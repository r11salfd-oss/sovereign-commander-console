/**
 * lsp_prober.ts — REAL Language Server Protocol reachability prober.
 *
 * Doctrine: a directory existing on disk is NOT evidence that a language server
 * is reachable. This module performs a genuine LSP base-protocol handshake over
 * stdio and reports only what was measured.
 *
 * Why this cannot reuse the MCP prober's transport: MCP speaks newline
 * delimited JSON-RPC. LSP speaks the "base protocol" — HTTP-style ASCII headers
 * terminated by \r\n\r\n, with a mandatory `Content-Length` header whose value
 * is the length of the content part **in bytes**, followed by a UTF-8 JSON body.
 * A newline-delimited reader fed an LSP server blocks forever on the header
 * block; an LSP reader fed an MCP server never finds `\r\n\r\n`. Separate
 * transport, separate parser. See LSP_PROBER.md.
 *
 * Spec references (fetched 2026-10-02):
 *  - LSP 3.17 §Base Protocol: header part is ASCII, each field terminated by
 *    \r\n, "two \r\n sequences always immediately precede the content part";
 *    `Content-Length` = "The length of the content part in bytes. This header
 *    is required."; `Content-Type` defaults to
 *    `application/vscode-jsonrpc; charset=utf-8` and utf-8 is the only
 *    supported charset (treat legacy `utf8` as `utf-8`).
 *  - §Lifecycle: `initialize` -> (result) -> `initialized` (once, before any
 *    other message) -> ... -> `shutdown` (await response) -> `exit`
 *    (exit code 0 iff shutdown was received, else 1).
 *  - InitializeResult: `capabilities` is REQUIRED, `serverInfo` optional
 *    (since 3.15).
 *  - InitializeParams: `processId` (parent pid or null), `rootUri` (required
 *    field, may be null), `capabilities` (required), optional `clientInfo`,
 *    `trace`, `workspaceFolders`.
 *
 * Host-side by necessity: the console container runs node:20-alpine as root
 * with `Mounts: []`, no PowerShell, no .NET runtime and no Python. No LSP
 * server on this machine is reachable from inside that container.
 *
 * Zero npm dependencies. The LSP libraries (`vscode-languageserver-protocol`,
 * `vscode-jsonrpc`) are NOT present in this repo and are deliberately not added;
 * the wire protocol is hand-rolled against the published spec.
 *
 * @module scripts/lsp_prober
 */

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { delimiter as PATH_DELIMITER, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Section 1 — Public result shapes (drop-in compatible with the MCP prober)
// ---------------------------------------------------------------------------

/**
 * Three-state semantics, identical in meaning to the MCP prober.
 *
 * - `ONLINE`       initialize returned a valid result AND capabilities observed.
 * - `OFFLINE`      conclusive: executable exists but is broken.
 * - `UNVERIFIABLE` could not be attempted or not concluded.
 */
export type LspProbeState = 'ONLINE' | 'OFFLINE' | 'UNVERIFIABLE';

/**
 * What an `lsp` inventory entry ACTUALLY IS.
 *
 * Doctrine: only a `language-server` may sit in the LSP reachability
 * denominator. Filing a compiler CLI, a linter CLI or a bare SDK under `lsp`
 * and then dividing by all of them is a miscategorisation, not a measurement —
 * it charges three real language servers for assets that were never LSP
 * endpoints. Nothing is deleted: every category is still declared, still probed
 * and still reported. Only the denominator is restricted, and both the declared
 * and the measurable totals are published side by side.
 *
 * The categories are the manifest's own conclusion, quoted per entry in
 * `categoryJustification` — e.g. `typescript`/`eslint`/`dotnet` are demoted on
 * the strength of this manifest's `note` and `handshakeBlockers` text, not on
 * this module's opinion.
 */
export type LspEntryCategory =
  | 'language-server'
  | 'compiler-cli'
  | 'linter-cli'
  | 'sdk-no-lsp-server'
  | 'unclassified';

/** Every category this module understands, in manifest order. */
export const LSP_ENTRY_CATEGORIES: readonly LspEntryCategory[] = [
  'language-server',
  'compiler-cli',
  'linter-cli',
  'sdk-no-lsp-server',
  'unclassified',
];

/**
 * The ONLY categories permitted in the reachability denominator.
 *
 * `unclassified` is deliberately excluded: an entry nobody has classified is
 * unmeasured, and unmeasured must never earn credit. Excluding it keeps a
 * missing `category` field on the conservative side (it can only lower a
 * score, never raise one).
 */
export const LSP_SCORE_DENOMINATOR_CATEGORIES: readonly LspEntryCategory[] = ['language-server'];

/** True when an entry of this category is entitled to sit in the denominator. */
export function isScoreableCategory(category: LspEntryCategory): boolean {
  return LSP_SCORE_DENOMINATOR_CATEGORIES.includes(category);
}

/**
 * Canonical wire value for the LSP probe method.
 *
 * MUST equal the literal in `scripts/host_prober_client.ts`
 * (`PROBE_METHOD_LSP_CONTENT_LENGTH`). That constant is consumed by the console
 * and by `parseLspReport`, which falls back to it when a row omits
 * `probeMethod`. Two different spellings would make the console display a probe
 * method the prober never claimed.
 */
export const PROBE_METHOD_LSP_CONTENT_LENGTH = 'lsp-jsonrpc-content-length';

/** Framing identifier carried by every LSP row, per the shared contract. */
export const LSP_FRAMING = 'CONTENT_LENGTH_HEADERS';

/** Why a probe ended the way it did. Drives ONLINE/OFFLINE/UNVERIFIABLE. */
export type LspFailureReason =
  | 'none'
  | 'not-declared-in-manifest'
  | 'launcher-not-found'
  | 'entry-directory-missing'
  | 'launcher-not-a-language-server'
  | 'spawn-failed'
  | 'dependency-missing'
  | 'platform-mismatch'
  | 'child-exited-early'
  | 'child-exited-nonzero'
  | 'framing-violation'
  | 'protocol-violation'
  | 'initialize-error-response'
  | 'initialize-timeout-silent'
  | 'total-deadline-exceeded'
  | 'io-error';

/** Outcome of the post-initialize capability probe request. */
export type LspCapabilityProbeOutcome =
  | 'answered'
  | 'answered-with-error'
  | 'no-capability-declared'
  | 'timeout'
  | 'not-reached';

/** Resolved, runnable LSP launcher. Never inferred — only discovered. */
export interface LspLauncher {
  /** `node` for JS entry points, or the absolute path of a host executable. */
  readonly command: string;
  readonly args: readonly string[];
  /** `node-script` | `host-executable` | `path-executable` */
  readonly kind: 'node-script' | 'host-executable' | 'path-executable';
  /** Provenance of the resolution, e.g. which .bin entry or PATH hit. */
  readonly evidence: string;
}

/** Aggregate capability summary — counts only, never a full capability dump. */
export interface LspCapabilityCounts {
  /** Top-level keys present in the server's `capabilities` object. */
  readonly total: number;
  /** Top-level `*Provider` capabilities advertised (boolean or object). */
  readonly providers: number;
  /** Top-level boolean capability flags (e.g. `hoverProvider: true`). */
  readonly booleanFlags: number;
  /** Key names of advertised `*Provider` capabilities. */
  readonly providerKeys: readonly string[];
  /** Number of top-level keys per capability namespace. */
  readonly namespaces: Readonly<Record<string, number>>;
}

export interface LspServerProbeResult {
  readonly id: string;
  readonly state: LspProbeState;
  /**
   * What this entry actually is, per the manifest's `category` field. Published
   * per row so no consumer has to infer it, and so the demoted entries remain
   * fully visible and individually accountable.
   */
  readonly category: LspEntryCategory;
  /**
   * True only for `category: language-server`. This is the flag the reachability
   * denominator is built from. A demoted entry keeps its state, its measurement
   * and its reason — it simply is not permitted to dilute the ratio.
   */
  readonly scoreable: boolean;
  /**
   * Operator-readable reason this entry is excluded from the denominator. An
   * exclusion nobody can read is indistinguishable from a quiet score adjustment,
   * so the manifest's justification travels with the measured row.
   */
  readonly categoryJustification?: string;
  readonly probeMethod: typeof PROBE_METHOD_LSP_CONTENT_LENGTH;
  readonly lastProbedAt: string;
  readonly durationMs: number;
  /** Always set, even when ONLINE; null when no launcher was resolved. */
  readonly reason: LspFailureReason;
  /** Operator-facing explanation. Empty string when ONLINE. */
  readonly detail: string;
  /** Manifest-declared state, reported separately from measured truth. */
  readonly declared: {
    readonly entry: string;
    readonly version: string;
    readonly source: string;
    readonly entryKind: string;
    readonly entryExists: boolean;
    /** The manifest's own claim, echoed for comparison. Never used as evidence. */
    readonly handshakeFeasibility: string;
    readonly handshakeBlockers: readonly string[];
  };
  readonly launcher: LspLauncher | null;
  /** Capabilitities as reported by the server's own `serverInfo`, if any. */
  readonly serverInfo: { readonly name: string; readonly version: string | null } | null;
  readonly capabilityCounts: LspCapabilityCounts | null;
  readonly capabilityProbe: {
    readonly method: string;
    readonly outcome: LspCapabilityProbeOutcome;
    readonly note: string;
  };
  readonly initialize: {
    readonly answered: boolean;
    readonly msToFirstResponse: number | null;
  };
  readonly shutdown: {
    /** Spec: exit code MUST be 0 if shutdown was received first, else 1. */
    readonly clean: boolean;
    readonly exitCode: number | null;
    readonly signal: string | null;
  };
}

export interface LspProbeReport {
  readonly summary: {
    /**
     * EVERY declared entry evaluated — one `servers[]` row each, no padding.
     *
     * This is the complete inventory and stays exactly that. It is NOT the
     * reachability denominator; see `measurableTotal`.
     */
    readonly total: number;
    /**
     * Alias of `total`, named for the consumer that would otherwise be misled.
     * The LSP inventory declared by the manifest, miscategorised entries
     * included.
     */
    readonly declaredTotal: number;
    /**
     * THE DENOMINATOR FOR REACHABILITY: declared entries whose category is
     * `language-server`. A compiler CLI, a linter CLI or a bare SDK is not
     * permitted to dilute the ratio of the servers that are.
     */
    readonly measurableTotal: number;
    /** ONLINE, restricted to `measurableTotal`. The score numerator. */
    readonly measurableOnline: number;
    /** OFFLINE, restricted to `measurableTotal`. */
    readonly measurableOffline: number;
    /** UNVERIFIABLE, restricted to `measurableTotal`. */
    readonly measurableUnverifiable: number;
    /** Declared entries that are NOT language servers, by category. */
    readonly nonLanguageServerTotal: number;
    readonly categoryCounts: Readonly<Record<LspEntryCategory, number>>;
    readonly online: number;
    readonly offline: number;
    readonly unverifiable: number;
    /**
     * Servers for which a genuine LSP handshake was even ATTEMPTED, i.e. a
     * runnable language-server launcher was resolved. This is the honest
     * denominator of measurable servers; it is frequently < total.
     */
    readonly measurable: number;
  };
  readonly denominator: {
    readonly declaredInManifest: number;
    /** Declared entries that are genuine language servers. */
    readonly declaredLanguageServers: number;
    /** Declared entries that exist as inventory but are not LSP endpoints. */
    readonly declaredNonLanguageServers: number;
    readonly declaredEntryDirectoryExists: number;
    readonly languageServerLauncherResolved: number;
    readonly handshakeCompleted: number;
    /** Plain-language statement of which number a consumer must divide by. */
    readonly scoreDenominator: string;
  };
  readonly servers: readonly LspServerProbeResult[];
  readonly generatedAt: string;
  readonly probeMethod: typeof PROBE_METHOD_LSP_CONTENT_LENGTH;
  readonly host: {
    readonly platform: string;
    readonly nodeVersion: string;
    readonly side: 'host';
    readonly workspaceRoot: string;
  };
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// Section 2 — Framing errors
// ---------------------------------------------------------------------------

export type LspFramingErrorCode =
  | 'header-section-too-large'
  | 'missing-content-length'
  | 'invalid-content-length'
  | 'content-length-too-large'
  | 'body-not-utf8'
  | 'body-not-json';

export class LspFramingError extends Error {
  readonly code: LspFramingErrorCode;
  readonly detail: string;

  constructor(code: LspFramingErrorCode, detail: string) {
    super(`LSP framing violation [${code}]: ${detail}`);
    this.name = 'LspFramingError';
    this.code = code;
    this.detail = detail;
  }
}

export class LspProtocolError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`LSP protocol violation: ${detail}`);
    this.name = 'LspProtocolError';
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Section 3 — LspFramer: incremental base-protocol decoder
// ---------------------------------------------------------------------------

export interface LspFramedMessage {
  /** Header names lowercased. Unknown/extra headers are retained, not rejected. */
  readonly headers: Readonly<Record<string, string>>;
  /** UTF-8 decoded content part. */
  readonly body: string;
  /** Raw content-part bytes — length must equal the `Content-Length` header. */
  readonly rawBody: Buffer;
}

export interface LspFramerOptions {
  /** Hard ceiling on a single content part. Default 8 MiB. */
  readonly maxContentLength?: number;
  /** Hard ceiling on the header section. Default 8 KiB. */
  readonly maxHeaderBytes?: number;
  /** Reject content parts that are not parseable JSON. Default true. */
  readonly strictJson?: boolean;
}

const DEFAULT_MAX_CONTENT_LENGTH = 8 * 1024 * 1024;
const DEFAULT_MAX_HEADER_BYTES = 8 * 1024;

/**
 * Locate the header/content separator.
 *
 * The spec mandates CRLF ("two \r\n sequences always immediately precede the
 * content part"). Real-world servers and proxies are not always disciplined, so
 * a bare LF is tolerated. The earliest of the two candidates wins, which is
 * unambiguous because CRLFCRLF contains no `\n\n`.
 */
function findHeaderSeparator(buf: Buffer): { readonly start: number; readonly length: number } | null {
  const crlf = buf.indexOf('\r\n\r\n', 0, 'latin1');
  const lf = buf.indexOf('\n\n', 0, 'latin1');
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { start: crlf, length: 4 };
  if (lf >= 0) return { start: lf, length: 2 };
  return null;
}

function parseHeaderSection(text: string): Record<string, string> {
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue; // malformed or empty header name: ignore
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name.length > 0) headers[name] = value;
  }
  return headers;
}

/**
 * Incremental LSP base-protocol frame decoder.
 *
 * Correctness properties this class is responsible for:
 *  1. Partial reads — a frame split across N chunk boundaries yields exactly one
 *     message once the final byte arrives. Internal buffer is a `Buffer`, never
 *     a string, so no byte is lost to a decode boundary.
 *  2. Multiple frames per chunk — returns an array, drains greedily.
 *  3. `Content-Length` is BYTES. Slicing happens on the `Buffer` before any
 *     text decoding, so a multi-byte payload is framed correctly. Using
 *     `String#length` would be wrong for any non-ASCII content.
 *  4. Bounded memory — an oversized `Content-Length` claim is rejected as a
 *     protocol violation *before* any allocation, so a hostile server cannot
 *     induce an 8 GiB buffer.
 */
export class LspFramer {
  readonly #maxContentLength: number;
  readonly #maxHeaderBytes: number;
  readonly #strictJson: boolean;
  readonly #decoder: TextDecoder;
  #pending: Buffer = Buffer.alloc(0);

  constructor(options: LspFramerOptions = {}) {
    this.#maxContentLength = options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
    this.#maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES;
    this.#strictJson = options.strictJson ?? true;
    // fatal:true so invalid UTF-8 surfaces as a violation instead of silently
    // producing U+FFFD replacement characters that would corrupt the JSON.
    this.#decoder = new TextDecoder('utf-8', { fatal: true });
  }

  /** Bytes currently held awaiting more input. Non-zero at EOF = truncated frame. */
  get bufferedBytes(): number {
    return this.#pending.length;
  }

  /** Bytes of the last successfully parsed content part. */
  get maxContentLength(): number {
    return this.#maxContentLength;
  }

  push(chunk: Buffer | string): LspFramedMessage[] {
    const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    this.#pending = this.#pending.length === 0 ? Buffer.from(incoming) : Buffer.concat([this.#pending, incoming]);

    const messages: LspFramedMessage[] = [];
    for (;;) {
      const separator = findHeaderSeparator(this.#pending);
      if (separator === null) {
        if (this.#pending.length > this.#maxHeaderBytes) {
          const held = this.#pending.length;
          this.reset();
          throw new LspFramingError(
            'header-section-too-large',
            `no header terminator within ${held} bytes (limit ${this.#maxHeaderBytes})`,
          );
        }
        break;
      }
      if (separator.start > this.#maxHeaderBytes) {
        const size = separator.start;
        this.reset();
        throw new LspFramingError(
          'header-section-too-large',
          `header section of ${size} bytes exceeds limit ${this.#maxHeaderBytes}`,
        );
      }

      const headers = parseHeaderSection(this.#pending.subarray(0, separator.start).toString('latin1'));
      const rawLength = headers['content-length'];
      if (rawLength === undefined || rawLength.length === 0) {
        const seen = Object.keys(headers).join(', ') || '<none>';
        this.reset();
        throw new LspFramingError('missing-content-length', `frame headers [${seen}] omit the required Content-Length`);
      }
      if (!/^[0-9]+$/.test(rawLength)) {
        this.reset();
        throw new LspFramingError('invalid-content-length', `Content-Length "${rawLength}" is not an unsigned integer`);
      }
      const contentLength = Number(rawLength);
      if (!Number.isSafeInteger(contentLength)) {
        this.reset();
        throw new LspFramingError('invalid-content-length', `Content-Length "${rawLength}" is not a safe integer`);
      }
      if (contentLength > this.#maxContentLength) {
        this.reset();
        throw new LspFramingError(
          'content-length-too-large',
          `claimed ${contentLength} bytes exceeds limit ${this.#maxContentLength}`,
        );
      }

      const bodyStart = separator.start + separator.length;
      const available = this.#pending.length - bodyStart;
      if (available < contentLength) break; // frame not fully buffered yet

      const rawBody = Buffer.from(this.#pending.subarray(bodyStart, bodyStart + contentLength));
      let body: string;
      try {
        body = this.#decoder.decode(rawBody);
      } catch {
        this.reset();
        throw new LspFramingError('body-not-utf8', `content part of ${contentLength} bytes is not valid UTF-8`);
      }
      if (this.#strictJson) {
        try {
          JSON.parse(body);
        } catch (err) {
          this.reset();
          const msg = err instanceof Error ? err.message : String(err);
          throw new LspFramingError('body-not-json', `content part is not valid JSON: ${msg}`);
        }
      }

      messages.push({ headers, body, rawBody });
      this.#pending = Buffer.from(this.#pending.subarray(bodyStart + contentLength));
    }
    return messages;
  }

  reset(): void {
    this.#pending = Buffer.alloc(0);
  }
}

/** Encode a JSON-RPC payload as one complete base-protocol frame. */
export function encodeLspFrame(payload: unknown, extraHeaders: Readonly<Record<string, string>> = {}): Buffer {
  const json = JSON.stringify(payload);
  // BYTE length, not character length. This is the single most common bug in
  // hand-rolled LSP clients and it silently corrupts every non-ASCII payload.
  const contentLength = Buffer.byteLength(json, 'utf8');
  const lines = [`Content-Length: ${contentLength}`];
  for (const [name, value] of Object.entries(extraHeaders)) {
    lines.push(`${name}: ${value}`);
  }
  const header = `${lines.join('\r\n')}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(json, 'utf8')]);
}

// ---------------------------------------------------------------------------
// Section 4 — JSON-RPC message helpers
// ---------------------------------------------------------------------------

export interface JsonRpcResponse {
  readonly jsonrpc: string;
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export interface JsonRpcNotification {
  readonly jsonrpc: string;
  readonly method: string;
  readonly params?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isResponse(value: unknown): value is JsonRpcResponse {
  const record = asRecord(value);
  return record !== null && ('result' in record || 'error' in record);
}

function parseIncoming(body: string): { readonly response?: JsonRpcResponse; readonly notification?: JsonRpcNotification } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new LspProtocolError(`content part is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const record = asRecord(parsed);
  if (record === null) throw new LspProtocolError('content part is not a JSON object');
  if (record['jsonrpc'] !== '2.0') {
    throw new LspProtocolError(`jsonrpc member must be the string "2.0", got ${JSON.stringify(record['jsonrpc'])}`);
  }
  if (isResponse(parsed)) {
    const response = parsed as JsonRpcResponse;
    const hasResult = 'result' in record;
    const hasError = 'error' in record;
    if (hasResult && hasError) throw new LspProtocolError('response carries both `result` and `error`');
    if (!hasResult && !hasError) throw new LspProtocolError('response carries neither `result` nor `error`');
    if (hasError) {
      const err = asRecord(record['error']);
      if (err === null) throw new LspProtocolError('`error` member is not an object');
      if (typeof err['code'] !== 'number' || typeof err['message'] !== 'string') {
        throw new LspProtocolError('`error` object requires numeric `code` and string `message`');
      }
    }
    return { response };
  }
  if (typeof record['method'] === 'string') {
    return { notification: record as unknown as JsonRpcNotification };
  }
  throw new LspProtocolError('message is neither a response nor a notification');
}

// ---------------------------------------------------------------------------
// Section 5 — Process session: spawn + frame I/O + guaranteed teardown
// ---------------------------------------------------------------------------

interface PendingRequest {
  readonly method: string;
  readonly settle: (error: Error | null, response?: JsonRpcResponse) => void;
  readonly timer: NodeJS.Timeout;
}

export interface LspSessionOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly maxContentLength?: number;
  readonly maxStderrBytes?: number;
}

export type SessionEvent =
  | { readonly type: 'response'; readonly response: JsonRpcResponse }
  | { readonly type: 'notification'; readonly notification: JsonRpcNotification }
  | { readonly type: 'framing-error'; readonly error: LspFramingError }
  | { readonly type: 'protocol-error'; readonly error: LspProtocolError }
  | { readonly type: 'spawn-error'; readonly error: Error }
  | { readonly type: 'exit'; readonly code: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly type: 'stderr'; readonly text: string };

const MAX_STDERR_BYTES = 8 * 1024;

/**
 * Kill a process and its descendants.
 *
 * On Windows `child.kill()` terminates only the direct child; a language server
 * that has spawned helpers (tsserver, node --inspect wrappers) would survive.
 * `taskkill /T` walks the tree. Non-Windows falls back to signals.
 */
function killProcessTree(pid: number | undefined): void {
  if (pid === undefined || pid <= 0) return;
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        /* best effort */
      });
      killer.unref();
      return;
    } catch {
      /* fall through to signal-based kill */
    }
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

/**
 * One LSP server process, framed over stdio.
 *
 * Cleanup is guaranteed: `dispose()` is idempotent, kills the process tree and
 * rejects every in-flight request, so no caller can leave an orphan.
 */
export class LspProcessSession {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #framer: LspFramer;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #listeners = new Set<(event: SessionEvent) => void>();
  readonly #stderr: string[] = [];
  readonly #maxStderrBytes: number;
  #stderrBytes = 0;
  #nextId = 1;
  #disposed = false;
  #exited = false;
  #lastExit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | null = null;
  readonly #exitPromise: Promise<void>;
  #resolveExit!: () => void;

  constructor(options: LspSessionOptions) {
    this.#maxStderrBytes = options.maxStderrBytes ?? MAX_STDERR_BYTES;
    this.#framer = new LspFramer(
      options.maxContentLength === undefined ? {} : { maxContentLength: options.maxContentLength },
    );
    this.#exitPromise = new Promise((resolveExit) => {
      this.#resolveExit = resolveExit;
    });

    this.#child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: { ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    }) as ChildProcessWithoutNullStreams;

    this.#child.stdout.on('data', (chunk: Buffer) => this.#ingest(chunk));
    this.#child.stderr.on('data', (chunk: Buffer) => this.#ingestStderr(chunk));
    this.#child.stdin.on('error', () => {
      /* server may close stdin before we finish writing; teardown handles it */
    });
    this.#child.on('error', (error: Error) => this.#emit({ type: 'spawn-error', error }));
    this.#child.on('exit', (code, signal) => {
      this.#exited = true;
      this.#lastExit = { code, signal };
      this.#failAllPending(
        new Error(`language server exited (code=${String(code)}, signal=${String(signal)}) before responding`),
      );
      this.#emit({ type: 'exit', code, signal });
      this.#resolveExit();
    });
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  get exited(): boolean {
    return this.#exited;
  }

  /** Populated once the `exit` event has fired. */
  get exitInfo(): { readonly code: number | null; readonly signal: NodeJS.Signals | null } | null {
    return this.#lastExit;
  }

  /** Bytes buffered by the framer at EOF — non-zero means a truncated frame. */
  get bufferedBytes(): number {
    return this.#framer.bufferedBytes;
  }

  get stderrText(): string {
    return this.#stderr.join('');
  }

  /**
   * Wait for the process to exit, or for `timeoutMs` to elapse.
   *
   * On Windows the `exit` event can precede stdio drain, so callers should read
   * `bufferedBytes` after this resolves rather than assuming a clean channel.
   * Resolves `true` when exit was observed, `false` on timeout.
   */
  waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.#exited) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      // NOTE: this timer is deliberately NOT unref'd. An unref'd timer does not
      // hold the event loop open, so once the child exits and releases its
      // handle the loop can drain and this await never resumes — the probe
      // would then exit 0 having emitted nothing.
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.#exitPromise.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  onEvent(listener: (event: SessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: SessionEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        /* a misbehaving listener must not break framing */
      }
    }
  }

  #ingestStderr(chunk: Buffer): void {
    if (this.#stderrBytes >= this.#maxStderrBytes) return;
    const remaining = this.#maxStderrBytes - this.#stderrBytes;
    const slice = chunk.subarray(0, remaining);
    this.#stderrBytes += slice.length;
    const text = slice.toString('utf8');
    this.#stderr.push(text);
    this.#emit({ type: 'stderr', text });
  }

  #ingest(chunk: Buffer): void {
    let frames: LspFramedMessage[];
    try {
      frames = this.#framer.push(chunk);
    } catch (err) {
      if (err instanceof LspFramingError) {
        this.#failAllPending(err);
        this.#emit({ type: 'framing-error', error: err });
      }
      return;
    }
    for (const frame of frames) {
      let parsed: ReturnType<typeof parseIncoming>;
      try {
        parsed = parseIncoming(frame.body);
      } catch (err) {
        const error = err instanceof LspProtocolError ? err : new LspProtocolError(String(err));
        this.#failAllPending(error);
        this.#emit({ type: 'protocol-error', error });
        continue;
      }
      if (parsed.response !== undefined) {
        this.#emit({ type: 'response', response: parsed.response });
        this.#settleResponse(parsed.response);
        continue;
      }
      if (parsed.notification !== undefined) this.#emit({ type: 'notification', notification: parsed.notification });
    }
  }

  #settleResponse(response: JsonRpcResponse): void {
    if (typeof response.id !== 'number') return; // server-initiated request; this prober ignores them
    const pending = this.#pending.get(response.id);
    if (pending === undefined) return;
    this.#pending.delete(response.id);
    clearTimeout(pending.timer);
    pending.settle(null, response);
  }

  #failAllPending(error: Error): void {
    if (this.#pending.size === 0) return;
    const entries = [...this.#pending.values()];
    this.#pending.clear();
    for (const pending of entries) {
      clearTimeout(pending.timer);
      pending.settle(error);
    }
  }

  /** Issue a JSON-RPC request and await the matching response. */
  request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcResponse> {
    if (this.#disposed) return Promise.reject(new Error('session already disposed'));
    if (this.#exited) return Promise.reject(new Error('language server process has already exited'));
    const id = this.#nextId++;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const settle = (error: Error | null, response?: JsonRpcResponse): void => {
        if (error !== null) reject(error);
        else resolve(response as JsonRpcResponse);
      };
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        settle(new Error(`timeout after ${timeoutMs}ms awaiting response to "${method}" (id=${id})`));
      }, timeoutMs);
      // Referenced on purpose: this timer is the only thing that guarantees the
      // awaiting caller observes a timeout. See waitForExit.
      this.#pending.set(id, { method, settle, timer });
      try {
        this.#child.stdin.write(encodeLspFrame({ jsonrpc: '2.0', id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.#pending.delete(id);
        settle(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Fire-and-forget notification. No id, so no response is ever expected. */
  notify(method: string, params: unknown): void {
    if (this.#disposed || this.#exited) return;
    try {
      this.#child.stdin.write(encodeLspFrame({ jsonrpc: '2.0', method, params }));
    } catch {
      /* teardown path */
    }
  }

  /** Idempotent teardown. Kills the process tree; no orphans. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#failAllPending(new Error('session disposed'));
    this.#listeners.clear();
    killProcessTree(this.#child.pid);
    try {
      this.#child.stdin.destroy();
    } catch {
      /* already closed */
    }
  }
}

// ---------------------------------------------------------------------------
// Section 6 — Launcher resolution (evidence-based; never inferred)
// ---------------------------------------------------------------------------

/** Extra argv each server needs before it will speak LSP on stdio. */
const LAUNCHER_ARGS: Readonly<Record<string, readonly string[]>> = {
  bash: ['start'],
  yaml: ['--stdio'],
  pyright: ['--stdio'],
};

/**
 * Fallback environment pass-through, used only when the manifest declares none.
 *
 * MEASURED on this host (2026-10-02), not assumed. `pyright-langserver` is a
 * CPython entry-point shim and the `pyright` package lives in the PER-USER
 * site-packages under `%APPDATA%\Python\Python314\site-packages`. CPython
 * derives the user-site directory from `%APPDATA%`, so a child launched without
 * APPDATA cannot import the package and the interpreter exits 1 with
 * `ModuleNotFoundError: No module named 'pyright'` before writing a byte to
 * stdout — which the prober correctly, but misleadingly, reports as
 * `EXIT_NONZERO_BEFORE_HANDSHAKE`.
 *
 * Reproduced and bisected: the host prober's four-variable child environment
 * fails in ~85ms; the same environment plus APPDATA answers `initialize` in
 * ~340ms. HOMEDRIVE/HOMEPATH alone do NOT fix it, which is what identifies
 * APPDATA specifically as the variable CPython needs.
 *
 * NAMES ONLY. No value is ever read here, logged, or written to the report.
 */
const LAUNCHER_ENV_PASSTHROUGH: Readonly<Record<string, readonly string[]>> = {
  pyright: ['APPDATA'],
};

/**
 * Candidates used only when the manifest does not authorise any. The
 * manifest's `command.launcherCandidates` is authoritative when present.
 *
 * This table is the load-bearing part of the anti-fabrication design: a `.bin`
 * directory containing `tsc`, `tsserver` or `eslint` does NOT make a language
 * server. Those are a compiler CLI, a compiler daemon and a linter CLI, each
 * with its own non-LSP protocol. Accepting them would recreate the very defect
 * being eliminated.
 */
const FALLBACK_LSP_BINARIES: Readonly<Record<string, readonly string[]>> = {
  typescript: ['typescript-language-server', 'vscode-typescript-language-server'],
  eslint: ['eslint-language-server', 'vscode-eslint-language-server'],
  bash: ['bash-language-server'],
  yaml: ['yaml-language-server'],
  pyright: ['pyright-langserver'],
  dotnet: ['omnisharp', 'csharp-ls'],
};

/** languageId used for the scratch document handed to each server. */
const LANGUAGE_IDS: Readonly<Record<string, string>> = {
  typescript: 'typescript',
  eslint: 'typescript',
  bash: 'shellscript',
  yaml: 'yaml',
  pyright: 'python',
  dotnet: 'csharp',
};

export interface LauncherResolution {
  readonly launcher: LspLauncher | null;
  readonly reason: LspFailureReason;
  readonly detail: string;
  /** Entry directory exists? Reported so a missing dir is distinguishable. */
  readonly entryExists: boolean;
}

function whichSync(commandName: string): string | null {
  const pathEnv = process.env['PATH'] ?? '';
  const extensions =
    process.platform === 'win32'
      ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((value) => value.length > 0)
      : [''];
  for (const directory of pathEnv.split(PATH_DELIMITER)) {
    if (directory.length === 0) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${commandName}${extension}`);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        /* unreadable PATH entry */
      }
    }
  }
  return null;
}

function listBinNames(binDir: string): readonly string[] {
  try {
    return readdirSync(binDir)
      .filter((name) => !name.endsWith('.cmd') && !name.endsWith('.ps1'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolve a declared LSP server to a runnable command.
 *
 * Order of evidence:
 *   1. `<entry>/node_modules/<binName>/package.json` `bin` field -> spawn with node.
 *   2. `<binName>` on PATH -> spawn the executable directly.
 * If neither matches, the server is UNVERIFIABLE and the reason names exactly
 * what was required and what was actually found (binary names only).
 *
 * `candidates` comes from the manifest when it authorises any; otherwise the
 * built-in table is used. `args` likewise.
 */
export function resolveLauncher(
  serverId: string,
  entryAbsoluteDir: string,
  declaredCandidates: readonly string[] = [],
  declaredArgs: readonly string[] | null = null,
): LauncherResolution {
  const candidates =
    declaredCandidates.length > 0
      ? declaredCandidates
      : FALLBACK_LSP_BINARIES[serverId] ?? [];
  const extraArgs = declaredArgs ?? LAUNCHER_ARGS[serverId] ?? [];

  // An omitted `entry` means "no Servers Center asset", which must NOT be
  // confused with the Servers Center root itself.
  const entryExists = declaredCandidates.length > 0 || entryAbsoluteDir.length > 0 ? existsSync(entryAbsoluteDir) : false;

  if (candidates.length === 0) {
    return {
      launcher: null,
      reason: 'launcher-not-found',
      detail: `manifest authorises no launcherCandidates for "${serverId}"`,
      entryExists,
    };
  }

  const foundInBin: readonly string[] = entryExists
    ? listBinNames(join(entryAbsoluteDir, 'node_modules', '.bin'))
    : [];

  for (const binName of candidates) {
    // Evidence path 1 — owning package inside the declared entry.
    if (entryExists) {
      const pkgDir = join(entryAbsoluteDir, 'node_modules', binName);
      const pkgJsonPath = join(pkgDir, 'package.json');
      if (existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
            bin?: string | Record<string, string>;
          };
          const binField = pkg.bin;
          const scriptRelative =
            typeof binField === 'string'
              ? binField
              : typeof binField === 'object' && binField !== null
                ? binField[binName]
                : undefined;
          if (scriptRelative !== undefined) {
            const scriptAbsolute = resolvePath(pkgDir, scriptRelative);
            if (existsSync(scriptAbsolute)) {
              return {
                launcher: {
                  command: process.execPath,
                  args: [scriptAbsolute, ...extraArgs],
                  kind: 'node-script',
                  evidence: `node_modules/${binName}/package.json bin -> ${scriptAbsolute}`,
                },
                reason: 'none',
                detail: '',
                entryExists,
              };
            }
          }
        } catch (err) {
          return {
            launcher: null,
            reason: 'dependency-missing',
            detail: `node_modules/${binName}/package.json is unreadable: ${errMessage(err)}`,
            entryExists,
          };
        }
      }
    }

    // Evidence path 2 — PATH lookup (how host-installed servers are found).
    const onPath = whichSync(binName);
    if (onPath !== null) {
      return {
        launcher: {
          command: onPath,
          args: [...extraArgs],
          kind: process.platform === 'win32' ? 'path-executable' : 'host-executable',
          evidence: `PATH lookup for "${binName}" resolved ${onPath}`,
        },
        reason: 'none',
        detail: '',
        entryExists,
      };
    }
  }

  // Nothing matched. Classify why, honestly and specifically.
  const inventory =
    foundInBin.length > 0
      ? `the entry directory's .bin holds [${foundInBin.join(', ')}]`
      : entryExists
        ? 'the entry directory exposes no .bin inventory'
        : 'no Servers Center asset is declared for this server';
  const location = entryExists ? `under ${entryAbsoluteDir} or on PATH` : 'on PATH';
  return {
    launcher: null,
    reason: entryExists ? 'launcher-not-a-language-server' : 'entry-directory-missing',
    detail: `no LSP launcher found. Required one of [${candidates.join(', ')}] ${location}; ${inventory}`,
    entryExists,
  };
}

// ---------------------------------------------------------------------------
// Section 7 — Handshake state machine
// ---------------------------------------------------------------------------

export interface ProbeOptions {
  readonly id: string;
  readonly declaredEntry: string;
  readonly declaredVersion: string;
  readonly declaredSource: string;
  readonly declaredEntryKind: string;
  readonly declaredCategory: LspEntryCategory;
  readonly declaredCategoryJustification?: string;
  readonly declaredLauncherCandidates: readonly string[];
  readonly declaredArgs: readonly string[] | null;
  /** Env var NAMES the launcher needs; resolved from process.env at spawn. */
  readonly declaredEnvPassThrough: readonly string[] | null;
  readonly declaredFeasibility: string;
  readonly declaredBlockers: readonly string[];
  readonly serversCenterRoot: string;
  readonly workspaceRoot: string;
  readonly stepTimeoutMs: number;
  readonly totalDeadlineMs: number;
  /**
   * Separate, shorter budget for the optional capability probe. A server can
   * legitimately be slow to answer its first real request (it is indexing a
   * workspace) while having completed `initialize` correctly. The probe is
   * corroborating evidence only, so it gets its own cap and a timeout here does
   * NOT downgrade an otherwise-valid ONLINE verdict.
   */
  readonly probeTimeoutMs: number;
  readonly nodeEnv: Readonly<Record<string, string>>;
  /** Operator diagnostics. Writes to stderr only; never to the JSON channel. */
  readonly trace?: (message: string) => void;
}

const PROBE_CLIENT_INFO = { name: 'sovereign-commander-console-lsp-prober', version: '1.0.0' } as const;

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  window: { workDoneProgress: true },
  workspace: {
    workspaceFolders: true,
    configuration: true,
    didChangeConfiguration: { dynamicRegistration: true },
  },
  textDocument: {
    synchronization: { dynamicRegistration: true, didSave: true },
    publishDiagnostics: { relatedInformation: true, versionSupport: true },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    definition: { linkSupport: true },
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    completion: { completionItem: { snippetSupport: true } },
  },
} as const;

/**
 * Capability probe ladder, cheapest first. Each entry names the server
 * capability key that must be truthy before the request is worth sending.
 */
const PROBE_LADDER: readonly {
  readonly capabilityKey: string;
  readonly method: string;
  readonly params: (uri: string) => unknown;
}[] = [
  {
    capabilityKey: 'hoverProvider',
    method: 'textDocument/hover',
    params: (uri) => ({ textDocument: { uri }, position: { line: 0, character: 0 } }),
  },
  {
    capabilityKey: 'definitionProvider',
    method: 'textDocument/definition',
    params: (uri) => ({ textDocument: { uri }, position: { line: 0, character: 0 } }),
  },
  {
    capabilityKey: 'documentSymbolProvider',
    method: 'textDocument/documentSymbol',
    params: (uri) => ({ textDocument: { uri } }),
  },
  {
    capabilityKey: 'completionProvider',
    method: 'textDocument/completion',
    params: (uri) => ({ textDocument: { uri }, position: { line: 0, character: 0 } }),
  },
  {
    capabilityKey: 'workspaceSymbolProvider',
    method: 'workspace/symbol',
    params: () => ({ query: '' }),
  },
];

const SCRATCH_DOCUMENTS: Readonly<Record<string, { readonly ext: string; readonly languageId: string; readonly text: string }>> = {
  typescript: { ext: 'ts', languageId: 'typescript', text: 'const probe: number = 1;\n' },
  eslint: { ext: 'ts', languageId: 'typescript', text: 'const probe: number = 1;\n' },
  bash: { ext: 'sh', languageId: 'shellscript', text: 'probe()\n' },
  yaml: { ext: 'yaml', languageId: 'yaml', text: 'probe: 1\n' },
  pyright: { ext: 'py', languageId: 'python', text: 'probe: int = 1\n' },
  dotnet: { ext: 'cs', languageId: 'csharp', text: 'class Probe { }\n' },
};

function emptyCounts(): LspCapabilityCounts {
  return { total: 0, providers: 0, booleanFlags: 0, providerKeys: [], namespaces: {} };
}

/**
 * Summarise a `ServerCapabilities` object into counts.
 *
 * Deliberately lossy: the console needs to know a server is feature-bearing,
 * not to receive a multi-kilobyte capability tree that varies per server.
 */
export function summariseCapabilities(raw: unknown): LspCapabilityCounts {
  const record = asRecord(raw);
  if (record === null) return emptyCounts();
  const keys = Object.keys(record);
  const providerKeys: string[] = [];
  const namespaces: Record<string, number> = {};
  let booleanFlags = 0;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') booleanFlags += 1;
    if (key.endsWith('Provider')) providerKeys.push(key);
    const namespace = key.includes('/') ? (key.split('/')[0] as string) : 'core';
    namespaces[namespace] = (namespaces[namespace] ?? 0) + 1;
  }
  return {
    total: keys.length,
    providers: providerKeys.length,
    booleanFlags,
    providerKeys: providerKeys.sort(),
    namespaces,
  };
}

function redact(text: string): string {
  // Language servers log paths and occasionally config; never echo anything
  // that looks like an assignment to a secret-shaped key.
  return text
    .replace(/((?:api[_-]?key|token|secret|password|passwd|credential)["']?\s*[:=]\s*)["']?[^\s"',}]+["']?/gi, '$1<redacted>')
    .slice(0, 400)
    .replace(/\r?\n/g, ' | ');
}

interface ProbeFailure {
  readonly state: LspProbeState;
  readonly reason: LspFailureReason;
  readonly detail: string;
}

function unverified(reason: LspFailureReason, detail: string): ProbeFailure {
  return { state: 'UNVERIFIABLE', reason, detail };
}

function offline(reason: LspFailureReason, detail: string): ProbeFailure {
  return { state: 'OFFLINE', reason, detail };
}

/**
 * Timeout sentinel. Deliberately a prefixed message rather than a custom class
 * so the timeout can originate inside the request layer and still be
 * discriminated here. Note: TypeScript 5.5+ infers type predicates for
 * `boolean`-returning functions, so this helper returns a plain string|null
 * to avoid narrowing `unknown` to `never` at call sites.
 */
function timeoutDetail(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return error.message.startsWith('timeout after') ? error.message : null;
}

/** Safely extract a message from an unknown thrown value. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Execute the full LSP lifecycle against one server.
 *
 * Sequence (spec-mandated ordering):
 *   spawn -> initialize -> await result -> initialized -> didOpen(scratch)
 *         -> one declared-capability request -> didClose -> shutdown
 *         -> await result -> exit -> await stdio close
 *
 * Every path out of this function calls `session.dispose()`, which kills the
 * process tree. A timeout is UNVERIFIABLE (silence is not proof of failure and
 * not proof of reachability); a protocol violation or explicit error response
 * is OFFLINE (the executable exists and demonstrably misbehaves).
 */
export async function probeLspServer(options: ProbeOptions): Promise<LspServerProbeResult> {
  const startedAt = Date.now();
  const lastProbedAt = new Date(startedAt).toISOString();
  const trace = (message: string): void => {
    options.trace?.(`[${options.id}] +${String(Date.now() - startedAt)}ms ${message}`);
  };
  trace('resolving launcher');

  const entryAbsoluteDir =
    options.declaredEntry.length > 0 ? resolvePath(options.serversCenterRoot, options.declaredEntry) : '';
  const resolution = resolveLauncher(
    options.id,
    entryAbsoluteDir,
    options.declaredLauncherCandidates,
    options.declaredArgs,
  );
  trace(
    resolution.launcher === null
      ? `no launcher (${resolution.reason}): ${resolution.detail}`
      : `launcher ${resolution.launcher.command} ${resolution.launcher.args.join(' ')}`,
  );

  const base = {
    id: options.id,
    category: options.declaredCategory,
    // Recorded here so the score denominator is auditable from any single row,
    // not only from the aggregate.
    scoreable: isScoreableCategory(options.declaredCategory),
    categoryJustification: options.declaredCategoryJustification,
    probeMethod: PROBE_METHOD_LSP_CONTENT_LENGTH as typeof PROBE_METHOD_LSP_CONTENT_LENGTH,
    lastProbedAt,
    declared: {
      entry: options.declaredEntry,
      version: options.declaredVersion,
      source: options.declaredSource,
      entryKind: options.declaredEntryKind,
      entryExists: resolution.entryExists,
      handshakeFeasibility: options.declaredFeasibility,
      handshakeBlockers: options.declaredBlockers,
    },
  };

  const finish = (
    failure: ProbeFailure,
    extra: {
      readonly launcher: LspLauncher | null;
      readonly serverInfo?: { readonly name: string; readonly version: string | null } | null;
      readonly capabilityCounts?: LspCapabilityCounts | null;
      readonly capabilityProbe?: LspServerProbeResult['capabilityProbe'];
      readonly initialize?: LspServerProbeResult['initialize'];
      readonly shutdown?: LspServerProbeResult['shutdown'];
    },
  ): LspServerProbeResult => ({
    ...base,
    state: failure.state,
    durationMs: Date.now() - startedAt,
    reason: failure.reason,
    detail: failure.detail,
    launcher: extra.launcher,
    serverInfo: extra.serverInfo ?? null,
    capabilityCounts: extra.capabilityCounts ?? null,
    capabilityProbe:
      extra.capabilityProbe ?? { method: '', outcome: 'not-reached', note: 'handshake did not reach the capability probe' },
    initialize: extra.initialize ?? { answered: false, msToFirstResponse: null },
    shutdown: extra.shutdown ?? { clean: false, exitCode: null, signal: null },
  });

  if (resolution.launcher === null) {
    return finish(unverified(resolution.reason, resolution.detail), { launcher: null });
  }

  const launcher = resolution.launcher;
  const env: Record<string, string> = {
    ...options.nodeEnv,
    // Keep probe side effects minimal and greppable.
    ELECTRON_RUN_AS_NODE: '1',
  };

  // Declared environment pass-through. The host prober deliberately hands down a
  // four-variable environment (PATH/SystemRoot/PATHEXT/ComSpec) so no host secret
  // is inherited. That is correct policy, but it is insufficient for a launcher
  // that is an INTERPRETER shim: a CPython entry point cannot locate a per-user
  // site-packages without %APPDATA%, and dies before speaking any protocol.
  //
  // Only NAMES declared by the manifest (or by the measured fallback table) are
  // read, only from the prober's own process.env, and only when present. No
  // value is logged or published. An absent variable is reported as absent rather
  // than substituted, so a genuine missing-variable failure stays visible instead
  // of being masked by an invented default.
  const requestedEnv =
    options.declaredEnvPassThrough !== null && options.declaredEnvPassThrough.length > 0
      ? options.declaredEnvPassThrough
      : LAUNCHER_ENV_PASSTHROUGH[options.id] ?? [];
  const injectedEnvNames: string[] = [];
  const missingEnvNames: string[] = [];
  for (const name of requestedEnv) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) {
      env[name] = value;
      injectedEnvNames.push(name);
    } else {
      missingEnvNames.push(name);
    }
  }
  if (injectedEnvNames.length > 0) trace(`injected declared env: ${injectedEnvNames.join(', ')} (values never logged)`);
  if (missingEnvNames.length > 0) {
    trace(`declared env absent from this host and NOT injected: ${missingEnvNames.join(', ')}`);
  }

  let session: LspProcessSession;
  try {
    session = new LspProcessSession({
      command: launcher.command,
      args: launcher.args,
      cwd: options.workspaceRoot,
      env,
    });
    trace(`spawned pid=${String(session.pid)}`);
  } catch (err) {
    return finish(
      unverified('spawn-failed', `could not spawn launcher: ${err instanceof Error ? err.message : String(err)}`),
      { launcher },
    );
  }

  // Collected in arrays rather than nullable locals: TypeScript's control-flow
  // analysis does not track assignments made inside the event callback, and a
  // `let x: T | null` would be narrowed to `never` at every read site.
  const framingErrors: LspFramingError[] = [];
  const protocolErrors: LspProtocolError[] = [];
  const spawnErrors: Error[] = [];
  const notificationMethods: string[] = [];
  const firstFramingError = (): LspFramingError | null => framingErrors[0] ?? null;
  const firstProtocolError = (): LspProtocolError | null => protocolErrors[0] ?? null;
  const firstSpawnError = (): Error | null => spawnErrors[0] ?? null;
  const unsubscribe = session.onEvent((event) => {
    if (event.type === 'framing-error') framingErrors.push(event.error);
    else if (event.type === 'protocol-error') protocolErrors.push(event.error);
    else if (event.type === 'spawn-error') spawnErrors.push(event.error);
    else if (event.type === 'notification') notificationMethods.push(event.notification.method);
  });

  const remainingBudget = (): number => Math.max(1, options.totalDeadlineMs - (Date.now() - startedAt));
    const budget = (): number => Math.min(options.stepTimeoutMs, remainingBudget());

    trace(`sending initialize (budget=${String(budget())}ms)`);
    try {
    // --- Step 1: initialize -------------------------------------------------
    const scratch = SCRATCH_DOCUMENTS[options.id] ?? { ext: 'txt', languageId: 'plaintext', text: '' };
    const languageId = LANGUAGE_IDS[options.id] ?? scratch.languageId;
    const docUri = `file:///${options.workspaceRoot.replace(/\\/g, '/').replace(/^\//, '')}/probe.${scratch.ext}`;

    let initializeResponse: JsonRpcResponse;
    try {
      initializeResponse = await session.request(
        'initialize',
        {
          processId: process.pid,
          clientInfo: PROBE_CLIENT_INFO,
          locale: 'en',
          rootUri: `file:///${options.workspaceRoot.replace(/\\/g, '/').replace(/^\//, '')}`,
          capabilities: CLIENT_CAPABILITIES,
          trace: 'off',
          workspaceFolders: [
            { uri: `file:///${options.workspaceRoot.replace(/\\/g, '/').replace(/^\//, '')}`, name: 'lsp-prober-scratch' },
          ],
          initializationOptions: {},
        },
        budget(),
      );
    } catch (err) {
      const framingError = firstFramingError();
      const protocolError = firstProtocolError();
      const spawnErr = firstSpawnError();
      const timedOut = err instanceof Error && err.message.startsWith('timeout after');
      if (framingError !== null) {
        return finish(offline('framing-violation', redact(framingError.message)), { launcher });
      }
      if (protocolError !== null) {
        return finish(offline('protocol-violation', redact(protocolError.message)), { launcher });
      }
      if (spawnErr !== null) {
        return finish(unverified('dependency-missing', `spawn failed: ${redact(spawnErr.message)}`), { launcher });
      }
      if (session.exited) {
        const stderr = session.stderrText;
        // The interpreter's own traceback is the primary evidence here and it is
        // the ONLY thing that distinguishes "this server is broken" from "the
        // launcher could not boot in the environment we gave it". Publish the
        // exit code and the full captured stderr, and name the launcher argv.
        const launch = `${launcher.command}${launcher.args.length > 0 ? ` ${launcher.args.join(' ')}` : ''}`;
        return finish(
          offline(
            'child-exited-early',
            `process exited (code=${String(session.exitInfo?.code)}, signal=${String(session.exitInfo?.signal)}) ` +
              `before answering initialize; launched as [${launch}]` +
              (injectedEnvNames.length > 0 ? ` with declared env [${injectedEnvNames.join(', ')}]` : ' with NO declared env injected') +
              (missingEnvNames.length > 0 ? `, declared-but-absent [${missingEnvNames.join(', ')}]` : '') +
              (stderr.length > 0 ? `. Interpreter output: ${redact(stderr)}` : '. The interpreter produced no output on stderr.'),
          ),
          { launcher },
        );
      }
      if (timedOut) {
        return finish(
          unverified(
            'initialize-timeout-silent',
            `no response to initialize within ${budget()}ms — silence proves neither reachability nor failure` +
              (session.stderrText.length > 0 ? `. stderr: ${redact(session.stderrText)}` : ''),
          ),
          { launcher },
        );
      }
      return finish(unverified('io-error', `initialize failed: ${errMessage(err)}`), { launcher });
    }

    const msToFirstResponse = Date.now() - startedAt;
    trace(`initialize answered in ${String(msToFirstResponse)}ms`);

    // A server that answers with a JSON-RPC error is talking, but not working.
    if (initializeResponse.error !== undefined) {
      return finish(
        offline(
          'initialize-error-response',
          `initialize rejected with code ${initializeResponse.error.code}: ${redact(initializeResponse.error.message)}`,
        ),
        { launcher, initialize: { answered: true, msToFirstResponse } },
      );
    }

    // InitializeResult.capabilities is REQUIRED by spec.
    const capabilitiesRecord = asRecord(initializeResponse.result);
    if (capabilitiesRecord === null) {
      return finish(
        offline(
          'protocol-violation',
          `initialize result is not an object carrying \`capabilities\` (got ${typeof initializeResponse.result}); ` +
            'the field is REQUIRED by InitializeResult',
        ),
        { launcher, initialize: { answered: true, msToFirstResponse } },
      );
    }
    const capabilities = asRecord(capabilitiesRecord['capabilities']);
    if (capabilities === null) {
      return finish(
        offline('protocol-violation', 'initialize result omits the REQUIRED `capabilities` object'),
        { launcher, initialize: { answered: true, msToFirstResponse } },
      );
    }

    const capabilityCounts = summariseCapabilities(capabilities);
    const infoRecord = asRecord(capabilitiesRecord['serverInfo']);
    const serverInfo =
      infoRecord !== null && typeof infoRecord['name'] === 'string'
        ? { name: infoRecord['name'], version: typeof infoRecord['version'] === 'string' ? infoRecord['version'] : null }
        : null;

    // --- Step 2: initialized (once, before any other message) ---------------
    trace(`sending initialized + didOpen(scratch)`);
    session.notify('initialized', {});

    // --- Step 3: didOpen the in-memory scratch document ---------------------
    session.notify('textDocument/didOpen', {
      textDocument: { uri: docUri, languageId, version: 1, text: scratch.text },
    });

    // --- Step 4: one request against a capability the server declared ------
    let probeOutcome: LspCapabilityProbeOutcome = 'no-capability-declared';
    let probeMethod = '';
    let probeNote = 'server advertised none of the probed capabilities';
    const chosen = PROBE_LADDER.find((entry) => {
      const value = capabilities[entry.capabilityKey];
      return value === true || (typeof value === 'object' && value !== null);
    });
    if (chosen !== undefined) {
      probeMethod = chosen.method;
      trace(`sending capability probe ${chosen.method} (probe budget=${String(Math.min(options.probeTimeoutMs, remainingBudget()))}ms)`);
      try {
        const probeResponse = await session.request(
          chosen.method,
          chosen.params(docUri),
          Math.min(options.probeTimeoutMs, remainingBudget()),
        );
        if (probeResponse.error !== undefined) {
          probeOutcome = 'answered-with-error';
          probeNote = `server responded with code ${probeResponse.error.code}: ${redact(probeResponse.error.message)}`;
        } else {
          probeOutcome = 'answered';
          probeNote = 'server answered a request over the framed channel';
        }
      } catch (err) {
        const framingError = firstFramingError();
        const timedOut = timeoutDetail(err);
        if (timedOut !== null) {
          probeOutcome = 'timeout';
          probeNote = `no response to ${chosen.method} within ${String(options.probeTimeoutMs)}ms`;
        } else if (framingError !== null) {
          probeOutcome = 'not-reached';
          probeNote = redact(framingError.message);
        } else {
          probeOutcome = 'not-reached';
          probeNote = redact(errMessage(err));
        }
      }
    }

    session.notify('textDocument/didClose', { textDocument: { uri: docUri } });

    // A framing violation anywhere means the channel itself is untrustworthy.
    const framingAfterProbe = firstFramingError();
    if (framingAfterProbe !== null) {
      return finish(offline('framing-violation', redact(framingAfterProbe.message)), {
        launcher,
        serverInfo,
        capabilityCounts,
        capabilityProbe: { method: probeMethod, outcome: probeOutcome, note: probeNote },
        initialize: { answered: true, msToFirstResponse },
      });
    }
    if (session.bufferedBytes > 0) {
      return finish(
        offline(
          'framing-violation',
          `${session.bufferedBytes} trailing bytes at EOF indicate a truncated frame`,
        ),
        {
          launcher,
          serverInfo,
          capabilityCounts,
          capabilityProbe: { method: probeMethod, outcome: probeOutcome, note: probeNote },
          initialize: { answered: true, msToFirstResponse },
        },
      );
    }

    // --- Step 5: shutdown, await result ------------------------------------
    let shutdownAnswered = false;
    let shutdownNote = '';
    trace(`sending shutdown`);
    try {
      const shutdownResponse = await session.request('shutdown', null, budget());
      shutdownAnswered = true;
      if (shutdownResponse.error !== undefined) {
        shutdownNote = `shutdown returned error ${shutdownResponse.error.code}`;
      }
    } catch (err) {
      shutdownNote =
        timeoutDetail(err) !== null ? 'shutdown timed out' : redact(errMessage(err));
    }

    // --- Step 6: exit, then wait for the process to actually leave ---------
    trace(`sending exit; awaiting process teardown (drain budget=${String(Math.min(2000, remainingBudget()))}ms)`);
    session.notify('exit', null);
    const drainBudget = Math.min(2000, remainingBudget());
    const exitedCleanly = await session.waitForExit(drainBudget);
    trace(`process exited=${String(exitedCleanly)} code=${String(session.exitInfo?.code)}`);
    // On Windows `exit` can precede stdio drain; give the pipe a moment so any
    // trailing frame is accounted for before judging the channel.
    if (exitedCleanly) {
      // Referenced timer: the child has already exited, so nothing else holds
      // the event loop open. Unref'ing here silently strands this await.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 150);
      });
      if (session.bufferedBytes > 0) {
        return finish(
          offline(
            'framing-violation',
            `${session.bufferedBytes} trailing bytes at EOF indicate a truncated frame`,
          ),
          {
            launcher,
            serverInfo,
            capabilityCounts,
            capabilityProbe: { method: probeMethod, outcome: probeOutcome, note: probeNote },
            initialize: { answered: true, msToFirstResponse },
            shutdown: { clean: false, exitCode: session.exitInfo?.code ?? null, signal: session.exitInfo?.signal ?? null },
          },
        );
      }
    }

    const exitCode = session.exitInfo?.code ?? null;
    const signal = session.exitInfo?.signal ?? null;
    // Spec §exit: exit code MUST be 0 when shutdown was received, else 1.
    const clean = shutdownAnswered && exitCode === 0;
    const capabilityProbeResult: LspServerProbeResult['capabilityProbe'] = {
      method: probeMethod,
      outcome: probeOutcome,
      // Unsolicited notifications (publishDiagnostics, logMessage, window/logMessage)
      // are independent evidence the server is live rather than a one-shot responder.
      note:
        notificationMethods.length > 0
          ? `${probeNote}; server also pushed unsolicited notifications (${[...new Set(notificationMethods)].slice(0, 4).join(', ')})`
          : probeNote,
    };

    // ONLINE requires a valid InitializeResult AND capabilities observed.
    const state: LspProbeState = capabilityCounts.total > 0 ? 'ONLINE' : 'OFFLINE';
    const lifecycle =
      shutdownAnswered && clean
        ? 'shutdown acknowledged; exit code 0 as required by spec'
        : shutdownAnswered
          ? `shutdown acknowledged but exit code was ${String(exitCode)}${shutdownNote.length > 0 ? ` (${shutdownNote})` : ''}`
          : `shutdown was not acknowledged (${shutdownNote.length > 0 ? shutdownNote : 'no response'})`;
    // A probe timeout is a real measurement and must not be buried.
    const probeCaveat =
      probeOutcome === 'timeout'
        ? `; NOTE the capability probe ${probeMethod} did not answer within ${String(options.probeTimeoutMs)}ms, so interactivity beyond initialize is NOT proven`
        : probeOutcome === 'answered-with-error'
          ? `; capability probe ${probeMethod} was refused (${probeNote})`
          : '';
    const finalDetail =
      state === 'ONLINE'
        ? lifecycle + probeCaveat
        : 'server returned an empty `capabilities` object — channel works, capability not proven';

    return finish(
      {
        state,
        reason: state === 'ONLINE' ? 'none' : 'protocol-violation',
        detail: finalDetail,
      },
      {
        launcher,
        serverInfo,
        capabilityCounts,
        capabilityProbe: capabilityProbeResult,
        initialize: { answered: true, msToFirstResponse },
        shutdown: { clean, exitCode, signal },
      },
    );
  } finally {
    unsubscribe();
    session.dispose();
  }
}

// ---------------------------------------------------------------------------
// Section 8 — Manifest loading and report assembly
// ---------------------------------------------------------------------------

export interface DeclaredLspServer {
  readonly id: string;
  readonly entry: string;
  readonly version: string;
  readonly source: string;
  /** `directory` when an E:\Servers-Center asset exists, else `external-toolchain`. */
  readonly entryKind: string;
  /**
   * What the entry actually IS. Defaults to `unclassified` when the manifest
   * omits or misspells it — never silently to `language-server`, because an
   * unclassified entry must not be able to earn credit.
   */
  readonly category: LspEntryCategory;
  /** Operator-readable reason this entry is excluded from the denominator, if excluded. */
  readonly categoryJustification?: string;
  /** Launcher binary names the manifest authorises for this server. */
  readonly launcherCandidates: readonly string[];
  /** Extra argv the manifest declares (e.g. `start` for bash-language-server). */
  readonly args: readonly string[];
  /**
   * Environment variable NAMES the launcher needs in order to start at all.
   * Names only. Values are read from the prober's own host environment at spawn
   * time and are never recorded in the report.
   */
  readonly envPassThrough: readonly string[];
  /**
   * The manifest's own reachability *claim*. Recorded purely so the report can
   * state whether measurement agrees with the declared feasibility. It is never
   * used as evidence of anything.
   */
  readonly handshakeFeasibility: string;
  readonly handshakeBlockers: readonly string[];
}

interface ManifestLspEntry {
  readonly entry?: unknown;
  readonly categoryJustification?: unknown;
  readonly version?: unknown;
  readonly source?: unknown;
  readonly entryKind?: unknown;
  readonly category?: unknown;
  readonly handshakeFeasibility?: unknown;
  readonly handshakeBlockers?: unknown;
  readonly command?: {
    readonly launcherCandidates?: unknown;
    readonly args?: unknown;
    readonly transport?: unknown;
    readonly executable?: unknown;
    readonly env?: { readonly passThrough?: unknown };
  };
}

interface ManifestShape {
  readonly lsp?: Readonly<Record<string, ManifestLspEntry>>;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Read a manifest `category`, refusing to guess.
 *
 * An absent, misspelled or unknown value resolves to `unclassified`, which is
 * EXCLUDED from the reachability denominator. That direction is deliberate: a
 * manifest that forgets to classify an entry must lose credit for it, never
 * gain it. A wrong guess in the other direction would inflate the score.
 */
export function parseEntryCategory(value: unknown): LspEntryCategory {
  return typeof value === 'string' && (LSP_ENTRY_CATEGORIES as readonly string[]).includes(value)
    ? (value as LspEntryCategory)
    : 'unclassified';
}

/** Case-insensitive lookup of an entry's `command.env.passThrough` names. */
function envPassThroughNames(command: { readonly env?: { readonly passThrough?: unknown } } | undefined): readonly string[] {
  const raw = command?.env?.passThrough;
  return Array.isArray(raw)
    ? [...new Set(raw.filter((item): item is string => typeof item === 'string' && item.length > 0))]
    : [];
}

export function loadDeclaredLspServers(manifestPath: string): readonly DeclaredLspServer[] {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestShape;
  const lsp = raw.lsp;
  if (lsp === undefined || typeof lsp !== 'object') return [];
  const servers: DeclaredLspServer[] = [];
  for (const [id, value] of Object.entries(lsp)) {
    if (typeof value !== 'object' || value === null) continue;
    const command = value.command ?? {};
    servers.push({
      id,
      entry: typeof value.entry === 'string' ? value.entry : '',
      version: typeof value.version === 'string' ? value.version : 'unknown',
      source: typeof value.source === 'string' ? value.source : 'unknown',
      entryKind: typeof value.entryKind === 'string' ? value.entryKind : 'unspecified',
      category: parseEntryCategory(value.category),
      // Carried through so an exclusion from the scoring denominator is always
      // readable. An exclusion nobody can see is indistinguishable from a quiet
      // score adjustment.
      categoryJustification: typeof value.categoryJustification === 'string' && value.categoryJustification.trim() ? value.categoryJustification : undefined,
      launcherCandidates: stringArray(command.launcherCandidates),
      args: stringArray(command.args),
      envPassThrough: envPassThroughNames(command),
      handshakeFeasibility:
        typeof value.handshakeFeasibility === 'string' ? value.handshakeFeasibility : 'UNSPECIFIED',
      handshakeBlockers: stringArray(value.handshakeBlockers),
    });
  }
  return servers;
}

export interface RunProbesOptions {
  readonly manifestPath: string;
  readonly serversCenterRoot: string;
  readonly workspaceRoot: string;
  readonly stepTimeoutMs: number;
  readonly totalDeadlineMs: number;
  readonly probeTimeoutMs: number;
  readonly onlyIds: readonly string[] | null;
  readonly nodeEnv: Readonly<Record<string, string>>;
  readonly trace?: (message: string) => void;
}

export async function runLspProbes(options: RunProbesOptions): Promise<LspProbeReport> {
  const declared = loadDeclaredLspServers(options.manifestPath);
  const selected = options.onlyIds === null ? declared : declared.filter((server) => options.onlyIds?.includes(server.id));
  const notes: string[] = [];

  for (const missing of (options.onlyIds ?? []).filter((id) => !declared.some((server) => server.id === id))) {
    notes.push(`--id "${missing}" matches no entry in the manifest; it is reported UNVERIFIABLE rather than omitted`);
  }

  const results: LspServerProbeResult[] = [];
  for (const server of selected) {
    try {
      results.push(
        await probeLspServer({
          id: server.id,
          declaredEntry: server.entry,
          declaredVersion: server.version,
          declaredSource: server.source,
          declaredEntryKind: server.entryKind,
          declaredCategory: server.category,
          declaredCategoryJustification: server.categoryJustification,
          declaredLauncherCandidates: server.launcherCandidates,
          declaredArgs: server.args,
          declaredEnvPassThrough: server.envPassThrough,
          declaredFeasibility: server.handshakeFeasibility,
          declaredBlockers: server.handshakeBlockers,
          serversCenterRoot: options.serversCenterRoot,
          workspaceRoot: options.workspaceRoot,
          stepTimeoutMs: options.stepTimeoutMs,
          totalDeadlineMs: options.totalDeadlineMs,
          probeTimeoutMs: options.probeTimeoutMs,
          nodeEnv: options.nodeEnv,
          ...(options.trace === undefined ? {} : { trace: options.trace }),
        }),
      );
    } catch (err) {
      // A crash in the prober itself must still yield an honest row, never a
      // missing one.
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        id: server.id,
        state: 'UNVERIFIABLE',
        category: server.category,
        scoreable: isScoreableCategory(server.category),
        probeMethod: PROBE_METHOD_LSP_CONTENT_LENGTH,
        lastProbedAt: new Date().toISOString(),
        durationMs: 0,
        reason: 'io-error',
        detail: `prober raised an unexpected error: ${redact(message)}`,
        declared: {
          entry: server.entry,
          version: server.version,
          source: server.source,
          entryKind: server.entryKind,
          entryExists: false,
          handshakeFeasibility: server.handshakeFeasibility,
          handshakeBlockers: server.handshakeBlockers,
        },
        launcher: null,
        serverInfo: null,
        capabilityCounts: null,
        capabilityProbe: { method: '', outcome: 'not-reached', note: 'prober error' },
        initialize: { answered: false, msToFirstResponse: null },
        shutdown: { clean: false, exitCode: null, signal: null },
      });
    }
  }

  // Rows for ids requested via --id that the manifest does not declare.
  for (const id of options.onlyIds ?? []) {
    if (results.some((row) => row.id === id)) continue;
    results.push({
      id,
      state: 'UNVERIFIABLE',
      // An id with no manifest entry cannot be shown to be a language server, so
      // it is unclassified and therefore outside the denominator.
      category: 'unclassified',
      scoreable: false,
      probeMethod: PROBE_METHOD_LSP_CONTENT_LENGTH,
      lastProbedAt: new Date().toISOString(),
      durationMs: 0,
      reason: 'not-declared-in-manifest',
      detail: 'no manifest entry; nothing to probe',
      declared: {
        entry: '',
        version: 'unknown',
        source: 'unknown',
        entryKind: 'not-declared',
        entryExists: false,
        handshakeFeasibility: 'NOT_DECLARED',
        handshakeBlockers: [],
      },
      launcher: null,
      serverInfo: null,
      capabilityCounts: null,
      capabilityProbe: { method: '', outcome: 'not-reached', note: 'not declared' },
      initialize: { answered: false, msToFirstResponse: null },
      shutdown: { clean: false, exitCode: null, signal: null },
    });
  }

  const online = results.filter((row) => row.state === 'ONLINE').length;
  const offline = results.filter((row) => row.state === 'OFFLINE').length;
  const unverifiable = results.filter((row) => row.state === 'UNVERIFIABLE').length;
  const entryExistsCount = results.filter((row) => row.declared.entryExists).length;
  const launcherResolved = results.filter((row) => row.launcher !== null).length;
  const handshakeCompleted = results.filter((row) => row.initialize.answered).length;

  // ── The denominator correction ──────────────────────────────────────────────
  // Both populations are computed here and BOTH are published below. The
  // demoted entries are never removed from `servers[]`, never hidden from any
  // consumer, and never reported as healthy — they are simply not permitted to
  // divide the ratio of the servers that actually speak LSP.
  const scoreableRows = results.filter((row) => isScoreableCategory(row.category));
  const declaredLanguageServers = scoreableRows.length;
  const declaredNonLanguageServers = results.length - declaredLanguageServers;
  const measurableOnline = scoreableRows.filter((row) => row.state === 'ONLINE').length;
  const measurableOffline = scoreableRows.filter((row) => row.state === 'OFFLINE').length;
  const measurableUnverifiable = scoreableRows.filter((row) => row.state === 'UNVERIFIABLE').length;
  const categoryCounts: Record<LspEntryCategory, number> = {
    'language-server': 0,
    'compiler-cli': 0,
    'linter-cli': 0,
    'sdk-no-lsp-server': 0,
    unclassified: 0,
  };
  for (const row of results) categoryCounts[row.category] += 1;

  if (declaredNonLanguageServers > 0) {
    const demoted = results
      .filter((row) => !isScoreableCategory(row.category))
      .map((row) => `${row.id}=${row.category}`)
      .join(', ');
    notes.push(
      `${declaredNonLanguageServers} of ${results.length} declared \`lsp\` entries are NOT language servers (${demoted}). ` +
        'They remain declared, probed and listed in servers[] with their real state and reason; they are excluded only from the ' +
        `reachability DENOMINATOR, which is therefore ${declaredLanguageServers}, not ${results.length}. ` +
        'A compiler CLI, a linter CLI and a bare SDK cannot answer an LSP handshake, so charging them against servers that do is a ' +
        'miscategorisation of the inventory, not a measurement of health.',
    );
  }
  const unclassifiedRows = results.filter((row) => row.category === 'unclassified');
  if (unclassifiedRows.length > 0) {
    notes.push(
      `${unclassifiedRows.length} declared entr${unclassifiedRows.length === 1 ? 'y has' : 'ies have'} no recognised ` +
        '`category` in the manifest. They are reported `unclassified`, counted in the declared inventory, and excluded from the ' +
        'reachability denominator. An entry nobody classified cannot be credited.',
    );
  }
  if (unverifiable > 0) {
    notes.push(
      `${unverifiable} of ${results.length} declared servers are UNVERIFIABLE: a live LSP handshake could not be ` +
        'attempted or concluded. They are reported, not dropped and not counted as healthy.',
    );
  }
  if (launcherResolved < results.length) {
    notes.push(
      `Only ${launcherResolved} of ${results.length} declared servers resolve to a runnable language-server ` +
        'launcher. The measurable denominator is therefore ' +
        `${launcherResolved}, not ${results.length}.`,
    );
  }

  return {
    summary: {
      total: results.length,
      declaredTotal: results.length,
      measurableTotal: declaredLanguageServers,
      measurableOnline,
      measurableOffline,
      measurableUnverifiable,
      nonLanguageServerTotal: declaredNonLanguageServers,
      categoryCounts,
      online,
      offline,
      unverifiable,
      measurable: launcherResolved,
    },
    denominator: {
      declaredInManifest: declared.length,
      declaredLanguageServers,
      declaredNonLanguageServers,
      declaredEntryDirectoryExists: entryExistsCount,
      languageServerLauncherResolved: launcherResolved,
      handshakeCompleted,
      scoreDenominator:
        `Divide measurableOnline (${measurableOnline}) by measurableTotal (${declaredLanguageServers}). ` +
        `Do NOT divide by declaredTotal (${results.length}): ${declaredNonLanguageServers} of those entries are declared ` +
        'toolchains that are not LSP endpoints.',
    },
    servers: results,
    generatedAt: new Date().toISOString(),
    probeMethod: PROBE_METHOD_LSP_CONTENT_LENGTH,
    host: {
      platform: `${process.platform}-${process.arch}`,
      nodeVersion: process.version,
      side: 'host',
      workspaceRoot: options.workspaceRoot,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Section 10 — Adapter for the host prober's shared LSP contract
// ---------------------------------------------------------------------------

/**
 * Coarse reason codes understood by `scripts/host_prober_client.ts`
 * (`ProbeReasonCode`). This module's failure taxonomy is finer-grained; this
 * map projects it onto the shared vocabulary so `asReasonCode()` in the client
 * accepts the value instead of silently downgrading it to
 * `LSP_TRANSPORT_NOT_IMPLEMENTED`, which would be false once the transport is
 * live. The precise, unabridged reason is always preserved in `reasonText`.
 */
export function toProberReasonCode(reason: LspFailureReason): string {
  switch (reason) {
    case 'none':
      return 'HANDSHAKE_COMPLETED';
    case 'not-declared-in-manifest':
      return 'INVENTORY_UNRESOLVED';
    case 'launcher-not-found':
    case 'launcher-not-a-language-server':
    case 'entry-directory-missing':
      return 'ENTRYPOINT_ABSENT';
    case 'spawn-failed':
      return 'SPAWN_FAILED';
    case 'dependency-missing':
      return 'ENTRYPOINT_ABSENT';
    case 'platform-mismatch':
      return 'PLATFORM_MISMATCH';
    case 'child-exited-early':
    case 'child-exited-nonzero':
      return 'EXIT_NONZERO_BEFORE_HANDSHAKE';
    case 'framing-violation':
    case 'protocol-violation':
      return 'PROBER_RESPONSE_INVALID';
    case 'initialize-error-response':
      return 'HANDSHAKE_INITIALIZE_ERROR';
    case 'initialize-timeout-silent':
      return 'HANDSHAKE_TIMEOUT';
    case 'total-deadline-exceeded':
      return 'RUN_DEADLINE_EXCEEDED';
    case 'io-error':
      return 'PROBER_RESPONSE_INVALID';
  }
}

/** One row in the shape `LspProbeResult` in `host_prober_client.ts` expects. */
export interface ProberLspRow {
  readonly id: string;
  readonly state: LspProbeState;
  /** Passed through so a consumer never has to re-derive the classification. */
  readonly category: LspEntryCategory;
  /** Whether this row belongs in the reachability denominator. */
  readonly scoreable: boolean;
  /** Operator-readable reason this entry is excluded. An exclusion nobody can read is indistinguishable from a quiet score adjustment. */
  readonly categoryJustification?: string;
  readonly probeMethod: typeof PROBE_METHOD_LSP_CONTENT_LENGTH;
  readonly lastProbedAt: string;
  readonly durationMs: number;
  readonly reason: string;
  readonly reasonText: string;
  /**
   * `measured` is true ONLY when a real handshake ran and concluded. A server
   * that was never spawned can never be `measured: true`.
   */
  readonly measured: boolean;
  readonly transportImplemented: true;
  readonly framing: typeof LSP_FRAMING;
  /** Optional extras; harmless extras of the shared shape. */
  readonly capabilityCounts: LspCapabilityCounts | null;
  readonly serverInfo: { readonly name: string; readonly version: string | null } | null;
  readonly capabilityProbe: LspServerProbeResult['capabilityProbe'];
  readonly initialize: LspServerProbeResult['initialize'];
  readonly shutdown: LspServerProbeResult['shutdown'];
}

/** Payload in the shape `LspProbeReport` in `host_prober_client.ts` expects. */
export interface ProberLspReport {
  readonly ok: true;
  readonly chainKeyId: string;
  readonly proberVersion: string;
  readonly generatedAt: string;
  readonly provenance: 'MEASURED_BY_PROBER';
  readonly transportImplemented: true;
  readonly summary: {
    readonly total: number;
    readonly online: number;
    readonly offline: number;
    readonly unverifiable: number;
  };
  readonly servers: readonly ProberLspRow[];
  /**
   * The corrected accounting, published ALONGSIDE `summary` rather than instead
   * of it. `summary.total` keeps its original meaning (every declared row) so
   * nothing that already reads it changes behaviour or loses an entry;
   * `measurableTotal` is the denominator reachability must actually use.
   */
  readonly measurable: number;
  readonly denominator: LspProbeReport['denominator'];
  readonly measurableTotal: number;
  readonly declaredTotal: number;
  readonly measurableOnline: number;
  readonly nonLanguageServerTotal: number;
  readonly categoryCounts: Readonly<Record<LspEntryCategory, number>>;
  readonly notes: readonly string[];
}

export interface ProberLspAdapterMeta {
  readonly chainKeyId: string;
  readonly proberVersion: string;
}

/**
 * Project a measured report onto the host prober's public LSP contract.
 *
 * This is the whole integration: `host_prober.ts::lspStatus()` becomes a call
 * into `runLspProbes()` followed by this adapter. Because `transportImplemented`
 * is now genuinely `true`, the client-side sanitizer stops clamping every state
 * to `UNVERIFIABLE` and the console receives real measurements.
 */
export function toProberLspReport(report: LspProbeReport, meta: ProberLspAdapterMeta): ProberLspReport {
  return {
    ok: true,
    chainKeyId: meta.chainKeyId,
    proberVersion: meta.proberVersion,
    generatedAt: report.generatedAt,
    provenance: 'MEASURED_BY_PROBER',
    transportImplemented: true,
    summary: {
      total: report.summary.total,
      online: report.summary.online,
      offline: report.summary.offline,
      unverifiable: report.summary.unverifiable,
    },
    servers: report.servers.map((server) => ({
      id: server.id,
      state: server.state,
      category: server.category,
      scoreable: server.scoreable,
      // An exclusion an operator cannot read is indistinguishable from a quiet
      // score adjustment, so the reason travels with the row.
      categoryJustification: server.categoryJustification,
      probeMethod: PROBE_METHOD_LSP_CONTENT_LENGTH,
      lastProbedAt: server.lastProbedAt,
      durationMs: server.durationMs,
      reason: toProberReasonCode(server.reason),
      reasonText: `${server.reason}: ${server.detail}`,
      // A handshake only counts as measured when initialize was actually answered.
      measured: server.initialize.answered,
      transportImplemented: true,
      framing: LSP_FRAMING,
      capabilityCounts: server.capabilityCounts,
      serverInfo: server.serverInfo,
      capabilityProbe: server.capabilityProbe,
      initialize: server.initialize,
      shutdown: server.shutdown,
    })),
    measurable: report.summary.measurable,
    denominator: report.denominator,
    measurableTotal: report.summary.measurableTotal,
    declaredTotal: report.summary.declaredTotal,
    measurableOnline: report.summary.measurableOnline,
    nonLanguageServerTotal: report.summary.nonLanguageServerTotal,
    categoryCounts: report.summary.categoryCounts,
    notes: report.notes,
  };
}

// ---------------------------------------------------------------------------
// Section 11 — CLI
// ---------------------------------------------------------------------------

const DEFAULTS = {
  serversCenterRoot: 'E:\\Servers-Center',
  manifestRelative: 'config/servers_center_manifest.json',
  scratchWorkspace: 'C:\\Users\\AA5II\\AppData\\Local\\Temp\\opencode\\lsp-prober\\workspace',
  stepTimeoutMs: 15_000,
  totalDeadlineMs: 45_000,
  probeTimeoutMs: 8_000,
} as const;

function scriptDir(): string {
  try {
    return resolvePath(fileURLToPath(import.meta.url), '..');
  } catch {
    return process.cwd();
  }
}

export interface CliOptions {
  readonly once: boolean;
  readonly watchMs: number;
  readonly pretty: boolean;
  readonly ids: readonly string[] | null;
  readonly stepTimeoutMs: number;
  readonly totalDeadlineMs: number;
  readonly probeTimeoutMs: number;
  readonly serversCenterRoot: string;
  readonly workspaceRoot: string;
  readonly manifestPath: string;
  readonly quiet: boolean;
  readonly traceEnabled: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  let once = false;
  let watchMs = 0;
  let pretty = false;
  let quiet = false;
  let traceEnabled = false;
  const ids: string[] = [];
  let stepTimeoutMs: number = DEFAULTS.stepTimeoutMs;
  let totalDeadlineMs: number = DEFAULTS.totalDeadlineMs;
  let probeTimeoutMs: number = DEFAULTS.probeTimeoutMs;
  let serversCenterRoot = process.env['SERVERS_CENTER_ROOT'] ?? DEFAULTS.serversCenterRoot;
  let workspaceRoot = process.env['LSP_PROBER_WORKSPACE'] ?? DEFAULTS.scratchWorkspace;
  let manifestPath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${String(arg)} requires a value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case '--once':
        once = true;
        break;
      case '--pretty':
        pretty = true;
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--trace':
        traceEnabled = true;
        break;
      case '--watch': {
        const value = Number(next());
        if (!Number.isFinite(value) || value <= 0) throw new Error('--watch requires a positive interval in ms');
        watchMs = value;
        break;
      }
      case '--id': {
        const value = next();
        for (const part of value.split(',')) {
          const trimmed = part.trim();
          if (trimmed.length > 0) ids.push(trimmed);
        }
        break;
      }
      case '--timeout-ms': {
        const value = Number(next());
        if (!Number.isFinite(value) || value <= 0) throw new Error('--timeout-ms requires a positive value');
        stepTimeoutMs = value;
        totalDeadlineMs = value;
        break;
      }
      case '--step-timeout-ms': {
        const value = Number(next());
        if (!Number.isFinite(value) || value <= 0) throw new Error('--step-timeout-ms requires a positive value');
        stepTimeoutMs = value;
        break;
      }
      case '--probe-timeout-ms': {
        const value = Number(next());
        if (!Number.isFinite(value) || value <= 0) throw new Error('--probe-timeout-ms requires a positive value');
        probeTimeoutMs = value;
        break;
      }
      case '--servers-center-root':
        serversCenterRoot = next();
        break;
      case '--workspace-root':
        workspaceRoot = next();
        break;
      case '--manifest':
        manifestPath = next();
        break;
      default:
        throw new Error(`unknown argument: ${String(arg)}`);
    }
  }
  if (totalDeadlineMs < stepTimeoutMs) totalDeadlineMs = stepTimeoutMs * 3;
  if (probeTimeoutMs > stepTimeoutMs) probeTimeoutMs = stepTimeoutMs;

  return {
    once,
    watchMs,
    pretty,
    ids: ids.length > 0 ? ids : null,
    stepTimeoutMs,
    totalDeadlineMs,
    probeTimeoutMs,
    serversCenterRoot,
    workspaceRoot,
    manifestPath,
    quiet,
    traceEnabled,
  };
}

const USAGE = `sovereign LSP prober — real Language Server Protocol reachability

Usage:
  lsp_prober --once [--pretty] [--id <id[,id]>] [--timeout-ms <n>] [--step-timeout-ms <n>]
             [--probe-timeout-ms <n>] [--servers-center-root <dir>] [--workspace-root <dir>]
             [--manifest <path>] [--trace]
  lsp_prober --watch <intervalMs> [...same flags...]
  lsp_prober --framer-selftest

Reads every LSP entry declared in config/servers_center_manifest.json, spawns the
real server, performs a real base-protocol handshake, and prints JSON to stdout.

Exit codes: 0 = report produced, 2 = bad arguments, 3 = unexpected prober fault.
`;

async function runOnce(options: CliOptions): Promise<LspProbeReport> {
  // Default to the manifest sitting beside this script in the repo layout;
  // `--manifest` is required when running a compiled copy from elsewhere.
  const manifestPath =
    options.manifestPath.length > 0
      ? resolvePath(options.manifestPath)
      : resolvePath(scriptDir(), '..', DEFAULTS.manifestRelative);
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest not found at ${manifestPath}; pass --manifest <path>`);
  }
  return runLspProbes({
    manifestPath,
    serversCenterRoot: options.serversCenterRoot,
    workspaceRoot: options.workspaceRoot,
    stepTimeoutMs: options.stepTimeoutMs,
    totalDeadlineMs: options.totalDeadlineMs,
    probeTimeoutMs: options.probeTimeoutMs,
    onlyIds: options.ids,
    // process.env is `Record<string, string | undefined>`; LSP children only
    // tolerate defined values, so drop the undefined entries explicitly.
    nodeEnv: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
    ...(options.traceEnabled
      ? {
          trace: (message: string): void => {
            process.stderr.write(`[lsp-prober] ${message}\n`);
          },
        }
      : {}),
  });
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 2;
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (argv.includes('--framer-selftest')) {
    process.stdout.write(`${JSON.stringify(selfTest(), null, options.pretty ? 2 : 0)}\n`);
    return 0;
  }

  const emit = (report: LspProbeReport): void => {
    process.stdout.write(`${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`);
  };

  if (!options.quiet) {
    process.stderr.write(
      `[lsp-prober] side=host platform=${process.platform} node=${process.version} ` +
        `serversCenter=${options.serversCenterRoot}\n[lsp-prober] workspaceRoot=${options.workspaceRoot}\n`,
    );
  }

  if (options.watchMs > 0) {
    let stopping = false;
    const stop = (): void => {
      stopping = true;
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    while (!stopping) {
      try {
        emit(await runOnce(options));
      } catch (err) {
        process.stderr.write(`[lsp-prober] run failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      if (stopping) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, options.watchMs);
      });
    }
    return 0;
  }

  // --once and the no-flag default are the same one-shot path.
  void options.once;

  // Watchdog. A reachability prober that exits 0 having printed nothing is the
  // exact failure mode this module exists to eliminate, so a stalled run is
  // converted into an explicit, loud, non-zero failure instead of a silent exit.
  const watchdog = setTimeout(() => {
    const detail = `watchdog fired after ${String(options.totalDeadlineMs + 15_000)}ms; the probe chain stalled`;
    process.stderr.write(`[lsp-prober] FATAL ${detail}\n`);
    process.stdout.write(
      `${JSON.stringify({
        summary: {
          total: 0, online: 0, offline: 0, unverifiable: 0, measurable: 0,
          declaredTotal: 0, measurableTotal: 0, measurableOnline: 0,
          measurableOffline: 0, measurableUnverifiable: 0, nonLanguageServerTotal: 0,
          categoryCounts: {
            'language-server': 0, 'compiler-cli': 0, 'linter-cli': 0,
            'sdk-no-lsp-server': 0, unclassified: 0,
          },
        },
        servers: [],
        generatedAt: new Date().toISOString(),
        probeMethod: PROBE_METHOD_LSP_CONTENT_LENGTH,
        notes: [detail],
      })}\n`,
    );
    process.exit(3);
  }, options.totalDeadlineMs + 15_000);

  try {
    if (!options.quiet) process.stderr.write('[lsp-prober] probes finished; emitting report\n');
    const report = await runOnce(options);
    if (!options.quiet) {
      process.stderr.write(
        `[lsp-prober] report built; summary=${JSON.stringify(report.summary)}; writing to stdout\n`,
      );
    }
    emit(report);
    return 0;
  } finally {
    clearTimeout(watchdog);
  }
}

/** Minimal embedded self-test, exposed for `--framer-selftest`. */
export function selfTest(): Record<string, unknown> {
  const cases: Record<string, unknown>[] = [];
  const frame = encodeLspFrame({ jsonrpc: '2.0', id: 1, result: 'ok' });
  const framer = new LspFramer({ strictJson: false });
  const single = framer.push(frame);
  cases.push({ name: 'single-frame', messageCount: single.length, body: single[0]?.body });
  return { cases };
}

// Only self-execute when run as the entry point, so the module stays importable.
const invokedDirectly = ((): boolean => {
  try {
    return process.argv[1] !== undefined && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`[lsp-prober] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exitCode = 3;
    },
  );
}