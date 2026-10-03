/**
 * ============================================================================
 * SOVEREIGN HOST PROBER — THE REAL INFRASTRUCTURE MEASUREMENT INSTRUMENT
 * ============================================================================
 * Chain Key ID: 360ea36c28e66d9d
 * Author role:   PROBER-BUILDER (host-side prober, production implementation)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS PROCESS EXISTS
 * ────────────────────────
 * The console runs in an Alpine container. `E:\Servers-Center` does not exist in
 * Linux. The container has no PowerShell and cannot execute the Windows-native
 * MCP binaries. So the container is physically incapable of measuring the very
 * infrastructure the console claims to report on — and the console was therefore
 * either blind or fabricating.
 *
 * This process runs ON THE WINDOWS HOST, where `E:\` is real, spawns the real
 * MCP servers, performs a real MCP stdio JSON-RPC handshake with each one, and
 * publishes the MEASURED result over a loopback HTTP API the container can read.
 * The status becomes genuinely true.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRANSPORT RATIONALE (why HTTP on loopback)
 * ──────────────────────────────────────────
 * A Windows named pipe is a Win32 kernel object and is not addressable from a
 * Linux container's network namespace. There is no AF_UNIX bridge across the
 * Docker Desktop VM boundary either. HTTP on Windows loopback is the only
 * transport that is simultaneously bindable to loopback on the host AND
 * reachable from the container.
 *
 * VERIFIED EMPIRICALLY ON THIS HOST: a listener bound to `127.0.0.1` answers on
 * `http://host.docker.internal:39711` from inside the running container, while
 * the bridge gateway `172.17.0.1` is REFUSED. Binding `0.0.0.0` is therefore
 * unnecessary and strictly worse; this process refuses to start on any
 * non-loopback bind address.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DESIGN INVARIANTS — do not relax without Commander approval
 * ───────────────────────────────────────────────────────────────────────────
 *  1. READ-ONLY. No filesystem writes. No mutation of any manifest.
 *  2. NO CALLER-CONTROLLED EXECUTION. A request may only SELECT an id from a
 *     hardcoded allowlist. There is no endpoint that accepts a path, a command,
 *     or an entrypoint. This is what keeps the prober from becoming an RCE
 *     gadget reachable from any container on the Docker host.
 *  3. LOOPBACK-ONLY BIND. Enforced, not merely defaulted.
 *  4. BEARER TOKEN, >= 32 chars, constant-time compared. The process REFUSES TO
 *     START without one (fail closed).
 *  5. THREE-STATE HONESTY. ONLINE requires a completed handshake that enumerated
 *     at least one tool. "Could not conclude" is UNVERIFIABLE and is never
 *     reported as ONLINE or OFFLINE.
 *  6. NO SECRET IN, NO SECRET OUT. Child environments are built from an explicit
 *     allowlist; stderr content is never captured into a payload; the token is
 *     never logged and never returned.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEPENDENCY POSTURE
 * ──────────────────
 * Zero third-party dependencies. `@modelcontextprotocol/sdk` is absent from
 * package.json and from node_modules (it appears in package-lock.json only as an
 * OPTIONAL peer of `@google/genai`). Installing it is a Commander decision that
 * has not been made, so the stdio JSON-RPC client below is hand-rolled. That
 * also keeps the probe surface small enough to audit by reading.
 *
 * THIS FILE IS HOST-ONLY. It must never be imported from `server.ts` or anything
 * under `src/` — esbuild bundles those into `dist/server.cjs` and the container
 * has neither `E:\` nor the ability to execute these binaries. Import the shared
 * contract from `scripts/host_prober_client.ts` instead.
 * ============================================================================
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { platform, arch, EOL } from 'node:os';

// The real LSP transport. LSP speaks Content-Length header framing, not the
// newline-delimited JSON-RPC used for MCP, so a separate client is REQUIRED —
// reusing the MCP client would silently freeze on the first frame. This module is
// the measured implementation; `lspStatus()` below is now its entry point rather
// than an honest admission that no transport exists.
import { runLspProbes, toProberLspReport } from './lsp_prober';

import {
  HOST_PROBER_CHAIN_KEY_ID,
  PROBE_METHOD_LSP_CONTENT_LENGTH,
  PROBE_METHOD_MCP_STDIO,
  buildUnverifiableLspReport,
  type EntrypointSource,
  type InventoryDiscrepancy,
  type LspProbeReport,
  type LspProbeResult,
  type McpProbeReport,
  type McpProbeResult,
  type ProbeReasonCode,
  type ProbeState,
  type ProberLimits,
} from './host_prober_client';

/* ===========================================================================
 * SECTION 1 — CONFIGURATION
 * ========================================================================= */

const PROBER_NAME = 'sovereign-host-prober';
const PROBER_VERSION = '1.0.0';

/** Hard ceiling on one child's whole lifetime. */
const DEFAULT_PER_CHILD_TIMEOUT_MS = 20_000;
/** Ceiling on any single awaited handshake phase, so one silent step cannot eat the whole budget. */
const DEFAULT_PHASE_TIMEOUT_MS = 10_000;
/** Ceiling on one full sweep of the inventory. */
const DEFAULT_RUN_DEADLINE_MS = 90_000;
/** Never run more than this many probes at once (bounds process + FD pressure). */
const DEFAULT_MAX_CONCURRENCY = 3;
/** Per-stream capture ceiling. A flooding child cannot exhaust prober memory. */
const DEFAULT_CAPTURE_CAP_BYTES = 4 * 1024 * 1024;
/** Short TTL so an expensive browser-backed server is not respawned per poll. */
const DEFAULT_CACHE_TTL_MS = 15_000;
/**
 * Grace period after 'exit' for stdio to drain before we declare the child dead.
 * On Windows 'exit' can fire while stdout/stderr are still buffered.
 */
const POST_EXIT_DRAIN_MS = 300;
/** Fixed-window rate limit for probing routes (health is exempt; see handler). */
const RATE_LIMIT_CAPACITY = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Minimum accepted bearer-token length. */
const MIN_TOKEN_LENGTH = 32;
/** Loopback bind addresses this process will accept. Anything else is a refusal. */
const LOOPBACK_BINDS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

const DEFAULT_ROOT = 'E:\\Servers-Center';
const DEFAULT_PORT = 39711;

/**
 * Environment variables forwarded to EVERY child.
 *
 * This list is the complete hostile-surface boundary: a child can read its own
 * environment, so anything not named here is invisible to it. Host secrets
 * (tokens, API keys, cloud credentials) are therefore NOT inherited.
 *
 * Each entry is justified:
 *   PATH                 the real launch configuration relies on PATH for shims.
 *   SystemRoot/SystemDrive Windows DLL search + crypto providers fail without these.
 *   PATHEXT              bare-command resolution semantics.
 *   COMSPEC              inherited by some Win32 helper binaries.
 *   TEMP/TMP             scratch directories; without them Chromium refuses to start.
 *   USERPROFILE/HOMEDRIVE/HOMEPATH  Chromium profile resolution.
 *   APPDATA/LOCALAPPDATA Chromium cache/profile root.
 *   PROGRAMFILES(x86)    Windows install-dir discovery used by child processes.
 *   NUMBER_OF_PROCESSORS / PROCESSOR_ARCHITECTURE  Node/Bun sharding heuristics.
 */
const GLOBAL_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'SystemRoot',
  'SystemDrive',
  'PATHEXT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
];

/**
 * THE EXECUTABLE ALLOWLIST — the only things this process can ever spawn.
 *
 * Every HTTP request may only SELECT one of these ids. Nothing in a request can
 * add, override, extend or influence an entry.
 *
 * `relativeEntry` is relative to HOST_PROBER_ROOT and uses forward slashes, so
 * the same declaration is correct under any root override. It is joined at run
 * time and then re-verified to be INSIDE the root (see `resolveWithinRoot`).
 *
 * `kind`:
 *   'node'            launch with the Servers Center Node runtime, entry is a .js
 *   'windows-native'  launch the entry directly; only ever measurable on win32
 *
 * `note` records a MEASURED reason whenever this declaration deliberately differs
 * from the manifest. Those notes are not decoration — see `github` below.
 */
interface AllowlistedEntrypoint {
  readonly id: string;
  readonly kind: 'node' | 'windows-native';
  readonly relativeEntry: string;
  readonly args: readonly string[];
  /** Additional environment variable NAMES to forward. Values are never logged. */
  readonly passEnv: readonly string[];
  /** Operator-facing note, also surfaced through `/probe/discrepancies`. */
  readonly note: string | null;
}

const ALLOWLIST: readonly AllowlistedEntrypoint[] = [
  {
    id: 'sovereign-commander',
    kind: 'node',
    relativeEntry: 'servers/mcp/sovereign-commander/server.js',
    args: [],
    passEnv: ['CHAIN_KEY_ID', 'CONSOLE_URL'],
    note: 'Ring-0 governance kernel MCP. Chain key is forwarded so the server can self-verify.',
  },
  {
    id: 'shell',
    kind: 'node',
    relativeEntry: 'servers/mcp/shell/server.js',
    args: [],
    passEnv: ['SHELL_CWD', 'SHELL_ROOT', 'SHELL_TIMEOUT_MS', 'SHELL_MAX_BUFFER', 'SHELL_ALLOWLIST'],
    note: 'Hardened shell MCP. Its sandbox allowlist variables are forwarded by name; values stay in the child.',
  },
  {
    id: 'chrome-devtools',
    kind: 'node',
    relativeEntry: 'servers/mcp/chrome-devtools/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js',
    args: ['--headless', '--isolated', '--no-usage-statistics', '--workspace', 'C:\\Users\\AA5II\\sovereign-commander-console\\sovereign-commander-console'],
    passEnv: [],
    note: 'Mirrors the workspace in opencode.json. Headless and isolated so a probe cannot disturb an interactive browser session.',
  },
  {
    id: 'syncfusion',
    kind: 'node',
    relativeEntry: 'servers/mcp/syncfusion/server.js',
    args: [],
    passEnv: ['SYNCFUSION'],
    note: null,
  },
  {
    id: 'context7',
    kind: 'node',
    relativeEntry: 'servers/mcp/context7/node_modules/@upstash/context7-mcp/dist/index.js',
    args: [],
    passEnv: [],
    note: 'Package entry, not a local server.js — matches both opencode.json and the host manifest.',
  },
  {
    id: 'playwright',
    kind: 'node',
    relativeEntry: 'servers/mcp/playwright/node_modules/@playwright/mcp/cli.js',
    args: ['--headless', '--isolated'],
    passEnv: ['PLAYWRIGHT_BROWSERS_PATH'],
    note: 'Headless + isolated so probing does not contend with a human-driven browser.',
  },
  {
    id: 'github',
    kind: 'windows-native',
    relativeEntry: 'servers/mcp/github/github-mcp-server.exe',
    args: ['stdio'],
    passEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOOLSETS', 'GITHUB_HOST'],
    // MEASURED, not assumed. Launching this server through
    // `powershell -File run-github-mcp.ps1` (as opencode.json:136-149 does) yields
    // EXIT 0 with ZERO MCP frames, because PowerShell does not forward its stdin
    // pipe to a native child: the server sees EOF and quits. Invoking the .exe
    // directly answers `initialize` and returns 45 tools. This is a PROBE-SIDE
    // decision; the Commander's own launch configuration is untouched.
    note: 'Invoked as the real .exe, never through the PowerShell wrapper: the wrapper exits 0 with zero MCP frames because PowerShell does not forward stdin to a native child.',
  },
];

const ALLOWLIST_BY_ID: ReadonlyMap<string, AllowlistedEntrypoint> = new Map(
  ALLOWLIST.map((entry) => [entry.id, entry]),
);

/** Strict id charset. A request id must match this AND exist in the allowlist. */
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** Fully resolved, validated prober configuration. Never partially applied. */
export interface ProberConfig {
  readonly root: string;
  readonly port: number;
  readonly bind: string;
  readonly token: string;
  readonly manifestEnabled: boolean;
  readonly repoRoot: string;
  readonly nodeBinary: string | null;
  readonly perChildTimeoutMs: number;
  readonly phaseTimeoutMs: number;
  readonly maxConcurrency: number;
  readonly runDeadlineMs: number;
  readonly captureCapBytes: number;
  readonly cacheTtlMs: number;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
}

/** Parse a positive integer from the environment, falling back when unusable. */
function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function envFlagDisabled(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === '0' || value === 'false' || value === 'no' || value === 'off';
}

function envList(name: string): readonly string[] {
  const raw = process.env[name];
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Walk up from `start` looking for the repository root (a directory containing
 * `package.json`). Deliberately avoids `import.meta.url` so the module runs
 * identically under tsx, ts-node, and a compiled CJS build.
 */
function findRepoRoot(start: string): string {
  let current = resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

/**
 * Resolve the Node runtime used to launch `kind: 'node'` entries.
 *
 * ORDER (honest, never a hardcoded version string):
 *   1. HOST_PROBER_NODE          explicit operator override
 *   2. host manifest runtime.node if the manifest is readable
 *   3. a single `runtime\<dir>\node.exe` under the root (or the greatest match)
 *   4. `node` on PATH
 *
 * The reference implementation hardcoded `node-v24.19.0-win-x64`. That is a
 * fabrication risk: when the runtime is upgraded the prober would keep probing
 * a binary that may no longer be the one the Commander uses, or may not exist
 * at all. Discovery keeps the measurement attached to reality.
 */
function resolveNodeBinary(root: string, manifestNode: string | null): string | null {
  const override = process.env['HOST_PROBER_NODE'];
  if (typeof override === 'string' && override.trim().length > 0 && existsSync(override.trim())) {
    return resolve(override.trim());
  }

  if (manifestNode !== null) {
    const fromManifest = isAbsolute(manifestNode) ? manifestNode : resolve(root, manifestNode);
    if (existsSync(fromManifest) && isRegularFile(fromManifest)) return resolve(fromManifest);
  }

  const runtimeDir = join(root, 'runtime');
  try {
    if (existsSync(runtimeDir) && isDirectory(runtimeDir)) {
      const candidates = readdirSync(runtimeDir)
        .map((name) => join(runtimeDir, name, 'node.exe'))
        .filter((candidate) => existsSync(candidate) && isRegularFile(candidate))
        .sort();
      if (candidates.length > 0) return candidates[candidates.length - 1];
    }
  } catch {
    // An unreadable runtime directory is not fatal: the prober still reports
    // node-kind entries as UNVERIFIABLE, which is the honest verdict.
  }

  const onPath = resolveExecutable('node');
  return onPath.exists ? onPath.path : null;
}

/**
 * Build the effective configuration, failing CLOSED on the token and on a
 * non-loopback bind.
 *
 * `requireToken` is false only for `--once`, which never opens a socket and
 * therefore has nothing to protect; a CI one-shot run should not need a secret.
 */
export function loadConfig(requireToken: boolean): ProberConfig {
  const tokenRaw = process.env['HOST_PROBER_TOKEN'];
  const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
  if (requireToken && token.length < MIN_TOKEN_LENGTH) {
    // Fail closed. A weak or absent token is refused outright rather than
    // silently downgraded to an unauthenticated read-only service.
    throw new Error(
      `HOST_PROBER_TOKEN must be set and at least ${MIN_TOKEN_LENGTH} characters long before the prober will bind a socket. ` +
        `Generate one with: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`,
    );
  }

  const bindRaw = process.env['HOST_PROBER_BIND'];
  const bind = typeof bindRaw === 'string' && bindRaw.trim().length > 0 ? bindRaw.trim() : '127.0.0.1';
  if (!LOOPBACK_BINDS.has(bind)) {
    throw new Error(
      `HOST_PROBER_BIND="${bind}" is refused. This prober only binds a loopback address ` +
        `(${Array.from(LOOPBACK_BINDS).join(', ')}). Verified on this host: a loopback listener IS reachable from the ` +
        `container via host.docker.internal, so a wider bind buys nothing and widens exposure.`,
    );
  }

  const root = resolve(process.env['HOST_PROBER_ROOT']?.trim() || DEFAULT_ROOT);
  const port = envInt('HOST_PROBER_PORT', DEFAULT_PORT, 1, 65_535);
  const repoRoot = findRepoRoot(process.env['HOST_PROBER_REPO_ROOT'] ?? process.cwd());

  // Default Host allowlist is loopback names ONLY. `host.docker.internal` must be
  // added explicitly by the operator, because accepting it is precisely what
  // widens the DNS-rebinding surface and it must never happen by accident.
  const portSuffixes = [`:${port}`, ''];
  const loopbackHosts = new Set<string>();
  for (const name of ['127.0.0.1', 'localhost', '[::1]']) {
    for (const suffix of portSuffixes) loopbackHosts.add(`${name}${suffix}`);
  }
  const allowedHosts = new Set<string>(loopbackHosts);
  for (const extra of envList('HOST_PROBER_ALLOWED_HOSTS')) {
    for (const suffix of portSuffixes) allowedHosts.add(`${extra.replace(/:\d+$/, '')}${suffix}`);
  }

  return {
    root,
    port,
    bind,
    token,
    manifestEnabled: !envFlagDisabled('HOST_PROBER_MANIFEST'),
    repoRoot,
    nodeBinary: null, // resolved in `buildInventory`, which also reads the manifest
    perChildTimeoutMs: envInt('HOST_PROBER_TIMEOUT_MS', DEFAULT_PER_CHILD_TIMEOUT_MS, 1_000, 120_000),
    phaseTimeoutMs: envInt('HOST_PROBER_PHASE_TIMEOUT_MS', DEFAULT_PHASE_TIMEOUT_MS, 1_000, 120_000),
    maxConcurrency: envInt('HOST_PROBER_MAX_CONCURRENCY', DEFAULT_MAX_CONCURRENCY, 1, 8),
    runDeadlineMs: envInt('HOST_PROBER_RUN_DEADLINE_MS', DEFAULT_RUN_DEADLINE_MS, 5_000, 600_000),
    captureCapBytes: envInt('HOST_PROBER_CAPTURE_CAP_BYTES', DEFAULT_CAPTURE_CAP_BYTES, 64 * 1024, 64 * 1024 * 1024),
    cacheTtlMs: envInt('HOST_PROBER_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS, 0, 300_000),
    allowedHosts: Array.from(allowedHosts),
    allowedOrigins: envList('HOST_PROBER_ALLOWED_ORIGINS'),
  };
}

/* ===========================================================================
 * SECTION 2 — FILESYSTEM HELPERS
 * ========================================================================= */

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a relative declaration to an ABSOLUTE path that is provably INSIDE
 * `root`.
 *
 * This is the containment check that makes reading a manifest safe: a manifest
 * is data, and data can be wrong or hostile. `../../../Windows/System32/cmd.exe`
 * resolves outside the root and is rejected here rather than spawned.
 */
function resolveWithinRoot(root: string, relative: string): string | null {
  const absolute = resolve(root, relative);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) return null;
  return absolute;
}

/**
 * Normalize a manifest `entry` written with either separator.
 *
 * Manifests in this estate mix `servers\\mcp\\shell\\server.js` and
 * `servers/mcp/shell/server.js`. POSIX `path` treats a backslash as an ordinary
 * filename character, so an un-normalized Windows entry becomes ONE absurd
 * filename and yields a guaranteed false negative.
 */
function normalizeRelativeEntry(entry: string): string {
  return entry
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/');
}

interface ExecutableResolution {
  /** Absolute path, or the original token when unresolved (for reporting). */
  readonly path: string;
  readonly exists: boolean;
  readonly isFile: boolean;
  /** How it was located. */
  readonly locatedBy: 'ABSOLUTE_PATH' | 'PATH_AND_PATHEXT' | 'UNRESOLVED';
}

/**
 * Resolve a command token to an existing regular file.
 *
 * BUG THIS FIXES (measured by the design agent): `existsSync('powershell')` is
 * ALWAYS false, because `existsSync` is only meaningful for a PATH, and a bare
 * command name is not one. That produced a false OFFLINE for a command that was
 * installed and working. Correct semantics are `where`/`PATHEXT`: for a bare
 * token, every PATH directory is searched for `token + ext` for each extension
 * in PATHEXT. Only then is "absent" a defensible conclusion.
 */
function resolveExecutable(command: string): ExecutableResolution {
  const looksLikePath = isAbsolute(command) || command.includes('\\') || command.includes('/');

  if (looksLikePath) {
    const absolute = resolve(command);
    const exists = existsSync(absolute);
    return {
      path: absolute,
      exists,
      isFile: exists && isRegularFile(absolute),
      locatedBy: 'ABSOLUTE_PATH',
    };
  }

  const pathVar = process.env['PATH'] ?? '';
  const isWindows = platform() === 'win32';
  const separator = isWindows ? ';' : ':';
  const extensions =
    isWindows
      ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((ext) => ext.trim())
          .filter((ext) => ext.length > 0)
      : [''];

  for (const dir of pathVar.split(separator)) {
    if (dir.trim().length === 0) continue;
    for (const ext of extensions) {
      // On POSIX the bare token is tried as-is; on Windows the extension is
      // mandatory (this is what `where` does).
      const candidate = join(dir.trim(), `${command}${ext}`);
      if (existsSync(candidate) && isRegularFile(candidate)) {
        return { path: candidate, exists: true, isFile: true, locatedBy: 'PATH_AND_PATHEXT' };
      }
    }
  }

  return { path: command, exists: false, isFile: false, locatedBy: 'UNRESOLVED' };
}

/* ===========================================================================
 * SECTION 3 — MANIFEST RECONCILIATION
 * ========================================================================= */

interface ManifestEntry {
  readonly entry: string | null;
  readonly args: readonly string[];
  readonly version: string | null;
}

interface ManifestRead {
  readonly ok: boolean;
  readonly source: 'REPO_CONFIG_MANIFEST' | 'HOST_MANIFEST';
  readonly mcp: ReadonlyMap<string, ManifestEntry>;
  readonly lspKeys: readonly string[];
  readonly nodeBinaryPath: string | null;
  readonly error: string | null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Read a manifest file defensively.
 *
 * Never throws: an unreadable or malformed manifest is a REPORTED condition
 * (`ok: false`), not a crash, and certainly not a licence to guess.
 */
function readManifestFile(
  absolutePath: string,
  source: 'REPO_CONFIG_MANIFEST' | 'HOST_MANIFEST',
): ManifestRead {
  const empty: ManifestRead = {
    ok: false,
    source,
    mcp: new Map(),
    lspKeys: [],
    nodeBinaryPath: null,
    error: `manifest not readable at ${absolutePath}`,
  };
  if (!existsSync(absolutePath) || !isRegularFile(absolutePath)) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (err) {
    return { ...empty, error: `manifest is not valid JSON: ${err instanceof Error ? err.message : 'unknown'}` };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ...empty, error: 'manifest root is not an object' };
  }

  const root = parsed as Record<string, unknown>;
  const mcpSection = (root['mcp'] ?? {}) as Record<string, unknown>;
  const mcp = new Map<string, ManifestEntry>();
  for (const [id, raw] of Object.entries(mcpSection)) {
    const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const argsRaw = record['args'];
    mcp.set(id, {
      entry: asStringOrNull(record['entry']),
      args: Array.isArray(argsRaw) ? argsRaw.filter((a): a is string => typeof a === 'string') : [],
      version: asStringOrNull(record['version']),
    });
  }

  const lspSection = (root['lsp'] ?? {}) as Record<string, unknown>;
  const runtimeSection = (root['runtime'] ?? {}) as Record<string, unknown>;

  return {
    ok: true,
    source,
    mcp,
    lspKeys: Object.keys(lspSection),
    nodeBinaryPath: asStringOrNull(runtimeSection['node']),
    error: null,
  };
}

/** Resolve a manifest `entry` into something we are willing to spawn, or null. */
function classifyManifestEntry(
  absolutePath: string,
): { readonly usable: boolean; readonly reason: string | null } {
  if (!existsSync(absolutePath)) return { usable: false, reason: 'declared path does not exist on this host' };
  if (!isRegularFile(absolutePath)) return { usable: false, reason: 'declared path is not a regular file' };

  const lower = absolutePath.toLowerCase();
  if (lower.endsWith('.ps1')) {
    // Rejected by MEASUREMENT, not by preference: a PowerShell wrapper does not
    // forward stdin to a native child, so it exits 0 with zero MCP frames. Probing
    // it would manufacture a false OFFLINE for a server that is actually fine.
    return {
      usable: false,
      reason:
        'declared entry is a PowerShell wrapper; measured on this host it exits 0 with zero MCP frames because PowerShell does not forward stdin to a native child',
    };
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return { usable: true, reason: null };
  if (lower.endsWith('.exe') || lower.endsWith('.cmd') || lower.endsWith('.bat')) return { usable: true, reason: null };
  return { usable: false, reason: 'declared entry has no recognised executable or JavaScript extension' };
}

/** One executable the prober is prepared to launch. */
export interface ProbeTarget {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly kind: 'node' | 'windows-native';
  readonly passEnv: readonly string[];
  readonly entrySource: EntrypointSource;
  /** Root-relative path actually used. Reported in discrepancies; never absolute. */
  readonly relativeEntry: string;
  /** Why the manifest entry was rejected, when it was. Surfaced as a discrepancy. */
  readonly discrepancy: InventoryDiscrepancy | null;
  /** Operator note from the allowlist, surfaced through `/probe/discrepancies`. */
  readonly note: string | null;
  /** Set when nothing could be resolved at all -> probe yields UNVERIFIABLE. */
  readonly unresolvableReason: ProbeReasonCode | null;
}

interface Inventory {
  readonly targets: readonly ProbeTarget[];
  readonly lspKeys: readonly string[];
  readonly manifestEnabled: boolean;
  readonly nodeBinary: string | null;
  readonly discrepancies: readonly InventoryDiscrepancy[];
  readonly rootLabel: string;
}

/**
 * Build the probe inventory.
 *
 * PRECEDENCE (deterministic and reported):
 *   repo `config/servers_center_manifest.json`  ->  host `<root>/manifest.json`  ->  allowlist
 *
 * The manifest is PREFERRED over the allowlist when its declared entry physically
 * exists, because the manifest is the Commander's declared intent and a probe
 * that ignored it would measure something nobody uses. A manifest entry that does
 * not exist on disk is REJECTED, REPORTED, and falls back to the next source. It
 * is never "accepted anyway".
 *
 * EVERY readable manifest is reconciled, not merely the one that happened to win.
 * This matters: once the repo manifest is corrected, a first-match strategy would
 * stop examining the host manifest, and the host manifest's known-bad
 * `mcp.github.entry` would DISAPPEAR from the report instead of being repaired. A
 * defect that stops being reported is a defect that never gets fixed.
 */
export function buildInventory(config: ProberConfig): Inventory {
  const discrepancies: InventoryDiscrepancy[] = [];
  const repoManifestPath = join(config.repoRoot, 'config', 'servers_center_manifest.json');
  const hostManifestPath = join(config.root, 'manifest.json');

  const manifests: readonly ManifestRead[] = config.manifestEnabled
    ? [readManifestFile(repoManifestPath, 'REPO_CONFIG_MANIFEST'), readManifestFile(hostManifestPath, 'HOST_MANIFEST')]
    : [];

  const usableManifests = manifests.filter((m) => m.ok);
  const manifestNode = usableManifests.find((m) => m.nodeBinaryPath !== null)?.nodeBinaryPath ?? null;
  const nodeBinary = resolveNodeBinary(config.root, manifestNode);
  const lspKeys = usableManifests[0]?.lspKeys ?? [];

  const targets: ProbeTarget[] = [];

  for (const entry of ALLOWLIST) {
    let chosen: ProbeTarget | null = null;

    for (const manifest of usableManifests) {
      const declared = manifest.mcp.get(entry.id);
      if (declared === undefined || declared.entry === null) continue;

      const relative = normalizeRelativeEntry(declared.entry);
      const absolute = resolveWithinRoot(config.root, relative);

      if (absolute === null) {
        discrepancies.push({
          id: entry.id,
          source: manifest.source,
          declaredEntry: declared.entry,
          declaredEntryExistsOnHost: false,
          resolution: 'REJECTED_ABSENT_ON_HOST',
          note: 'declared entry resolves OUTSIDE the Servers Center root and was refused as a containment violation.',
        });
        continue;
      }

      const verdict = classifyManifestEntry(absolute);
      if (!verdict.usable) {
        discrepancies.push({
          id: entry.id,
          source: manifest.source,
          declaredEntry: declared.entry,
          declaredEntryExistsOnHost: existsSync(absolute),
          resolution: 'REJECTED_ABSENT_ON_HOST',
          note: verdict.reason ?? 'declared entry is not usable as an MCP stdio entrypoint.',
        });
        continue;
      }

      const isScript = /\.(js|mjs|cjs)$/i.test(absolute);
      const kind: 'node' | 'windows-native' = isScript ? 'node' : 'windows-native';

      if (kind === 'node' && nodeBinary === null) {
        discrepancies.push({
          id: entry.id,
          source: manifest.source,
          declaredEntry: declared.entry,
          declaredEntryExistsOnHost: true,
          resolution: 'REJECTED_ABSENT_ON_HOST',
          note: 'declared entry exists but no Node runtime could be resolved on this host, so the launch would be impossible.',
        });
        continue;
      }

      if (chosen !== null) {
        // A higher-precedence manifest already won. Record the disagreement so a
        // stale entry in a secondary manifest stays VISIBLE instead of vanishing:
        // once the repo manifest is corrected, a first-match strategy would stop
        // examining the host manifest, and that manifest's bad `github.entry`
        // would silently stop being reported.
        if (chosen.relativeEntry !== relative) {
          discrepancies.push({
            id: entry.id,
            source: manifest.source,
            declaredEntry: declared.entry,
            declaredEntryExistsOnHost: true,
            resolution: 'REJECTED_ABSENT_ON_HOST',
            note: `this manifest's entry is usable but DIVERGES from the higher-precedence entry actually probed ("${chosen.relativeEntry}"). The two documents disagree and must be reconciled.`,
          });
        }
        continue;
      }

      chosen = {
        id: entry.id,
        command: kind === 'node' ? (nodeBinary as string) : absolute,
        args: kind === 'node' ? [absolute, ...declared.args] : declared.args,
        kind,
        passEnv: entry.passEnv,
        entrySource: 'MANIFEST',
        relativeEntry: relative,
        discrepancy: null,
        note: entry.note,
        unresolvableReason: null,
      };
    }

    if (chosen !== null) {
      targets.push(chosen);
      continue;
    }

    // ---- Allowlist fallback ----
    const absolute = resolveWithinRoot(config.root, entry.relativeEntry);
    const manifestRejectedThisId = discrepancies.some((d) => d.id === entry.id);

    if (absolute === null) {
      targets.push({
        id: entry.id,
        command: entry.relativeEntry,
        args: entry.args,
        kind: entry.kind,
        passEnv: entry.passEnv,
        entrySource: 'UNRESOLVED',
        relativeEntry: entry.relativeEntry,
        discrepancy: null,
        note: entry.note,
        unresolvableReason: 'INVENTORY_UNRESOLVED',
      });
      continue;
    }

    const command = entry.kind === 'node' ? (nodeBinary ?? absolute) : absolute;
    targets.push({
      id: entry.id,
      command,
      args: entry.kind === 'node' ? [absolute, ...entry.args] : entry.args,
      kind: entry.kind,
      passEnv: entry.passEnv,
      entrySource: manifestRejectedThisId ? 'MANIFEST_ENTRY_ABSENT_FALLBACK_ALLOWLIST' : 'ALLOWLIST',
      relativeEntry: entry.relativeEntry,
      discrepancy: null,
      note: entry.note,
      unresolvableReason: entry.kind === 'node' && nodeBinary === null ? 'ENTRYPOINT_ABSENT' : null,
    });
  }

  // Surface the operator notes of entries that deliberately diverge from a
  // manifest, as first-class discrepancies rather than as hidden comments.
  for (const target of targets) {
    if (target.note !== null && target.entrySource !== 'MANIFEST') {
      discrepancies.push({
        id: target.id,
        source: 'REPO_CONFIG_MANIFEST',
        declaredEntry: target.relativeEntry,
        declaredEntryExistsOnHost: existsSync(join(config.root, target.relativeEntry)),
        resolution: 'ACCEPTED',
        note: target.note,
      });
    }
  }

  return {
    targets,
    lspKeys,
    manifestEnabled: config.manifestEnabled,
    nodeBinary,
    discrepancies,
    rootLabel: config.root,
  };
}

/* ===========================================================================
 * SECTION 4 — CHILD ENVIRONMENT SCRUB
 * ========================================================================= */

/**
 * Build the child's environment from scratch.
 *
 * There is NO `...process.env` spread anywhere in this file. A child can read
 * its own environment, so every inherited variable is a potential secret handed
 * to a subprocess. Only GLOBAL_ENV_ALLOWLIST plus the target's own `passEnv`
 * NAMES are forwarded, and their VALUES are never logged, never returned, and
 * never included in any `reasonText`.
 */
function buildChildEnv(passEnv: readonly string[]): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  const allowed = new Set<string>([...GLOBAL_ENV_ALLOWLIST, ...passEnv]);
  for (const name of allowed) {
    const value = process.env[name];
    if (typeof value === 'string') childEnv[name] = value;
  }
  // Some Windows runtimes fail to start a console process without these; they
  // are directory/OS facts, never credentials.
  childEnv['NO_COLOR'] = '1';
  return childEnv;
}

/* ===========================================================================
 * SECTION 5 — MCP STDIO JSON-RPC CLIENT (explicit state machine)
 * ========================================================================= */

/**
 * The MCP stdio transport frames JSON-RPC as NEWLINE-DELIMITED JSON.
 * (This is NOT `Content-Length` header framing — that is LSP. Getting the two
 * confused is why so many "the server hung" reports exist.)
 *
 * The compliant sequence is strictly ordered:
 *   1. `initialize`               (request)  -> capabilities + protocol version
 *   2. `notifications/initialized` (notification, NO response expected)
 *   3. `tools/list`               (request)  -> the actual capability inventory
 *
 * BUG THIS FIXES (measured): sending only `initialize` hung or failed 6 of 7
 * servers, because a compliant server refuses `tools/list` until it has received
 * `notifications/initialized`. The steps are therefore modelled as an explicit
 * state machine with a per-phase timeout, not as three fire-and-forget writes.
 */
const HANDSHAKE_PHASE = {
  SPAWNING: 'SPAWNING',
  AWAIT_INITIALIZE_RESULT: 'AWAIT_INITIALIZE_RESULT',
  AWAIT_TOOLS_LIST_RESULT: 'AWAIT_TOOLS_LIST_RESULT',
  SETTLED: 'SETTLED',
} as const;

type HandshakePhase = (typeof HANDSHAKE_PHASE)[keyof typeof HANDSHAKE_PHASE];

const RPC_ID_INITIALIZE = 1;
const RPC_ID_TOOLS_LIST = 2;

interface JsonRpcFrame {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

interface RawServerResult {
  readonly protocolVersion: string | null;
  readonly serverName: string | null;
  readonly serverVersion: string | null;
}

function readRawServerResult(result: unknown): RawServerResult {
  if (typeof result !== 'object' || result === null) {
    return { protocolVersion: null, serverName: null, serverVersion: null };
  }
  const record = result as Record<string, unknown>;
  const info =
    typeof record['serverInfo'] === 'object' && record['serverInfo'] !== null
      ? (record['serverInfo'] as Record<string, unknown>)
      : null;
  return {
    protocolVersion: asStringOrNull(record['protocolVersion']),
    serverName: info === null ? null : asStringOrNull(info['name']),
    serverVersion: info === null ? null : asStringOrNull(info['version']),
  };
}

function readToolNames(result: unknown): readonly string[] | null {
  if (typeof result !== 'object' || result === null) return null;
  const tools = (result as Record<string, unknown>)['tools'];
  if (!Array.isArray(tools)) return null;
  return tools
    .map((tool) => {
      if (typeof tool !== 'object' || tool === null) return null;
      return asStringOrNull((tool as Record<string, unknown>)['name']);
    })
    .filter((name): name is string => name !== null);
}

function describeRpcError(error: { readonly code?: unknown; readonly message?: unknown } | undefined): string {
  if (error === undefined) return 'no error detail supplied';
  const code = typeof error.code === 'number' ? `code ${error.code}` : 'no error code';
  const message = asStringOrNull(error.message) ?? 'no error message';
  // Only the code and message are echoed. A server that stuffs a stack trace or
  // an environment dump into `error.message` would otherwise leak through here.
  return `${code}, ${message.slice(0, 200)}`;
}

/** Raw outcome of one probe, before it is stamped into a wire payload. */
export interface ProbeOutcome {
  readonly state: ProbeState;
  readonly reason: ProbeReasonCode;
  readonly reasonText: string;
  readonly toolCount: number | null;
  readonly toolNames: readonly string[];
  readonly protocolVersion: string | null;
  readonly serverName: string | null;
  readonly serverVersion: string | null;
  readonly exitCode: number | null;
  readonly stderrProduced: boolean;
  readonly framesReceived: number;
}

/** Every live child, so shutdown can guarantee no orphans. */
const activeChildren = new Set<ChildProcessWithoutNullStreams>();

/**
 * Terminate a child AND everything it spawned.
 *
 * WHY THIS EXISTS (measured, not theorised): `child.kill()` on Windows issues
 * `TerminateProcess` against the DIRECT child only. The browser-backed MCP
 * servers (`chrome-devtools-mcp`, `@playwright/mcp`) each spawn Chromium as a
 * GRANDCHILD. A hard kill of this prober mid-probe was observed to leave 3 live
 * `chrome.exe` processes behind. Killing only the direct child is therefore not
 * sufficient for a guarantee of "no orphans".
 *
 * `taskkill /T /F` is a built-in Windows utility that walks the tree; using it
 * costs no npm dependency, which matters because adding one is a Commander
 * decision that has not been made. It is strictly best-effort: on any failure we
 * fall back to a plain `kill()` so a child is never left alive merely because
 * `taskkill` was unavailable.
 */
function terminateTree(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (typeof pid !== 'number') return;

  if (platform() === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        timeout: 5_000,
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      /* taskkill unavailable: fall through to the direct kill */
    }
  }

  try {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  } catch {
    /* already gone */
  }
}

/**
 * Probe one target. Resolves ALWAYS — a hung child can never stall a sweep,
 * because the phase timer, the per-child timer, and the sweep deadline are all
 * independent upper bounds.
 *
 * Exported so a verification harness can drive individual targets (for example
 * to prove that the PowerShell wrapper is classified as the failure it is)
 * without opening a socket.
 */
export function probeTarget(target: ProbeTarget, config: ProberConfig, budgetMs: number): Promise<ProbeOutcome> {
  const unmeasured = (
    state: ProbeState,
    reason: ProbeReasonCode,
    reasonText: string,
  ): ProbeOutcome => ({
    state,
    reason,
    reasonText,
    toolCount: null,
    toolNames: [],
    protocolVersion: null,
    serverName: null,
    serverVersion: null,
    exitCode: null,
    stderrProduced: false,
    framesReceived: 0,
  });

  // A measurement limit is reported as a measurement limit. A Windows-native
  // entrypoint on a non-Windows host is UNVERIFIABLE, never OFFLINE.
  if (target.kind === 'windows-native' && platform() !== 'win32') {
    return Promise.resolve(
      unmeasured(
        'UNVERIFIABLE',
        'PLATFORM_MISMATCH',
        'A Windows-native entrypoint cannot execute on a non-Windows host. Nothing was probed, so nothing is known about the service.',
      ),
    );
  }

  if (target.unresolvableReason !== null) {
    return Promise.resolve(
      unmeasured(
        'UNVERIFIABLE',
        target.unresolvableReason,
        target.unresolvableReason === 'ENTRYPOINT_ABSENT'
          ? 'The launcher runtime for this entrypoint could not be resolved on this host, so no handshake was attempted.'
          : 'The inventory entry could not be resolved to a concrete executable, so no handshake was attempted.',
      ),
    );
  }

  const resolution = resolveExecutable(target.command);
  if (!resolution.exists || !resolution.isFile) {
    // NEVER ATTEMPTED => UNVERIFIABLE. Reporting OFFLINE here would assert an
    // outage from a measurement that was never taken.
    return Promise.resolve(
      unmeasured(
        'UNVERIFIABLE',
        'ENTRYPOINT_ABSENT',
        resolution.locatedBy === 'UNRESOLVED'
          ? 'The launcher command could not be resolved on PATH (PATHEXT semantics applied). No handshake was attempted.'
          : 'The declared entrypoint does not exist on this host as a regular file. No handshake was attempted.',
      ),
    );
  }

  if (budgetMs <= 0) {
    return Promise.resolve(
      unmeasured('UNVERIFIABLE', 'RUN_DEADLINE_EXCEEDED', 'The sweep deadline elapsed before this probe could start.'),
    );
  }

  const childTimeout = Math.min(config.perChildTimeoutMs, budgetMs);
  const phaseTimeout = Math.min(config.phaseTimeoutMs, childTimeout);

  return new Promise<ProbeOutcome>((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(resolution.path, [...target.args], {
        env: buildChildEnv(target.passEnv),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      // `spawn` only throws for malformed arguments; a missing binary arrives as
      // an asynchronous 'error' event, handled below.
      const code = (err as NodeJS.ErrnoException).code;
      resolve(
        unmeasured(
          'OFFLINE',
          'SPAWN_FAILED',
          `The operating system refused to launch the entrypoint (${code ?? 'spawn threw synchronously'}).`,
        ),
      );
      return;
    }

    activeChildren.add(child);

    /* ---- teardown state ---- */
    let settled = false;
    let phaseTimer: NodeJS.Timeout | null = null;
    let childTimer: NodeJS.Timeout | null = null;
    let drainTimer: NodeJS.Timeout | null = null;
    let settledFrames = 0;
    let stderrBytes = 0;
    let stderrProduced = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    /* ---- handshake state machine ---- */
    let phase: HandshakePhase = HANDSHAKE_PHASE.SPAWNING;
    let awaitedId: number | null = null;
    let stdoutBuffer = '';
    let stdoutBytes = 0;
    let protocolVersion: string | null = null;
    let serverName: string | null = null;
    let serverVersion: string | null = null;
    let framesReceived = 0;

    const finish = (outcome: ProbeOutcome): void => {
      if (settled) return;
      settled = true;
      phase = HANDSHAKE_PHASE.SETTLED;
      // Snapshot the live frame counter at the moment of settlement. Reporting a
      // stale or always-zero count next to an ONLINE verdict would misrepresent
      // the evidence, which is worse than not reporting it at all.
      settledFrames = framesReceived;
      if (phaseTimer !== null) clearTimeout(phaseTimer);
      if (childTimer !== null) clearTimeout(childTimer);
      if (drainTimer !== null) clearTimeout(drainTimer);
      // Guaranteed cleanup: no settle path leaves a process or timer behind.
      try {
        child.stdin.destroy();
      } catch {
        /* already closed */
      }
      terminateTree(child);
      try {
        child.stdout.destroy();
        child.stderr.destroy();
      } catch {
        /* already destroyed */
      }
      activeChildren.delete(child);
      resolve({
        ...outcome,
        toolNames: outcome.toolNames,
        protocolVersion: outcome.protocolVersion,
        serverName: outcome.serverName,
        serverVersion: outcome.serverVersion,
        exitCode: outcome.exitCode,
        stderrProduced,
        framesReceived: settledFrames,
      });
    };

    const restartPhaseTimer = (): void => {
      if (phaseTimer !== null) clearTimeout(phaseTimer);
      phaseTimer = setTimeout(() => {
        finish(
          unmeasured(
            'UNVERIFIABLE',
            'HANDSHAKE_TIMEOUT',
            `No JSON-RPC response arrived for phase ${phase} within ${phaseTimeout} ms. The handshake started but could not conclude, so the server's state is unknown.`,
          ),
        );
      }, phaseTimeout);
    };

    /**
     * Legal transition check. A frame that arrives out of order (a server sending
     * a notification mid-handshake, or a late duplicate) is IGNORED rather than
     * allowed to drive the machine into an impossible phase.
     */
    const advanceTo = (next: HandshakePhase, nextAwaitedId: number | null): void => {
      phase = next;
      awaitedId = nextAwaitedId;
      restartPhaseTimer();
    };

    const send = (message: Record<string, unknown>): void => {
      try {
        if (!child.stdin.writable) {
          finish(
            unmeasured(
              'OFFLINE',
              'EXIT_ZERO_NO_MCP_FRAMES',
              'The child closed its stdin before the handshake completed and emitted no MCP frames. This is the classic wrapper failure where stdin is not forwarded to the server process.',
            ),
          );
          return;
        }
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        finish(
          unmeasured('OFFLINE', 'SPAWN_FAILED', 'Writing to the child stdin failed; the process is no longer accepting protocol traffic.'),
        );
      }
    };

    /**
     * Interpret a frame against the CURRENT phase.
     *
     * `handled` reports whether the frame advanced the machine, so the caller can
     * distinguish "not our business" from "our business and it was an error".
     */
    const handleFrame = (frame: JsonRpcFrame): void => {
      framesReceived += 1;
      const idMatches = frame.id === awaitedId;

      if (!idMatches) {
        // A notification, a server-initiated request, or a late frame. Not
        // protocol progress for us; ignoring it is correct and safe.
        return;
      }

      if (frame.error !== undefined) {
        if (phase === HANDSHAKE_PHASE.AWAIT_INITIALIZE_RESULT) {
          finish(unmeasured('OFFLINE', 'HANDSHAKE_INITIALIZE_ERROR', `The server rejected initialize (${describeRpcError(frame.error)}).`));
        } else {
          finish(unmeasured('OFFLINE', 'HANDSHAKE_TOOLS_LIST_ERROR', `The server rejected tools/list (${describeRpcError(frame.error)}).`));
        }
        return;
      }

      if (phase === HANDSHAKE_PHASE.AWAIT_INITIALIZE_RESULT) {
        const info = readRawServerResult(frame.result);
        protocolVersion = info.protocolVersion;
        serverName = info.serverName;
        serverVersion = info.serverVersion;
        // Step 2 then step 3, in that order, both synchronous writes on the same
        // pipe: the notification MUST precede tools/list.
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        advanceTo(HANDSHAKE_PHASE.AWAIT_TOOLS_LIST_RESULT, RPC_ID_TOOLS_LIST);
        send({ jsonrpc: '2.0', id: RPC_ID_TOOLS_LIST, method: 'tools/list', params: {} });
        return;
      }

      if (phase === HANDSHAKE_PHASE.AWAIT_TOOLS_LIST_RESULT) {
        const names = readToolNames(frame.result);
        if (names === null) {
          finish(
            unmeasured(
              'OFFLINE',
              'HANDSHAKE_TOOLS_LIST_ERROR',
              'The server answered tools/list without a `tools` array, so no capability inventory could be read.',
            ),
          );
          return;
        }
        if (names.length === 0) {
          // Served, but useless. Deliberately NOT ONLINE: a server exposing zero
          // capabilities must never inflate the online count.
          finish({
            state: 'OFFLINE',
            reason: 'EMPTY_TOOL_LIST',
            reasonText: 'The handshake completed but tools/list returned zero tools. The server is serving and incapable, which is not a healthy service.',
            toolCount: 0,
            toolNames: [],
            protocolVersion,
            serverName,
            serverVersion,
            exitCode,
            stderrProduced,
            framesReceived,
          });
          return;
        }
        finish({
          state: 'ONLINE',
          reason: 'HANDSHAKE_COMPLETED',
          reasonText: 'MCP handshake completed: initialize answered, notifications/initialized was delivered, and tools/list enumerated tools.',
          toolCount: names.length,
          toolNames: names,
          protocolVersion,
          serverName,
          serverVersion,
          exitCode,
          stderrProduced,
          framesReceived,
        });
      }
    };

    /* ---- streams ---- */
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk, 'utf8');
      if (stdoutBytes > config.captureCapBytes) {
        finish(
          unmeasured(
            'OFFLINE',
            'STDOUT_CAPTURE_LIMIT_EXCEEDED',
            `The child exceeded the ${config.captureCapBytes}-byte stdout capture cap without completing a handshake. It is not behaving like an MCP stdio server.`,
          ),
        );
        return;
      }
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          // stderr-equivalent noise on stdout (banners, logs) is not protocol
          // traffic; JSON.parse failing is normal, not an error condition.
          try {
            handleFrame(JSON.parse(line) as JsonRpcFrame);
          } catch {
            /* non-JSON stdout line: ignore */
          }
        }
        if (settled) return;
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // COUNT ONLY. The text is deliberately discarded: a misconfigured server
      // routinely prints its own environment, which on this estate would include
      // tokens. Counting is enough to tell an operator "look on the host".
      const size = Buffer.byteLength(chunk, 'utf8');
      if (size > 0) stderrProduced = true;
      stderrBytes += size;
      if (stderrBytes > config.captureCapBytes) {
        // Stop reading rather than accumulate. The child is killed at settle().
        try {
          child.stderr.pause();
        } catch {
          /* already paused */
        }
      }
    });

    /* ---- lifecycle ---- */
    child.on('error', (err: NodeJS.ErrnoException) => {
      // The spawn was ATTEMPTED, so a failure here is a conclusion about this
      // target rather than an absence of measurement — except for permission,
      // which tells us nothing about how the service runs under its supervisor.
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        finish(
          unmeasured(
            'UNVERIFIABLE',
            'SPAWN_PERMISSION_DENIED',
            'The entrypoint exists but this process is not permitted to execute it. Nothing is known about the service under its real supervisor.',
          ),
        );
        return;
      }
      if (err.code === 'ENOEXEC' || err.code === 'EINVAL') {
        finish(
          unmeasured(
            'OFFLINE',
            'NOT_AN_EXECUTABLE_IMAGE',
            'The operating system refused to execute the entrypoint because it is not a valid executable image for this platform.',
          ),
        );
        return;
      }
      finish(
        unmeasured(
          'OFFLINE',
          'SPAWN_FAILED',
          `The entrypoint could not be launched (${err.code ?? err.message}). The attempt was conclusive: the server is not serving.`,
        ),
      );
    });

    /**
     * `exit` alone is NOT sufficient evidence of a dead child on Windows: it can
     * fire while stdout and stderr are still buffered, which would truncate valid
     * output and mis-attribute the failure. We therefore record the exit and wait
     * for `close` (which fires after all stdio has drained), bounded by
     * `drainTimer` in case `close` never arrives.
     */
    child.on('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      if (drainTimer !== null) clearTimeout(drainTimer);
      drainTimer = setTimeout(() => onChildClosed(code, signal), POST_EXIT_DRAIN_MS);
    });

    child.on('close', (code, signal) => {
      if (drainTimer !== null) clearTimeout(drainTimer);
      onChildClosed(code, signal);
    });

    function onChildClosed(code: number | null, signal: NodeJS.Signals | null): void {
      if (settled) return;
      const resolvedExit = code ?? exitCode;
      const resolvedSignal = signal ?? exitSignal;
      const codeText = resolvedExit === null ? 'null' : String(resolvedExit);
      const signalText = resolvedSignal === null ? 'none' : resolvedSignal;

      if (framesReceived === 0) {
        // Zero MCP frames of any kind. This is THE trap the Commander's own
        // PowerShell wrapper falls into (exit 0, zero frames) and it must never
        // be reported as ONLINE.
        finish({
          state: 'OFFLINE',
          reason: resolvedExit === 0 ? 'EXIT_ZERO_NO_MCP_FRAMES' : 'EXIT_NONZERO_BEFORE_HANDSHAKE',
          reasonText:
            `The entrypoint terminated before emitting any MCP frame (exit code ${codeText}, signal ${signalText}, ` +
            `${stderrProduced ? 'stderr was produced' : 'no stderr'}). ` +
            (resolvedExit === 0
              ? 'A clean exit with zero frames is the wrapper failure mode: stdin was not forwarded to the server process.'
              : 'A non-zero exit before the handshake is a conclusive failure to serve.'),
          toolCount: null,
          toolNames: [],
          protocolVersion,
          serverName,
          serverVersion,
          exitCode: resolvedExit,
          stderrProduced,
          framesReceived: 0,
        });
        return;
      }

      // Frames arrived but the handshake did not finish: the server spoke and
      // then stopped. That is a measurement that cannot conclude.
      finish(
        unmeasured(
          'UNVERIFIABLE',
          'HANDSHAKE_TIMEOUT',
          `The entrypoint emitted ${framesReceived} MCP frame(s) and then terminated before the handshake completed (exit code ${codeText}, signal ${signalText}).`,
        ),
      );
    }

    /* ---- start ---- */
    childTimer = setTimeout(() => {
      finish(
        unmeasured(
          'UNVERIFIABLE',
          'HANDSHAKE_TIMEOUT',
          `The child exceeded its ${childTimeout} ms lifetime budget without completing the handshake and was terminated. The server's state is unknown.`,
        ),
      );
    }, childTimeout);

    advanceTo(HANDSHAKE_PHASE.AWAIT_INITIALIZE_RESULT, RPC_ID_INITIALIZE);
    send({
      jsonrpc: '2.0',
      id: RPC_ID_INITIALIZE,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: PROBER_NAME, version: PROBER_VERSION },
      },
    });
  });
}

/* ===========================================================================
 * SECTION 6 — SCHEDULER (bounded concurrency, hard sweep deadline, TTL cache)
 * ========================================================================= */

interface CacheEntry {
  readonly measuredAtMs: number;
  readonly result: McpProbeResult;
}

const resultCache = new Map<string, CacheEntry>();

export interface SweepOptions {
  /** Ignore the TTL cache and force a real handshake for every target. */
  readonly bypassCache?: boolean;
}

/**
 * Probe the whole inventory with bounded concurrency and a hard sweep deadline.
 *
 * The deadline is enforced by CLAMPING each child's budget rather than by
 * abandoning the sweep, so a partial sweep still returns complete, individually
 * honest results (the unstarted ones come back UNVERIFIABLE /
 * RUN_DEADLINE_EXCEEDED) instead of silently missing ids.
 */
export async function sweep(config: ProberConfig, options: SweepOptions = {}): Promise<McpProbeReport> {
  const startedAtMs = Date.now();
  const inventory = buildInventory(config);
  const deadlineMs = startedAtMs + config.runDeadlineMs;

  const results = new Map<string, McpProbeResult>();
  const now = Date.now();

  const queue: ProbeTarget[] = [];
  for (const target of inventory.targets) {
    const hit = resultCache.get(target.id);
    if (!options.bypassCache && hit !== undefined && config.cacheTtlMs > 0 && now - hit.measuredAtMs < config.cacheTtlMs) {
      results.set(target.id, { ...hit.result, cached: true, cacheAgeMs: now - hit.measuredAtMs });
      continue;
    }
    queue.push(target);
  }

  const workerCount = Math.max(1, Math.min(config.maxConcurrency, queue.length));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= queue.length) return;
      const target = queue[index];
      if (target === undefined) return;

      const budget = deadlineMs - Date.now();
      const completedAtMs = Date.now();
      const outcome = await probeTarget(target, config, budget);
      const result: McpProbeResult = {
        id: target.id,
        state: outcome.state,
        probeMethod: PROBE_METHOD_MCP_STDIO,
        lastProbedAt: new Date(completedAtMs).toISOString(),
        durationMs: Date.now() - completedAtMs,
        toolCount: outcome.toolCount,
        toolNames: outcome.toolNames,
        reason: outcome.reason,
        reasonText: outcome.reasonText,
        // ONLINE is the ONLY state backed by a completed transport.
        measured: outcome.state === 'ONLINE' || outcome.state === 'OFFLINE',
        serverName: outcome.serverName,
        serverVersion: outcome.serverVersion,
        protocolVersion: outcome.protocolVersion,
        entrySource: target.entrySource,
        stderrProduced: outcome.stderrProduced,
        exitCode: outcome.exitCode,
        cached: false,
        cacheAgeMs: null,
      };
      if (config.cacheTtlMs > 0) resultCache.set(target.id, { measuredAtMs: Date.now(), result });
      results.set(target.id, result);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Preserve the declared inventory order for stable, diff-friendly output.
  const servers = inventory.targets
    .map((target) => results.get(target.id))
    .filter((r): r is McpProbeResult => r !== undefined);

  const limits: ProberLimits = {
    perChildTimeoutMs: config.perChildTimeoutMs,
    phaseTimeoutMs: config.phaseTimeoutMs,
    maxConcurrency: config.maxConcurrency,
    runDeadlineMs: config.runDeadlineMs,
    stdoutCapBytes: config.captureCapBytes,
    cacheTtlMs: config.cacheTtlMs,
  };

  return {
    ok: true,
    chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
    proberVersion: PROBER_VERSION,
    hostPlatform: `${platform()} ${arch()}`,
    nodeRuntime: inventory.nodeBinary === null ? 'unresolved' : 'servers-center-runtime',
    rootLabel: inventory.rootLabel,
    inventorySource: config.manifestEnabled ? 'MANIFEST_RECONCILED' : 'ALLOWLIST_ONLY',
    manifestEnabled: config.manifestEnabled,
    generatedAt: new Date().toISOString(),
    runDurationMs: Date.now() - startedAtMs,
    measuredFresh: !servers.some((s) => s.cached),
    provenance: 'MEASURED_BY_PROBER',
    summary: {
      total: servers.length,
      online: servers.filter((s) => s.state === 'ONLINE').length,
      offline: servers.filter((s) => s.state === 'OFFLINE').length,
      unverifiable: servers.filter((s) => s.state === 'UNVERIFIABLE').length,
    },
    servers,
    discrepancies: inventory.discrepancies,
    limits,
  };
}

/**
 * LSP status.
 *
 * Returns UNVERIFIABLE for EVERY entry, unconditionally, and says so structurally
 * rather than in a comment: `transportImplemented` is `false`, so a consumer can
 * gate on it instead of on a prose promise.
 *
 * WHY, EXACTLY: LSP frames messages with `Content-Length` headers, not
 * newline-delimited JSON. The MCP client in this process therefore CANNOT speak
 * to a language server at all. The previous console inferred LSP readiness from
 * the EXISTENCE OF A DIRECTORY, which is precisely the fabrication being
 * eliminated — a directory existing is not a healthy language server.
 *
 * DROP-IN SEAM: `buildInventory` already enumerates the manifest's `lsp` keys.
 * A real client only has to (a) implement Content-Length framing, (b) issue
 * `initialize` and read `serverInfo`, (c) flip `transportImplemented` to true.
 * The consumer-side sanitizer in `host_prober_client.ts` already refuses to
 * believe any LSP state while `transportImplemented` is false, so nothing can
 * accidentally start reporting a fabricated READY.
 *
 * ── SEAM NOW WIRED (2026-10-02) ──────────────────────────────────────────────
 * All three requirements above are met by `lsp_prober.ts`, which implements a
 * byte-accurate Content-Length framer (byte counts, not character counts — the
 * distinction is real for any non-ASCII payload), issues `initialize`, reads
 * `serverInfo`, and performs a capability probe. `toProberLspReport` projects
 * that measured report onto this prober's public contract, which is what makes
 * `transportImplemented` genuinely true rather than merely asserted.
 *
 * The previous body of this function stamped every entry UNVERIFIABLE with
 * `transportImplemented: false`. That was honest, and it is now obsolete: it
 * refused to measure what CAN be measured. Both states are retained in spirit —
 * anything the transport cannot conclude is still reported UNVERIFIABLE, never
 * promoted — but a server that answers `initialize` is now reported ONLINE on the
 * strength of that answer.
 */
export async function lspStatus(config: ProberConfig): Promise<LspProbeReport> {
  const inventory = buildInventory(config);
  if (inventory.lspKeys.length === 0) {
    return buildUnverifiableLspReport(
      [],
      'INVENTORY_UNRESOLVED',
      'No LSP inventory could be enumerated from any readable manifest.',
      new Date().toISOString()
    );
  }

  // Manifest precedence mirrors `buildInventory`: the repo copy is authoritative
  // for declared entrypoints, the host copy is the cross-check. Pointing the LSP
  // client at the same manifest the MCP sweep used keeps one inventory for both.
  const manifestPath = join(config.root, 'manifest.json');
  const repoManifestPath = join(config.repoRoot, 'config', 'servers_center_manifest.json');

  // The scratch workspace MUST exist before any child is spawned.
  //
  // Measured, not assumed: on Windows, `child_process.spawn` reports ENOENT for a
  // MISSING `cwd` exactly as it does for a missing executable. A probe run against
  // a workspace root that was never created therefore reported
  // `dependency-missing` for every server and looked like a broken toolchain when
  // in fact every launcher was present and working.
  //
  // Creating it here also keeps the probe side-effect-free: language servers are
  // pointed at an empty scratch directory, never at the real repository or the E:
  // tree, so a server that indexes or watches cannot touch production data.
  const workspaceRoot = join(config.repoRoot, '.lsp-probe-workspace');
  try {
    mkdirSync(workspaceRoot, { recursive: true });
  } catch (err) {
    return buildUnverifiableLspReport(
      inventory.lspKeys,
      'SPAWN_FAILED',
      `Could not create the scratch LSP workspace at ${workspaceRoot} (${
        err instanceof Error ? err.message : String(err)
      }). No LSP handshake was attempted, so no server state is known.`,
      new Date().toISOString()
    );
  }

  try {
    const measured = await runLspProbes({
      manifestPath: existsSync(repoManifestPath) ? repoManifestPath : manifestPath,
      serversCenterRoot: config.root,
      workspaceRoot,
      stepTimeoutMs: Math.max(2000, Math.floor(config.phaseTimeoutMs / 2)),
      totalDeadlineMs: config.runDeadlineMs,
      probeTimeoutMs: config.perChildTimeoutMs,
      onlyIds: null,
      // Minimal, explicit environment: no host secrets are inherited by language
      // server child processes.
      // Minimal environment, not the full host environment. Two Windows-specific
      // variables are load-bearing rather than optional: PATHEXT is what lets
      // spawn resolve a launcher with no extension, and SystemRoot is required by
      // the loader before any DLL resolves — omit it and a valid executable still
      // fails. No host secrets are inherited.
      nodeEnv: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
        ComSpec: process.env.ComSpec ?? '',
        // APPDATA is load-bearing on Windows, not cosmetic: `pyright-langserver`
        // is a CPython console script whose package lives in the per-user
        // site-packages directory, and CPython derives that directory from
        // %APPDATA%. Without it the interpreter raises
        // ModuleNotFoundError and exits 1 before a single handshake byte — which
        // is a broken PROBE ENVIRONMENT, not a broken language server. Measured:
        // HOMEDRIVE+HOMEPATH alone do not fix it; APPDATA alone does.
        APPDATA: process.env.APPDATA ?? '',
        LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
      },
    });

    return toProberLspReport(measured, {
      chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
      proberVersion: PROBER_VERSION,
    }) as unknown as LspProbeReport;
  } catch (err) {
    // A transport-level failure must not read as "all servers are unhealthy".
    // It means WE could not measure, which is a different claim entirely.
    return buildUnverifiableLspReport(
      inventory.lspKeys,
      'SPAWN_FAILED',
      `The LSP transport was invoked but failed before any verdict could be established: ${
        err instanceof Error ? err.message : String(err)
      }`,
      new Date().toISOString()
    );
  }
}

/** @deprecated Retained only as the documented pre-implementation behaviour. */
function lspStatusWithoutTransport(config: ProberConfig): LspProbeReport {
  const inventory = buildInventory(config);
  const generatedAt = new Date().toISOString();
  const reasonText =
    'No LSP transport is implemented in this prober. LSP uses Content-Length header framing, ' +
    'which the MCP newline-delimited JSON-RPC client in this process cannot speak. Readiness is ' +
    'deliberately NOT inferred from file or directory existence: an asset existing on disk is not a ' +
    'healthy language server, and reporting it as READY would be the exact fabrication this system ' +
    'was built to remove.';

  const servers: LspProbeResult[] = inventory.lspKeys.map((id) => ({
    id,
    state: 'UNVERIFIABLE',
    probeMethod: PROBE_METHOD_LSP_CONTENT_LENGTH,
    lastProbedAt: generatedAt,
    durationMs: 0,
    reason: 'LSP_TRANSPORT_NOT_IMPLEMENTED',
    reasonText,
    measured: false,
    transportImplemented: false,
    framing: 'CONTENT_LENGTH_HEADERS',
    // Superseded path (no transport). It cannot classify anything, so nothing is
    // scoreable — the same fail-safe direction as the degraded builder.
    category: 'unclassified' as const,
    scoreable: false,
  }));

  if (servers.length === 0) {
    return buildUnverifiableLspReport([], 'INVENTORY_UNRESOLVED', 'No LSP inventory could be enumerated from any readable manifest.', generatedAt);
  }

  return {
    ok: true,
    chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
    proberVersion: PROBER_VERSION,
    generatedAt,
    provenance: 'MEASURED_BY_PROBER',
    transportImplemented: false,
    summary: {
      total: servers.length,
      online: 0,
      offline: 0,
      unverifiable: servers.length,
      // No transport means no measurement and no classification, so the scoring
      // denominator is zero rather than the inventory size.
      declaredTotal: servers.length,
      measurableTotal: 0,
      measurableOnline: 0,
      nonLanguageServerTotal: 0,
    },
    servers,
  };
}

/* ===========================================================================
 * SECTION 7 — SECURITY MIDDLEWARE
 * ========================================================================= */

/** Constant-time token comparison with a length-mismatch guard. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Host header validation.
 *
 * Defeats DNS rebinding: an attacker's page resolves its own hostname to
 * 127.0.0.1 and issues same-origin requests to the prober, defeating a naive
 * "loopback bind is enough" argument. Only names the operator allowlisted may
 * address this service. `host.docker.internal` is NOT accepted by default — the
 * operator must add it, which makes the exposure an explicit decision.
 */
function hostAllowed(hostHeader: string | undefined, allowed: readonly string[]): boolean {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  const normalized = hostHeader.trim().toLowerCase();
  return allowed.some((candidate) => normalized === candidate.toLowerCase());
}

/**
 * Origin validation. A browser-issued cross-origin request has no legitimate
 * reason to read this API, so an `Origin` must be explicitly allowlisted. An
 * absent `Origin` (the container's HTTP client) is allowed.
 */
function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) return true;
  return allowed.includes(origin.trim());
}

/** Fixed-window rate limiter keyed by peer address. */
class RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  public allow(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (entry === undefined || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= RATE_LIMIT_CAPACITY) return false;
    entry.count += 1;
    return true;
  }

  /** Drop stale buckets so the map cannot grow without bound. */
  public sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) this.hits.delete(key);
    }
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown, extraHeaders: Readonly<Record<string, string>> = {}): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  res.end(body);
}

/** Reject a malformed or oversized request line before any routing happens. */
function parseRequestPath(url: string | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 512) return null;
  const queryStart = url.indexOf('?');
  const pathPart = queryStart === -1 ? url : url.slice(0, queryStart);
  if (pathPart.includes('..') || pathPart.includes('\\') || pathPart.includes('\0')) return null;
  try {
    return decodeURIComponent(pathPart);
  } catch {
    return null;
  }
}

/* ===========================================================================
 * SECTION 8 — HTTP SERVER
 * ========================================================================= */

export interface ProberHandle {
  readonly port: number;
  readonly bind: string;
  close(): Promise<void>;
}

export function createProber(config: ProberConfig): { handle: ProberHandle; server: ReturnType<typeof createServer> } {
  const limiter = new RateLimiter();
  const sweeper = setInterval(() => limiter.sweep(), RATE_LIMIT_WINDOW_MS);
  sweeper.unref();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async (): Promise<void> => {
      // --- Transport-level guards apply to EVERY route, including health ---
      if (!hostAllowed(req.headers.host, config.allowedHosts)) {
        sendJson(res, 400, { ok: false, error: 'host header not allowed' });
        return;
      }
      if (!originAllowed(req.headers.origin, config.allowedOrigins)) {
        sendJson(res, 403, { ok: false, error: 'origin not allowed' });
        return;
      }

      const path = parseRequestPath(req.url);
      if (path === null) {
        sendJson(res, 400, { ok: false, error: 'malformed request target' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' }, { Allow: 'GET, HEAD' });
        return;
      }

      // --- Liveness. Unauthenticated by design so an operator can distinguish
      //     "the prober is down" from "the token is wrong". It therefore exposes
      //     NO host metadata: no paths, no counts, no token state. ---
      if (path === '/probe/health') {
        sendJson(res, 200, {
          ok: true,
          chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
          proberVersion: PROBER_VERSION,
          generatedAt: new Date().toISOString(),
          authRequiredForData: true,
        });
        return;
      }

      // --- Authentication for every data route ---
      const authHeader = req.headers.authorization;
      const bearer =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
      if (config.token.length < MIN_TOKEN_LENGTH || !tokenMatches(bearer, config.token)) {
        // The token VALUE is never echoed, logged, or stored.
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      // --- Rate limit. Health is exempt (checked above) so a supervisor polling
      //     liveness can never be told the prober is down when it is merely busy. ---
      const peer = req.socket.remoteAddress ?? 'unknown';
      if (!limiter.allow(peer)) {
        sendJson(res, 429, { ok: false, error: 'rate limited' }, { 'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
        return;
      }

      if (path === '/probe/mcp/status') {
        // `?fresh=1` is a boolean mode selector, NOT a caller-supplied path,
        // command or entrypoint, so it cannot widen the execution surface.
        const query = (req.url ?? '').split('?')[1] ?? '';
        const bypassCache = /(?:^|&)fresh=1(?:&|$)/.test(query);
        sendJson(res, 200, await sweep(config, { bypassCache }));
        return;
      }

      if (path === '/probe/lsp/status') {
        // Awaited: the LSP sweep spawns language servers, so this is a measurement,
        // not a lookup. It is deliberately NOT cached — an LSP handshake costs far
        // more than an MCP one, and a stale LSP verdict would be worse than none.
        sendJson(res, 200, await lspStatus(config));
        return;
      }

      if (path === '/probe/servers') {
        // Inventory ids, kinds and operator notes only: no paths, no arguments,
        // no env values. The notes record DELIBERATE divergences from what a
        // manifest may declare (notably the PowerShell wrapper trap), so they
        // belong with the static allowlist rather than in the per-run
        // discrepancy report, which is reserved for actual document conflicts.
        sendJson(res, 200, {
          ok: true,
          chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
          generatedAt: new Date().toISOString(),
          servers: ALLOWLIST.map((entry) => ({ id: entry.id, kind: entry.kind, note: entry.note })),
        });
        return;
      }

      if (path === '/probe/discrepancies') {
        // Manifest-vs-host disagreements, including the `mcp.github.entry` defect.
        // Relative paths only; the prober never writes a manifest.
        const report = buildInventory(config);
        sendJson(res, 200, {
          ok: true,
          chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
          generatedAt: new Date().toISOString(),
          manifestEnabled: report.manifestEnabled,
          discrepancies: report.discrepancies,
        });
        return;
      }

      if (path.startsWith('/probe/tools/')) {
        const id = path.slice('/probe/tools/'.length);
        // Two independent gates: a strict charset AND an allowlist membership
        // check. The path is NEVER joined to a filesystem location from the
        // request, so traversal is structurally impossible.
        if (!ID_PATTERN.test(id)) {
          sendJson(res, 400, { ok: false, error: 'malformed server id' });
          return;
        }
        if (!ALLOWLIST_BY_ID.has(id)) {
          sendJson(res, 404, { ok: false, error: 'unknown server id' });
          return;
        }
        const inventory = buildInventory(config);
        const target = inventory.targets.find((t) => t.id === id);
        if (target === undefined) {
          sendJson(res, 404, { ok: false, error: 'unknown server id' });
          return;
        }
        const outcome = await probeTarget(target, config, config.runDeadlineMs);
        const at = new Date().toISOString();
        sendJson(res, 200, {
          ok: true,
          chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
          id,
          state: outcome.state,
          lastProbedAt: at,
          // Tool NAMES only. Argument schemas and tool output are deliberately
          // absent: a schema can embed default values, and output can embed data.
          toolCount: outcome.toolCount,
          toolNames: outcome.toolNames,
          reason: outcome.reason,
          reasonText: outcome.reasonText,
          measured: outcome.state === 'ONLINE' || outcome.state === 'OFFLINE',
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    })().catch(() => {
      // Never leak a stack trace, an absolute path, or an internal error message.
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' });
      else res.end();
    });
  });

  const handle: ProberHandle = {
    port: config.port,
    bind: config.bind,
    close: () =>
      new Promise<void>((resolveClose) => {
        clearInterval(sweeper);
        server.close(() => {
          killAllChildren();
          resolveClose();
        });
        server.closeIdleConnections?.();
      }),
  };

  return { handle, server };
}

/** Kill every live child tree. Guarantees no orphaned prober child on shutdown. */
export function killAllChildren(): number {
  let killed = 0;
  for (const child of activeChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      terminateTree(child);
      killed += 1;
    }
    activeChildren.delete(child);
  }
  return killed;
}

/* ===========================================================================
 * SECTION 9 — ENTRYPOINT (--once for CI, default long-running server)
 * ========================================================================= */

const USAGE = `${PROBER_NAME} ${PROBER_VERSION} — real MCP/LSP infrastructure measurement

USAGE
  npx tsx scripts/host_prober.ts [--once] [--help]

MODES
  (default)   Long-running read-only HTTP service bound to a loopback address.
  --once      Probe every target once, print the report as JSON to stdout, exit.
              No socket is opened, so no HOST_PROBER_TOKEN is required (CI-safe).
  --help      This text.

ENVIRONMENT
  HOST_PROBER_TOKEN          REQUIRED for server mode. >= ${MIN_TOKEN_LENGTH} characters. Fail closed.
  HOST_PROBER_PORT           Default ${DEFAULT_PORT}.
  HOST_PROBER_BIND           Loopback only. Default 127.0.0.1. Any other value is REFUSED.
  HOST_PROBER_ROOT           Servers Center root. Default ${DEFAULT_ROOT}.
  HOST_PROBER_MANIFEST       Set to 0 to force the built-in allowlist.
  HOST_PROBER_NODE           Explicit Node runtime override.
  HOST_PROBER_REPO_ROOT      Repository root used to locate config/servers_center_manifest.json.
  HOST_PROBER_ALLOWED_HOSTS  Extra Host header names, comma separated. To let the
                             container reach this prober you must include
                             host.docker.internal here. NOT allowed by default.
  HOST_PROBER_ALLOWED_ORIGINS  Extra Origin values, comma separated.
  HOST_PROBER_TIMEOUT_MS            Per-child lifetime cap. Default ${DEFAULT_PER_CHILD_TIMEOUT_MS}.
  HOST_PROBER_PHASE_TIMEOUT_MS      Per-handshake-phase cap. Default ${DEFAULT_PHASE_TIMEOUT_MS}.
  HOST_PROBER_MAX_CONCURRENCY       Parallel probes. Default ${DEFAULT_MAX_CONCURRENCY}.
  HOST_PROBER_RUN_DEADLINE_MS       Whole-sweep deadline. Default ${DEFAULT_RUN_DEADLINE_MS}.
  HOST_PROBER_CACHE_TTL_MS          Result cache TTL, 0 disables. Default ${DEFAULT_CACHE_TTL_MS}.
`;

export async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  // Unknown flags are REJECTED rather than ignored, so a typo cannot silently
  // change what the operator believes they are measuring.
  const known = new Set(['--once', '--help', '-h']);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    process.stderr.write(`PROBER_FATAL: unrecognized argument(s): ${unknown.join(', ')}\n\n${USAGE}`);
    return 2;
  }

  const once = args.includes('--once');
  let config: ProberConfig;
  try {
    config = loadConfig(!once);
  } catch (err) {
    process.stderr.write(`PROBER_FATAL: ${err instanceof Error ? err.message : 'configuration refused'}\n`);
    return 1;
  }

  if (once) {
    // `bypassCache` is meaningless for a fresh process but is stated explicitly
    // so the semantics of a CI run are unambiguous.
    const report = await sweep(config, { bypassCache: true });
    process.stdout.write(`${JSON.stringify(report, null, 2)}${EOL}`);
    // Non-zero only when the prober itself failed. A measured OFFLINE is a
    // successful measurement and must not fail a build.
    return 0;
  }

  const { server, handle } = createProber(config);
  const onSignal = (): void => {
    void handle.close().then(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(config.port, config.bind, () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });

  // Startup banner: ids, port, bind, and limits ONLY. No token, no path values.
  process.stdout.write(
    `${PROBER_NAME} ${PROBER_VERSION} listening on http://${config.bind}:${config.port}${EOL}` +
      `  root            : ${config.root}${EOL}` +
      `  manifest recon. : ${config.manifestEnabled ? 'enabled' : 'disabled (HOST_PROBER_MANIFEST=0)'}${EOL}` +
      `  limits          : perChild=${config.perChildTimeoutMs}ms phase=${config.phaseTimeoutMs}ms ` +
      `concurrency=${config.maxConcurrency} sweep=${config.runDeadlineMs}ms cache=${config.cacheTtlMs}ms${EOL}` +
      `  allowlisted ids : ${ALLOWLIST.map((e) => e.id).join(', ')}${EOL}` +
      `  host allowlist  : ${config.allowedHosts.join(', ')}${EOL}`,
  );

  return new Promise<number>((resolveExit) => {
    server.on('error', () => resolveExit(1));
    server.on('close', () => resolveExit(0));
  });
}

const invokedDirectly =
  process.argv[1] !== undefined && /host_prober\.(ts|mts|cts|js|cjs|mjs)$/i.test(process.argv[1]);

if (invokedDirectly) {
  main(process.argv)
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`PROBER_FATAL: ${err instanceof Error ? err.message : 'unknown'}\n`);
      process.exitCode = 1;
    });
}