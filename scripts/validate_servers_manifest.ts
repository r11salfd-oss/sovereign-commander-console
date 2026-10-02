/**
 * ============================================================================
 * SOVEREIGN SERVERS CENTER MANIFEST VALIDATOR
 * ============================================================================
 * Chain Key ID: 360ea36c28e66d9d
 * Author role:   MANIFEST-BUILDER (data-integrity engineering)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ────────
 * `config/servers_center_manifest.json` is the CONSOLE'S DECLARED INTENT for the
 * 7 MCP servers and 6 language servers on `E:\Servers-Center`. Before this
 * validator existed that document had exactly two problems that no gate could
 * see:
 *
 *   1. It was never read by the runtime. Its only reader was a Python test, so
 *      nothing in production was ever validated against it and nothing ever
 *      failed when it drifted.
 *   2. It had never been reconciled against reality. Four of its seven MCP
 *      entries pointed at files that do not exist on the host, and ALL THIRTEEN
 *      of its declared versions were wrong (seven were the literal "1.0.0").
 *
 * This validator closes that loop. It is the machine-checked contract that makes
 * the manifest a real input instead of decorative JSON.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IT CHECKS (and what it deliberately does NOT check)
 * ────────────────────────────────────────────────────────────────────────────
 *   STRUCTURAL       parseable JSON; required keys present and correctly typed;
 *                    unique ids; `args` really is an array of strings; a launch
 *                    command that is not empty; path separator consistency; the
 *                    entry vocabulary is closed (an unknown value is a defect,
 *                    not a shrug).
 *
 *   CROSS-DOCUMENT   every MCP id declared here must exist in `opencode.json`,
 *                    and the two must agree on WHICH FILE IS LAUNCHED and on the
 *                    trailing argv. This is the real payoff: it turns two
 *                    independently-edited documents into one verified
 *                    relationship, so neither can silently drift from the other.
 *
 *   LIVE (`--live`)  whether each declared asset physically exists under the
 *                    resolved Servers Center root. OFF BY DEFAULT, because CI
 *                    runs on Linux where `E:` does not exist and an absent host
 *                    is NOT a broken document.
 *
 * IT NEVER SPAWNS A PROCESS AND NEVER PERFORMS A HANDSHAKE. Nothing here can
 * observe reachability, therefore nothing here reports ONLINE or OFFLINE. A
 * file that exists is `CHECKED_AND_PRESENT`, and that is the entire claim.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE THREE EXAMINEES THAT ARE NEVER COLLAPSED
 * ────────────────────────────────────────────────────────────────────────────
 *   CHECKED_AND_PRESENT             measured, positive
 *   CHECKED_AND_ABSENT              measured, negative
 *   NOT_CHECKED_IN_THIS_ENVIRONMENT not measured (host unavailable, or --live off)
 *
 * Reporting "absent" and "not checked" with the same token is the same class of
 * defect as reporting a missing file as "offline": it converts the absence of an
 * instrument into a measurement. They are distinct strings here and are never
 * mapped onto one another.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EXIT CODES (a CI gate reads these; do not renumber)
 * ────────────────────────────────────────────────────────────────────────────
 *   0  VALID — no structural error, no cross-document mismatch, and (if --live)
 *      was requested) every checked asset was present.
 *   1  STRUCTURAL_FAILURE — the document itself is broken. The file must not be
 *      trusted as an inventory at all.
 *   2  LIVE_CHECK_FAILED — the document is structurally sound, but a live check
 *      was requested and a declared asset was measured ABSENT. Distinct from 1
 *      on purpose: a broken document and an unavailable/host-incomplete host are
 *      different failures and must not be reported as the same one.
 *   3  CROSS_DOCUMENT_MISMATCH — the document is structurally sound but
 *      disagrees with `opencode.json`. The two inventories have drifted.
 *   4  USAGE_ERROR — bad arguments.
 * ============================================================================
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHAIN_KEY_ID = '360ea36c28e66d9d';
const VALIDATOR_NAME = 'validate_servers_manifest';

/* ===========================================================================
 * 1. CLOSED VOCABULARIES
 *
 * Every enumeration is closed on purpose. An unknown value is reported as a
 * defect rather than accepted silently, because a manifest that can hold any
 * string in a field nothing validates is exactly the decoration this program is
 * removing.
 * ===========================================================================
 */

/** How the declared entrypoint file itself is executed. */
const ENTRY_KINDS = ['js-module', 'windows-exe', 'windows-powershell', 'external-toolchain', 'directory'] as const;
type EntryKind = (typeof ENTRY_KINDS)[number];

/** Target OS of the declared launch. `any` only for host-installed toolchains. */
const PLATFORMS = ['win32', 'any'] as const;
type DeclaredPlatform = (typeof PLATFORMS)[number];

/** Where a declared version string came from. Nothing may claim UNKNOWN silently. */
const VERSION_SOURCES = [
  'EXECUTED_VERSION_FLAG',
  'PACKAGE_JSON_ON_DISK',
  'EMBEDDED_IN_SERVER_SOURCE',
  'HOST_MANIFEST_DECLARED'
] as const;
type VersionSource = (typeof VERSION_SOURCES)[number];

/** Whether a real handshake is physically possible at all, on any host. */
const HANDSHAKE_FEASIBILITIES = ['ELIGIBLE_NOT_EXECUTED', 'BLOCKED_PLATFORM', 'BLOCKED_NO_LAUNCHER'] as const;
type HandshakeFeasibility = (typeof HANDSHAKE_FEASIBILITIES)[number];

/** Whether the declared tool surface is evidenced or merely absent. */
const TOOLS_STATUSES = ['DECLARED_BY_HOST_MANIFEST', 'UNDECLARED_IN_EVIDENCE'] as const;
type ToolsStatus = (typeof TOOLS_STATUSES)[number];

/**
 * The canonical catalogue. This list is duplicated from
 * `EXPECTED_MCP_KEYS` / `EXPECTED_LSP_KEYS` in `src/services/serversCenterRegistry.ts`
 * (lines 215 / 218) because those constants are not exported. A fourth copy of
 * the catalogue is a known, accepted duplication for now; the fix is to export
 * them and import them here. See the delivery report.
 */
const EXPECTED_MCP_IDS = [
  'shell',
  'chrome-devtools',
  'github',
  'syncfusion',
  'context7',
  'playwright',
  'sovereign-commander'
] as const;
const EXPECTED_LSP_IDS = ['typescript', 'eslint', 'bash', 'yaml', 'pyright', 'dotnet'] as const;

/* ===========================================================================
 * 2. ISSUE MODEL
 * ===========================================================================
 */

type Severity = 'ERROR' | 'WARNING';
/** Which exit-code class a finding belongs to. */
type FailureClass = 'STRUCTURAL_FAILURE' | 'LIVE_CHECK_FAILED' | 'CROSS_DOCUMENT_MISMATCH';

interface Issue {
  readonly severity: Severity;
  readonly failureClass: FailureClass;
  readonly code: string;
  readonly location: string;
  readonly message: string;
}

/** Per-entry live verdict. The three states below are NEVER collapsed. */
type LiveState =
  | 'CHECKED_AND_PRESENT'
  | 'CHECKED_AND_ABSENT'
  | 'CHECKED_AND_DIRECTORY'
  | 'NOT_CHECKED_IN_THIS_ENVIRONMENT'
  | 'NOT_APPLICABLE_NO_DECLARED_ASSET'
  | 'SKIPPED_LIVE_FLAG_NOT_REQUESTED';

interface LiveFinding {
  readonly id: string;
  readonly kind: 'mcp' | 'lsp';
  readonly declaredPath: string | null;
  readonly resolvedPath: string | null;
  readonly state: LiveState;
  readonly detail: string;
}

/** How a manifest MCP entry lines up with its `opencode.json` counterpart. */
type ReconciliationState =
  | 'MATCH'
  | 'MATCH_VIA_POWERSHELL_WRAPPER'
  | 'ENTRY_MISMATCH'
  | 'ARGS_MISMATCH'
  | 'MISSING_IN_OPENCODE'
  | 'MISSING_IN_MANIFEST'
  | 'OPENCODE_SHAPE_INVALID'
  | 'OPENCODE_PATH_OUTSIDE_DECLARED_ROOT';

interface McpReconciliation {
  readonly id: string;
  readonly state: ReconciliationState;
  readonly manifestEntry: string;
  readonly manifestArgs: readonly string[];
  readonly opencodeArgv: readonly string[];
  readonly opencodeEntry: string | null;
  readonly detail: string;
}

/* ===========================================================================
 * 3. PARSED DOCUMENT SHAPES
 * ===========================================================================
 */

interface CommandBlock {
  readonly executable: string | null;
  readonly executableKind: EntryKind;
  readonly interpreter: string | null;
  readonly platform: DeclaredPlatform;
  readonly transport: string | null;
  readonly argvShape: readonly string[];
  readonly launcherCandidates: readonly string[];
  readonly nodeRuntime: string | null;
}

interface McpEntry {
  readonly id: string;
  readonly version: string;
  readonly versionSource: VersionSource;
  readonly entry: string;
  readonly args: readonly string[];
  readonly tools: readonly string[];
  readonly toolsStatus: ToolsStatus;
  readonly command: CommandBlock;
  readonly powershellWrapper: string | null;
  readonly handshakeFeasibility: HandshakeFeasibility;
  readonly handshakeBlockers: readonly string[];
}

interface LspEntry {
  readonly id: string;
  readonly version: string;
  readonly versionSource: VersionSource;
  readonly entry: string | null;
  readonly entryKind: EntryKind;
  readonly source: string;
  readonly command: CommandBlock;
  readonly handshakeFeasibility: HandshakeFeasibility;
  readonly handshakeBlockers: readonly string[];
}

interface ParsedManifest {
  readonly manifestVersion: string;
  readonly chainKeyId: string;
  readonly rootDefault: string;
  readonly rootEnvOverride: string | null;
  readonly nodeRuntime: string;
  readonly nodeVersion: string;
  readonly handshakesExecuted: number | null;
  readonly mcp: readonly McpEntry[];
  readonly lsp: readonly LspEntry[];
}

interface OpencodeMcpEntry {
  readonly command: readonly string[];
}

interface ParsedOpencode {
  readonly present: boolean;
  readonly error: string | null;
  readonly mcp: ReadonlyMap<string, OpencodeMcpEntry>;
  readonly otherIds: readonly string[];
}

/* ===========================================================================
 * 4. CLI
 * ===========================================================================
 */

interface CliOptions {
  readonly manifestPath: string;
  readonly opencodePath: string;
  readonly hostRootOverride: string | null;
  readonly live: boolean;
  readonly json: boolean;
}

const USAGE = `${VALIDATOR_NAME} — structural + cross-document validator for config/servers_center_manifest.json

Usage:
  npx tsx scripts/${VALIDATOR_NAME}.ts [options]

Options:
  --manifest <path>   Manifest to validate (default: <repo>/config/servers_center_manifest.json)
  --opencode <path>   opencode.json to reconcile against (default: <repo>/opencode.json)
  --root <dir>        Servers Center root for --live (default: SERVERS_CENTER_ROOT, then SERVERS_CENTER_PATH, then E:\\Servers-Center)
  --live              Check that each declared asset physically exists. OFF by default.
  --json              Emit the machine-readable summary instead of the human report.
  --help              Show this text.

Exit codes: 0 VALID | 1 STRUCTURAL_FAILURE | 2 LIVE_CHECK_FAILED | 3 CROSS_DOCUMENT_MISMATCH | 4 USAGE_ERROR

Chain Key ID: ${CHAIN_KEY_ID}
`;

function repoRoot(): string {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..');
  } catch {
    return process.cwd();
  }
}

function defaultHostRoot(): string {
  const primary = process.env['SERVERS_CENTER_ROOT'];
  if (primary !== undefined && primary.trim().length > 0) return primary.trim();
  const legacy = process.env['SERVERS_CENTER_PATH'];
  if (legacy !== undefined && legacy.trim().length > 0) return legacy.trim();
  return 'E:\\Servers-Center';
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const root = repoRoot();
  let manifestPath = resolve(root, 'config', 'servers_center_manifest.json');
  let opencodePath = resolve(root, 'opencode.json');
  let hostRootOverride: string | null = null;
  let live = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${String(arg)} requires a value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case '--manifest':
        manifestPath = resolve(next());
        break;
      case '--opencode':
        opencodePath = resolve(next());
        break;
      case '--root':
        hostRootOverride = resolve(next());
        break;
      case '--live':
        live = true;
        break;
      case '--json':
        json = true;
        break;
      default:
        throw new Error(`unknown argument: ${String(arg)}`);
    }
  }

  return { manifestPath, opencodePath, hostRootOverride, live, json };
}

/* ===========================================================================
 * 5. SMALL TYPED READERS
 *
 * These never throw. An unreadable or wrong-typed field is a REPORTED issue, not
 * a crash and certainly not a licence to substitute a plausible default.
 * ===========================================================================
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  return value.trim();
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] | null {
  const value = record[key];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) if (typeof item === 'string') out.push(item);
  return out;
}

function readEnum<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[]): T | null {
  const value = readString(record, key);
  if (value === null) return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Normalise to forward slashes so Windows and POSIX authors compare equal. */
function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function isAbsoluteLike(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/');
}

/** Remove `./` noise and collapse duplicate separators; never touch the case. */
function normaliseRelative(value: string): string {
  return toPosix(value)
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.')
    .join('/');
}

/** Strip a declared Servers Center root prefix from an absolute-ish path. */
export function stripRootPrefix(candidate: string, root: string): string | null {
  const normalisedCandidate = toPosix(candidate).replace(/\/+$/, '');
  const normalisedRoot = toPosix(root).replace(/\/+$/, '');
  if (normalisedCandidate.toLowerCase() === normalisedRoot.toLowerCase()) return '';
  const prefix = `${normalisedRoot}/`;
  if (normalisedCandidate.toLowerCase().startsWith(prefix.toLowerCase())) {
    return normalisedCandidate.slice(prefix.length);
  }
  return null;
}

/* ===========================================================================
 * 6. ISSUE COLLECTOR
 * ===========================================================================
 */

class IssueLog {
  private readonly items: Issue[] = [];

  public error(code: string, failureClass: FailureClass, location: string, message: string): void {
    this.items.push({ severity: 'ERROR', failureClass, code, location, message });
  }

  public warn(code: string, failureClass: FailureClass, location: string, message: string): void {
    this.items.push({ severity: 'WARNING', failureClass, code, location, message });
  }

  public all(): readonly Issue[] {
    return this.items;
  }

  public countBySeverity(severity: Severity): number {
    return this.items.filter(item => item.severity === severity).length;
  }
}

/* ===========================================================================
 * 7. MANIFEST PARSING + STRUCTURAL VALIDATION
 * ===========================================================================
 */

function parseCommandBlock(
  record: Record<string, unknown>,
  location: string,
  log: IssueLog,
  requireExecutable: boolean
): CommandBlock {
  const raw = record['command'];
  if (!isRecord(raw)) {
    log.error('COMMAND_BLOCK_MISSING', 'STRUCTURAL_FAILURE', location, 'entry has no `command` object; a launch cannot be derived without it.');
    return { executable: null, executableKind: 'js-module', interpreter: null, platform: 'win32', transport: null, argvShape: [], launcherCandidates: [], nodeRuntime: null };
  }
  const loc = `${location}.command`;

  const executableKind = readEnum(raw, 'executableKind', ENTRY_KINDS);
  if (executableKind === null) {
    log.error(
      'EXECUTABLE_KIND_INVALID',
      'STRUCTURAL_FAILURE',
      loc,
      `\`executableKind\` must be one of [${ENTRY_KINDS.join(', ')}]; a consumer cannot honestly classify an entrypoint it cannot name.`
    );
  }
  const platform = readEnum(raw, 'platform', PLATFORMS);
  if (platform === null) {
    log.error('PLATFORM_INVALID', 'STRUCTURAL_FAILURE', loc, `\`platform\` must be one of [${PLATFORMS.join(', ')}].`);
  }
  const executable = readString(raw, 'executable');
  if (requireExecutable && (executable === null || executable.length === 0)) {
    log.error('LAUNCH_COMMAND_EMPTY', 'STRUCTURAL_FAILURE', loc, 'launch command is empty: `executable` is missing or blank.');
  }
  const interpreter = readString(raw, 'interpreter');
  if (executableKind === 'js-module' && (interpreter === null || interpreter.length === 0)) {
    log.error(
      'JS_MODULE_WITHOUT_INTERPRETER',
      'STRUCTURAL_FAILURE',
      loc,
      '`executableKind` is `js-module` but no `interpreter` is declared, so argv[0] is undeterminable.'
    );
  }

  return {
    executable,
    executableKind: executableKind ?? 'js-module',
    interpreter,
    platform: platform ?? 'win32',
    transport: readString(raw, 'transport'),
    argvShape: readStringArray(raw, 'argvShape') ?? [],
    launcherCandidates: readStringArray(raw, 'launcherCandidates') ?? [],
    nodeRuntime: readString(raw, 'nodeRuntime')
  };
}

function readArgs(
  record: Record<string, unknown>,
  location: string,
  log: IssueLog,
  fallback: readonly string[]
): readonly string[] {
  if (!Object.prototype.hasOwnProperty.call(record, 'args')) return fallback;
  const value = record['args'];
  if (!Array.isArray(value)) {
    log.error(
      'ARGS_NOT_ARRAY',
      'STRUCTURAL_FAILURE',
      `${location}.args`,
      '`args` must be an array of strings; a bare string is ambiguous under shell-style parsing and is refused.'
    );
    return [];
  }
  const bad = value.filter((item): boolean => typeof item !== 'string');
  if (bad.length > 0) {
    log.error(
      'ARGS_NOT_STRINGS',
      'STRUCTURAL_FAILURE',
      `${location}.args`,
      `\`args\` contains ${bad.length} non-string element(s); every argv element must be a string.`
    );
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function parseMcpSection(section: Record<string, unknown>, log: IssueLog): readonly McpEntry[] {
  const out: McpEntry[] = [];
  for (const [id, value] of Object.entries(section)) {
    const location = `mcp.${id}`;
    if (!isRecord(value)) {
      log.error('ENTRY_NOT_OBJECT', 'STRUCTURAL_FAILURE', location, 'entry must be an object.');
      continue;
    }

    const version = readString(value, 'version');
    if (version === null || version.length === 0) {
      log.error('VERSION_MISSING', 'STRUCTURAL_FAILURE', `${location}.version`, '`version` is missing or blank; declare a version or an explicit unknown marker.');
    }
    const versionSource = readEnum(value, 'version_source', VERSION_SOURCES);
    if (versionSource === null) {
      log.error(
        'VERSION_SOURCE_INVALID',
        'STRUCTURAL_FAILURE',
        `${location}.version_source`,
        `\`version_source\` must be one of [${VERSION_SOURCES.join(', ')}] so a reader knows whether the version was measured or merely declared.`
      );
    }
    const entry = readString(value, 'entry');
    if (entry === null || entry.length === 0) {
      log.error('ENTRY_MISSING', 'STRUCTURAL_FAILURE', `${location}.entry`, '`entry` is missing or blank; an inventory with no path is not an inventory.');
      continue;
    }
    const args = readArgs(value, location, log, []);
    const toolsStatus = readEnum(value, 'tools_status', TOOLS_STATUSES);
    if (toolsStatus === null) {
      log.error(
        'TOOLS_STATUS_INVALID',
        'STRUCTURAL_FAILURE',
        `${location}.tools_status`,
        `\`tools_status\` must be one of [${TOOLS_STATUSES.join(', ')}]. Absent tool evidence must be stated, not left blank.`
      );
    }
    const tools = readStringArray(value, 'tools') ?? [];
    const handshakeFeasibility = readEnum(value, 'handshakeFeasibility', HANDSHAKE_FEASIBILITIES);
    if (handshakeFeasibility === null) {
      log.error(
        'HANDSHAKE_FEASIBILITY_INVALID',
        'STRUCTURAL_FAILURE',
        `${location}.handshakeFeasibility`,
        `\`handshakeFeasibility\` must be one of [${HANDSHAKE_FEASIBILITIES.join(', ')}].`
      );
    }
    const handshakeBlockers = readStringArray(value, 'handshakeBlockers') ?? [];
    const command = parseCommandBlock(value, location, log, true);
    const wrapper = isRecord(value['command']) ? readString(value['command'], 'powershellWrapper') : null;

    out.push({
      id,
      version: version ?? '',
      versionSource: versionSource ?? 'HOST_MANIFEST_DECLARED',
      entry,
      args,
      tools,
      toolsStatus: toolsStatus ?? 'UNDECLARED_IN_EVIDENCE',
      command,
      powershellWrapper: wrapper,
      handshakeFeasibility: handshakeFeasibility ?? 'BLOCKED_NO_LAUNCHER',
      handshakeBlockers
    });
  }
  return out;
}

function parseLspSection(section: Record<string, unknown>, log: IssueLog): readonly LspEntry[] {
  const out: LspEntry[] = [];
  for (const [id, value] of Object.entries(section)) {
    const location = `lsp.${id}`;
    if (!isRecord(value)) {
      log.error('ENTRY_NOT_OBJECT', 'STRUCTURAL_FAILURE', location, 'entry must be an object.');
      continue;
    }
    const version = readString(value, 'version');
    if (version === null || version.length === 0) {
      log.error('VERSION_MISSING', 'STRUCTURAL_FAILURE', `${location}.version`, '`version` is missing or blank.');
    }
    const versionSource = readEnum(value, 'version_source', VERSION_SOURCES);
    if (versionSource === null) {
      log.error(
        'VERSION_SOURCE_INVALID',
        'STRUCTURAL_FAILURE',
        `${location}.version_source`,
        `\`version_source\` must be one of [${VERSION_SOURCES.join(', ')}].`
      );
    }
    const entry = readString(value, 'entry');
    const entryKind = readEnum(value, 'entryKind', ENTRY_KINDS);
    if (entryKind === null) {
      log.error('ENTRY_KIND_INVALID', 'STRUCTURAL_FAILURE', `${location}.entryKind`, `\`entryKind\` must be one of [${ENTRY_KINDS.join(', ')}].`);
    }
    if (entry !== null && entryKind === 'external-toolchain') {
      log.warn(
        'TOOLCHAIN_WITH_ENTRY',
        'CROSS_DOCUMENT_MISMATCH',
        `${location}.entry`,
        'an `external-toolchain` entry declares an `entry`; an external toolchain is by definition not a Servers Center asset.'
      );
    }
    const source = readString(value, 'source');
    if (source === null || source.length === 0) {
      log.error('SOURCE_MISSING', 'STRUCTURAL_FAILURE', `${location}.source`, '`source` is missing or blank.');
    }
    const handshakeFeasibility = readEnum(value, 'handshakeFeasibility', HANDSHAKE_FEASIBILITIES);
    if (handshakeFeasibility === null) {
      log.error(
        'HANDSHAKE_FEASIBILITY_INVALID',
        'STRUCTURAL_FAILURE',
        `${location}.handshakeFeasibility`,
        `\`handshakeFeasibility\` must be one of [${HANDSHAKE_FEASIBILITIES.join(', ')}].`
      );
    }
    // LSP entries have no top-level `args`: the argv of a language server is
    // [launcher, ...command.args] and the launcher is resolved at probe time.
    const command = parseCommandBlock(value, location, log, entryKind !== 'external-toolchain');

    out.push({
      id,
      version: version ?? '',
      versionSource: versionSource ?? 'HOST_MANIFEST_DECLARED',
      entry,
      entryKind: entryKind ?? 'directory',
      source: source ?? '',
      command,
      handshakeFeasibility: handshakeFeasibility ?? 'BLOCKED_NO_LAUNCHER',
      handshakeBlockers: readStringArray(value, 'handshakeBlockers') ?? []
    });
  }
  return out;
}

/** Report mixed separators. Uniform backslashes are a WARNING, not an error. */
function checkSeparatorConsistency(paths: readonly { readonly id: string; readonly location: string; readonly value: string }[], log: IssueLog): void {
  const forward = paths.filter(item => !item.value.includes('\\'));
  const back = paths.filter(item => item.value.includes('\\'));
  if (forward.length === 0 && back.length === 0) return;
  if (forward.length > 0 && back.length > 0) {
    log.error(
      'SEPARATORS_MIXED',
      'STRUCTURAL_FAILURE',
      'mcp/lsp .entry',
      `relative paths mix separators: ${forward.length} forward-slash and ${back.length} backslash entries. Pick one convention so a diff shows real changes only.`
    );
    return;
  }
  if (back.length > 0) {
    log.warn(
      'SEPARATORS_BACKSLASH',
      'CROSS_DOCUMENT_MISMATCH',
      'mcp/lsp .entry',
      `all ${back.length} relative paths use Windows backslashes; normalizeRelativeEntry() accepts this, but forward slashes are the portable convention used here.`
    );
  }
}

/**
 * Report every key that appears MORE THAN ONCE as a DIRECT child of a named
 * top-level section, reading the RAW TEXT rather than the parsed value.
 *
 * A regular expression is not sufficient here: a naive `"mcp"\s*:\s*\{([^}]*)\}`
 * stops at the first `}`, which is inside the first entry's nested `command`
 * object, and would then report duplicate NESTED field names (`version`,
 * `args`, ...) as duplicate ids. This scanner therefore tracks brace depth and
 * only ever considers a key that sits at depth 0 inside the section body, which
 * is exactly where an id lives.
 */
export function findDuplicateKeys(raw: string, sectionName: string): readonly string[] {
  const openMatch = new RegExp(`"${sectionName}"\\s*:\\s*\\{`).exec(raw);
  if (openMatch === null) return [];
  const openIndex = raw.indexOf('{', openMatch.index);
  if (openIndex === -1) return [];

  // Locate the matching close brace for the section body.
  let sectionDepth = 0;
  let inString = false;
  let escaped = false;
  let closeIndex = raw.length;
  for (let index = openIndex; index < raw.length; index += 1) {
    const ch = raw[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') sectionDepth += 1;
    else if (ch === '}') {
      sectionDepth -= 1;
      if (sectionDepth === 0) {
        closeIndex = index;
        break;
      }
    }
  }

  const body = raw.slice(openIndex + 1, closeIndex);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let depth = 0;
  let inBodyString = false;
  let bodyEscaped = false;
  let expectKey = true;

  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index] ?? '';

    if (bodyEscaped) {
      bodyEscaped = false;
      continue;
    }
    if (ch === '\\' && inBodyString) {
      bodyEscaped = true;
      continue;
    }
    if (ch === '"') {
      if (!inBodyString && depth === 0 && expectKey) {
        let value = '';
        for (let cursor = index + 1; cursor < body.length; cursor += 1) {
          const inner = body[cursor] ?? '';
          if (inner === '"') break;
          if (inner === '\\') {
            value += body[cursor + 1] ?? '';
            cursor += 1;
            continue;
          }
          value += inner;
        }
        if (seen.has(value)) duplicates.push(value);
        seen.add(value);
        expectKey = false;
      }
      inBodyString = !inBodyString;
      continue;
    }
    if (inBodyString) continue;
    if (ch === '{' || ch === '[') {
      depth += 1;
      if (depth === 1) expectKey = true;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) expectKey = true;
      continue;
    }
    if (depth === 0 && ch === ',') expectKey = true;
  }

  return duplicates;
}

export function parseManifest(absolutePath: string, log: IssueLog): ParsedManifest | null {
  if (!existsSync(absolutePath)) {
    log.error('MANIFEST_ABSENT', 'STRUCTURAL_FAILURE', absolutePath, 'manifest file does not exist at the given path.');
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(absolutePath, 'utf8');
  } catch (err) {
    log.error('MANIFEST_UNREADABLE', 'STRUCTURAL_FAILURE', absolutePath, `cannot read manifest: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    log.error('MANIFEST_MALFORMED_JSON', 'STRUCTURAL_FAILURE', absolutePath, `malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!isRecord(parsed)) {
    log.error('MANIFEST_ROOT_NOT_OBJECT', 'STRUCTURAL_FAILURE', absolutePath, 'manifest root is not a JSON object.');
    return null;
  }

  const manifestVersion = readString(parsed, 'manifest_version');
  if (manifestVersion === null) log.error('MANIFEST_VERSION_MISSING', 'STRUCTURAL_FAILURE', 'manifest_version', '`manifest_version` is missing.');
  const chainKeyId = readString(parsed, 'chain_key_id');
  if (chainKeyId !== null && chainKeyId !== CHAIN_KEY_ID) {
    log.error('CHAIN_KEY_MISMATCH', 'STRUCTURAL_FAILURE', 'chain_key_id', `expected ${CHAIN_KEY_ID}, found ${chainKeyId}.`);
  } else if (chainKeyId === null) {
    log.error('CHAIN_KEY_MISSING', 'STRUCTURAL_FAILURE', 'chain_key_id', '`chain_key_id` is missing.');
  }

  const rootRecord = isRecord(parsed['root']) ? (parsed['root'] as Record<string, unknown>) : {};
  const rootDefault = readString(rootRecord, 'default');
  if (rootDefault === null) log.error('ROOT_DEFAULT_MISSING', 'STRUCTURAL_FAILURE', 'root.default', '`root.default` is missing; entry paths cannot be resolved.');

  const runtime = isRecord(parsed['runtime']) ? (parsed['runtime'] as Record<string, unknown>) : {};
  const nodeRuntime = readString(runtime, 'node');
  if (nodeRuntime === null) {
    log.error(
      'RUNTIME_NODE_MISSING',
      'STRUCTURAL_FAILURE',
      'runtime.node',
      '`runtime.node` is missing; scripts/host_prober.ts reads this key and would otherwise have to guess a runtime.'
    );
  }
  const nodeVersion = readString(runtime, 'node_version');
  if (nodeVersion === null) log.error('RUNTIME_NODE_VERSION_MISSING', 'STRUCTURAL_FAILURE', 'runtime.node_version', '`runtime.node_version` is missing.');

  const provenance = isRecord(parsed['provenance']) ? (parsed['provenance'] as Record<string, unknown>) : {};
  const handshakesExecutedRaw = provenance['handshakesExecuted'];
  const handshakesExecuted = typeof handshakesExecutedRaw === 'number' ? handshakesExecutedRaw : null;
  if (handshakesExecuted === null) {
    log.error(
      'PROVENANCE_MISSING',
      'STRUCTURAL_FAILURE',
      'provenance.handshakesExecuted',
      '`provenance.handshakesExecuted` is missing; a reader must be able to see that no handshake backed this inventory.'
    );
  }
  for (const entry of Object.values(parsed)) {
    if (!isRecord(entry)) continue;
    for (const forbidden of ['reachability', 'status', 'online', 'offline', 'isHealthy', 'health']) {
      if (Object.prototype.hasOwnProperty.call(entry, forbidden)) {
        log.error(
          'REACHABILITY_CLAIM_IN_INVENTORY',
          'STRUCTURAL_FAILURE',
          forbidden,
          `entry declares \`${forbidden}\`. An inventory must not carry a reachability verdict; that is measured by a prober, never declared here.`
        );
      }
    }
  }

  const mcpSection = isRecord(parsed['mcp']) ? (parsed['mcp'] as Record<string, unknown>) : {};
  const lspSection = isRecord(parsed['lsp']) ? (parsed['lsp'] as Record<string, unknown>) : {};
  if (!isRecord(parsed['mcp'])) log.error('MCP_SECTION_MISSING', 'STRUCTURAL_FAILURE', 'mcp', '`mcp` section is missing or is not an object.');
  if (!isRecord(parsed['lsp'])) log.error('LSP_SECTION_MISSING', 'STRUCTURAL_FAILURE', 'lsp', '`lsp` section is missing or is not an object.');

  const mcp = parseMcpSection(mcpSection, log);
  const lsp = parseLspSection(lspSection, log);

  // Duplicate ids: JSON.parse silently keeps the LAST duplicate key, so this
  // can only be detected by re-reading the raw text. Losing an entry that way is
  // exactly the kind of silent data loss this validator exists to catch.
  for (const section of ['mcp', 'lsp'] as const) {
    for (const key of findDuplicateKeys(raw, section)) {
      log.error(
        'DUPLICATE_ID',
        'STRUCTURAL_FAILURE',
        `${section}.${key}`,
        `duplicate key "${key}" inside the ${section} section; JSON.parse keeps only the last occurrence, so the earlier entry is silently discarded.`
      );
    }
  }

  const seenMcp = new Set<string>();
  for (const entry of mcp) {
    if (seenMcp.has(entry.id)) log.error('DUPLICATE_ID', 'STRUCTURAL_FAILURE', `mcp.${entry.id}`, 'duplicate id.');
    seenMcp.add(entry.id);
    if (!(EXPECTED_MCP_IDS as readonly string[]).includes(entry.id)) {
      log.error(
        'MCP_ID_NOT_IN_CATALOGUE',
        'CROSS_DOCUMENT_MISMATCH',
        `mcp.${entry.id}`,
        `id is not in the canonical catalogue (EXPECTED_MCP_KEYS in src/services/serversCenterRegistry.ts); it would be discovered but never expected.`
      );
    }
  }
  for (const id of EXPECTED_MCP_IDS) {
    if (!seenMcp.has(id)) log.error('MCP_ID_MISSING', 'CROSS_DOCUMENT_MISMATCH', `mcp.${id}`, 'canonical MCP id is absent from the manifest.');
  }
  const seenLsp = new Set<string>();
  for (const entry of lsp) {
    if (seenLsp.has(entry.id)) log.error('DUPLICATE_ID', 'STRUCTURAL_FAILURE', `lsp.${entry.id}`, 'duplicate id.');
    seenLsp.add(entry.id);
    if (!(EXPECTED_LSP_IDS as readonly string[]).includes(entry.id)) {
      log.error('LSP_ID_NOT_IN_CATALOGUE', 'CROSS_DOCUMENT_MISMATCH', `lsp.${entry.id}`, 'id is not in the canonical catalogue (EXPECTED_LSP_KEYS in src/services/serversCenterRegistry.ts).');
    }
  }
  for (const id of EXPECTED_LSP_IDS) {
    if (!seenLsp.has(id)) log.error('LSP_ID_MISSING', 'CROSS_DOCUMENT_MISMATCH', `lsp.${id}`, 'canonical LSP id is absent from the manifest.');
  }

  const paths: { id: string; location: string; value: string }[] = [];
  for (const entry of mcp) paths.push({ id: entry.id, location: `mcp.${entry.id}.entry`, value: entry.entry });
  for (const entry of lsp) if (entry.entry !== null) paths.push({ id: entry.id, location: `lsp.${entry.id}.entry`, value: entry.entry });
  checkSeparatorConsistency(paths, log);

  return {
    manifestVersion: manifestVersion ?? '',
    chainKeyId: chainKeyId ?? '',
    rootDefault: rootDefault ?? '',
    rootEnvOverride: readString(rootRecord, 'env_override'),
    nodeRuntime: nodeRuntime ?? '',
    nodeVersion: nodeVersion ?? '',
    handshakesExecuted,
    mcp,
    lsp
  };
}

/* ===========================================================================
 * 8. CROSS-DOCUMENT RECONCILIATION (manifest <-> opencode.json)
 * ===========================================================================
 */

export function readOpencode(absolutePath: string, log: IssueLog): ParsedOpencode {
  if (!existsSync(absolutePath)) {
    log.warn(
      'OPENCODE_ABSENT',
      'CROSS_DOCUMENT_MISMATCH',
      absolutePath,
      'opencode.json not found; cross-document reconciliation was NOT PERFORMED (this is "not checked", not "checked and clean").'
    );
    return { present: false, error: 'file not found', mcp: new Map(), otherIds: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (err) {
    log.error('OPENCODE_MALFORMED_JSON', 'CROSS_DOCUMENT_MISMATCH', absolutePath, `opencode.json is malformed: ${err instanceof Error ? err.message : String(err)}`);
    return { present: false, error: 'malformed JSON', mcp: new Map(), otherIds: [] };
  }
  if (!isRecord(parsed)) {
    log.error('OPENCODE_ROOT_NOT_OBJECT', 'CROSS_DOCUMENT_MISMATCH', absolutePath, 'opencode.json root is not an object.');
    return { present: false, error: 'root not an object', mcp: new Map(), otherIds: [] };
  }
  const section = parsed['mcp'];
  if (!isRecord(section)) {
    log.error('OPENCODE_MCP_SECTION_MISSING', 'CROSS_DOCUMENT_MISMATCH', 'opencode.json#mcp', 'opencode.json has no `mcp` object; nothing to reconcile against.');
    return { present: false, error: 'no mcp section', mcp: new Map(), otherIds: [] };
  }
  const mcp = new Map<string, OpencodeMcpEntry>();
  for (const [id, value] of Object.entries(section)) {
    if (!isRecord(value)) continue;
    const command = value['command'];
    mcp.set(id, { command: Array.isArray(command) ? command.filter((item): item is string => typeof item === 'string') : [] });
  }
  return { present: true, error: null, mcp, otherIds: [...mcp.keys()] };
}

/**
 * Reduce an `opencode.json` argv to (relativeEntry, trailingArgs).
 *
 * Three shapes occur and each is recognised, not guessed:
 *   A) [node.exe, <script>, ...args]              -> js-module
 *   B) [<native .exe>, ...args]                   -> windows-exe
 *   C) [powershell, -NoProfile, -ExecutionPolicy, Bypass, -File, <script>, ...args]
 *
 * Returns null when the shape is not one of the three; the caller then reports
 * OPENCODE_SHAPE_INVALID instead of inventing a comparison.
 */
function reduceOpencodeArgv(argv: readonly string[], declaredRoot: string): { entry: string; args: readonly string[] } | null {
  if (argv.length === 0) return null;
  const first = argv[0] ?? '';

  if (/^powershell(\.exe)?$/i.test(first)) {
    const fileIndex = argv.findIndex((item, index) => index > 0 && item.toLowerCase() === '-file');
    if (fileIndex === -1 || fileIndex + 1 >= argv.length) return null;
    const script = argv[fileIndex + 1] ?? '';
    const stripped = stripRootPrefix(script, declaredRoot);
    if (stripped === null) return null;
    return { entry: normaliseRelative(stripped), args: argv.slice(fileIndex + 2) };
  }

  // Shape A: [<interpreter>, <script.js>, ...args].
  // The interpreter is normally node.exe, so it must be recognised by "argv[1] is
  // a JavaScript file" rather than by its own extension — an .exe interpreter
  // would otherwise be misread as shape B and reported as the entrypoint.
  const second = argv[1];
  if (isAbsoluteLike(first) && second !== undefined && /\.(js|mjs|cjs)$/i.test(second)) {
    const stripped = stripRootPrefix(second, declaredRoot);
    if (stripped === null) return null;
    return { entry: normaliseRelative(stripped), args: argv.slice(2) };
  }

  // Shape B: [<native executable>, ...args].
  if (isAbsoluteLike(first) && /\.(exe|cmd|bat)$/i.test(first)) {
    const stripped = stripRootPrefix(first, declaredRoot);
    if (stripped === null) return null;
    return { entry: normaliseRelative(stripped), args: argv.slice(1) };
  }

  return null;
}

function argvEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item.toLowerCase() === (b[index] ?? '').toLowerCase());
}

export function reconcile(
  manifest: ParsedManifest,
  opencode: ParsedOpencode,
  log: IssueLog
): readonly McpReconciliation[] {
  const rows: McpReconciliation[] = [];
  const declaredRoot = manifest.rootDefault;

  for (const entry of manifest.mcp) {
    const counterpart = opencode.mcp.get(entry.id);
    if (counterpart === undefined) {
      log.error(
        'MCP_MISSING_IN_OPENCODE',
        'CROSS_DOCUMENT_MISMATCH',
        `mcp.${entry.id}`,
        'declared here but absent from opencode.json#mcp; the two inventories disagree about what exists.'
      );
      rows.push({
        id: entry.id,
        state: 'MISSING_IN_OPENCODE',
        manifestEntry: entry.entry,
        manifestArgs: entry.args,
        opencodeArgv: [],
        opencodeEntry: null,
        detail: 'no opencode.json#mcp entry with this id'
      });
      continue;
    }

    const argv = counterpart.command;
    if (argv.length === 0) {
      log.error(
        'OPENCODE_COMMAND_EMPTY',
        'CROSS_DOCUMENT_MISMATCH',
        `opencode.json#mcp.${entry.id}.command`,
        'opencode.json declares an empty command array; nothing is actually launched.'
      );
      rows.push({
        id: entry.id,
        state: 'OPENCODE_SHAPE_INVALID',
        manifestEntry: entry.entry,
        manifestArgs: entry.args,
        opencodeArgv: argv,
        opencodeEntry: null,
        detail: 'empty command array'
      });
      continue;
    }

    const reduced = reduceOpencodeArgv(argv, declaredRoot);
    if (reduced === null) {
      log.error(
        'OPENCODE_SHAPE_INVALID',
        'CROSS_DOCUMENT_MISMATCH',
        `opencode.json#mcp.${entry.id}.command`,
        `argv shape is not recognised (neither node+script, native executable, nor powershell -File): ${JSON.stringify(argv)}`
      );
      rows.push({
        id: entry.id,
        state: 'OPENCODE_SHAPE_INVALID',
        manifestEntry: entry.entry,
        manifestArgs: entry.args,
        opencodeArgv: argv,
        opencodeEntry: null,
        detail: 'argv shape not recognised'
      });
      continue;
    }

    const manifestEntry = normaliseRelative(entry.entry);
    const wrapper = entry.powershellWrapper === null ? null : normaliseRelative(entry.powershellWrapper);
    const isViaWrapper = wrapper !== null && reduced.entry.toLowerCase() === wrapper.toLowerCase();

    if (isViaWrapper) {
      // The wrapper is a different FILE that forwards to the declared entry. The
      // launch is equivalent, so this is agreement — but the argv tail belongs to
      // the wrapper, not to `args`, so it is explicitly NOT compared.
      rows.push({
        id: entry.id,
        state: 'MATCH_VIA_POWERSHELL_WRAPPER',
        manifestEntry: entry.entry,
        manifestArgs: entry.args,
        opencodeArgv: argv,
        opencodeEntry: reduced.entry,
        detail: `opencode.json launches the wrapper ${reduced.entry}; that wrapper forwards to the declared native entry. args were NOT compared because the wrapper supplies them.`
      });
      continue;
    }

    if (manifestEntry.toLowerCase() !== reduced.entry.toLowerCase()) {
      log.error(
        'ENTRY_MISMATCH',
        'CROSS_DOCUMENT_MISMATCH',
        `mcp.${entry.id}`,
        `manifest entry "${entry.entry}" but opencode.json launches "${reduced.entry}". One of the two documents is describing a file that is not the one actually launched.`
      );
      rows.push({
        id: entry.id,
        state: 'ENTRY_MISMATCH',
        manifestEntry: entry.entry,
        manifestArgs: entry.args,
        opencodeArgv: argv,
        opencodeEntry: reduced.entry,
        detail: `manifest=${entry.entry} opencode=${reduced.entry}`
      });
      continue;
    }

    if (!argvEquals(reduced.args, entry.args)) {
      log.error(
        'ARGS_MISMATCH',
        'CROSS_DOCUMENT_MISMATCH',
        `mcp.${entry.id}.args`,
        `trailing argv disagrees: manifest=[${entry.args.join(' ')}] opencode=[${reduced.args.join(' ')}]`
      );
      rows.push({
        id: entry.id,
        state: 'ARGS_MISMATCH',
        manifestEntry: entry.entry,
        manifestArgs: entry.args,
        opencodeArgv: argv,
        opencodeEntry: reduced.entry,
        detail: `manifest args=[${entry.args.join(' ')}] opencode args=[${reduced.args.join(' ')}]`
      });
      continue;
    }

    rows.push({
      id: entry.id,
      state: 'MATCH',
      manifestEntry: entry.entry,
      manifestArgs: entry.args,
      opencodeArgv: argv,
      opencodeEntry: reduced.entry,
      detail: 'entry and trailing argv agree with opencode.json'
    });
  }

  // The reverse direction: an opencode.json server this manifest never declares.
  const declaredIds = new Set(manifest.mcp.map(entry => entry.id));
  for (const id of opencode.otherIds) {
    if (declaredIds.has(id)) continue;
    log.error(
      'MCP_MISSING_IN_MANIFEST',
      'CROSS_DOCUMENT_MISMATCH',
      `opencode.json#mcp.${id}`,
      'opencode.json launches this server but the manifest does not declare it; the inventory is incomplete.'
    );
    rows.push({
      id,
      state: 'MISSING_IN_MANIFEST',
      manifestEntry: '',
      manifestArgs: [],
      opencodeArgv: opencode.mcp.get(id)?.command ?? [],
      opencodeEntry: null,
      detail: 'launched by opencode.json, absent from the manifest'
    });
  }

  return rows;
}

/* ===========================================================================
 * 9. LIVE PRESENCE CHECK
 *
 * This is the only measurement this validator performs, and it is presence only.
 * It spawns nothing and therefore cannot observe reachability.
 * ===========================================================================
 */

function probePath(absolute: string): { state: LiveState; detail: string } {
  try {
    const stat = statSync(absolute);
    if (stat.isDirectory()) return { state: 'CHECKED_AND_DIRECTORY', detail: 'exists and is a directory (an LSP package root, not a server process)' };
    return { state: 'CHECKED_AND_PRESENT', detail: `exists (${stat.size} bytes)` };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    if (code === 'ENOENT') return { state: 'CHECKED_AND_ABSENT', detail: 'measured: no such file or directory' };
    return { state: 'CHECKED_AND_ABSENT', detail: `measured: not readable (${code})` };
  }
}

export function liveCheck(manifest: ParsedManifest, root: string, requested: boolean): readonly LiveFinding[] {
  const findings: LiveFinding[] = [];
  const rootAvailable = existsSync(root);

  /** Resolve a root-relative declared path, or explain why it was not resolved. */
  const measure = (id: string, kind: 'mcp' | 'lsp', relative: string): LiveFinding => {
    if (!requested) {
      return { id, kind, declaredPath: relative, resolvedPath: null, state: 'SKIPPED_LIVE_FLAG_NOT_REQUESTED', detail: '--live not passed; presence was not measured' };
    }
    if (!rootAvailable) {
      return { id, kind, declaredPath: relative, resolvedPath: null, state: 'NOT_CHECKED_IN_THIS_ENVIRONMENT', detail: `Servers Center root ${root} is not present on this host; presence could not be measured` };
    }
    const absolute = resolve(root, ...normaliseRelative(relative).split('/'));
    const probe = probePath(absolute);
    return { id, kind, declaredPath: relative, resolvedPath: absolute, state: probe.state, detail: probe.detail };
  };

  for (const entry of manifest.mcp) {
    findings.push(measure(entry.id, 'mcp', normaliseRelative(entry.entry)));
  }

  for (const entry of manifest.lsp) {
    if (entry.entry === null) {
      findings.push({
        id: entry.id,
        kind: 'lsp',
        declaredPath: null,
        resolvedPath: null,
        state: 'NOT_APPLICABLE_NO_DECLARED_ASSET',
        detail: `${entry.entryKind}: resolved from the host toolchain (${entry.source}); there is no Servers Center path to measure`
      });
      continue;
    }
    findings.push(measure(entry.id, 'lsp', normaliseRelative(entry.entry)));
  }

  // The declared Node runtime is itself a declared asset and must be measured too.
  if (manifest.nodeRuntime.length > 0) {
    findings.push(measure('runtime.node', 'mcp', normaliseRelative(manifest.nodeRuntime)));
  }

  return findings;
}

/* ===========================================================================
 * 10. REPORTING
 * ===========================================================================
 */

const STATE_GLYPH: Readonly<Record<LiveState, string>> = {
  CHECKED_AND_PRESENT: 'PRESENT   ',
  CHECKED_AND_ABSENT: 'ABSENT    ',
  CHECKED_AND_DIRECTORY: 'DIRECTORY ',
  NOT_CHECKED_IN_THIS_ENVIRONMENT: 'NOT-CHECKED (host unavailable)',
  NOT_APPLICABLE_NO_DECLARED_ASSET: 'N/A (external toolchain)',
  SKIPPED_LIVE_FLAG_NOT_REQUESTED: 'NOT-CHECKED (--live not passed)'
};

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export function renderTextReport(
  manifestPath: string,
  opencodePath: string,
  root: string,
  manifest: ParsedManifest | null,
  rows: readonly McpReconciliation[],
  live: readonly LiveFinding[],
  issues: readonly Issue[],
  liveRootAvailable: boolean
): string {
  const lines: string[] = [];
  const rule = '='.repeat(96);
  lines.push(rule);
  lines.push(` SOVEREIGN SERVERS CENTER MANIFEST VALIDATOR — ${VALIDATOR_NAME}`);
  lines.push(` Chain Key ID: ${CHAIN_KEY_ID}   |   node ${process.version}   |   platform ${process.platform}-${process.arch}`);
  lines.push(` manifest : ${manifestPath}`);
  lines.push(` opencode : ${opencodePath}`);
  lines.push(` root     : ${root}${liveRootAvailable ? '' : '   (NOT PRESENT ON THIS HOST)'}`);
  lines.push(` measured : FILE PRESENCE ONLY. No process was spawned and no MCP/LSP handshake was attempted.`);
  lines.push(rule);

  if (manifest !== null) {
    lines.push('');
    lines.push(' INVENTORY');
    lines.push(`   manifest_version ${manifest.manifestVersion}   chain_key ${manifest.chainKeyId}   node ${manifest.nodeVersion} (${manifest.nodeRuntime})`);
    lines.push(`   handshakes executed while authoring this manifest: ${manifest.handshakesExecuted}`);
    lines.push(`   MCP declared: ${manifest.mcp.length}   LSP declared: ${manifest.lsp.length}`);
    lines.push('');
    lines.push(`   ${pad('KIND', 5)}${pad('ID', 22)}${pad('VERSION', 11)}${pad('KIND-OF-ENTRY', 20)}${pad('HANDSHAKE', 24)}ENTRY`);
    for (const entry of manifest.mcp) {
      lines.push(`   ${pad('mcp', 5)}${pad(entry.id, 22)}${pad(entry.version, 11)}${pad(entry.command.executableKind, 20)}${pad(entry.handshakeFeasibility, 24)}${entry.entry}`);
    }
    for (const entry of manifest.lsp) {
      lines.push(`   ${pad('lsp', 5)}${pad(entry.id, 22)}${pad(entry.version, 11)}${pad(entry.entryKind, 20)}${pad(entry.handshakeFeasibility, 24)}${entry.entry ?? '(none — external toolchain)'}`);
    }
  }

  lines.push('');
  lines.push(' CROSS-DOCUMENT RECONCILIATION — config/servers_center_manifest.json  <->  opencode.json');
  if (rows.length === 0) {
    lines.push('   NOT PERFORMED — the manifest could not be parsed, so there was nothing to reconcile.');
  } else {
    for (const row of rows) {
      const mark = row.state === 'MATCH' || row.state === 'MATCH_VIA_POWERSHELL_WRAPPER' ? '[OK]  ' : '[DRIFT]';
      lines.push(`   ${mark} ${pad(row.id, 22)}${pad(row.state, 32)}${row.detail}`);
    }
  }

  lines.push('');
  lines.push(' LIVE PRESENCE CHECK');
  lines.push('   CHECKED_AND_PRESENT / CHECKED_AND_ABSENT / CHECKED_AND_DIRECTORY are MEASURED.');
  lines.push('   NOT_CHECKED_IN_THIS_ENVIRONMENT and SKIPPED_LIVE_FLAG_NOT_REQUESTED are NOT MEASURED and are never merged with the above.');
  for (const finding of live) {
    lines.push(`   ${pad(STATE_GLYPH[finding.state], 34)}${pad(`${finding.kind}:${finding.id}`, 26)}${finding.declaredPath ?? '(none)'}`);
    if (finding.detail.length > 0) lines.push(`   ${' '.repeat(34)}${finding.detail}`);
  }

  lines.push('');
  lines.push(' ISSUES');
  if (issues.length === 0) {
    lines.push('   none.');
  } else {
    for (const issue of issues) {
      lines.push(`   [${issue.severity}] ${pad(issue.failureClass, 24)}${pad(issue.code, 34)}${issue.location}`);
      lines.push(`   ${' '.repeat(9)}${issue.message}`);
    }
  }

  const errors = issues.filter(issue => issue.severity === 'ERROR').length;
  const warnings = issues.filter(issue => issue.severity === 'WARNING').length;
  const absent = live.filter(finding => finding.state === 'CHECKED_AND_ABSENT').length;
  lines.push('');
  lines.push(rule);
  lines.push(` SUMMARY  errors=${errors}  warnings=${warnings}  live_checked_absent=${absent}  mcp=${manifest?.mcp.length ?? 0}  lsp=${manifest?.lsp.length ?? 0}`);
  lines.push(rule);
  return lines.join('\n');
}

export interface MachineSummary {
  readonly validator: string;
  readonly chainKeyId: string;
  readonly generatedAt: string;
  readonly runtimeInfo: { readonly node: string; readonly platform: string };
  readonly targets: {
    readonly manifestPath: string;
    readonly opencodePath: string;
    readonly serversCenterRoot: string;
    readonly rootAvailable: boolean;
  };
  readonly liveCheckRequested: boolean;
  readonly measurement: string;
  readonly manifest: {
    readonly parsed: boolean;
    readonly manifestVersion: string | null;
    readonly nodeRuntime: string | null;
    readonly handshakesExecuted: number | null;
    readonly mcpCount: number;
    readonly lspCount: number;
    readonly mcp: readonly { readonly id: string; readonly version: string; readonly entry: string; readonly executableKind: string; readonly platform: string; readonly handshakeFeasibility: string; readonly handshakeBlockers: readonly string[]; readonly toolsStatus: string; readonly toolCount: number | null }[];
    readonly lsp: readonly { readonly id: string; readonly version: string; readonly entry: string | null; readonly entryKind: string; readonly source: string; readonly handshakeFeasibility: string; readonly handshakeBlockers: readonly string[] }[];
  };
  readonly reconciliation: readonly McpReconciliation[];
  readonly live: readonly LiveFinding[];
  readonly issues: readonly Issue[];
  readonly counts: {
    readonly errors: number;
    readonly warnings: number;
    readonly byFailureClass: Readonly<Record<FailureClass, number>>;
    readonly liveAbsent: number;
  };
  readonly exitCode: number;
  readonly exitMeaning: string;
}

function exitMeaning(code: number): string {
  switch (code) {
    case 0:
      return 'VALID';
    case 1:
      return 'STRUCTURAL_FAILURE';
    case 2:
      return 'LIVE_CHECK_FAILED';
    case 3:
      return 'CROSS_DOCUMENT_MISMATCH';
    case 4:
      return 'USAGE_ERROR';
    default:
      return 'UNKNOWN';
  }
}

/* ===========================================================================
 * 11. MAIN
 * ===========================================================================
 */

export function run(options: CliOptions): number {
  const log = new IssueLog();
  const manifest = parseManifest(options.manifestPath, log);
  const opencode = readOpencode(options.opencodePath, log);

  const rows = manifest === null ? [] : reconcile(manifest, opencode, log);

  const root = options.hostRootOverride ?? defaultHostRoot();
  const live = manifest === null ? [] : liveCheck(manifest, root, options.live);

  // A live absence is only a FAILURE when it was actually measured. An
  // unavailable host produces NOT_CHECKED_IN_THIS_ENVIRONMENT and never counts.
  for (const finding of live) {
    if (finding.state !== 'CHECKED_AND_ABSENT') continue;
    log.error(
      'ASSET_ABSENT_ON_HOST',
      'LIVE_CHECK_FAILED',
      `${finding.kind}:${finding.id}`,
      `declared path "${finding.declaredPath}" was measured and does not exist under ${root}. ${finding.detail}`
    );
  }

  const hasStructural = issuesOf(log.all(), 'STRUCTURAL_FAILURE').length > 0;
  const hasLiveFailure = issuesOf(log.all(), 'LIVE_CHECK_FAILED').length > 0;
  const hasCrossDoc = issuesOf(log.all(), 'CROSS_DOCUMENT_MISMATCH').length > 0;

  let exitCode = 0;
  if (hasStructural) exitCode = 1;
  else if (hasLiveFailure) exitCode = 2;
  else if (hasCrossDoc) exitCode = 3;

  if (options.json) {
    const summary: MachineSummary = {
      validator: VALIDATOR_NAME,
      chainKeyId: CHAIN_KEY_ID,
      generatedAt: new Date().toISOString(),
      runtimeInfo: { node: process.version, platform: `${process.platform}-${process.arch}` },
      targets: {
        manifestPath: options.manifestPath,
        opencodePath: options.opencodePath,
        serversCenterRoot: root,
        rootAvailable: existsSync(root)
      },
      liveCheckRequested: options.live,
      measurement: 'FILE_PRESENCE_ONLY_NO_HANDSHAKE',
      manifest:
        manifest === null
          ? { parsed: false, manifestVersion: null, nodeRuntime: null, handshakesExecuted: null, mcpCount: 0, lspCount: 0, mcp: [], lsp: [] }
          : {
              parsed: true,
              manifestVersion: manifest.manifestVersion,
              nodeRuntime: manifest.nodeRuntime,
              handshakesExecuted: manifest.handshakesExecuted,
              mcpCount: manifest.mcp.length,
              lspCount: manifest.lsp.length,
              mcp: manifest.mcp.map(entry => ({
                id: entry.id,
                version: entry.version,
                entry: entry.entry,
                executableKind: entry.command.executableKind,
                platform: entry.command.platform,
                handshakeFeasibility: entry.handshakeFeasibility,
                handshakeBlockers: entry.handshakeBlockers,
                toolsStatus: entry.toolsStatus,
                toolCount: entry.tools.length > 0 ? entry.tools.length : null
              })),
              lsp: manifest.lsp.map(entry => ({
                id: entry.id,
                version: entry.version,
                entry: entry.entry,
                entryKind: entry.entryKind,
                source: entry.source,
                handshakeFeasibility: entry.handshakeFeasibility,
                handshakeBlockers: entry.handshakeBlockers
              }))
            },
      reconciliation: rows,
      live,
      issues: log.all(),
      counts: {
        errors: log.countBySeverity('ERROR'),
        warnings: log.countBySeverity('WARNING'),
        byFailureClass: {
          STRUCTURAL_FAILURE: issuesOf(log.all(), 'STRUCTURAL_FAILURE').length,
          LIVE_CHECK_FAILED: hasLiveFailure ? 1 : 0,
          CROSS_DOCUMENT_MISMATCH: issuesOf(log.all(), 'CROSS_DOCUMENT_MISMATCH').length
        },
        liveAbsent: live.filter(finding => finding.state === 'CHECKED_AND_ABSENT').length
      },
      exitCode,
      exitMeaning: exitMeaning(exitCode)
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${renderTextReport(options.manifestPath, options.opencodePath, root, manifest, rows, live, log.all(), existsSync(root))}\n`
    );
  }

  return exitCode;
}

function issuesOf(issues: readonly Issue[], failureClass: FailureClass): readonly Issue[] {
  return issues.filter(issue => issue.failureClass === failureClass && issue.severity === 'ERROR');
}

function main(argv: readonly string[]): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 4;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  return run(options);
}

/**
 * Entry point.
 *
 * The exit code MUST be handed to the process explicitly. A bare `main(...)`
 * call discards the return value and always exits 0, which would make this
 * validator — the very thing that must fail loudly — incapable of ever failing.
 */
process.exitCode = main(process.argv.slice(2));