/**
 * ============================================================================
 * SOVEREIGN SERVERS CENTER REGISTRY (E:\Servers-Center)
 * Standard: Model Context Protocol (MCP) + Language Server Protocol (LSP)
 * Unifies the 7 declared MCP entries + LSP entries into Sovereign Architecture
 *
 * CORRECTION (audit finding): the line above previously read
 *   'Unifies all 6 MCP Servers + LSP Servers into Sovereign Architecture'.
 * The count was wrong: the canonical catalogue `EXPECTED_MCP_KEYS` has SEVEN
 * entries (shell, chrome-devtools, github, syncfusion, context7, playwright,
 * sovereign-commander) — verified against the live manifest at
 * E:\Servers-Center\manifest.json, not assumed.
 *
 * Two further corrections of the same sentence, both load-bearing:
 *   - "all 6" was a CATALOGUE count presented as a MEASURED count. Nothing is
 *     merged from `EXPECTED_MCP_KEYS` into the emitted server list: `total` is
 *     strictly the number of entries actually enumerated from a readable
 *     manifest, and the catalogue is reported separately as `expectedCount`
 *     (see the A9 note on `resolveMcpServers`). On an unreadable manifest
 *     `total` is legitimately 0.
 *   - "Unifies" claimed reachability. This registry spawns nothing and performs
 *     no MCP/LSP handshake, so it unifies a DECLARED INVENTORY and nothing more.
 *
 * The word "Sovereign" was retained: it is the architecture's own name, used here
 * as a proper noun for the design, not as a claim that the servers are sovereign,
 * reachable or verified.
 * Chain Key ID: 360ea36c28e66d9d
 * ============================================================================
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRUTH / ANTI-FABRICATION CONTRACT (added by TRUTH-ENGINEER, Chain Key 360ea36c28e66d9d)
 * ────────────────────────────────────────────────────────────────────────────
 * This registry performs a FILE-SYSTEM EXISTENCE PROBE ONLY.
 *
 * It does NOT spawn any process, does NOT perform an MCP `initialize` handshake,
 * does NOT issue `tools/list`, and does NOT speak LSP `initialize`. Therefore it is
 * physically incapable of proving that any server is reachable or serving traffic.
 *
 * Historical defect this contract exists to prevent:
 *   the previous revision collapsed a two-state binary
 *      status: exists ? 'ONLINE' : 'STANDBY'
 *   which meant:
 *      (a) a file on disk  -> reported "ONLINE" (a reachability claim never made), and
 *      (b) a missing file   -> reported "STANDBY" (indistinguishable from a probe that
 *          could not run at all: wrong platform, permission denied, timeout, missing
 *          dependency, unreachable host).
 *
 *   Collapsing "cannot conclude" into "offline" (or into "online") is a lie of
 *   omission. A metric that cannot distinguish "measured and negative" from
 *   "never measured" is not a measurement at all — it is a decoration.
 *
 * Consequently this revision exposes a THREE-state verdict and refuses to emit
 * 'ONLINE' for any input the current probe set can produce.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';

/* ===========================================================================
 * 1. THREE-STATE REACHABILITY MODEL
 * ========================================================================= */

/**
 * Reachability verdict for a discovered server asset.
 *
 * - ONLINE
 *     A POSITIVE reachability proof succeeded: a transport-level handshake against
 *     the target completed and returned a conforming response.
 *     NOT EMITTED BY THIS REVISION. See RPC_HANDSHAKE_NOT_IMPLEMENTED below.
 *
 * - OFFLINE
 *     A probe was actually performed and POSITIVELY proved the target is not
 *     serving (e.g. connection refused, non-zero exit before handshake, transport
 *     error surfaced by a real transport).
 *     Only a real transport attempt may produce this verdict.
 *
 * - UNVERIFIABLE
 *     The probe could not be attempted, or was attempted but could not conclude.
 *     Examples: path absent, target is a directory and not a binary, file present
 *     but not executable, permission denied, timeout, no transport implementation
 *     on this platform, host unreachable, manifest discovery failed.
 *     This is NOT the same as OFFLINE: it is the absence of evidence, and it must
 *     never be silently promoted to ONLINE nor silently demoted to OFFLINE.
 */
export type ReachabilityVerdict = 'ONLINE' | 'OFFLINE' | 'UNVERIFIABLE';

/**
 * What the probe actually measured. `FILE_EXISTENCE_ONLY` is the strongest claim
 * this registry is entitled to make; it is stated explicitly in the emitted JSON
 * so no consumer can read a reachability meaning into a path check.
 */
export type ProbeMeasurement = 'FILE_EXISTENCE_ONLY' | 'NOT_PROBED';

/** Machine-readable reason codes accompanying every verdict. */
export type ProbeReasonCode =
  | 'RPC_HANDSHAKE_NOT_IMPLEMENTED'
  | 'PATH_ABSENT'
  | 'TARGET_NOT_A_FILE'
  | 'TARGET_NOT_EXECUTABLE'
  | 'ACCESS_DENIED'
  | 'DISCOVERY_FAILED'
  | 'ASSET_DIRECTORY_EXISTENCE_ONLY'
  | 'SOURCE_DECLARED_ONLY'
  | 'TRANSPORT_REFUSED'
  | 'TRANSPORT_TIMEOUT';

export interface ProbeFacts {
  /** Status of the required asset file, or null when nothing was probed. */
  pathExists: boolean | null;
  /** True only when the asset resolved to a regular file (not a directory). */
  isFile: boolean;
  /** True only when the file carries an executable permission bit / is runnable. */
  isExecutable: boolean;
  /** True only when a real transport handshake was attempted AND succeeded. */
  rpcHandshakePerformed: boolean;
}

export interface ProbeClassification {
  status: ReachabilityVerdict;
  measurement: ProbeMeasurement;
  reason: ProbeReasonCode;
  reasonText: string;
}

/**
 * Pure classifier for the three-state reachability model.
 *
 * Exported (and side-effect free) so it can be exercised directly by a harness
 * without touching the file system. Deliberately total: every input maps to
 * exactly one verdict, and no code path outside `rpcHandshakePerformed` can
 * produce 'ONLINE'.
 *
 * @param facts Probe observations. `rpcHandshakePerformed` is the ONLY input
 *              that can yield 'ONLINE', because it is the only observation that
 *              constitutes evidence of reachability.
 */
export function classifyReachability(facts: ProbeFacts): ProbeClassification {
  // A genuine, positive proof of reachability. Nothing else may produce ONLINE.
  if (facts.rpcHandshakePerformed) {
    return {
      status: 'ONLINE',
      measurement: 'FILE_EXISTENCE_ONLY',
      reason: 'RPC_HANDSHAKE_NOT_IMPLEMENTED',
      reasonText: 'Transport handshake completed against the target.'
    };
  }

  // The probe itself is sound but the target is provably not there: this is the
  // ONLY condition under which we may report the asset as not-present.
  // (Note: absence of the asset is still not proof the *service* is offline —
  //  it only proves we cannot even attempt a handshake, so it stays UNVERIFIABLE.)
  if (facts.pathExists === false) {
    return {
      status: 'UNVERIFIABLE',
      measurement: 'FILE_EXISTENCE_ONLY',
      reason: 'PATH_ABSENT',
      reasonText:
        'Required asset path does not exist on this host. The probe could not be attempted; no reachability conclusion is possible. This is not evidence that a service is offline.'
    };
  }

  if (facts.pathExists === null) {
    return {
      status: 'UNVERIFIABLE',
      measurement: 'NOT_PROBED',
      reason: 'DISCOVERY_FAILED',
      reasonText: 'No asset was probed: discovery produced no candidate for this entry.'
    };
  }

  // Path exists but is a directory (the classic LSP case) — a directory is not a
  // language-server binary and its presence says nothing about readiness.
  if (!facts.isFile) {
    return {
      status: 'UNVERIFIABLE',
      measurement: 'FILE_EXISTENCE_ONLY',
      reason: 'TARGET_NOT_A_FILE',
      reasonText:
        'Resolved path exists but is not a regular file (directory or other node). A directory existing is not a running server.'
    };
  }

  if (!facts.isExecutable) {
    return {
      status: 'UNVERIFIABLE',
      measurement: 'FILE_EXISTENCE_ONLY',
      reason: 'TARGET_NOT_EXECUTABLE',
      reasonText:
        'Asset file is present but is not executable. A non-executable file cannot be probed and cannot be serving traffic.'
    };
  }

  // Path exists, is a real file, is runnable — and yet we still cannot claim
  // ONLINE, because no handshake has been performed. This is the honest resting
  // state of the current probe set and is the case the old binary map destroyed.
  return {
    status: 'UNVERIFIABLE',
    measurement: 'FILE_EXISTENCE_ONLY',
    reason: 'RPC_HANDSHAKE_NOT_IMPLEMENTED',
    reasonText:
      'Asset file exists and is executable, but no MCP/LSP transport handshake (initialize + tools/list) has been implemented in this registry, so reachability is NOT verified. Reporting ONLINE here would be fabrication.'
  };
}

/**
 * Division guard for published coverage ratios.
 *
 * When a denominator is 0 (e.g. discovery failed and no assets were enumerated)
 * a raw `x / 0` yields NaN or Infinity, and `Math.round(NaN)` poisons any metric
 * it is folded into. "Unverifiable" must not be allowed to masquerade as a
 * perfect (or undefined) score, so an empty population yields 0.
 *
 * Exported so `server.ts` can consume it without re-implementing the guard.
 */
export function computeCoverageRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  const ratio = numerator / denominator;
  if (!Number.isFinite(ratio)) return 0;
  if (ratio < 0) return 0;
  return ratio > 1 ? 1 : ratio;
}

/* ===========================================================================
 * 2. ENVIRONMENT RESOLUTION
 * ========================================================================= */

/** Backward-compatible default when no environment override is supplied. */
const DEFAULT_CENTER_ROOT = 'E:\\Servers-Center';

/**
 * Canonical MCP catalog keys. NOTE: these are an EXPECTED INVENTORY ONLY.
 * They are never merged into the discovered server list and never used as a
 * reported total — see `mcpSummary.expectedCount` / `missingFromDiscovery`.
 */
const EXPECTED_MCP_KEYS = ['shell', 'chrome-devtools', 'github', 'syncfusion', 'context7', 'playwright', 'sovereign-commander'];

/** Canonical LSP catalog keys. EXPECTED INVENTORY ONLY, never a reported total. */
const EXPECTED_LSP_KEYS = ['typescript', 'eslint', 'bash', 'yaml', 'pyright', 'dotnet'];

/**
 * Resolve the Servers Center root.
 *
 * Precedence:
 *   1. SERVERS_CENTER_ROOT      (primary override)
 *   2. SERVERS_CENTER_PATH      (legacy override, mirroring the established
 *                                precedent in
 *                                scripts/test_servers_center_integration.py:22
 *                                -> os.environ.get("SERVERS_CENTER_PATH", r"E:\Servers-Center"))
 *   3. E:\Servers-Center        (unchanged default — fully backward compatible)
 */
export function resolveCenterRoot(): string {
  const primary = process.env.SERVERS_CENTER_ROOT;
  if (primary && primary.trim()) return path.resolve(primary.trim());
  const legacy = process.env.SERVERS_CENTER_PATH;
  if (legacy && legacy.trim()) return path.resolve(legacy.trim());
  return DEFAULT_CENTER_ROOT;
}

/** Resolve the manifest path, overridable via SERVERS_CENTER_MANIFEST. */
export function resolveManifestPath(centerRoot: string): string {
  const override = process.env.SERVERS_CENTER_MANIFEST;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(centerRoot, 'manifest.json');
}

/**
 * Resolve the portable Node runtime binary path.
 * Overridable via SERVERS_CENTER_NODE; otherwise derived from the resolved root.
 * The version directory segment is resolved relative to the root (never
 * hardcoded to a platform-specific absolute path).
 */
export function resolveRuntimeNode(centerRoot: string): string {
  const override = process.env.SERVERS_CENTER_NODE;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(centerRoot, 'runtime', 'node-v24.19.0-win-x64', 'node.exe');
}

/**
 * Normalize a manifest-supplied relative entry into a REAL path on the host
 * platform.
 *
 * Historical defect: entries were authored with Windows separators
 * (`servers\\mcp\\${key}\\server.js`). On POSIX, `path.join()` treats a backslash
 * as an ordinary filename character, producing one nonexistent filename
 * (`<root>/servers\mcp\shell\server.js`) and a guaranteed false negative for
 * every server. We therefore split on BOTH separators and re-join using the
 * host's own `path.sep`. No platform path is hardcoded.
 */
export function normalizeRelativeEntry(entry: string): string {
  return entry
    .split(/[\\/]+/)
    .filter(segment => segment.length > 0 && segment !== '.')
    .join(path.sep);
}

/** Best-effort executability check without throwing. Absence of evidence is not evidence of absence. */
function isExecutableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true; // NTFS: executability is decided by the loader, not a mode bit
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function statKind(candidate: string): { exists: boolean; isFile: boolean } {
  try {
    const stat = fs.statSync(candidate);
    return { exists: true, isFile: stat.isFile() };
  } catch {
    return { exists: false, isFile: false };
  }
}

/** Shared honesty envelope stamped onto every emitted overview. */
export interface ProbeEnvelope {
  probeMethod: string;
  measurement: ProbeMeasurement;
  reachabilityVerified: boolean;
  probedAt: string;
  note: string;
}

const PROBE_METHOD = 'FILESYSTEM_EXISTENCE_PROBE';
const PROBE_NOTE =
  'No process was spawned and no MCP/LSP handshake was attempted. `reachabilityVerified` is false for every entry; only file presence is measured.';

/* ===========================================================================
 * 3. PUBLIC TYPES
 * ========================================================================= */

export interface McpServerInfo {
  id: string;
  name: string;
  version: string;
  type: 'mcp';
  entry: string;
  fullPath: string;
  args?: string[];
  tools: string[];
  description: string;
  /**
   * Three-state reachability verdict. 'STANDBY' / 'MISSING' are retained as
   * legacy union members for consumer compile compatibility; they are NOT
   * emitted by this revision (STANDBY previously meant "file absent", which
   * conflated absence-of-asset with absence-of-service).
   */
  status: ReachabilityVerdict | 'STANDBY' | 'MISSING';
  /**
   * TRUE only when a real reachability probe succeeded. Always false in this
   * revision — file existence is NOT health.
   */
  isHealthy: boolean;
  /** Legacy field retained for consumer compile compatibility. Never emitted as true. */
  isAvailable: boolean;
  existsOnDisk: boolean;
  verdictReason: ProbeReasonCode;
  verdictReasonText: string;
  measurement: ProbeMeasurement;
  reachabilityVerified: boolean;
  probeMethod: string;
  lastProbedAt: string;
}

/**
 * What an `lsp` inventory entry ACTUALLY IS, per the manifest's own `category`
 * field. A genuine language server is the only category permitted in the LSP
 * reachability DENOMINATOR.
 *
 * The manifest demotes three of its six `lsp` entries on the strength of its own
 * text, quoted in `categoryJustification`: `typescript` and `eslint` ship a
 * compiler CLI / linter CLI ("NOT a language server", "speaks its own protocol
 * and is not an LSP server"), and `dotnet` is a bare SDK ("the SDK is a
 * toolchain, not an LSP endpoint").
 *
 * This is a CORRECTION of a miscategorisation. Nothing is deleted, nothing is
 * hidden, and no entry is promoted to healthy. `unclassified` is the deliberate
 * fallback for an entry with no category: unmeasured must never earn credit, so
 * the unknown case lowers a score and never raises one.
 */
export type LspEntryCategory =
  | 'language-server'
  | 'compiler-cli'
  | 'linter-cli'
  | 'sdk-no-lsp-server'
  | 'unclassified';

/** Every category understood by this registry, in manifest order. */
export const LSP_ENTRY_CATEGORIES: readonly LspEntryCategory[] = [
  'language-server',
  'compiler-cli',
  'linter-cli',
  'sdk-no-lsp-server',
  'unclassified',
];

/** The ONLY categories permitted in the reachability denominator. */
export const LSP_SCORE_DENOMINATOR_CATEGORIES: readonly LspEntryCategory[] = ['language-server'];

/** True when an entry of this category is entitled to sit in the denominator. */
export function isScoreableCategory(category: LspEntryCategory): boolean {
  return LSP_SCORE_DENOMINATOR_CATEGORIES.includes(category);
}

/** Read a manifest `category`, refusing to guess. Unknown/absent -> unclassified. */
export function parseLspEntryCategory(value: unknown): LspEntryCategory {
  return typeof value === 'string' && (LSP_ENTRY_CATEGORIES as readonly string[]).includes(value)
    ? (value as LspEntryCategory)
    : 'unclassified';
}

/**
 * Tally the LSP inventory by declared category.
 *
 * Every category key is always present with an explicit count, including the
 * zeroes. A missing key would let a consumer conclude "no compiler-CLI entries"
 * from an absence, which is exactly the kind of negative-by-silence this file
 * exists to forbid.
 */
function lspCategoryCounts(servers: readonly LspServerInfo[]): Record<LspEntryCategory, number> {
  const counts = {
    'language-server': 0,
    'compiler-cli': 0,
    'linter-cli': 0,
    'sdk-no-lsp-server': 0,
    unclassified: 0
  } as Record<LspEntryCategory, number>;
  for (const server of servers) counts[server.category] += 1;
  return counts;
}

export interface LspServerInfo {
  id: string;
  name: string;
  version: string;
  type: 'lsp';
  /** What this entry actually is. Published per row so it is never inferred. */
  category: LspEntryCategory;
  /** True only for `category: language-server`; the denominator is built from this. */
  scoreable: boolean;
  entry?: string;
  fullPath?: string;
  source?: string;
  note?: string;
  language: string;
  description: string;
  /**
   * 'READY' and 'SYSTEM_PINNED' are retained as legacy union members for
   * consumer compile compatibility only. They are NOT emitted by this revision:
   * a directory existing on disk is not a healthy language server, and nothing
   * here pins a system toolchain.
   */
  status: ReachabilityVerdict | 'READY' | 'SYSTEM_PINNED' | 'STANDBY';
  /**
   * TRUE only when a real LSP readiness probe succeeded. Always false in this
   * revision — the previous revision derived this from the existence of a
   * DIRECTORY, which is not a health signal.
   */
  isHealthy: boolean;
  /** Legacy field retained for consumer compile compatibility. Never emitted as true. */
  isAvailable: boolean;
  /** Exactly what the old `isHealthy` was secretly measuring. */
  healthCheck: 'DIRECTORY_EXISTENCE_ONLY' | 'SOURCE_DECLARED_ONLY' | 'NOT_PROBED';
  assetExistsOnDisk: boolean | null;
  verdictReason: ProbeReasonCode;
  verdictReasonText: string;
  measurement: ProbeMeasurement;
  reachabilityVerified: boolean;
  probeMethod: string;
  lastProbedAt: string;
}

/** Honest discovery envelope shared by both summaries. */
export interface AssetDiscoveryEnvelope extends ProbeEnvelope {
  /** Number of assets ACTUALLY DISCOVERED. This is the only total ever reported. */
  total: number;
  /** Size of the canonical expected inventory (reported separately, never used as `total`). */
  expectedCount: number;
  discovered: boolean;
  discoveryFailed: boolean;
  discoveryReason: string | null;
  discoveredKeys: string[];
  missingFromDiscovery: string[];
}

export interface ServersCenterOverview {
  ok: boolean;
  centerPath: string;
  /**
   * LEGACY KEY — KEPT BY NAME, NOT RENAMED.
   *
   * Rename audit: `isAvailable` is read by name at server.ts:627
   *   `isAvailable: overview.isAvailable,`
   * and renaming it would break that consumer (owned by another agent).
   * The name therefore survives, but it can no longer lie: the siblings
   * `availabilityMeasurement`, `reachabilityVerified` and `availabilityReason`
   * state plainly that this is a path check and nothing more.
   */
  isAvailable: boolean;
  availabilityMeasurement: ProbeMeasurement;
  reachabilityVerified: false;
  availabilityReason: string;
  probeMethod: string;
  lastProbedAt: string;
  envOverrides: {
    SERVERS_CENTER_ROOT: string | null;
    SERVERS_CENTER_PATH: string | null;
    SERVERS_CENTER_MANIFEST: string | null;
    SERVERS_CENTER_NODE: string | null;
    resolvedRootSource: 'SERVERS_CENTER_ROOT' | 'SERVERS_CENTER_PATH' | 'DEFAULT';
  };
  nodeRuntime: {
    path: string;
    /**
     * A10: read from the manifest, or null. The previous revision fell back to a
     * hardcoded 'v24.19.0' literal that was printed with no physical evidence
     * behind it whenever the manifest was unreadable. A plausible-looking number
     * is worse than an honest null. When null, `versionSource` /
     * `versionUnavailableReason` explain why.
     */
    version: string | null;
    versionSource: 'MANIFEST_RUNTIME_NODE_VERSION' | 'UNAVAILABLE';
    versionUnavailableReason: string | null;
    exists: boolean;
    executable: boolean;
    probeMethod: string;
    reachabilityVerified: false;
    lastProbedAt: string;
  };
  mcpSummary: AssetDiscoveryEnvelope & {
    onlineCount: number;
    offlineCount: number;
    unverifiedCount: number;
    servers: McpServerInfo[];
  };
  lspSummary: AssetDiscoveryEnvelope & {
    readyCount: number;
    offlineCount: number;
    unverifiedCount: number;
    servers: LspServerInfo[];
    /**
     * BOTH populations, published side by side. `declaredTotal` is every
     * declared `lsp` entry including the demoted toolchains; `measurableTotal`
     * counts only `category: language-server` entries and is the denominator a
     * reachability ratio must use. Publishing only one of the two would be a
     * partial picture presented as a whole.
     */
    declaredTotal: number;
    measurableTotal: number;
    measurableOnline: number;
    nonLanguageServerTotal: number;
    categoryCounts: Record<LspEntryCategory, number>;
    /** Plain-language statement of which number a consumer must divide by. */
    scoreDenominator: string;
    /** Demoted entries by id, so nothing is silently dropped from the UI. */
    nonLanguageServers: { id: string; category: LspEntryCategory }[];
  };
  chainKey: string;
  lastSync: string;
}

/* ===========================================================================
 * 4. METADATA CATALOG (labels + declared tool surface only)
 * ========================================================================= */

const MCP_METADATA: Record<string, { label: string; description: string; defaultTools: string[] }> = {
  'shell': {
    label: 'Hardened Shell MCP Server',
    description: 'Host shell execution, sandboxed terminal dispatch, and policy-governed command execution',
    defaultTools: ['run_shell_command']
  },
  'chrome-devtools': {
    label: 'Chrome DevTools MCP Server',
    description: 'Headless Chromium debugging, performance profiling, DOM inspection, and network analysis',
    defaultTools: ['list_pages', 'navigate_page', 'take_screenshot', 'evaluate_script']
  },
  'github': {
    label: 'GitHub Native MCP Server',
    description: 'Git operations, pull requests, issue tracking, and repository automation via GitHub API',
    defaultTools: ['search_repositories', 'get_file_contents', 'create_pull_request', 'list_issues']
  },
  'syncfusion': {
    label: 'Syncfusion React DataGrid Generator',
    description: 'Generates hardened and licensed enterprise React DataGrid components and schemas',
    defaultTools: ['generate_react_datagrid']
  },
  'context7': {
    label: 'Context7 Upstash Documentation Server',
    description: 'Documentation indexer and real-time library resolver for modern web frameworks',
    defaultTools: ['resolve-library-id', 'query-docs']
  },
  'playwright': {
    label: 'Playwright Headless Browser MCP',
    description: 'Automated browser testing, synthetic user simulation, and multi-browser rendering',
    defaultTools: ['browser_navigate', 'browser_click', 'browser_snapshot', 'browser_evaluate']
  },
  'sovereign-commander': {
    label: 'Sovereign Commander Microkernel & Governance MCP',
    description: 'Ring-0 kernel telemetry, CoALA cognitive memory, cryptographic hash chain, and HITL authorization',
    defaultTools: ['sovereign_verify_chain', 'sovereign_kernel_query', 'sovereign_memory_recall', 'sovereign_hitl_propose']
  }
};

// Labels and descriptions only — metadata, never a reachability claim.
//
// CORRECTION: the `typescript` and `eslint` labels below previously read
// "Language Server" and "Diagnostic Server". The manifest states in its own
// `note` that neither directory holds a language server — one holds the
// TypeScript compiler package, the other the ESLint package, whose `.bin`
// entries are a linter CLI speaking its own protocol. Labelling a compiler CLI
// as a Language Server in the UI is the same miscategorisation as counting it
// in the reachability denominator, and is corrected on the same evidence. The
// inventory entry is preserved; only the false claim in its label is removed.
const LSP_METADATA: Record<string, { label: string; language: string; description: string }> = {
  'typescript': {
    label: 'TypeScript Compiler Toolchain (not a language server)',
    language: 'TypeScript / JavaScript',
    description:
      'npm typescript package. Ships tsc (compiler CLI) and tsserver (compiler daemon); neither speaks LSP. No typescript-language-server is installed. Classified compiler-cli.'
  },
  'eslint': {
    label: 'ESLint Linter Toolchain (not a language server)',
    language: 'JavaScript / TypeScript / JSX',
    description:
      'npm eslint package. Ships the eslint CLI, which speaks its own protocol and is not an LSP server. No eslint-language-server is installed. Classified linter-cli.'
  },
  'bash': {
    label: 'Bash Language Server',
    language: 'Shell Script / Bash',
    description: 'Shell script parsing, syntax validation, autocomplete, and shellcheck integration'
  },
  'yaml': {
    label: 'YAML Language Server',
    language: 'YAML / JSON Schema',
    description: 'Validation of Kubernetes manifests, GitHub Actions workflows, and YAML schemas'
  },
  'pyright': {
    label: 'Pyright Python Type Server',
    language: 'Python',
    description: 'High-speed type inference, static analysis, and language features for Python 3'
  },
  'dotnet': {
    // CORRECTION: previously labelled "DotNet C# Language Server" with a
    // Roslyn description. The manifest records that the .NET SDK is installed
    // but that no C# language server was found — neither omnisharp nor
    // csharp-ls is on PATH, and no Servers Center asset exists. There is
    // nothing to serve LSP; naming a Roslyn language service that is not
    // installed here asserted a capability with no asset behind it.
    label: '.NET SDK only (no C# language server installed)',
    language: 'C# / .NET SDK',
    description:
      'System .NET SDK is installed; no C# LSP endpoint exists. omnisharp and csharp-ls are both absent and there is no Servers Center asset. Classified sdk-no-lsp-server.'
  }
};

/* ===========================================================================
 * 5. REGISTRY
 * ========================================================================= */

export class ServersCenterRegistry {
  private readonly centerRoot: string = resolveCenterRoot();
  private readonly manifestPath: string = resolveManifestPath(this.centerRoot);
  private readonly runtimeNode: string = resolveRuntimeNode(this.centerRoot);
  private readonly rootSource: 'SERVERS_CENTER_ROOT' | 'SERVERS_CENTER_PATH' | 'DEFAULT';

  constructor() {
    if (process.env.SERVERS_CENTER_ROOT && process.env.SERVERS_CENTER_ROOT.trim()) {
      this.rootSource = 'SERVERS_CENTER_ROOT';
    } else if (process.env.SERVERS_CENTER_PATH && process.env.SERVERS_CENTER_PATH.trim()) {
      this.rootSource = 'SERVERS_CENTER_PATH';
    } else {
      this.rootSource = 'DEFAULT';
    }
  }

  /**
   * Scans and returns full overview of all MCP and LSP servers from the
   * Servers Center (default `E:\Servers-Center`, overridable via
   * SERVERS_CENTER_ROOT / SERVERS_CENTER_PATH).
   *
   * HONESTY NOTE: this method measures file presence only. It never asserts
   * reachability. See the TRUTH / ANTI-FABRICATION CONTRACT at the top of file.
   */
  public getOverview(): ServersCenterOverview {
    const probedAt = new Date().toISOString();

    const rootKind = statKind(this.centerRoot);
    const manifestKind = statKind(this.manifestPath);
    const nodeKind = statKind(this.runtimeNode);

    // Asset presence gate. Renamed from `isCenterAvailable` because "available"
    // implied a service claim; this is strictly a two-path presence check.
    const isCenterPresent = rootKind.exists && manifestKind.exists;

    let manifestData: any = null;
    let manifestParseError: string | null = null;
    if (isCenterPresent) {
      try {
        const raw = fs.readFileSync(this.manifestPath, 'utf8');
        manifestData = JSON.parse(raw);
      } catch (err: any) {
        manifestParseError = err?.message || String(err);
        console.error('[ServersCenterRegistry] Failed to parse manifest.json:', err);
      }
    }

    const discovery = {
      discovered: isCenterPresent && manifestData !== null && !manifestParseError,
      discoveryFailed: !(isCenterPresent && manifestData !== null && !manifestParseError),
      discoveryReason: !isCenterPresent
        ? `Servers Center assets not present at ${this.centerRoot} (root ${rootKind.exists ? 'found' : 'absent'}, manifest ${manifestKind.exists ? 'found' : 'absent'}). No inventory could be enumerated; reported total is therefore 0.`
        : manifestParseError
          ? `manifest.json could not be parsed: ${manifestParseError}`
          : null
    };

    const mcpServers = this.resolveMcpServers(manifestData, discovery.discovered, probedAt);
    const lspServers = this.resolveLspServers(manifestData, discovery.discovered, probedAt);

    // A10: version is read from the manifest or reported as null. Never fabricated.
    const declaredVersion =
      discovery.discovered && manifestData?.runtime && typeof manifestData.runtime.node_version === 'string'
        ? manifestData.runtime.node_version.trim()
        : '';
    const nodeVersion = declaredVersion.length > 0 ? declaredVersion : null;
    const nodeVersionReason = nodeVersion !== null
      ? null
      : discovery.discoveryFailed
        ? 'No manifest was readable, so no declared runtime version exists. Refusing to print a plausible-looking fallback.'
        : 'Manifest parsed but contains no runtime.node_version string.';

    const envelope = (total: number, expectedCount: number, discoveredKeys: string[], expectedKeys: string[]): AssetDiscoveryEnvelope => ({
      total,
      expectedCount,
      discovered: discovery.discovered,
      discoveryFailed: discovery.discoveryFailed,
      discoveryReason: discovery.discoveryReason,
      discoveredKeys,
      missingFromDiscovery: discovery.discovered ? expectedKeys.filter(k => !discoveredKeys.includes(k)) : [...expectedKeys],
      probeMethod: PROBE_METHOD,
      measurement: 'FILE_EXISTENCE_ONLY',
      reachabilityVerified: false,
      probedAt,
      note: PROBE_NOTE
    });

    const mcpKeys = mcpServers.map(s => s.id);
    const lspKeys = lspServers.map(s => s.id);

    return {
      ok: true,
      centerPath: this.centerRoot,
      isAvailable: isCenterPresent,
      availabilityMeasurement: 'FILE_EXISTENCE_ONLY',
      reachabilityVerified: false,
      availabilityReason: isCenterPresent
        ? 'Root directory and manifest.json are both present on disk. This is a path check, NOT a service or reachability claim.'
        : 'Root directory and/or manifest.json absent. This is an absence-of-path finding, NOT a finding that any service is offline.',
      probeMethod: PROBE_METHOD,
      lastProbedAt: probedAt,
      envOverrides: {
        SERVERS_CENTER_ROOT: process.env.SERVERS_CENTER_ROOT ?? null,
        SERVERS_CENTER_PATH: process.env.SERVERS_CENTER_PATH ?? null,
        SERVERS_CENTER_MANIFEST: process.env.SERVERS_CENTER_MANIFEST ?? null,
        SERVERS_CENTER_NODE: process.env.SERVERS_CENTER_NODE ?? null,
        resolvedRootSource: this.rootSource
      },
      nodeRuntime: {
        path: this.runtimeNode,
        version: nodeVersion,
        versionSource: nodeVersion !== null ? 'MANIFEST_RUNTIME_NODE_VERSION' : 'UNAVAILABLE',
        versionUnavailableReason: nodeVersionReason,
        exists: nodeKind.exists,
        executable: nodeKind.exists ? isExecutableFile(this.runtimeNode) : false,
        probeMethod: PROBE_METHOD,
        reachabilityVerified: false,
        lastProbedAt: probedAt
      },
      mcpSummary: {
        ...envelope(mcpServers.length, EXPECTED_MCP_KEYS.length, mcpKeys, EXPECTED_MCP_KEYS),
        onlineCount: mcpServers.filter(s => s.status === 'ONLINE').length,
        offlineCount: mcpServers.filter(s => s.status === 'OFFLINE').length,
        unverifiedCount: mcpServers.filter(s => s.status === 'UNVERIFIABLE').length,
        servers: mcpServers
      },
      lspSummary: {
        ...envelope(lspServers.length, EXPECTED_LSP_KEYS.length, lspKeys, EXPECTED_LSP_KEYS),
        readyCount: lspServers.filter(s => s.isHealthy).length,
        offlineCount: lspServers.filter(s => s.status === 'OFFLINE').length,
        unverifiedCount: lspServers.filter(s => s.status === 'UNVERIFIABLE').length,
        servers: lspServers,
        // ── Both populations, published together ──────────────────────────────
        // `declaredTotal` is every declared entry and is what `servers[]`
        // contains — nothing is removed from the UI. `measurableTotal` counts
        // only genuine language servers and is the denominator reachability must
        // use. A ratio over `declaredTotal` charges a compiler CLI, a linter CLI
        // and a bare SDK against the servers that actually speak LSP.
        declaredTotal: lspServers.length,
        measurableTotal: lspServers.filter(s => isScoreableCategory(s.category)).length,
        measurableOnline: lspServers.filter(s => isScoreableCategory(s.category) && s.status === 'ONLINE').length,
        nonLanguageServerTotal: lspServers.filter(s => !isScoreableCategory(s.category)).length,
        categoryCounts: lspCategoryCounts(lspServers),
        scoreDenominator:
          `Divide the ONLINE count of language servers by measurableTotal (${lspServers.filter(s => isScoreableCategory(s.category)).length}). ` +
          `Do NOT divide by declaredTotal (${lspServers.length}): ` +
          `${lspServers.filter(s => !isScoreableCategory(s.category)).length} of those entries are declared toolchains that are not LSP endpoints.`,
        nonLanguageServers: lspServers
          .filter(s => !isScoreableCategory(s.category))
          .map(s => ({ id: s.id, category: s.category }))
      },
      chainKey: '360ea36c28e66d9d',
      lastSync: probedAt
    };
  }

  /**
   * A9 — Discover MCP assets.
   *
   * `total` is now `discoveredServers.length`, i.e. the number of servers that
   * were ACTUALLY enumerated from a readable manifest. The previous revision
   * unioned the manifest keys with a hardcoded 7-key array, so `total` reported
   * 7 even when discovery had produced nothing at all — an asserted inventory
   * dressed as a measured one.
   *
   * When discovery fails the function returns an EMPTY list; `total` therefore
   * reports 0 and `discoveryFailed: true` is carried by the summary envelope.
   */
  private resolveMcpServers(manifest: any, discovered: boolean, probedAt: string): McpServerInfo[] {
    const mcpEntries = (discovered && manifest?.mcp) || {};

    // A9: `total` is the number of servers ACTUALLY enumerated from a readable
    // manifest. The canonical catalog (EXPECTED_MCP_KEYS) is NEVER merged in
    // here — doing so would make `total` catalog-driven again, which is the
    // defect this revision removes. Catalog gaps are reported separately and
    // honestly in `missingFromDiscovery` / `expectedCount` instead of being
    // padded into `servers[]` as phantom assets.
    const discoveredKeys = Object.keys(mcpEntries);
    const keys = discovered ? discoveredKeys : [];

    return keys.map(key => {
      const entryCfg = mcpEntries[key] || {};
      const meta = MCP_METADATA[key] || {
        label: `${key.toUpperCase()} MCP Server`,
        description: `External Model Context Protocol tool provider: ${key}`,
        defaultTools: [key]
      };

      // Platform-correct path construction (was a backslash template literal).
      const rawEntry: string = entryCfg.entry || `servers/mcp/${key}/server.js`;
      const relEntry = normalizeRelativeEntry(rawEntry);
      const fullPath = path.join(this.centerRoot, relEntry);

      const kind = statKind(fullPath);
      const verdict = classifyReachability({
        pathExists: kind.exists,
        isFile: kind.isFile,
        isExecutable: kind.exists && kind.isFile ? isExecutableFile(fullPath) : false,
        rpcHandshakePerformed: false
      });

      let tools: string[] = [];
      if (entryCfg.tools && Array.isArray(entryCfg.tools)) {
        tools = entryCfg.tools;
      } else if (entryCfg.tool) {
        tools = [entryCfg.tool];
      } else {
        tools = meta.defaultTools;
      }

      // A version absent from the manifest is reported as null, not defaulted.
      const declaredVersion = typeof entryCfg.version === 'string' ? entryCfg.version.trim() : '';

      return {
        id: key,
        name: meta.label,
        version: declaredVersion.length > 0 ? declaredVersion : 'unreported',
        type: 'mcp',
        entry: relEntry,
        fullPath,
        args: entryCfg.args || [],
        tools,
        description: meta.description,
        status: verdict.status,
        // Reachability was not verified, therefore not healthy. File presence
        // is NOT health. `existsOnDisk` carries the real, narrow fact instead.
        isHealthy: verdict.status === 'ONLINE',
        isAvailable: verdict.status === 'ONLINE',
        existsOnDisk: kind.exists,
        verdictReason: verdict.reason,
        verdictReasonText: verdict.reasonText,
        measurement: verdict.measurement,
        reachabilityVerified: false,
        probeMethod: PROBE_METHOD,
        lastProbedAt: probedAt
      };
    });
  }

  /**
   * Discover LSP assets and mark them honestly.
   *
   * The previous revision reported `status: 'READY'` and `isHealthy: true` for
   * any LSP whose `source` field merely existed in the manifest, and `READY` for
   * any LSP whose entry directory existed on disk. Both are directory-level
   * facts masquerading as language-server health. This revision reports
   * UNVERIFIABLE for every entry and states in `healthCheck` exactly what was
   * measured.
   */
  private resolveLspServers(manifest: any, discovered: boolean, probedAt: string): LspServerInfo[] {
    const lspEntries = (discovered && manifest?.lsp) || {};
    // A9, same rule as MCP: only genuinely discovered entries enter `servers[]`.
    const discoveredKeys = Object.keys(lspEntries);
    const keys = discovered ? discoveredKeys : [];

    return keys.map(key => {
      const entryCfg = lspEntries[key] || {};

      // The manifest's explicit classification. Absent or unrecognised resolves
      // to `unclassified`, which is EXCLUDED from the denominator. Direction is
      // deliberate: an unclassified entry can lower a score, never raise one.
      const category = parseLspEntryCategory(entryCfg.category);

      const meta = LSP_METADATA[key] || {
        // Never say "Language Server" about an entry whose own manifest category
        // denies it. An unclassified entry gets a label that claims nothing.
        label: category === 'language-server' ? `${key.toUpperCase()} Language Server` : `${key.toUpperCase()} (uncategorised LSP inventory entry)`,
        language: key,
        description: `Language Server Protocol service for ${key}`
      };

      // Platform-correct path construction (was a backslash template literal).
      const rawEntry: string = entryCfg.entry || `servers/lsp/${key}`;
      const relEntry = normalizeRelativeEntry(rawEntry);
      const fullPath = path.join(this.centerRoot, relEntry);

      const isSystemToolchain = typeof entryCfg.source === 'string' && entryCfg.source.trim().length > 0;
      const kind = statKind(fullPath);

      const verdict = classifyReachability({
        pathExists: kind.exists,
        isFile: kind.isFile,
        isExecutable: kind.exists && kind.isFile ? isExecutableFile(fullPath) : false,
        rpcHandshakePerformed: false
      });

      // State plainly what the previous `isHealthy` was really measuring.
      const healthCheck: LspServerInfo['healthCheck'] = isSystemToolchain
        ? 'SOURCE_DECLARED_ONLY'
        : kind.exists
          ? 'DIRECTORY_EXISTENCE_ONLY'
          : 'NOT_PROBED';

      const declaredVersion = typeof entryCfg.version === 'string' ? entryCfg.version.trim() : '';

      return {
        id: key,
        name: meta.label,
        version: declaredVersion.length > 0 ? declaredVersion : 'unreported',
        type: 'lsp',
        category,
        scoreable: isScoreableCategory(category),
        entry: relEntry,
        fullPath,
        source: entryCfg.source,
        note: entryCfg.note,
        language: meta.language,
        description: meta.description,
        status: verdict.status,
        // NEVER true here: a directory (or a `source: "npm"` string) is not a
        // healthy language server, and no LSP handshake has been performed.
        isHealthy: verdict.status === 'ONLINE',
        isAvailable: verdict.status === 'ONLINE',
        healthCheck,
        assetExistsOnDisk: kind.exists,
        verdictReason: isSystemToolchain && !kind.exists ? 'SOURCE_DECLARED_ONLY' : verdict.reason,
        verdictReasonText: isSystemToolchain && !kind.exists
          ? 'Manifest declares a `source` package manager for this language server, but nothing on this host was probed and no LSP handshake was performed. Declared provenance is not health.'
          : verdict.reasonText,
        measurement: verdict.measurement,
        reachabilityVerified: false,
        probeMethod: PROBE_METHOD,
        lastProbedAt: probedAt
      };
    });
  }
}

// Global Singleton Instance
export const globalServersCenterRegistry = new ServersCenterRegistry();