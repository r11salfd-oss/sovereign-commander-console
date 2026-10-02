/**
 * ============================================================================
 * SOVEREIGN HOST PROBER — SHARED WIRE CONTRACT + CONSOLE-SIDE HTTP CLIENT
 * ============================================================================
 * Chain Key ID: 360ea36c28e66d9d
 * Author role:   PROBER-BUILDER (host-side prober, production implementation)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ────────
 * This module is the SINGLE SOURCE OF TRUTH for the shape of every payload the
 * host-side prober (`scripts/host_prober.ts`) publishes, and the only sanctioned
 * way for the console (`server.ts`, running inside the Alpine container) to read
 * it back.
 *
 * The split is deliberate and load-bearing:
 *
 *   scripts/host_prober.ts        HOST-ONLY.   Spawns processes, reads E:\, binds
 *                                               a Windows loopback socket. It must
 *                                               NEVER be imported by the container
 *                                               bundle, because none of those
 *                                               capabilities exist there.
 *
 *   scripts/host_prober_client.ts CONTAINER-SAFE. Zero node-only imports beyond
 *                                               `process.env`, zero third-party
 *                                               dependencies. Safe to import from
 *                                               `server.ts`; esbuild bundles it into
 *                                               `dist/server.cjs`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE HONESTY INVARIANT (non-negotiable — do not relax without Commander approval)
 * ────────────────────────────────────────────────────────────────────────────
 * The container previously could not see `E:\Servers-Center`, so the console
 * reported fabricated infrastructure status. The host prober makes real status
 * observable. This module exists so that when the measuring instrument is
 * ABSENT, the console degrades to UNVERIFIABLE rather than inventing a verdict:
 *
 *     prober reachable + handshake measured      -> ONLINE / OFFLINE (measured)
 *     prober unreachable / unauthorized / slow  -> UNVERIFIABLE for EVERY server
 *
 * `OFFLINE` asserts "I probed it and it is not serving". If the prober itself is
 * down, token-rotated, or misrouted, that assertion is FALSE, and emitting it
 * converts one bridge outage into seven phantom server outages. Therefore:
 *
 *     NEVER map UNVERIFIABLE -> ONLINE.
 *     NEVER map UNVERIFIABLE -> OFFLINE.
 *
 * Every degraded report is stamped `provenance: 'DEGRADED_UNVERIFIABLE'` so no
 * consumer can accidentally read a measurement into it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEPENDENCY POSTURE
 * ──────────────────
 * `@modelcontextprotocol/sdk` is NOT a dependency of this project (it appears in
 * package-lock.json only as an OPTIONAL peer of `@google/genai`, and is absent
 * from node_modules). Installing it is a Commander decision that has not been
 * made, so this module adds nothing and uses only the platform `fetch`.
 * ============================================================================
 */

/* ===========================================================================
 * 1. THREE-STATE REACHABILITY MODEL
 * ========================================================================= */

/**
 * The only three verdicts this system is permitted to emit.
 *
 *  ONLINE       MEASURED ALIVE. A real MCP stdio JSON-RPC handshake completed:
 *               `initialize` returned a result, `notifications/initialized` was
 *               delivered, and `tools/list` returned at least one tool. This is
 *               evidence, not a file-existence guess.
 *
 *  OFFLINE      MEASURED DEAD. A transport attempt actually ran and the target
 *               conclusively declined to serve: non-zero exit, an `initialize`
 *               error response, a clean exit with zero MCP frames (the
 *               PowerShell-wrapper failure mode), or a binary that is not a
 *               runnable executable image.
 *
 *  UNVERIFIABLE COULD NOT CONCLUDE. The probe was never attempted (entrypoint
 *               absent, no transport, platform mismatch) or could not finish
 *               (timeout, run deadline, permission denied, prober unreachable).
 *               This is the ABSENCE of evidence and must never be promoted to
 *               ONLINE nor demoted to OFFLINE.
 */
export type ProbeState = 'ONLINE' | 'OFFLINE' | 'UNVERIFIABLE';

/**
 * Machine-readable reason codes. Closed union (plus a catch-all) so a consumer
 * can branch on the reason without string-matching prose.
 *
 * Conclusive-negative family (only these may accompany OFFLINE):
 *   HANDSHAKE_INITIALIZE_ERROR, HANDSHAKE_TOOLS_LIST_ERROR,
 *   EXIT_NONZERO_BEFORE_HANDSHAKE, EXIT_ZERO_NO_MCP_FRAMES,
 *   NOT_AN_EXECUTABLE_IMAGE, EMPTY_TOOL_LIST, STDOUT_CAPTURE_LIMIT_EXCEEDED
 *
 * Could-not-conclude family (these must accompany UNVERIFIABLE):
 *   ENTRYPOINT_ABSENT, SPAWN_PERMISSION_DENIED, SPAWN_FAILED,
 *   HANDSHAKE_TIMEOUT, RUN_DEADLINE_EXCEEDED, PLATFORM_MISMATCH,
 *   INVENTORY_UNRESOLVED, LSP_TRANSPORT_NOT_IMPLEMENTED
 *
 * Consumer-side family (transport between console and prober failed):
 *   PROBER_UNREACHABLE, PROBER_UNAUTHORIZED, PROBER_FORBIDDEN,
 *   PROBER_RATE_LIMITED, PROBER_TIMEOUT, PROBER_RESPONSE_INVALID,
 *   PROBER_TOKEN_ABSENT, PROBER_ERROR
 */
export type ProbeReasonCode =
  | 'HANDSHAKE_COMPLETED'
  | 'HANDSHAKE_INITIALIZE_ERROR'
  | 'HANDSHAKE_TOOLS_LIST_ERROR'
  | 'EXIT_NONZERO_BEFORE_HANDSHAKE'
  | 'EXIT_ZERO_NO_MCP_FRAMES'
  | 'NOT_AN_EXECUTABLE_IMAGE'
  | 'EMPTY_TOOL_LIST'
  | 'STDOUT_CAPTURE_LIMIT_EXCEEDED'
  | 'ENTRYPOINT_ABSENT'
  | 'SPAWN_PERMISSION_DENIED'
  | 'SPAWN_FAILED'
  | 'HANDSHAKE_TIMEOUT'
  | 'RUN_DEADLINE_EXCEEDED'
  | 'PLATFORM_MISMATCH'
  | 'INVENTORY_UNRESOLVED'
  | 'LSP_TRANSPORT_NOT_IMPLEMENTED'
  | 'PROBER_UNREACHABLE'
  | 'PROBER_UNAUTHORIZED'
  | 'PROBER_FORBIDDEN'
  | 'PROBER_RATE_LIMITED'
  | 'PROBER_TIMEOUT'
  | 'PROBER_RESPONSE_INVALID'
  | 'PROBER_TOKEN_ABSENT'
  | 'PROBER_ERROR';

/** Populated when a state is NOT `ONLINE`. Always human-readable, never secret. */
export type ProbeStateCounts = {
  readonly total: number;
  readonly online: number;
  readonly offline: number;
  readonly unverifiable: number;
};

/**
 * Where a payload's verdicts came from.
 *
 *  MEASURED_BY_PROBER       the prober actually ran transports and concluded.
 *  DEGRADED_UNVERIFIABLE    the console could not reach/authorize the prober, so
 *                           NOTHING was measured and every entry is UNVERIFIABLE.
 */
export type ReportProvenance = 'MEASURED_BY_PROBER' | 'DEGRADED_UNVERIFIABLE';

/** How a probe reached its verdict. Stamped on every result, never omitted. */
export const PROBE_METHOD_MCP_STDIO = 'mcp-stdio-jsonrpc';
export const PROBE_METHOD_MCP_NONE = 'none-not-probed';
/** LSP uses `Content-Length` header framing — a DIFFERENT transport from MCP. */
export const PROBE_METHOD_LSP_CONTENT_LENGTH = 'lsp-jsonrpc-content-length';

/** Where the executable that was probed came from. Exposes no path. */
export type EntrypointSource =
  /** Only the built-in hardcoded allowlist. */
  | 'ALLOWLIST'
  /** A manifest `entry` was read AND the resolved file exists on this host. */
  | 'MANIFEST'
  /** Manifest `entry` was read but is absent on disk; allowlist entry used. */
  | 'MANIFEST_ENTRY_ABSENT_FALLBACK_ALLOWLIST'
  /** No manifest and no allowlist entry: the id could not be probed at all. */
  | 'UNRESOLVED';

/** One MCP server's measured (or explicitly unmeasured) verdict. */
export interface McpProbeResult {
  readonly id: string;
  readonly state: ProbeState;
  readonly probeMethod: string;
  /** ISO-8601 instant the probe COMPLETED (not when it was cached). */
  readonly lastProbedAt: string;
  readonly durationMs: number;
  /** Tool count from `tools/list`. Null whenever the state is not ONLINE. */
  readonly toolCount: number | null;
  /**
   * Tool NAMES only — never argument schemas, never tool output, never values.
   * A tool name is a capability identifier; a tool's `inputSchema` can embed
   * default values and examples that operators treat as sensitive.
   */
  readonly toolNames: readonly string[];
  readonly reason: ProbeReasonCode;
  /** Human-readable explanation. Never contains a secret or an env value. */
  readonly reasonText: string;
  /**
   * TRUE only when a transport was actually attempted and produced a verdict.
   * For ONLINE this is the proof-of-life bit. For UNVERIFIABLE it is false.
   */
  readonly measured: boolean;
  /** `serverInfo.name` from the `initialize` result, when the handshake ran. */
  readonly serverName: string | null;
  /** `serverInfo.version` from the `initialize` result, when available. */
  readonly serverVersion: string | null;
  /** Negotiated MCP protocol version from the `initialize` result. */
  readonly protocolVersion: string | null;
  readonly entrySource: EntrypointSource;
  /** Whether the child wrote anything to stderr. The CONTENT is never returned. */
  readonly stderrProduced: boolean;
  /** Child exit code, when the child ran to completion. */
  readonly exitCode: number | null;
  /** TRUE when served from the prober's short TTL cache (measurement is older). */
  readonly cached: boolean;
  /** Age of the underlying measurement when `cached` is true, else null. */
  readonly cacheAgeMs: number | null;
}

/**
 * A disagreement between a manifest's declared `entry` and physical reality.
 *
 * Reported, never auto-corrected: the prober does not own any manifest file, and
 * silently "fixing" a wrong path would hide a real inventory defect from the
 * operator. Only RELATIVE paths are echoed — never an absolute host path and
 * never a value from the environment.
 */
export interface InventoryDiscrepancy {
  readonly id: string;
  readonly source: 'REPO_CONFIG_MANIFEST' | 'HOST_MANIFEST';
  /** The relative path exactly as written in the manifest. */
  readonly declaredEntry: string;
  readonly declaredEntryExistsOnHost: boolean;
  readonly resolution: 'ACCEPTED' | 'REJECTED_ABSENT_ON_HOST' | 'NO_ALLOWLIST_FALLBACK';
  readonly note: string;
}

/** Hard limits the prober was running under, published so they are auditable. */
export interface ProberLimits {
  readonly perChildTimeoutMs: number;
  readonly phaseTimeoutMs: number;
  readonly maxConcurrency: number;
  readonly runDeadlineMs: number;
  readonly stdoutCapBytes: number;
  readonly cacheTtlMs: number;
}

/** Payload of `GET /probe/mcp/status` — the console's source of measured truth. */
export interface McpProbeReport {
  readonly ok: true;
  readonly chainKeyId: string;
  readonly proberVersion: string;
  readonly hostPlatform: string;
  readonly nodeRuntime: string;
  /** Label of the Servers Center root in use. No credentials, no secret values. */
  readonly rootLabel: string;
  readonly inventorySource: 'ALLOWLIST_ONLY' | 'MANIFEST_RECONCILED';
  readonly manifestEnabled: boolean;
  readonly generatedAt: string;
  readonly runDurationMs: number;
  /**
   * FALSE when any served verdict came from cache (or when the whole payload is
   * degraded). A consumer rendering a "measured now" badge must check this.
   */
  readonly measuredFresh: boolean;
  readonly provenance: ReportProvenance;
  readonly summary: ProbeStateCounts;
  readonly servers: readonly McpProbeResult[];
  readonly discrepancies: readonly InventoryDiscrepancy[];
  readonly limits: ProberLimits;
}

/** One LSP entry. Always UNVERIFIABLE until a real LSP transport is dropped in. */
export interface LspProbeResult {
  readonly id: string;
  readonly state: ProbeState;
  readonly probeMethod: string;
  readonly lastProbedAt: string;
  readonly durationMs: number;
  readonly reason: ProbeReasonCode;
  readonly reasonText: string;
  /** Always false: no LSP handshake is implemented. Never infer from a file. */
  readonly measured: boolean;
  /** FALSE until a Content-Length-framed JSON-RPC LSP client exists. */
  readonly transportImplemented: boolean;
  readonly framing: 'CONTENT_LENGTH_HEADERS';
}

/** Payload of `GET /probe/lsp/status`. */
export interface LspProbeReport {
  readonly ok: true;
  readonly chainKeyId: string;
  readonly proberVersion: string;
  readonly generatedAt: string;
  readonly provenance: ReportProvenance;
  /** FALSE today. A real LSP client flips this and the states with it. */
  readonly transportImplemented: boolean;
  readonly summary: ProbeStateCounts;
  readonly servers: readonly LspProbeResult[];
}

/** Payload of `GET /probe/health`. Deliberately carries no host metadata. */
export interface ProberHealth {
  readonly ok: true;
  readonly chainKeyId: string;
  readonly proberVersion: string;
  readonly generatedAt: string;
  /** Authentication is enforced on every other route; this one is open by design. */
  readonly authRequiredForData: true;
}

/** Payload of `GET /probe/tools/:id`. Names only, by construction. */
export interface ToolNameReport {
  readonly ok: true;
  readonly chainKeyId: string;
  readonly id: string;
  readonly state: ProbeState;
  readonly lastProbedAt: string;
  readonly toolCount: number | null;
  readonly toolNames: readonly string[];
  readonly reason: ProbeReasonCode;
  readonly reasonText: string;
  readonly measured: boolean;
}

/** Shared chain key. Also stamped on every payload so responses are attributable. */
export const HOST_PROBER_CHAIN_KEY_ID = '360ea36c28e66d9d';

/**
 * Default origin the container should target.
 *
 * VERIFIED on this host: a Windows service bound to `127.0.0.1` IS reachable
 * from the container through `host.docker.internal`, which Docker Desktop
 * proxies to host loopback. The bridge gateway `172.17.0.1` is REFUSED, so
 * `host.docker.internal` is the only working route — and is why binding loopback
 * is sufficient AND safe.
 */
export const HOST_PROBER_DEFAULT_BASE_URL = 'http://host.docker.internal:39711';

/* ===========================================================================
 * 2. RUNTIME-SAFE PARSING HELPERS
 *
 * The wire is untrusted. A prober that is a newer version, a hostile prober, or
 * a truncated response must degrade to UNVERIFIABLE — never crash the console and
 * never be partially believed.
 * ========================================================================= */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

function asStringArray(value: unknown): readonly string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

/** Runtime guard for `ProbeState`. Used by every consumer of the wire. */
export function isProbeState(value: unknown): value is ProbeState {
  return value === 'ONLINE' || value === 'OFFLINE' || value === 'UNVERIFIABLE';
}

const REASON_CODES: ReadonlySet<string> = new Set<ProbeReasonCode>([
  'HANDSHAKE_COMPLETED',
  'HANDSHAKE_INITIALIZE_ERROR',
  'HANDSHAKE_TOOLS_LIST_ERROR',
  'EXIT_NONZERO_BEFORE_HANDSHAKE',
  'EXIT_ZERO_NO_MCP_FRAMES',
  'NOT_AN_EXECUTABLE_IMAGE',
  'EMPTY_TOOL_LIST',
  'STDOUT_CAPTURE_LIMIT_EXCEEDED',
  'ENTRYPOINT_ABSENT',
  'SPAWN_PERMISSION_DENIED',
  'SPAWN_FAILED',
  'HANDSHAKE_TIMEOUT',
  'RUN_DEADLINE_EXCEEDED',
  'PLATFORM_MISMATCH',
  'INVENTORY_UNRESOLVED',
  'LSP_TRANSPORT_NOT_IMPLEMENTED',
  'PROBER_UNREACHABLE',
  'PROBER_UNAUTHORIZED',
  'PROBER_FORBIDDEN',
  'PROBER_RATE_LIMITED',
  'PROBER_TIMEOUT',
  'PROBER_RESPONSE_INVALID',
  'PROBER_TOKEN_ABSENT',
  'PROBER_ERROR',
]);

function asReasonCode(value: unknown, fallback: ProbeReasonCode): ProbeReasonCode {
  return typeof value === 'string' && REASON_CODES.has(value)
    ? (value as ProbeReasonCode)
    : fallback;
}

/* ===========================================================================
 * 3. SANITIZERS — turn an untrusted payload into a trusted shape, or degrade
 * ========================================================================= */

/**
 * Normalize one `McpProbeResult` from the wire.
 *
 * Enforces the honesty invariant at the boundary: a payload claiming ONLINE with
 * no tool count, or with a non-positive tool count, or with `measured: false`,
 * is DOWNGRADED to UNVERIFIABLE. A prober bug must not be able to inject a green
 * status into the console.
 */
export function sanitizeMcpProbeResult(raw: unknown): McpProbeResult | null {
  const record = asRecord(raw);
  if (!record) return null;

  const id = asString(record['id']);
  if (id === null) return null;

  const declaredState = record['state'];
  const declaredToolCount = asFiniteNumber(record['toolCount']);
  const toolNames = asStringArray(record['toolNames']);

  let state: ProbeState = isProbeState(declaredState) ? declaredState : 'UNVERIFIABLE';
  let reason: ProbeReasonCode = asReasonCode(
    record['reason'],
    state === 'ONLINE' ? 'PROBER_RESPONSE_INVALID' : 'PROBER_RESPONSE_INVALID',
  );
  let measured = record['measured'] === true;
  let toolCount: number | null = declaredToolCount === null ? null : Math.trunc(declaredToolCount);
  let names: readonly string[] = toolNames;

  // ONLINE is admissible only when a transport really ran AND tools were enumerated.
  if (state === 'ONLINE') {
    const declaredReason = asReasonCode(record['reason'], 'PROBER_RESPONSE_INVALID');
    // A green verdict must carry the proof-of-handshake reason. Accepting
    // ONLINE alongside, say, EXIT_ZERO_NO_MCP_FRAMES would let an internally
    // inconsistent payload through, which is exactly the class of lie this
    // whole system exists to remove.
    if (declaredReason !== 'HANDSHAKE_COMPLETED') {
      state = 'UNVERIFIABLE';
      reason = 'PROBER_RESPONSE_INVALID';
      measured = false;
      toolCount = null;
      names = [];
    } else if (measured !== true || toolCount === null || toolCount < 1 || names.length < 1) {
      state = 'UNVERIFIABLE';
      reason = 'PROBER_RESPONSE_INVALID';
      measured = false;
      toolCount = null;
      names = [];
    } else {
      // toolCount must agree with the enumerated names, else the payload is torn.
      if (toolCount !== names.length) toolCount = names.length;
      reason = declaredReason;
    }
  } else {
    // Non-ONLINE: a tool count is not claimed, and `measured` may not be true for
    // UNVERIFIABLE (there is nothing that was measured).
    if (state === 'OFFLINE' && toolCount !== null && toolCount < 0) toolCount = 0;
    if (state === 'UNVERIFIABLE') {
      measured = false;
      toolCount = null;
      names = [];
    }
  }

  const entrySourceRaw = asString(record['entrySource']);
  const entrySource: EntrypointSource =
    entrySourceRaw === 'ALLOWLIST' ||
    entrySourceRaw === 'MANIFEST' ||
    entrySourceRaw === 'MANIFEST_ENTRY_ABSENT_FALLBACK_ALLOWLIST' ||
    entrySourceRaw === 'UNRESOLVED'
      ? entrySourceRaw
      : 'UNRESOLVED';

  return {
    id,
    state,
    probeMethod: asString(record['probeMethod']) ?? PROBE_METHOD_MCP_NONE,
    lastProbedAt: asString(record['lastProbedAt']) ?? new Date(0).toISOString(),
    durationMs: asFiniteNumber(record['durationMs']) ?? 0,
    toolCount,
    toolNames: names,
    reason,
    reasonText: asString(record['reasonText']) ?? 'No reason supplied by the prober.',
    measured,
    serverName: asString(record['serverName']),
    serverVersion: asString(record['serverVersion']),
    protocolVersion: asString(record['protocolVersion']),
    entrySource,
    stderrProduced: record['stderrProduced'] === true,
    exitCode: asFiniteNumber(record['exitCode']),
    cached: record['cached'] === true,
    cacheAgeMs: asFiniteNumber(record['cacheAgeMs']),
  };
}

function countStates(results: readonly McpProbeResult[]): ProbeStateCounts {
  return {
    total: results.length,
    online: results.filter((r) => r.state === 'ONLINE').length,
    offline: results.filter((r) => r.state === 'OFFLINE').length,
    unverifiable: results.filter((r) => r.state === 'UNVERIFIABLE').length,
  };
}

/**
 * Sanitize a `/probe/mcp/status` payload.
 *
 * Returns `null` when the payload is not a recognizable report, which the caller
 * MUST translate into a degraded report rather than an error.
 */
export function sanitizeMcpProbeReport(raw: unknown): McpProbeReport | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (record['ok'] !== true) return null;

  const servers = asArray(record['servers'])
    .map(sanitizeMcpProbeResult)
    .filter((r): r is McpProbeResult => r !== null);

  const discrepancies = asArray(record['discrepancies'])
    .map((item): InventoryDiscrepancy | null => {
      const d = asRecord(item);
      if (!d) return null;
      const id = asString(d['id']);
      const declaredEntry = asString(d['declaredEntry']);
      if (id === null || declaredEntry === null) return null;
      const source = asString(d['source']);
      const resolution = asString(d['resolution']);
      return {
        id,
        source: source === 'HOST_MANIFEST' ? 'HOST_MANIFEST' : 'REPO_CONFIG_MANIFEST',
        declaredEntry,
        declaredEntryExistsOnHost: d['declaredEntryExistsOnHost'] === true,
        resolution:
          resolution === 'ACCEPTED'
            ? 'ACCEPTED'
            : resolution === 'NO_ALLOWLIST_FALLBACK'
              ? 'NO_ALLOWLIST_FALLBACK'
              : 'REJECTED_ABSENT_ON_HOST',
        note: asString(d['note']) ?? '',
      };
    })
    .filter((d): d is InventoryDiscrepancy => d !== null);

  const limitsRecord = asRecord(record['limits']) ?? {};
  const measuredFresh = record['measuredFresh'] === true;
  // A payload claiming freshness while serving cached rows is internally
  // inconsistent; trust the conservative reading.
  const anyCached = servers.some((s) => s.cached);

  const provenance: ReportProvenance =
    record['provenance'] === 'DEGRADED_UNVERIFIABLE' ? 'DEGRADED_UNVERIFIABLE' : 'MEASURED_BY_PROBER';

  return {
    ok: true,
    chainKeyId: asString(record['chainKeyId']) ?? HOST_PROBER_CHAIN_KEY_ID,
    proberVersion: asString(record['proberVersion']) ?? 'unknown',
    hostPlatform: asString(record['hostPlatform']) ?? 'unknown',
    nodeRuntime: asString(record['nodeRuntime']) ?? 'unknown',
    rootLabel: asString(record['rootLabel']) ?? 'unreported',
    inventorySource:
      asString(record['inventorySource']) === 'MANIFEST_RECONCILED' ? 'MANIFEST_RECONCILED' : 'ALLOWLIST_ONLY',
    manifestEnabled: record['manifestEnabled'] === true,
    generatedAt: asString(record['generatedAt']) ?? new Date(0).toISOString(),
    runDurationMs: asFiniteNumber(record['runDurationMs']) ?? 0,
    measuredFresh: measuredFresh && !anyCached,
    provenance,
    summary: countStates(servers),
    servers,
    discrepancies,
    limits: {
      perChildTimeoutMs: asFiniteNumber(limitsRecord['perChildTimeoutMs']) ?? 0,
      phaseTimeoutMs: asFiniteNumber(limitsRecord['phaseTimeoutMs']) ?? 0,
      maxConcurrency: asFiniteNumber(limitsRecord['maxConcurrency']) ?? 0,
      runDeadlineMs: asFiniteNumber(limitsRecord['runDeadlineMs']) ?? 0,
      stdoutCapBytes: asFiniteNumber(limitsRecord['stdoutCapBytes']) ?? 0,
      cacheTtlMs: asFiniteNumber(limitsRecord['cacheTtlMs']) ?? 0,
    },
  };
}

/** Sanitize an `/probe/lsp/status` payload. */
export function sanitizeLspProbeReport(raw: unknown): LspProbeReport | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (record['ok'] !== true) return null;

  const transportImplemented = record['transportImplemented'] === true;
  const servers = asArray(record['servers']).map((item): LspProbeResult => {
    const r = asRecord(item);
    const id = asString(r?.['id']) ?? 'unknown';
    // A consumer-visible LSP state is never trusted beyond UNVERIFIABLE while
    // `transportImplemented` is false: the transport is the evidence, and there
    // is none. Inferring readiness from file existence is the original defect.
    const rawState = r?.['state'];
    const state: ProbeState = transportImplemented && isProbeState(rawState) ? rawState : 'UNVERIFIABLE';
    return {
      id,
      state,
      probeMethod: asString(r?.['probeMethod']) ?? PROBE_METHOD_LSP_CONTENT_LENGTH,
      lastProbedAt: asString(r?.['lastProbedAt']) ?? new Date(0).toISOString(),
      durationMs: asFiniteNumber(r?.['durationMs']) ?? 0,
      reason: transportImplemented
        ? asReasonCode(r?.['reason'], 'LSP_TRANSPORT_NOT_IMPLEMENTED')
        : 'LSP_TRANSPORT_NOT_IMPLEMENTED',
      reasonText:
        asString(r?.['reasonText']) ??
        'No LSP transport is implemented. Readiness is NOT inferred from file existence.',
      measured: transportImplemented && r?.['measured'] === true,
      transportImplemented,
      framing: 'CONTENT_LENGTH_HEADERS',
    };
  });

  return {
    ok: true,
    chainKeyId: asString(record['chainKeyId']) ?? HOST_PROBER_CHAIN_KEY_ID,
    proberVersion: asString(record['proberVersion']) ?? 'unknown',
    generatedAt: asString(record['generatedAt']) ?? new Date(0).toISOString(),
    provenance:
      record['provenance'] === 'DEGRADED_UNVERIFIABLE' ? 'DEGRADED_UNVERIFIABLE' : 'MEASURED_BY_PROBER',
    transportImplemented,
    summary: {
      total: servers.length,
      online: servers.filter((s) => s.state === 'ONLINE').length,
      offline: servers.filter((s) => s.state === 'OFFLINE').length,
      unverifiable: servers.filter((s) => s.state === 'UNVERIFIABLE').length,
    },
    servers,
  };
}

/* ===========================================================================
 * 4. DEGRADATION — the single place UNVERIFIABLE is manufactured
 * ========================================================================= */

/**
 * Build an all-UNVERIFIABLE MCP report.
 *
 * This is the ONLY sanctioned way to represent "the prober did not measure".
 * Every entry gets `measured: false`, `toolCount: null`, empty tool names, and
 * the supplied reason — so no downstream consumer can read a capability or an
 * outage out of it.
 *
 * @param ids       Inventory the console already knows about. When the prober is
 *                  unreachable we cannot learn its inventory, so the caller's
 *                  expected ids are used to keep the roster visible. Pass `[]`
 *                  and the roster will legitimately be empty.
 * @param reason    Machine-readable cause.
 * @param reasonText Human-readable cause. NEVER include a token or an env value.
 */
export function buildUnverifiableMcpReport(
  ids: readonly string[],
  reason: ProbeReasonCode,
  reasonText: string,
  generatedAt: string = new Date().toISOString(),
): McpProbeReport {
  const servers: McpProbeResult[] = ids.map((id) => ({
    id,
    state: 'UNVERIFIABLE' as const,
    probeMethod: PROBE_METHOD_MCP_NONE,
    lastProbedAt: generatedAt,
    durationMs: 0,
    toolCount: null,
    toolNames: [] as readonly string[],
    reason,
    reasonText,
    measured: false,
    serverName: null,
    serverVersion: null,
    protocolVersion: null,
    entrySource: 'UNRESOLVED' as const,
    stderrProduced: false,
    exitCode: null,
    cached: false,
    cacheAgeMs: null,
  }));

  return {
    ok: true,
    chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
    proberVersion: 'unreachable',
    hostPlatform: 'unmeasured',
    nodeRuntime: 'unmeasured',
    rootLabel: 'unmeasured',
    inventorySource: 'ALLOWLIST_ONLY',
    manifestEnabled: false,
    generatedAt,
    runDurationMs: 0,
    measuredFresh: false,
    provenance: 'DEGRADED_UNVERIFIABLE',
    summary: countStates(servers),
    servers,
    discrepancies: [],
    limits: {
      perChildTimeoutMs: 0,
      phaseTimeoutMs: 0,
      maxConcurrency: 0,
      runDeadlineMs: 0,
      stdoutCapBytes: 0,
      cacheTtlMs: 0,
    },
  };
}

/** Build an all-UNVERIFIABLE LSP report. See `buildUnverifiableMcpReport`. */
export function buildUnverifiableLspReport(
  ids: readonly string[],
  reason: ProbeReasonCode,
  reasonText: string,
  generatedAt: string = new Date().toISOString(),
): LspProbeReport {
  const servers: LspProbeResult[] = ids.map((id) => ({
    id,
    state: 'UNVERIFIABLE' as const,
    probeMethod: PROBE_METHOD_LSP_CONTENT_LENGTH,
    lastProbedAt: generatedAt,
    durationMs: 0,
    reason,
    reasonText,
    measured: false,
    transportImplemented: false,
    framing: 'CONTENT_LENGTH_HEADERS' as const,
  }));

  return {
    ok: true,
    chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
    proberVersion: 'unreachable',
    generatedAt,
    provenance: 'DEGRADED_UNVERIFIABLE',
    transportImplemented: false,
    summary: {
      total: servers.length,
      online: 0,
      offline: 0,
      unverifiable: servers.length,
    },
    servers,
  };
}

/* ===========================================================================
 * 5. CONSOLE-SIDE HTTP CLIENT
 * ========================================================================= */

export interface HostProberClientOptions {
  /** Defaults to `HOST_PROBER_BASE_URL`, then to `host.docker.internal:39711`. */
  readonly baseUrl?: string;
  /** Bearer token. NEVER logged, NEVER included in a returned payload. */
  readonly token?: string;
  /** Per-request budget. Default 15000 ms — generous for a full 7-server run. */
  readonly timeoutMs?: number;
  /** Injection seam for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Read-only client for the host prober.
 *
 * HARD CONTRACT: no method on this class throws for a transport-layer problem.
 * `fetchMcpStatus` and `fetchLspStatus` always resolve to a report, degrading to
 * all-UNVERIFIABLE. A caller that wants to know "did the prober answer?" reads
 * `provenance === 'MEASURED_BY_PROBER'`; it never has to catch an exception to
 * find out, which removes the temptation to substitute a default verdict.
 *
 * SECURITY: this client only ever requests fixed paths. There is no method that
 * forwards a caller-supplied URL, path, command, or entrypoint to the prober.
 */
export class HostProberClient {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: HostProberClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveProberBaseUrl()).replace(/\/+$/, '');
    this.token = options.token ?? process.env['HOST_PROBER_TOKEN'] ?? null;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Perform one authenticated GET against a FIXED prober path.
   *
   * `path` is a compile-time constant supplied by this class only — there is no
   * public surface through which a caller can influence it.
   */
  private async getFixed(
    path: '/probe/health' | '/probe/mcp/status' | '/probe/lsp/status',
  ): Promise<
    | { readonly ok: true; readonly body: unknown }
    | { readonly ok: false; readonly reason: ProbeReasonCode; readonly reasonText: string }
  > {
    if (this.token === null || this.token.length < 32) {
      return {
        ok: false,
        reason: 'PROBER_TOKEN_ABSENT',
        reasonText:
          'HOST_PROBER_TOKEN is not configured on the console side (or is shorter than 32 characters). No probe was attempted, so no server state is known.',
      };
    }
    if (typeof this.fetchImpl !== 'function') {
      return {
        ok: false,
        reason: 'PROBER_UNREACHABLE',
        reasonText: 'No fetch implementation is available in this runtime.',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          // The token is placed here and nowhere else; it is never logged.
          authorization: `Bearer ${this.token}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          reason: response.status === 401 ? 'PROBER_UNAUTHORIZED' : 'PROBER_FORBIDDEN',
          reasonText: `The host prober rejected the console credentials (HTTP ${response.status}). The prober's token and the console's token differ, or the Host/Origin guard rejected the request.`,
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          reason: 'PROBER_RATE_LIMITED',
          reasonText: 'The host prober rate limit (30 requests/minute per peer) was exceeded.',
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          reason: 'PROBER_ERROR',
          reasonText: `The host prober returned HTTP ${response.status}.`,
        };
      }

      const body: unknown = await response.json();
      return { ok: true, body };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        reason: aborted ? 'PROBER_TIMEOUT' : 'PROBER_UNREACHABLE',
        reasonText: aborted
          ? `No response from the host prober within ${this.timeoutMs} ms.`
          : `The host prober at ${this.baseUrl} could not be reached. Confirm the prober service is running, is bound to 127.0.0.1, and that HOST_PROBER_ALLOWED_HOSTS permits the container's Host header.`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** `GET /probe/health`. Throws nothing; returns `null` when unreachable. */
  public async health(): Promise<ProberHealth | null> {
    // Health is intentionally unauthenticated on the prober side, so it is
    // requested WITHOUT the Authorization header: sending it would be pointless
    // and would put the token on a route that does not need it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/probe/health`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = asRecord(await response.json());
      if (!body || body['ok'] !== true) return null;
      return {
        ok: true,
        chainKeyId: asString(body['chainKeyId']) ?? HOST_PROBER_CHAIN_KEY_ID,
        proberVersion: asString(body['proberVersion']) ?? 'unknown',
        generatedAt: asString(body['generatedAt']) ?? new Date(0).toISOString(),
        authRequiredForData: true,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `GET /probe/mcp/status`.
   *
   * @param expectedIds Inventory to fall back to when the prober is unreachable,
   *                    so the console can still show a roster of UNVERIFIABLE
   *                    entries instead of silently showing nothing.
   */
  public async fetchMcpStatus(expectedIds: readonly string[] = []): Promise<McpProbeReport> {
    const outcome = await this.getFixed('/probe/mcp/status');
    // `=== false` rather than `!outcome.ok`: this project compiles WITHOUT
    // strictNullChecks, and truthiness narrowing of a boolean-literal union is not
    // reliable in that mode. An explicit comparison narrows correctly either way.
    if (outcome.ok === false) {
      // Narrowed here: `getFixed` returns a discriminated union on `ok`, so the false
      // branch is the only shape carrying `reason`/`reasonText`.
      return buildUnverifiableMcpReport(
        expectedIds,
        outcome.reason,
        outcome.reasonText,
      );
    }
    const report = sanitizeMcpProbeReport(outcome.body);
    if (report === null) {
      return buildUnverifiableMcpReport(
        expectedIds,
        'PROBER_RESPONSE_INVALID',
        'The host prober answered but the payload did not match the declared contract, so it was not believed. No server state is known.',
      );
    }
    return report;
  }

  /** `GET /probe/lsp/status`. Always UNVERIFIABLE until a real LSP transport lands. */
  public async fetchLspStatus(expectedIds: readonly string[] = []): Promise<LspProbeReport> {
    const outcome = await this.getFixed('/probe/lsp/status');
    // Explicit comparison for reliable narrowing without strictNullChecks (see above).
    if (outcome.ok === false) {
      return buildUnverifiableLspReport(expectedIds, outcome.reason, outcome.reasonText);
    }
    const report = sanitizeLspProbeReport(outcome.body);
    if (report === null) {
      return buildUnverifiableLspReport(
        expectedIds,
        'PROBER_RESPONSE_INVALID',
        'The host prober answered with an unrecognized LSP payload. No language-server state is known.',
      );
    }
    return report;
  }
}

/**
 * Resolve the prober origin.
 *
 * Order: explicit argument -> `HOST_PROBER_BASE_URL` -> the verified default
 * `http://host.docker.internal:39711`.
 */
export function resolveProberBaseUrl(explicit?: string): string {
  const candidate = explicit ?? process.env['HOST_PROBER_BASE_URL'];
  if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  return HOST_PROBER_DEFAULT_BASE_URL;
}