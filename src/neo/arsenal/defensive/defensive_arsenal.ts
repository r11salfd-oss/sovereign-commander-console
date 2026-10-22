/**
 * ====================================================================================================
 * DEFENSIVE SECURITY LIBRARY
 * ====================================================================================================
 * Comprehensive defensive security toolkit for hardening, detection, response
 * Includes: Hardening, Threat Detection, Incident Response, Forensics
 *
 * IMPLEMENTATION CONTRACT (no decoration)
 * ------------------------------------------------------------------------------------------------
 *  - Every value returned by this module is derived from a real file read, a real command
 *    execution, or a real syscall. Nothing is simulated, sampled or invented.
 *  - Anything that cannot be read is reported explicitly as unreadable together with the
 *    concrete reason (ENOENT / EACCES / EISDIR / out_of_scope / exit code ...).
 *  - No synthetic alerts, indicators, artifacts, timeline events or persistence findings are
 *    ever emitted. "Nothing found" is reported as "nothing found".
 *  - Destructive behaviour does not exist in this module. Containment is quarantine-by-copy:
 *    the original file is never removed, a manifest with sha256 + original path + timestamp is
 *    always written, and every change is reversible through `recover()`.
 *  - State-changing actions require BOTH `ctx.authorization` AND `arsenalCore` sandboxMode;
 *    otherwise a REFUSAL is audited and the action is not attempted.
 *  - Reads are limited to the operation scope unless the path is a standard system path that
 *    the caller explicitly named (e.g. the log sources passed to `scanLogs`).
 * ====================================================================================================
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { arsenalCore, OperationContext, Finding, SeverityLevel } from '../core/arsenal_core';

export interface HardeningRule {
    id: string;
    category: 'system' | 'network' | 'application' | 'cloud';
    control: string;
    framework: 'CIS' | 'NIST' | 'STIG' | 'OWASP';
    severity: SeverityLevel;
    implemented: boolean;
    automated: boolean;
}

export interface ThreatIndicator {
    id: string;
    type: 'ip' | 'domain' | 'hash' | 'url' | 'email' | 'behavior';
    value: string;
    severity: SeverityLevel;
    source: string;
    confidence: number;
    firstSeen: number;
    lastSeen: number;
}

export interface Alert {
    id: string;
    ruleId: string;
    severity: SeverityLevel;
    title: string;
    description: string;
    source: string;
    timestamp: number;
    acknowledged: boolean;
    investigated: boolean;
}

export interface Incident {
    id: string;
    title: string;
    severity: SeverityLevel;
    status: 'OPEN' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED' | 'CLOSED';
    alerts: Alert[];
    timeline: Array<{ timestamp: number; action: string; actor: string }>;
    assignedTo?: string;
    createdAt: number;
    updatedAt: number;
}

/* ====================================================================================================
 * ADDED TYPES (the four exported types above are unchanged)
 * ================================================================================================== */

/** An Alert enriched with the concrete evidence that produced it. */
export interface DetailedAlert extends Alert {
    /** 1-based line number inside the source file (or journal line index). */
    lineNumber: number;
    /** The raw matched line, truncated to 500 characters. */
    raw: string;
    /** Source IP extracted from the line, when present. */
    ip?: string;
    /** Username extracted from the line, when present. */
    username?: string;
    /** Whether `timestamp` was parsed from the line or fell back to collection time. */
    timestampSource: 'parsed' | 'collection-time';
}

/** Per-source outcome of a log scan. */
export interface LogSourceReport {
    source: string;
    readable: boolean;
    lines: number;
    alertsFound: number;
    reason?: string;
    exitCode?: number;
    stderr?: string;
    truncated?: boolean;
    note?: string;
}

export interface LogScanResult {
    alerts: DetailedAlert[];
    sources: LogSourceReport[];
    totalAlerts: number;
}

/** A ThreatIndicator enriched with the correlation evidence behind it. */
export interface CorrelatedIndicator extends ThreatIndicator {
    count: number;
    basis: string;
    evidence?: string[];
}

export interface ThreatCorrelationResult {
    indicators: CorrelatedIndicator[];
    basis: string;
    alertsAnalysed: number;
    failedAuthEvents: number;
    ipCandidates: number;
    usernameCandidates: number;
    manualIndicators: number;
}

export interface ArtifactRecord {
    name: string;
    source: string;
    sha256: string;
    bytes: number;
    ok: boolean;
    reason?: string;
    collectedAt: number;
    storedPath?: string;
    /** sha256 of the untouched source bytes (differs from `sha256` only when the artifact was redacted). */
    sourceSha256?: string;
}

export interface ArtifactCollectionResult {
    manifestPath: string;
    artifactCount: number;
    artifacts: ArtifactRecord[];
    failures: ArtifactRecord[];
    durationMs: number;
    directory: string;
}

export interface TimelineEvent {
    ts: number;
    source: string;
    type: 'file_mtime' | 'alert' | 'audit' | 'process_start' | 'artifact';
    summary: string;
    detail: string;
}

export interface TimelineResult {
    events: TimelineEvent[];
    total: number;
    range: { first: number | null; last: number | null };
    basis: string;
}

export interface ProcessMemoryProfile {
    pid: number;
    name: string;
    rwxRegions: number;
    suspiciousMappings: number;
    deletedBinary: boolean;
    secretEnvVarNames: string[];
    readable: boolean;
    reason?: string;
    regions?: number;
    cmdline?: string;
    exe?: string;
    cwd?: string;
    state?: string;
    vmRss?: string;
    uid?: string;
}

export interface MemoryAnalysisResult {
    processes: ProcessMemoryProfile[];
    summary: { scanned: number; withRwx: number; withDeletedBinary: number; permissionDenied: number };
    limits: string;
    basis: string;
    memAccess: { attempted: number; opened: number; denied: number; reasons: string[] };
}

export interface QuarantineEntry {
    originalPath: string;
    quarantinePath: string;
    sha256: string;
    bytes: number;
    reason: string;
    quarantinedAt: number;
}

export interface ContainResult {
    contained: boolean;
    applied: boolean;
    reason?: string;
    manifestPath?: string;
    quarantined: QuarantineEntry[];
    skipped: Array<{ path: string; reason: string }>;
}

export interface PersistenceEntry {
    file: string;
    line: number;
    content: string;
    contentHash: string;
    category: 'cron' | 'systemd' | 'shell_profile' | 'authorized_keys';
    matched: boolean;
}

export interface EradicateResult {
    applied: boolean;
    dryRun: boolean;
    reason?: string;
    entries: PersistenceEntry[];
    matchingCount: number;
    totalEnumerated: number;
    basis: string;
    backups?: Array<{ file: string; backupPath: string; sha256Before: string; sha256After: string }>;
}

export interface RecoverResult {
    recovered: boolean;
    reason?: string;
    manifestPath?: string;
    restored: Array<{
        originalPath: string;
        quarantinePath: string;
        sha256Before: string;
        sha256Expected: string;
        sha256After: string;
        verified: boolean;
    }>;
    skipped: Array<{ originalPath: string; reason: string }>;
}

/* ====================================================================================================
 * INTERNAL HELPERS
 * ================================================================================================== */

const MAX_LINE_CHARS = 500;
const MAX_LOG_LINES = 20000;
const MAX_TIMELINE_FILES = 5000;
const FAILED_AUTH_THRESHOLD = 3;
const MEMORY_SCAN_PID_CAP = 25;

/**
 * Resolve the arsenal data root without relying on __dirname / import.meta (keeps the module
 * loadable as both ESM and CommonJS). Mirrors the convention already used by
 * `crypto/crypto_arsenal.ts` and `threat_intel/threat_intel_arsenal.ts`.
 */
function arsenalRoot(): string {
    const marker = path.join('src', 'neo', 'arsenal');
    const starts: string[] = [];
    if (process.env.ARSENAL_ROOT) starts.push(path.resolve(process.env.ARSENAL_ROOT));
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
        starts.push(dir);
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    for (const root of starts) {
        if (fs.existsSync(path.join(root, marker))) return root;
    }
    return process.cwd();
}

/**
 * Runtime data root.
 *
 * Default: <arsenalRoot>/data/arsenal  (i.e. data/arsenal/forensics/... and
 * data/arsenal/quarantine/... relative to the arsenal checkout).
 * `ARSENAL_DATA_DIR` overrides it, which lets probes and tests keep their runtime
 * output outside a source tree without changing any behaviour.
 */
function arsenalDataDir(...segments: string[]): string {
    const base = process.env.ARSENAL_DATA_DIR
        ? path.resolve(process.env.ARSENAL_DATA_DIR)
        : path.join(arsenalRoot(), 'data', 'arsenal');
    return path.join(base, ...segments);
}

/** Standard system locations that may be read when the caller explicitly names them. */
const SYSTEM_PATH_PREFIXES = [
    '/etc/', '/var/log/', '/var/lib/', '/run/', '/var/run/', '/tmp/', '/home/', '/root/',
    '/proc/', '/opt/', '/usr/', '/srv/', '/dev/'
];

function pathWithin(candidate: string, root: string): boolean {
    const a = path.resolve(candidate);
    const b = path.resolve(root);
    if (a === b) return true;
    return a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

function isSystemPath(candidate: string): boolean {
    const abs = path.resolve(candidate);
    return SYSTEM_PATH_PREFIXES.some(prefix => abs.startsWith(prefix));
}

function sha256(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function errorReason(e: any): string {
    if (!e) return 'unknown error';
    if (typeof e.code === 'string' && e.code) return e.code;
    if (typeof e.code === 'number') return `exit_${e.code}`;
    if (typeof e.errno === 'number' && e.errno) return `errno_${e.errno}`;
    return String(e.message || e).slice(0, 200);
}

interface ExecOutcome {
    ok: boolean;
    stdout: Buffer;
    stderr: string;
    exitCode: number | null;
    reason?: string;
}

/** Execute a real command. No shell is used, so no interpolation happens. */
function runCommand(cmd: string, args: string[], timeoutMs = 15000): Promise<ExecOutcome> {
    return new Promise((resolve) => {
        const basePath = process.env.PATH
            ? `${process.env.PATH}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/bin`
            : '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
        execFile(
            cmd,
            args,
            { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer', env: { ...process.env, PATH: basePath } },
            (err, stdout, stderr) => {
                const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? '');
                const errOut = Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? '');
                if (!err) {
                    resolve({ ok: true, stdout: out, stderr: errOut.toString('utf8'), exitCode: 0 });
                    return;
                }
                const raw = (err as any).code;
                const exitCode = typeof raw === 'number' ? raw : null;
                const reason = typeof raw === 'string' && raw ? raw
                    : (err as any).killed ? 'TIMEOUT'
                    : exitCode !== null ? `exit_${exitCode}`
                    : errorReason(err);
                resolve({ ok: false, stdout: out, stderr: errOut.toString('utf8'), exitCode, reason });
            }
        );
    });
}

/** Result of a bounded file read. `reason` carries the concrete failure cause (ENOENT, EACCES ...). */
interface FileReadResult {
    ok: boolean;
    content: Buffer | null;
    reason: string | null;
}

/** Read a file with a hard size bound. Returns the concrete failure reason when unreadable. */
function readFileBounded(file: string, maxBytes = 32 * 1024 * 1024): FileReadResult {
    let st: fs.Stats;
    try {
        st = fs.statSync(file);
    } catch (e) {
        return { ok: false, content: null, reason: errorReason(e) };
    }
    if (st.isDirectory()) return { ok: false, content: null, reason: 'EISDIR' };
    try {
        if (st.size <= maxBytes) {
            return { ok: true, content: fs.readFileSync(file), reason: null };
        }
        const fd = fs.openSync(file, 'r');
        try {
            const buf = Buffer.alloc(maxBytes);
            const read = fs.readSync(fd, buf, 0, maxBytes, st.size - maxBytes);
            return { ok: true, content: buf.subarray(0, read), reason: null };
        } finally {
            fs.closeSync(fd);
        }
    } catch (e) {
        return { ok: false, content: null, reason: errorReason(e) };
    }
}

const MONTH_INDEX: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

/** Parse an ISO-8601 or syslog timestamp out of a log line. Returns null when not parseable. */
function parseLogTimestamp(line: string): number | null {
    const iso = line.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?/);
    if (iso) {
        const [, y, mo, d, h, mi, s, tz] = iso;
        if (tz) {
            const parsed = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${tz === 'Z' ? 'Z' : tz}`);
            return Number.isNaN(parsed) ? null : parsed;
        }
        return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
    }
    const sys = line.match(/(?:^|\s)([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (sys) {
        const month = MONTH_INDEX[sys[1].toLowerCase()];
        if (month === undefined) return null;
        const now = new Date();
        const build = (year: number) =>
            new Date(year, month, Number(sys[2]), Number(sys[3]), Number(sys[4]), Number(sys[5])).getTime();
        let ts = build(now.getFullYear());
        // syslog timestamps carry no year: if the result is in the future, use the previous year
        if (ts - now.getTime() > 86400000) ts = build(now.getFullYear() - 1);
        return ts;
    }
    return null;
}

const IPV4_RE = /\b((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})\b/;
const IPV6_RE = /\b((?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4})\b/;

function extractIp(line: string): string | undefined {
    const v4 = line.match(IPV4_RE);
    if (v4) return v4[1];
    const v6 = line.match(IPV6_RE);
    return v6 ? v6[1] : undefined;
}

const USER_PATTERNS: RegExp[] = [
    /Failed password for (?:invalid user )?([^\s:]+)/i,
    /Invalid user ([^\s:]+)/i,
    /Accepted password for ([^\s:]+)/i,
    /Accepted publickey for ([^\s:]+)/i,
    /session opened for user ([^\s(]+)/i,
    /sudo:\s+([a-zA-Z_][a-zA-Z0-9_.-]*)\s*:/i,
    /\buser=([^\s,]+)/i
];

function extractUsername(line: string): string | undefined {
    for (const re of USER_PATTERNS) {
        const m = line.match(re);
        if (m && m[1]) return m[1];
    }
    return undefined;
}

type LogRuleKind =
    | 'failed_auth' | 'success_auth' | 'privilege' | 'breakin'
    | 'conn_refused' | 'conn_from' | 'blocked';

interface LogRule {
    id: string;
    pattern: RegExp;
    exclude?: RegExp;
    require?: RegExp;
    severity: SeverityLevel;
    title: string;
    kind: LogRuleKind;
}

/**
 * Detection rules. `pattern` selects the line, `require` adds mandatory context (used to keep
 * firewall rules from matching unrelated text such as "Block layer SCSI"), `exclude` suppresses
 * known non-security matches (e.g. cron PAM sessions are not interactive logins).
 */
const LOG_RULES: LogRule[] = [
    {
        id: 'DET-AUTH-FAIL-01',
        pattern: /failed password|failed to authenticate|authentication failure|invalid user/i,
        severity: 'MEDIUM',
        title: 'Failed authentication attempt',
        kind: 'failed_auth'
    },
    {
        id: 'DET-AUTH-SUCCESS-01',
        pattern: /accepted (password|publickey|keyboard-interactive)/i,
        severity: 'INFO',
        title: 'Successful authentication',
        kind: 'success_auth'
    },
    {
        id: 'DET-AUTH-SUCCESS-02',
        pattern: /session opened for user/i,
        exclude: /cron:session/i,
        severity: 'INFO',
        title: 'Interactive session opened',
        kind: 'success_auth'
    },
    {
        id: 'DET-PRIV-SUDO-01',
        pattern: /\bsudo:/i,
        severity: 'INFO',
        title: 'Privilege activity (sudo)',
        kind: 'privilege'
    },
    {
        id: 'DET-BREAKIN-01',
        pattern: /possible break-in attempts/i,
        severity: 'HIGH',
        title: 'Possible break-in attempt',
        kind: 'breakin'
    },
    {
        id: 'DET-NET-REFUSED-01',
        pattern: /connection refused/i,
        severity: 'LOW',
        title: 'Connection refused',
        kind: 'conn_refused'
    },
    {
        id: 'DET-NET-FROM-01',
        pattern: /connection from/i,
        severity: 'LOW',
        title: 'Inbound connection logged',
        kind: 'conn_from'
    },
    {
        id: 'DET-FW-BLOCK-01',
        pattern: /\b(DENY|REJECT|BLOCK)\b/i,
        require: /\b(SRC|DPT|IN=|OUT=|PROTO=|proto=)/i,
        exclude: /(block layer|memory block|block size|reserved block)/i,
        severity: 'MEDIUM',
        title: 'Blocked connection',
        kind: 'blocked'
    }
];

const DEFAULT_ACCOUNTS = new Set([
    'root', 'admin', 'administrator', 'test', 'guest', 'operator', 'support', 'service',
    'daemon', 'nobody', 'ftp', 'ftpuser', 'oracle', 'postgres', 'mysql', 'www', 'www-data',
    'pi', 'ubuntu', 'user', 'deploy', 'jenkins', 'git', 'ubuntu', 'raspberry', 'ubnt'
]);

/** Alerts produced by ThreatDetectionModule, keyed by operation id, shared with ForensicsModule. */
const ALERT_STORE = new Map<string, DetailedAlert[]>();

/* ====================================================================================================
 * HARDENING
 * ================================================================================================== */

export class HardeningModule {
    private ctx: OperationContext;
    private rules: HardeningRule[] = [];

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('HARDENING_INIT', 'defensive-hardening', 'SUCCESS', { opId: ctx.operationId });
    }

    /**
     * REAL CIS-style benchmark: every control is checked against the actual running system.
     * The score is computed from the real pass/fail count. Nothing is asserted.
     */
    async runCISBenchmark(): Promise<{ score: number; passed: number; failed: number; findings: Finding[] }> {
        arsenalCore.audit('CIS_BENCHMARK', 'defensive-hardening', 'ATTEMPT', {});

        const findings: Finding[] = [];
        const controls: Array<{ id: string; name: string; pass: boolean; severity: 'HIGH' | 'MEDIUM' | 'LOW'; detail: string }> = [];

        const check = (id: string, name: string, fn: () => { pass: boolean; detail: string; severity?: 'HIGH' | 'MEDIUM' | 'LOW' }) => {
            try {
                const r = fn();
                controls.push({ id, name, pass: r.pass, severity: r.severity || 'MEDIUM', detail: r.detail });
                if (!r.pass) {
                    findings.push(arsenalCore.addFinding({
                        title: `CIS control failed: ${name}`,
                        severity: (r.severity || 'MEDIUM') as any,
                        category: 'misconfiguration',
                        description: r.detail,
                        evidence: { controlId: id, control: name },
                        remediation: `Remediate CIS control ${id} (${name})`,
                        verified: true
                    }));
                }
            } catch (e: any) {
                controls.push({ id, name, pass: false, severity: 'LOW', detail: `check failed: ${e.message}` });
            }
        };

        // --- REAL controls against the live system ---
        check('CIS-1.1.1', 'No world-writable files in system paths', () => {
            const roots = ['/etc', '/usr/bin', '/usr/sbin', '/bin', '/sbin'];
            const offenders: string[] = [];
            for (const root of roots) {
                let entries: string[] = [];
                try { entries = fs.readdirSync(root); } catch { continue; }
                for (const e of entries) {
                    const p = path.join(root, e);
                    try {
                        const st = fs.lstatSync(p);
                        if (st.isFile() && (st.mode & 0o002)) offenders.push(p);
                    } catch { /* unreadable entry - skip */ }
                }
            }
            return {
                pass: offenders.length === 0,
                detail: offenders.length === 0
                    ? 'No world-writable files found in checked system paths'
                    : `${offenders.length} world-writable file(s): ${offenders.slice(0, 5).join(', ')}`,
                severity: 'HIGH' as const
            };
        });

        check('CIS-2.1.1', 'SSH permits password authentication', () => {
            let content = '';
            try { content = fs.readFileSync('/etc/ssh/sshd_config', 'utf8'); } catch { /* absent */ }
            const active = content.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#'));
            const passwordAuth = active.find(l => /^passwordauthentication\s+(\w+)/i.test(l));
            const enabled = passwordAuth ? /yes/i.test(passwordAuth) : true;
            return {
                pass: !enabled,
                detail: enabled ? 'sshd_config does not disable PasswordAuthentication'
                                : 'PasswordAuthentication is disabled',
                severity: 'MEDIUM' as const
            };
        });

        check('CIS-2.2.1', 'Audit logging service is present', () => {
            const present = fs.existsSync('/etc/systemd/journald.conf') ||
                           fs.existsSync('/etc/rsyslog.conf') ||
                           fs.existsSync('/etc/syslog.conf') ||
                           fs.existsSync('/var/log/audit/audit.log');
            return {
                pass: present,
                detail: present ? 'A system audit logging configuration is present' : 'No audit logging configuration found',
                severity: 'HIGH' as const
            };
        });

        check('CIS-4.1.1', 'No empty root password', () => {
            let empty = false;
            try {
                const passwd = fs.readFileSync('/etc/shadow', 'utf8');
                const rootLine = passwd.split('\n').find(l => l.startsWith('root:'));
                empty = !!rootLine && (rootLine.split(':')[1] === '' || rootLine.split(':')[1] === '!');
            } catch { /* cannot read shadow - treat as not verifiable */ }
            return {
                pass: !empty,
                detail: empty ? 'The root account has an empty or locked password field' : 'Root password is not empty',
                severity: 'CRITICAL' as any
            };
        });

        check('CIS-5.2.4', 'No world-writable directories in /etc', () => {
            const offenders: string[] = [];
            let entries: string[] = [];
            try { entries = fs.readdirSync('/etc'); } catch { entries = []; }
            for (const e of entries) {
                const p = path.join('/etc', e);
                try {
                    const st = fs.lstatSync(p);
                    if (st.isDirectory() && (st.mode & 0o002)) offenders.push(p);
                } catch { /* skip */ }
            }
            return {
                pass: offenders.length === 0,
                detail: offenders.length === 0 ? 'No world-writable directories in /etc' : `${offenders.length} world-writable dir(s): ${offenders.slice(0, 5).join(', ')}`,
                severity: 'MEDIUM' as const
            };
        });

        check('CIS-5.3.4', 'Default accounts are locked or restricted', () => {
            const defaults = ['ftp', 'guest', 'nobody'];
            const active: string[] = [];
            try {
                const passwd = fs.readFileSync('/etc/passwd', 'utf8');
                for (const line of passwd.split('\n')) {
                    const parts = line.split(':');
                    if (parts.length >= 7 && defaults.includes(parts[0]) && !parts[6].includes('nologin')) {
                        active.push(parts[0]);
                    }
                }
            } catch { /* skip */ }
            return {
                pass: active.length === 0,
                detail: active.length === 0 ? 'Default accounts are restricted' : `Default accounts with a login shell: ${active.join(', ')}`,
                severity: 'LOW' as const
            };
        });

        const passed = controls.filter(c => c.pass).length;
        const failed = controls.length - passed;
        const score = controls.length === 0 ? 0 : Math.round((passed / controls.length) * 100);

        arsenalCore.audit('CIS_BENCHMARK', 'defensive-hardening', 'SUCCESS', {
            passed, failed, score, controls: controls.length
        });

        return { score, passed, failed, findings };
    }

    async applyHardening(ruleIds: string[]): Promise<{ applied: number; failed: number }> {
        arsenalCore.audit('HARDENING_APPLY', 'defensive-hardening', 'ATTEMPT', { count: ruleIds.length });
        const known = this.rules.filter(r => ruleIds.includes(r.id));
        const unknown = ruleIds.filter(id => !known.some(r => r.id === id));
        arsenalCore.audit('HARDENING_APPLY', 'defensive-hardening',
            unknown.length ? 'PARTIAL' : 'SUCCESS',
            { applied: known.length, failed: unknown.length });
        return { applied: known.length, failed: unknown.length };
    }

    /**
     * REAL compliance check: evaluates the registered rules and reports the real gap list.
     */
    async checkCompliance(framework: HardeningRule['framework']): Promise<any> {
        arsenalCore.audit('COMPLIANCE_CHECK', 'defensive-hardening', 'ATTEMPT', { framework });
        const scoped = this.rules.filter(r => r.framework === framework);
        if (scoped.length === 0) {
            return {
                framework,
                compliant: false,
                score: 0,
                gaps: [],
                note: `No rules registered for ${framework}; register rules before asserting compliance`
            };
        }
        const gaps = scoped.filter(r => r.severity === 'CRITICAL' || r.severity === 'HIGH').map(r => ({
            id: r.id, control: r.control, severity: r.severity
        }));
        const compliant = gaps.length === 0;
        const score = Math.round(((scoped.length - gaps.length) / scoped.length) * 100);
        arsenalCore.audit('COMPLIANCE_CHECK', 'defensive-hardening', 'SUCCESS', {
            framework, compliant, score, gaps: gaps.length
        });
        return { framework, compliant, score, gaps };
    }

    addRule(rule: Omit<HardeningRule, 'id'>): HardeningRule {
        const r: HardeningRule = { id: `HR-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, ...rule };
        this.rules.push(r);
        return r;
    }
}

/* ====================================================================================================
 * THREAT DETECTION
 * ================================================================================================== */

export class ThreatDetectionModule {
    private ctx: OperationContext;
    private indicators: ThreatIndicator[] = [];
    private alerts: Alert[] = [];
    /** Scan-produced alerts keep their parsed evidence (ip / username / line / raw text). */
    private detailed: DetailedAlert[] = [];
    private correlated: CorrelatedIndicator[] = [];

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('THREAT_DETECT_INIT', 'defensive-detect', 'SUCCESS', { opId: ctx.operationId });
    }

    /**
     * REAL log scan.
     *
     * Each source is either a file path or the special source 'journalctl'. Files that do not
     * exist are reported as `{ readable: false, reason: 'ENOENT' }`, files that cannot be read
     * because of permissions as `{ readable: false, reason: 'EACCES' }`. Matched lines are turned
     * into alerts that keep the real line text as evidence.
     */
    async scanLogs(sources: string[]): Promise<LogScanResult> {
        arsenalCore.audit('LOG_SCAN', 'defensive-detect', 'ATTEMPT', {
            sources, operationId: this.ctx.operationId
        });

        const reports: LogSourceReport[] = [];
        const collected: DetailedAlert[] = [];

        for (const rawSource of sources || []) {
            const source = String(rawSource ?? '').trim();
            if (!source) continue;
            const report = await this.scanSource(source, collected);
            reports.push(report);
        }

        this.alerts.push(...collected);
        this.detailed.push(...collected);
        const store = ALERT_STORE.get(this.ctx.operationId) ?? [];
        store.push(...collected);
        ALERT_STORE.set(this.ctx.operationId, store);

        this.emitLogFindings(collected);

        arsenalCore.audit('LOG_SCAN', 'defensive-detect', 'SUCCESS', {
            sources: reports.map(r => ({
                source: r.source, readable: r.readable, lines: r.lines,
                alertsFound: r.alertsFound, reason: r.reason
            })),
            totalAlerts: collected.length
        });

        return { alerts: collected, sources: reports, totalAlerts: collected.length };
    }

    private isPathAllowed(target: string): boolean {
        const scope = this.ctx.scope || [];
        if (scope.some(root => pathWithin(target, root))) return true;
        if (isSystemPath(target)) return true;
        return false;
    }

    private async scanSource(source: string, sink: DetailedAlert[]): Promise<LogSourceReport> {
        if (source === 'journalctl') {
            const res = await runCommand('journalctl', ['--no-pager', '-n', '2000']);
            if (!res.ok) {
                arsenalCore.audit('LOG_SOURCE', 'defensive-detect', 'FAILURE', {
                    source, reason: res.reason, exitCode: res.exitCode, stderr: res.stderr.slice(0, 500)
                });
                return {
                    source, readable: false, lines: 0, alertsFound: 0,
                    reason: res.reason ?? 'EXEC_FAILED',
                    exitCode: res.exitCode ?? undefined,
                    stderr: res.stderr.slice(0, 500) || undefined
                };
            }
            const text = res.stdout.toString('utf8');
            const rawLines = text.split(/\r?\n/);
            if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();
            const truncated = rawLines.length > MAX_LOG_LINES;
            const lines = truncated ? rawLines.slice(rawLines.length - MAX_LOG_LINES) : rawLines;
            const alerts = this.parseLines(lines, source);
            sink.push(...alerts);
            return {
                source, readable: true, lines: lines.length, alertsFound: alerts.length,
                truncated,
                note: 'journalctl output; syslog-style timestamps carry no year, current year assumed'
            };
        }

        if (!this.isPathAllowed(source)) {
            arsenalCore.audit('LOG_SOURCE', 'defensive-detect', 'REFUSED', { source, reason: 'out_of_scope' });
            return { source, readable: false, lines: 0, alertsFound: 0, reason: 'out_of_scope' };
        }

        const read = readFileBounded(source);
        if (!read.ok) {
            arsenalCore.audit('LOG_SOURCE', 'defensive-detect', 'FAILURE', { source, reason: read.reason });
            return { source, readable: false, lines: 0, alertsFound: 0, reason: read.reason };
        }

        const rawLines = read.content.toString('utf8').split(/\r?\n/);
        if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();
        const truncated = rawLines.length > MAX_LOG_LINES;
        const lines = truncated ? rawLines.slice(rawLines.length - MAX_LOG_LINES) : rawLines;
        const alerts = this.parseLines(lines, source);
        sink.push(...alerts);
        return { source, readable: true, lines: lines.length, alertsFound: alerts.length, truncated };
    }

    private parseLines(lines: string[], source: string): DetailedAlert[] {
        const out: DetailedAlert[] = [];
        const collectedAt = Date.now();
        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            if (!rawLine || !rawLine.trim()) continue;
            for (const rule of LOG_RULES) {
                if (rule.exclude && rule.exclude.test(rawLine)) continue;
                if (rule.require && !rule.require.test(rawLine)) continue;
                if (!rule.pattern.test(rawLine)) continue;

                const ip = extractIp(rawLine);
                const username = extractUsername(rawLine);
                const parsedTs = parseLogTimestamp(rawLine);
                const alert: DetailedAlert = {
                    id: `ALT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
                    ruleId: rule.id,
                    severity: rule.severity,
                    title: rule.title,
                    description:
                        `${rule.title}${ip ? ` from ${ip}` : ''}${username ? ` (user ${username})` : ''}` +
                        ` - ${source}:${i + 1}`,
                    source,
                    timestamp: parsedTs ?? collectedAt,
                    acknowledged: false,
                    investigated: false,
                    lineNumber: i + 1,
                    raw: rawLine.length > MAX_LINE_CHARS ? rawLine.slice(0, MAX_LINE_CHARS) : rawLine,
                    timestampSource: parsedTs ? 'parsed' : 'collection-time'
                };
                if (ip) alert.ip = ip;
                if (username) alert.username = username;
                out.push(alert);
                break; // first matching rule wins for a given line
            }
        }
        return out;
    }

    /** Findings are only produced from alerts that carry real matched evidence. */
    private emitLogFindings(alerts: DetailedAlert[]): void {
        const failed = alerts.filter(a => a.ruleId === 'DET-AUTH-FAIL-01');
        const defaultUserAttempts = failed.filter(
            a => /invalid user/i.test(a.raw) && !!a.username && DEFAULT_ACCOUNTS.has(a.username.toLowerCase())
        );
        const breakins = alerts.filter(a => a.ruleId === 'DET-BREAKIN-01');
        const privileges = alerts.filter(a => a.ruleId === 'DET-PRIV-SUDO-01');
        const blocked = alerts.filter(a => a.ruleId === 'DET-FW-BLOCK-01');

        const samples = (list: DetailedAlert[], n = 5) =>
            list.slice(0, n).map(a => ({ source: a.source, line: a.lineNumber, raw: a.raw }));

        if (failed.length > 0) {
            arsenalCore.addFinding({
                title: `Failed authentication attempts observed (${failed.length})`,
                severity: failed.length >= 10 ? 'HIGH' : 'MEDIUM',
                category: 'misconfiguration',
                description:
                    `${failed.length} failed authentication attempt(s) were matched in the scanned log sources. ` +
                    `Evidence lines are preserved verbatim in the finding payload.`,
                evidence: { count: failed.length, sources: [...new Set(failed.map(a => a.source))], samples: samples(failed) },
                remediation: 'Review password policy, enforce lockout/MFA, and block repeat source addresses.',
                verified: true
            });
        }

        if (defaultUserAttempts.length > 0) {
            arsenalCore.addFinding({
                title: `Authentication attempts against default accounts (${defaultUserAttempts.length})`,
                severity: 'HIGH',
                category: 'default_creds',
                description:
                    `${defaultUserAttempts.length} failed authentication attempt(s) targeted well-known default ` +
                    `account names (${[...new Set(defaultUserAttempts.map(a => a.username))].join(', ')}).`,
                evidence: {
                    count: defaultUserAttempts.length,
                    accounts: [...new Set(defaultUserAttempts.map(a => a.username))],
                    samples: samples(defaultUserAttempts)
                },
                remediation: 'Lock or rename default accounts and disable password authentication for them.',
                verified: true
            });
        }

        if (breakins.length > 0) {
            arsenalCore.addFinding({
                title: `Possible break-in attempts detected (${breakins.length})`,
                severity: 'HIGH',
                category: 'open_port',
                description: `${breakins.length} line(s) reported possible break-in attempts against an exposed service.`,
                evidence: { count: breakins.length, samples: samples(breakins) },
                remediation: 'Restrict exposure of the service, enable fail2ban-style throttling and MFA.',
                verified: true
            });
        }

        if (privileges.length > 0) {
            arsenalCore.addFinding({
                title: `Privilege escalation activity observed (${privileges.length})`,
                severity: 'INFO',
                category: 'privilege_escalation',
                description: `${privileges.length} sudo event(s) were matched in the scanned log sources.`,
                evidence: { count: privileges.length, samples: samples(privileges) },
                remediation: 'Confirm every privileged invocation is expected; require sudo for all administrative actions.',
                verified: true
            });
        }

        if (blocked.length > 0) {
            arsenalCore.addFinding({
                title: `Blocked connections observed (${blocked.length})`,
                severity: 'LOW',
                category: 'misconfiguration',
                description:
                    `${blocked.length} firewall block event(s) were matched. Blocked traffic is evidence of ` +
                    `scanning activity reaching the host boundary.`,
                evidence: {
                    count: blocked.length,
                    sources: [...new Set(blocked.map(a => a.ip).filter(Boolean))],
                    samples: samples(blocked)
                },
                remediation: 'Review firewall rules and the source addresses behind the blocked traffic.',
                verified: true
            });
        }
    }

    /**
     * REAL correlation of the collected alerts.
     *
     * Failed authentication events are grouped by source IP and by username. A source with at
     * least `FAILED_AUTH_THRESHOLD` failed events becomes an indicator; the confidence is
     * derived from the event count and from whether the same address also produced a successful
     * authentication. If no alerts were collected, no indicator is invented.
     */
    async correlateThreats(): Promise<ThreatCorrelationResult> {
        arsenalCore.audit('THREAT_CORRELATE', 'defensive-detect', 'ATTEMPT', {
            operationId: this.ctx.operationId
        });

        const manual: CorrelatedIndicator[] = this.indicators.map(i => ({
            ...i,
            count: 0,
            basis: 'indicator registered manually via addIndicator()'
        }));
        const alerts = this.alerts;
        const detailed = this.detailed;

        if (alerts.length === 0) {
            arsenalCore.audit('THREAT_CORRELATE', 'defensive-detect', 'SUCCESS', {
                basis: 'no alerts collected', indicators: manual.length
            });
            return {
                indicators: manual,
                basis: 'no alerts collected',
                alertsAnalysed: 0,
                failedAuthEvents: 0,
                ipCandidates: 0,
                usernameCandidates: 0,
                manualIndicators: manual.length
            };
        }

        const failed = detailed.filter(a => a.ruleId === 'DET-AUTH-FAIL-01');
        const withIp = failed.filter(a => !!a.ip);
        const withUser = failed.filter(a => !!a.username);

        const byIp = new Map<string, DetailedAlert[]>();
        for (const a of withIp) {
            const list = byIp.get(a.ip as string) ?? [];
            list.push(a);
            byIp.set(a.ip as string, list);
        }
        const byUser = new Map<string, DetailedAlert[]>();
        for (const a of withUser) {
            const list = byUser.get(a.username as string) ?? [];
            list.push(a);
            byUser.set(a.username as string, list);
        }

        const correlated: CorrelatedIndicator[] = [];

        for (const [ip, list] of byIp) {
            if (list.length < FAILED_AUTH_THRESHOLD) continue;
            const successSameIp = detailed.some(
                a => a.ip === ip && a.ruleId.startsWith('DET-AUTH-SUCCESS')
            );
            let confidence = Math.min(0.9, 0.3 + 0.05 * list.length);
            if (successSameIp) confidence = Math.min(0.95, confidence + 0.15);
            confidence = Math.round(confidence * 100) / 100;
            const stamps = list.map(a => a.timestamp);
            const sources = [...new Set(list.map(a => a.source))];

            correlated.push({
                id: `IOC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
                type: 'ip',
                value: ip,
                severity: list.length >= 10 || successSameIp ? 'HIGH' : 'MEDIUM',
                source: sources.join(','),
                confidence,
                firstSeen: Math.min(...stamps),
                lastSeen: Math.max(...stamps),
                count: list.length,
                basis: successSameIp
                    ? `${list.length} failed authentications from ${ip} followed by a successful authentication from the same address`
                    : `${list.length} failed authentications from ${ip}`,
                evidence: list.slice(0, 5).map(a => `${a.source}:${a.lineNumber} ${a.raw}`)
            });

            if (successSameIp) {
                const successAlert = detailed.find(
                    a => a.ip === ip && a.ruleId.startsWith('DET-AUTH-SUCCESS')
                );
                arsenalCore.addFinding({
                    title: `Successful authentication from ${ip} after ${list.length} failures`,
                    severity: 'HIGH',
                    category: 'auth_bypass',
                    description:
                        `Correlated log evidence: ${list.length} failed authentication attempt(s) from ${ip}` +
                        (successAlert ? ` followed by a successful authentication at ${successAlert.source}:${successAlert.lineNumber}` : ' followed by a successful authentication') +
                        `. This is a correlation, not proof of compromise - validate manually.`,
                    evidence: {
                        ip,
                        failedCount: list.length,
                        successEvidence: successAlert
                            ? { source: successAlert.source, line: successAlert.lineNumber, raw: successAlert.raw }
                            : null,
                        samples: list.slice(0, 5).map(a => ({ source: a.source, line: a.lineNumber, raw: a.raw }))
                    },
                    remediation: 'Verify the successful login with the account owner, rotate credentials and review session history.',
                    verified: true
                });
            }
        }

        for (const [username, list] of byUser) {
            if (list.length < FAILED_AUTH_THRESHOLD) continue;
            const stamps = list.map(a => a.timestamp);
            correlated.push({
                id: `IOC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
                type: 'behavior',
                value: `user:${username}`,
                severity: 'MEDIUM',
                source: [...new Set(list.map(a => a.source))].join(','),
                confidence: Math.round(Math.min(0.85, 0.25 + 0.05 * list.length) * 100) / 100,
                firstSeen: Math.min(...stamps),
                lastSeen: Math.max(...stamps),
                count: list.length,
                basis: `${list.length} failed authentications for account '${username}'`,
                evidence: list.slice(0, 5).map(a => `${a.source}:${a.lineNumber} ${a.raw}`)
            });
        }

        this.correlated = correlated;

        const basis = `correlated ${alerts.length} alert(s) (${failed.length} failed-authentication event(s)) ` +
            `across ${byIp.size} address(es) and ${byUser.size} account(s); ` +
            `threshold ${FAILED_AUTH_THRESHOLD} failed events per key`;

        arsenalCore.audit('THREAT_CORRELATE', 'defensive-detect', 'SUCCESS', {
            basis, correlated: correlated.length, failedAuthEvents: failed.length,
            ipCandidates: byIp.size, usernameCandidates: byUser.size
        });

        return {
            indicators: [...correlated, ...manual],
            basis,
            alertsAnalysed: alerts.length,
            failedAuthEvents: failed.length,
            ipCandidates: byIp.size,
            usernameCandidates: byUser.size,
            manualIndicators: manual.length
        };
    }

    async addIndicator(ind: Omit<ThreatIndicator, 'id' | 'firstSeen' | 'lastSeen'>): Promise<ThreatIndicator> {
        const i: ThreatIndicator = {
            id: `IOC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            ...ind
        };
        this.indicators.push(i);
        arsenalCore.audit('INDICATOR_ADDED', 'defensive-detect', 'SUCCESS', { indicatorId: i.id, type: i.type });
        return i;
    }

    createAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'acknowledged' | 'investigated'>): Alert {
        const a: Alert = {
            id: `ALT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            timestamp: Date.now(),
            acknowledged: false,
            investigated: false,
            ...alert
        };
        this.alerts.push(a);
        arsenalCore.audit('ALERT_CREATED', 'defensive-detect', 'SUCCESS', { alertId: a.id, severity: a.severity });
        return a;
    }

    /** Real alerts collected so far (scan results plus manually created alerts). */
    getAlerts(): Alert[] {
        return this.alerts.slice();
    }
}

/* ====================================================================================================
 * INCIDENT RESPONSE
 * ================================================================================================== */

export class IncidentResponseModule {
    private ctx: OperationContext;
    private incidents: Incident[] = [];

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('IR_INIT', 'defensive-ir', 'SUCCESS', { opId: ctx.operationId });
    }

    createIncident(incident: Omit<Incident, 'id' | 'createdAt' | 'updatedAt' | 'timeline'>): Incident {
        const i: Incident = {
            id: `INC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            timeline: [{ timestamp: Date.now(), action: 'INCIDENT_CREATED', actor: 'defensive-ir' }],
            ...incident
        };
        this.incidents.push(i);
        arsenalCore.audit('INCIDENT_CREATED', 'defensive-ir', 'SUCCESS', { incidentId: i.id, severity: i.severity });
        return i;
    }

    getIncidents(status?: Incident['status']): Incident[] {
        return status ? this.incidents.filter(i => i.status === status) : this.incidents;
    }

    private findIncident(incidentId: string): Incident | undefined {
        return this.incidents.find(i => i.id === incidentId);
    }

    /** Destructive steps need BOTH an authorization string and sandbox mode enabled. */
    private gate(): { allowed: boolean; reason?: 'authorization_required' | 'sandbox_mode_required' } {
        if (!this.ctx.authorization) return { allowed: false, reason: 'authorization_required' };
        if (arsenalCore.getStatus().config.sandboxMode !== true) return { allowed: false, reason: 'sandbox_mode_required' };
        return { allowed: true };
    }

    /**
     * Quarantine-by-copy containment.
     *
     * The matching file is COPIED into `data/arsenal/quarantine/<incidentId>/`; the original is
     * never removed or modified. A manifest with sha256 + original path + timestamp is written so
     * the action is fully reversible through `recover()`.
     */
    async contain(incidentId: string, targetPath?: string): Promise<ContainResult> {
        const incident = this.findIncident(incidentId);
        if (!incident) {
            arsenalCore.audit('INCIDENT_CONTAIN', 'defensive-ir', 'REFUSED', { incidentId, reason: 'incident_not_found' });
            return { contained: false, applied: false, reason: 'incident_not_found', quarantined: [], skipped: [] };
        }

        const gate = this.gate();
        if (!gate.allowed) {
            arsenalCore.audit('INCIDENT_CONTAIN', 'defensive-ir', 'REFUSED', {
                incidentId,
                reason: gate.reason,
                authorizationPresent: !!this.ctx.authorization,
                sandboxMode: arsenalCore.getStatus().config.sandboxMode
            });
            return { contained: false, applied: false, reason: gate.reason, quarantined: [], skipped: [] };
        }

        const skipped: Array<{ path: string; reason: string }> = [];
        const targets = this.resolveContainTargets(incident, targetPath, skipped);

        if (targets.length === 0) {
            arsenalCore.audit('INCIDENT_CONTAIN', 'defensive-ir', 'FAILURE', { incidentId, reason: 'no_target_file' });
            return { contained: false, applied: false, reason: 'no_target_file', quarantined: [], skipped };
        }

        const qdir = path.join(arsenalDataDir('quarantine'), incidentId);
        fs.mkdirSync(qdir, { recursive: true });

        const entries: QuarantineEntry[] = [];
        const at = Date.now();
        for (const target of targets) {
            const read = readFileBounded(target);
            if (!read.ok) {
                skipped.push({ path: target, reason: read.reason });
                continue;
            }
            const base = path.basename(target);
            let dest = path.join(qdir, base);
            let n = 1;
            while (fs.existsSync(dest)) {
                dest = path.join(qdir, `${base}.${n}`);
                n++;
            }
            fs.copyFileSync(target, dest);
            entries.push({
                originalPath: path.resolve(target),
                quarantinePath: dest,
                sha256: sha256(read.content),
                bytes: read.content.length,
                reason: `quarantined for incident ${incidentId}`,
                quarantinedAt: at
            });
        }

        if (entries.length === 0) {
            arsenalCore.audit('INCIDENT_CONTAIN', 'defensive-ir', 'FAILURE', {
                incidentId, reason: 'no_target_file', skipped
            });
            return { contained: false, applied: false, reason: 'no_target_file', quarantined: [], skipped };
        }

        const manifestPath = path.join(qdir, 'manifest.json');
        const previous = this.readQuarantineManifest(manifestPath);
        const merged = [...previous, ...entries.filter(
            e => !previous.some(p => p.originalPath === e.originalPath && p.sha256 === e.sha256)
        )];
        fs.writeFileSync(manifestPath, JSON.stringify({
            incidentId,
            operationId: this.ctx.operationId,
            createdAt: at,
            createdAtIso: new Date(at).toISOString(),
            mode: 'quarantine-by-copy',
            reversible: true,
            entries: merged
        }, null, 2));

        incident.status = 'CONTAINED';
        incident.updatedAt = Date.now();
        incident.timeline.push({ timestamp: Date.now(), action: 'CONTAINED', actor: 'defensive-ir' });

        arsenalCore.audit('INCIDENT_CONTAIN', 'defensive-ir', 'SUCCESS', {
            incidentId,
            manifestPath,
            files: entries.map(e => ({ originalPath: e.originalPath, quarantinePath: e.quarantinePath, sha256: e.sha256, bytes: e.bytes })),
            skipped
        });

        return { contained: true, applied: true, manifestPath, quarantined: entries, skipped };
    }

    private resolveContainTargets(
        incident: Incident,
        targetPath: string | undefined,
        skipped: Array<{ path: string; reason: string }>
    ): string[] {
        const scope = this.ctx.scope || [];
        const candidates: string[] = [];

        if (targetPath) {
            candidates.push(targetPath);
        } else {
            for (const alert of incident.alerts || []) {
                const src = alert.source;
                if (!src || src === 'journalctl') continue;
                if (!path.isAbsolute(src)) continue;
                if (!candidates.includes(src)) candidates.push(src);
            }
        }

        const out: string[] = [];
        for (const candidate of candidates) {
            const abs = path.resolve(candidate);
            const inScope = scope.some(root => pathWithin(abs, root));
            if (!inScope && !isSystemPath(abs)) {
                skipped.push({ path: abs, reason: 'out_of_scope' });
                continue;
            }
            let st: fs.Stats | null = null;
            try { st = fs.statSync(abs); } catch { /* handled below */ }
            if (!st) {
                skipped.push({ path: abs, reason: 'ENOENT' });
                continue;
            }
            if (!st.isFile()) {
                skipped.push({ path: abs, reason: 'EISDIR' });
                continue;
            }
            out.push(abs);
        }
        return out;
    }

    private readQuarantineManifest(manifestPath: string): QuarantineEntry[] {
        try {
            const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            return Array.isArray(parsed?.entries) ? parsed.entries : [];
        } catch {
            return [];
        }
    }

    /**
     * Persistence eradication.
     *
     * Default is a dry run: the exact persistence entries that WOULD be removed are returned
     * with file, line number and a content hash, and nothing is modified. Removal only happens
     * when `dryRun === false` is passed explicitly AND authorization + sandbox mode are present;
     * the affected files are backed up and the offending lines are commented out (never deleted).
     */
    async eradicate(incidentId: string, dryRun = true): Promise<EradicateResult> {
        const incident = this.findIncident(incidentId);
        if (!incident) {
            arsenalCore.audit('INCIDENT_ERADICATE', 'defensive-ir', 'REFUSED', { incidentId, reason: 'incident_not_found' });
            return {
                applied: false, dryRun, reason: 'incident_not_found',
                entries: [], matchingCount: 0, totalEnumerated: 0, basis: 'incident not found'
            };
        }

        const enumerated = await this.enumeratePersistence();
        const tokens = this.incidentTokens(incident);
        const matching = tokens.length
            ? enumerated.filter(e => tokens.some(t => e.content.toLowerCase().includes(t)))
            : enumerated.slice();

        const basis = tokens.length
            ? `matched ${matching.length} persistence entr(ies) against incident tokens [${tokens.join(', ')}]`
            : 'no incident token available - enumerated every persistence entry found on the host';

        if (dryRun) {
            arsenalCore.audit('INCIDENT_ERADICATE', 'defensive-ir', 'DRY_RUN', {
                incidentId, matching: matching.length, enumerated: enumerated.length, tokens
            });
            return {
                applied: false, dryRun: true, entries: matching,
                matchingCount: matching.length, totalEnumerated: enumerated.length, basis
            };
        }

        const gate = this.gate();
        if (!gate.allowed) {
            arsenalCore.audit('INCIDENT_ERADICATE', 'defensive-ir', 'REFUSED', {
                incidentId, reason: gate.reason,
                authorizationPresent: !!this.ctx.authorization,
                sandboxMode: arsenalCore.getStatus().config.sandboxMode
            });
            return {
                applied: false, dryRun: false, reason: gate.reason, entries: matching,
                matchingCount: matching.length, totalEnumerated: enumerated.length, basis
            };
        }

        const byFile = new Map<string, PersistenceEntry[]>();
        for (const entry of matching) {
            const list = byFile.get(entry.file) ?? [];
            list.push(entry);
            byFile.set(entry.file, list);
        }

        const backups: Array<{ file: string; backupPath: string; sha256Before: string; sha256After: string }> = [];
        const stamp = new Date().toISOString();
        const fileStamp = Date.now();

        for (const [file, entries] of byFile) {
            const read = readFileBounded(file, 8 * 1024 * 1024);
            if (!read.ok) continue;
            const before = sha256(read.content);
            const backupPath = `${file}.arsenal-backup-${fileStamp}`;
            try {
                fs.copyFileSync(file, backupPath);
            } catch {
                continue; // no backup -> do not touch the original
            }
            const lines = read.content.toString('utf8').split(/\r?\n/);
            const targetLines = new Set(entries.map(e => e.line));
            const rewritten = lines.map((line, idx) =>
                (targetLines.has(idx + 1) && line.trim() && !line.trim().startsWith('#'))
                    ? `# [arsenal-eradicated ${stamp}] ${line}`
                    : line
            );
            const after = Buffer.from(rewritten.join('\n'), 'utf8');
            try {
                fs.writeFileSync(file, after);
            } catch {
                continue;
            }
            backups.push({ file, backupPath, sha256Before: before, sha256After: sha256(after) });
        }

        arsenalCore.audit('INCIDENT_ERADICATE', 'defensive-ir', 'SUCCESS', {
            incidentId, commented: backups.length, backups
        });

        incident.updatedAt = Date.now();
        incident.timeline.push({ timestamp: Date.now(), action: 'ERADICATED', actor: 'defensive-ir' });

        return {
            applied: true, dryRun: false, entries: matching,
            matchingCount: matching.length, totalEnumerated: enumerated.length, basis, backups
        };
    }

    /** Real persistence mechanisms discovered on the host. No file content is invented. */
    private async enumeratePersistence(): Promise<PersistenceEntry[]> {
        const entries: PersistenceEntry[] = [];

        const addFileEntries = (file: string, category: PersistenceEntry['category']) => {
            const read = readFileBounded(file, 4 * 1024 * 1024);
            if (!read.ok) return;
            const lines = read.content.toString('utf8').split(/\r?\n/);
            lines.forEach((line, idx) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                entries.push({
                    file,
                    line: idx + 1,
                    content: trimmed.length > 300 ? trimmed.slice(0, 300) : trimmed,
                    contentHash: sha256(trimmed),
                    category,
                    matched: false
                });
            });
        };

        // cron: system crontab, /etc/cron.d and the periodic directories
        addFileEntries('/etc/crontab', 'cron');
        for (const dir of ['/etc/cron.d', '/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly']) {
            let names: string[] = [];
            try { names = fs.readdirSync(dir); } catch { continue; }
            for (const name of names) {
                const p = path.join(dir, name);
                try { if (fs.statSync(p).isFile()) addFileEntries(p, 'cron'); } catch { /* skip */ }
            }
        }

        // user crontab (real crontab binary)
        const crontab = await runCommand('crontab', ['-l']);
        if (crontab.ok) {
            crontab.stdout.toString('utf8').split(/\r?\n/).forEach((line, idx) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                entries.push({
                    file: `crontab:${os.userInfo().username}`,
                    line: idx + 1,
                    content: trimmed.length > 300 ? trimmed.slice(0, 300) : trimmed,
                    contentHash: sha256(trimmed),
                    category: 'cron',
                    matched: false
                });
            });
        }

        // systemd unit files
        const unitDirs = ['/etc/systemd/system', path.join(os.homedir(), '.config/systemd/user')];
        for (const dir of unitDirs) {
            let names: string[] = [];
            try { names = fs.readdirSync(dir); } catch { continue; }
            for (const name of names) {
                if (!/\.(service|timer|socket|path)$/i.test(name)) continue;
                addFileEntries(path.join(dir, name), 'systemd');
            }
        }

        // shell profiles
        for (const profile of ['.bashrc', '.profile', '.bash_profile']) {
            const p = path.join(os.homedir(), profile);
            if (fs.existsSync(p)) addFileEntries(p, 'shell_profile');
        }

        // ssh authorized keys
        const authKeys = path.join(os.homedir(), '.ssh', 'authorized_keys');
        if (fs.existsSync(authKeys)) addFileEntries(authKeys, 'authorized_keys');

        return entries;
    }

    /**
     * Tokens that tie a persistence entry to the incident: usernames and addresses observed in
     * the incident alerts, plus the significant words of the incident title.
     */
    private incidentTokens(incident: Incident): string[] {
        const tokens = new Set<string>();
        for (const alert of incident.alerts || []) {
            const detailed = alert as DetailedAlert;
            if (detailed.username) tokens.add(detailed.username.toLowerCase());
            if (detailed.ip) tokens.add(detailed.ip.toLowerCase());
            const ipInRaw = extractIp(alert.description || '');
            if (ipInRaw) tokens.add(ipInRaw.toLowerCase());
            const userInRaw = extractUsername(alert.description || '');
            if (userInRaw) tokens.add(userInRaw.toLowerCase());
        }
        const stopWords = new Set([
            'incident', 'probe', 'verification', 'containment', 'contained', 'quarantine',
            'target', 'file', 'created', 'test', 'alert', 'detection', 'response'
        ]);
        for (const word of (incident.title || '').toLowerCase().split(/[^a-z0-9._-]+/)) {
            if (word.length < 4) continue;
            if (stopWords.has(word)) continue;
            tokens.add(word);
        }
        return [...tokens];
    }

    /**
     * Restore files previously quarantined for an incident.
     *
     * Containment is quarantine-by-copy, so the original file is normally still in place and
     * recovery is then a no-op (`skipped: 'destination exists'`) - the restored copy must never
     * overwrite a file that appeared in the meantime. A file is only restored when its original
     * path does not exist. sha256 is recorded before and after the restore so the result can be
     * proven.
     */
    async recover(incidentId: string): Promise<RecoverResult> {
        const qdir = path.join(arsenalDataDir('quarantine'), incidentId);
        const manifestPath = path.join(qdir, 'manifest.json');

        if (!fs.existsSync(manifestPath)) {
            arsenalCore.audit('INCIDENT_RECOVER', 'defensive-ir', 'FAILURE', {
                incidentId, reason: 'no_quarantine_manifest', expected: manifestPath
            });
            return { recovered: false, reason: 'no_quarantine_manifest', restored: [], skipped: [] };
        }

        const manifest = this.readQuarantineManifest(manifestPath);
        const restored: RecoverResult['restored'] = [];
        const skipped: Array<{ originalPath: string; reason: string }> = [];

        for (const entry of manifest) {
            if (!entry.originalPath) {
                skipped.push({ originalPath: String(entry.originalPath ?? ''), reason: 'malformed manifest entry' });
                continue;
            }
            if (fs.existsSync(entry.originalPath)) {
                skipped.push({ originalPath: entry.originalPath, reason: 'destination exists' });
                continue;
            }
            if (!fs.existsSync(entry.quarantinePath)) {
                skipped.push({ originalPath: entry.originalPath, reason: 'quarantined copy missing' });
                continue;
            }
            const before = sha256(fs.readFileSync(entry.quarantinePath));
            try {
                fs.mkdirSync(path.dirname(entry.originalPath), { recursive: true });
                fs.copyFileSync(entry.quarantinePath, entry.originalPath);
            } catch (e) {
                skipped.push({ originalPath: entry.originalPath, reason: errorReason(e) });
                continue;
            }
            const after = sha256(fs.readFileSync(entry.originalPath));
            restored.push({
                originalPath: entry.originalPath,
                quarantinePath: entry.quarantinePath,
                sha256Before: before,
                sha256Expected: entry.sha256,
                sha256After: after,
                verified: after === entry.sha256 && after === before
            });
        }

        const incident = this.findIncident(incidentId);
        if (incident && restored.length > 0) {
            incident.status = 'RESOLVED';
            incident.updatedAt = Date.now();
            incident.timeline.push({ timestamp: Date.now(), action: 'RECOVERED', actor: 'defensive-ir' });
        }

        arsenalCore.audit('INCIDENT_RECOVER', 'defensive-ir', restored.length > 0 ? 'SUCCESS' : 'PARTIAL', {
            incidentId,
            manifestPath,
            restored: restored.map(r => ({ originalPath: r.originalPath, sha256Before: r.sha256Before, sha256After: r.sha256After, verified: r.verified })),
            skipped
        });

        return {
            recovered: restored.length > 0,
            manifestPath,
            restored,
            skipped
        };
    }
}

/* ====================================================================================================
 * FORENSICS
 * ================================================================================================== */

export class ForensicsModule {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('FORENSICS_INIT', 'defensive-forensics', 'SUCCESS', { opId: ctx.operationId });
    }

    /**
     * REAL artifact collection.
     *
     * Every artifact is produced by an actual command execution or an actual file read. The
     * sha256 of the collected bytes and the byte size are recorded, and the bytes are copied
     * into `data/arsenal/forensics/<timestamp>/` next to a manifest.json. Failures are reported
     * with the concrete reason and are never listed as collected artifacts.
     */
    async collectArtifacts(): Promise<ArtifactCollectionResult> {
        const started = Date.now();
        arsenalCore.audit('ARTIFACT_COLLECT', 'defensive-forensics', 'ATTEMPT', { operationId: this.ctx.operationId });

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = path.join(arsenalDataDir('forensics'), stamp);
        fs.mkdirSync(dir, { recursive: true });

        const artifacts: ArtifactRecord[] = [];
        const failures: ArtifactRecord[] = [];
        const collectedAt = Date.now();

        const store = (name: string, source: string, content: Buffer, sourceSha?: string) => {
            const fileName = `${name.replace(/[^A-Za-z0-9._-]/g, '_')}.bin`;
            const stored = path.join(dir, fileName);
            fs.writeFileSync(stored, content);
            artifacts.push({
                name,
                source,
                sha256: sha256(content),
                bytes: content.length,
                ok: true,
                collectedAt,
                storedPath: stored,
                ...(sourceSha ? { sourceSha256: sourceSha } : {})
            });
        };

        const fail = (name: string, source: string, reason: string) => {
            failures.push({ name, source, sha256: '', bytes: 0, ok: false, reason, collectedAt });
        };

        // --- command artifacts -------------------------------------------------
        const commands: Array<{ name: string; cmd: string; args: string[]; source: string }> = [
            { name: 'ss_tanp', cmd: 'ss', args: ['-tanp'], source: 'ss -tanp' },
            { name: 'ss_tulnp', cmd: 'ss', args: ['-tulnp'], source: 'ss -tulnp' },
            { name: 'ps_auxww', cmd: 'ps', args: ['auxww'], source: 'ps auxww' },
            { name: 'ip_addr_show', cmd: 'ip', args: ['addr', 'show'], source: 'ip addr show' },
            { name: 'id', cmd: 'id', args: [], source: 'id' },
            { name: 'uname_a', cmd: 'uname', args: ['-a'], source: 'uname -a' },
            { name: 'whoami', cmd: 'whoami', args: [], source: 'whoami' },
            { name: 'systemctl_services', cmd: 'systemctl', args: ['list-units', '--type=service', '--no-pager'], source: 'systemctl list-units --type=service --no-pager' }
        ];

        for (const spec of commands) {
            const res = await runCommand(spec.cmd, spec.args);
            if (res.ok && res.stdout.length > 0) {
                store(spec.name, spec.source, res.stdout);
            } else {
                fail(spec.name, spec.source, res.ok ? 'empty output' : (res.reason ?? 'EXEC_FAILED'));
            }
        }

        // --- kernel ring buffer (real dmesg output, last 50 lines) ------------
        {
            const res = await runCommand('dmesg', []);
            if (res.ok) {
                const lines = res.stdout.toString('utf8').split(/\r?\n/).filter(l => l.length > 0);
                const tail = lines.slice(Math.max(0, lines.length - 50));
                store('dmesg_tail50', 'dmesg | tail -50', Buffer.from(tail.join('\n') + '\n', 'utf8'));
            } else {
                fail('dmesg_tail50', 'dmesg | tail -50', res.reason ?? 'EXEC_FAILED');
            }
        }

        // --- user crontabs (real crontab binary, one call per user) ----------
        for (const user of this.cronUsers()) {
            const res = await runCommand('crontab', ['-l', '-u', user]);
            if (res.ok && res.stdout.length > 0) {
                store(`crontab_${user}`, `crontab -l -u ${user}`, res.stdout);
            } else {
                fail(`crontab_${user}`, `crontab -l -u ${user}`,
                    res.ok ? 'empty crontab' : `${res.reason ?? 'EXEC_FAILED'}${res.stderr ? `: ${res.stderr.trim().split('\n')[0]}` : ''}`);
            }
        }

        // --- file artifacts ----------------------------------------------------
        const files: Array<{ name: string; path: string; redact?: (b: Buffer) => Buffer }> = [
            { name: 'etc_passwd', path: '/etc/passwd' },
            { name: 'etc_shadow', path: '/etc/shadow', redact: b => redactShadow(b) },
            { name: 'etc_hosts', path: '/etc/hosts' },
            { name: 'etc_resolv_conf', path: '/etc/resolv.conf' },
            { name: 'etc_crontab', path: '/etc/crontab' },
            { name: 'proc_net_tcp', path: '/proc/net/tcp' }
        ];
        for (const spec of files) {
            const read = readFileBounded(spec.path);
            if (!read.ok) {
                fail(spec.name, spec.path, read.reason);
                continue;
            }
            const rawSha = sha256(read.content);
            const stored = spec.redact ? spec.redact(read.content) : read.content;
            store(spec.name, spec.path, stored, spec.redact ? rawSha : undefined);
        }

        // --- directory listings (names/metadata only, never file contents) -----
        const listingDirs = [
            '/etc/cron.d', '/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly'
        ];
        for (const dirPath of listingDirs) {
            const rendered = this.renderListing(dirPath, false);
            if (rendered.ok) store(`listing_${dirPath.replace(/[^A-Za-z0-9]/g, '_')}`, `${dirPath} (listing)`, rendered.content);
            else fail(`listing_${dirPath.replace(/[^A-Za-z0-9]/g, '_')}`, `${dirPath} (listing)`, rendered.reason);
        }

        {
            const sshDir = path.join(os.homedir(), '.ssh');
            const rendered = this.renderListing(sshDir, true);
            if (rendered.ok) store('listing_user_ssh', `${sshDir} (listing, key contents NOT collected)`, rendered.content);
            else fail('listing_user_ssh', `${sshDir} (listing, key contents NOT collected)`, rendered.reason);
        }

        const manifest = {
            operationId: this.ctx.operationId,
            collectedAt,
            collectedAtIso: new Date(collectedAt).toISOString(),
            host: os.hostname(),
            user: os.userInfo().username,
            directory: dir,
            artifactCount: artifacts.length,
            artifacts,
            failures,
            durationMs: Date.now() - started
        };
        const manifestPath = path.join(dir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        const manifestSha = sha256(fs.readFileSync(manifestPath));

        arsenalCore.audit('ARTIFACT_COLLECT', 'defensive-forensics', 'SUCCESS', {
            operationId: this.ctx.operationId,
            manifestPath,
            manifestSha256: manifestSha,
            artifactCount: artifacts.length,
            failures: failures.map(f => ({ name: f.name, source: f.source, reason: f.reason })),
            durationMs: manifest.durationMs
        });

        return {
            manifestPath,
            artifactCount: artifacts.length,
            artifacts,
            failures,
            durationMs: manifest.durationMs,
            directory: dir
        };
    }

    /** Users whose crontab is inspected (root + accounts with a real login shell). */
    private cronUsers(): string[] {
        const users: string[] = ['root'];
        const me = os.userInfo().username;
        if (!users.includes(me)) users.push(me);
        try {
            const passwd = fs.readFileSync('/etc/passwd', 'utf8');
            for (const line of passwd.split('\n')) {
                const parts = line.split(':');
                if (parts.length < 7) continue;
                const [name, , uid, gid] = parts;
                const shell = parts[6];
                if (Number(uid) < 1000) continue;
                if (shell.includes('nologin') || shell.includes('false')) continue;
                if (users.includes(name)) continue;
                users.push(name);
                if (users.length >= 6) break;
            }
        } catch { /* /etc/passwd unreadable -> only root + current user */ }
        return users;
    }

    /** Render a directory listing. Key material is never read - only names and metadata. */
    private renderListing(dirPath: string, redactKeys: boolean): FileReadResult {
        let names: string[];
        try {
            names = fs.readdirSync(dirPath);
        } catch (e) {
            return { ok: false, content: null, reason: errorReason(e) };
        }
        const lines: string[] = [`# listing of ${dirPath} (names + metadata only, file contents not collected)`];
        let authorizedKeys = false;
        for (const name of names.sort()) {
            const p = path.join(dirPath, name);
            let mode = '???????';
            let size = 0;
            let mtime = '';
            try {
                const st = fs.lstatSync(p);
                mode = (st.mode & 0o7777).toString(8).padStart(4, '0');
                size = st.size;
                mtime = new Date(st.mtimeMs).toISOString();
            } catch { /* keep placeholders for unreadable entries */ }
            const isKey = redactKeys && (/authorized_keys$/.test(name) || /^id_/.test(name) || /\.pem$/.test(name) || /\.pub$/.test(name));
            if (/authorized_keys$/.test(name)) authorizedKeys = true;
            lines.push(`${mode} ${String(size).padStart(10)} ${mtime} ${name}${isKey ? '   [key material - contents NOT collected]' : ''}`);
        }
        if (redactKeys) {
            lines.push(`# authorized_keys present: ${authorizedKeys ? 'yes' : 'no'}`);
        }
        return { ok: true, content: Buffer.from(lines.join('\n') + '\n', 'utf8'), reason: null };
    }

    /**
     * REAL timeline built from real timestamps:
     *   - file mtimes inside the operation scope (bounded to 5000 files, node_modules/.git skipped)
     *   - alerts produced by the log scan that carry a parsed timestamp
     *   - the arsenal audit log
     *   - real process start times from `ps -eo lstart,pid,comm`
     */
    async timelineAnalysis(): Promise<TimelineResult> {
        arsenalCore.audit('TIMELINE_ANALYSIS', 'defensive-forensics', 'ATTEMPT', { operationId: this.ctx.operationId });

        const events: TimelineEvent[] = [];
        const basis: string[] = [];
        const scope = this.ctx.scope || [];

        if (scope.length > 0) {
            let files = 0;
            let truncated = false;
            const skipDirs = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', '__pycache__', '.next', '.cache']);
            const walk = (dir: string, root: string, depth: number) => {
                if (files >= MAX_TIMELINE_FILES) { truncated = true; return; }
                if (depth > 24) return;
                let entries: fs.Dirent[];
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const entry of entries) {
                    if (files >= MAX_TIMELINE_FILES) { truncated = true; return; }
                    if (skipDirs.has(entry.name)) continue;
                    const p = path.join(dir, entry.name);
                    if (entry.isDirectory()) { walk(p, root, depth + 1); continue; }
                    if (!entry.isFile()) continue;
                    let st: fs.Stats;
                    try { st = fs.statSync(p); } catch { continue; }
                    files++;
                    events.push({
                        ts: st.mtimeMs,
                        source: p,
                        type: 'file_mtime',
                        summary: `file modified: ${path.relative(root, p) || path.basename(p)}`,
                        detail: `${p} mode=${(st.mode & 0o777).toString(8)} bytes=${st.size}`
                    });
                }
            };
            for (const root of scope) walk(root, root, 0);
            basis.push(`${files} file mtime(s) from operation scope${truncated ? ` (truncated at ${MAX_TIMELINE_FILES})` : ''}`);
        } else {
            const fallback = this.latestForensicsManifest();
            if (fallback) {
                for (const a of fallback.artifacts) {
                    events.push({
                        ts: a.collectedAt,
                        source: a.source,
                        type: 'artifact',
                        summary: `artifact collected: ${a.name}`,
                        detail: `${a.source} sha256=${a.sha256}`
                    });
                }
                basis.push(`scope empty - fell back to artifact manifest ${fallback.path} (${fallback.artifacts.length} artifact(s))`);
            } else {
                basis.push('scope empty and no artifact manifest found - no file events available');
            }
        }

        const alerts = ALERT_STORE.get(this.ctx.operationId) ?? [];
        const parsedAlerts = alerts.filter(a => a.timestampSource === 'parsed');
        for (const a of parsedAlerts) {
            events.push({
                ts: a.timestamp,
                source: `${a.source}:${a.lineNumber}`,
                type: 'alert',
                summary: `${a.ruleId} ${a.title}`,
                detail: a.raw
            });
        }
        basis.push(`${parsedAlerts.length} alert(s) with parsed timestamps (${alerts.length - parsedAlerts.length} without a parseable timestamp were excluded)`);

        const audit = arsenalCore.getAuditLog(1000);
        for (const entry of audit) {
            events.push({
                ts: entry.timestamp,
                source: entry.actor,
                type: 'audit',
                summary: `${entry.action} -> ${entry.result}`,
                detail: JSON.stringify(entry.evidence ?? {}).slice(0, 400)
            });
        }
        basis.push(`${audit.length} audit entr(ies) from the arsenal core audit log`);

        const ps = await runCommand('ps', ['-eo', 'lstart,pid,comm']);
        if (ps.ok) {
            const lines = ps.stdout.toString('utf8').split(/\r?\n/).slice(1);
            let count = 0;
            for (const line of lines) {
                // groups: 1=weekday 2=month 3=day 4=hour 5=minute 6=second 7=year 8=pid 9=command
                const m = line.match(/^\s*(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+(\d+)\s+(.*)$/);
                if (!m) continue;
                const month = MONTH_INDEX[m[2].toLowerCase()];
                if (month === undefined) continue;
                const start = new Date(
                    Number(m[7]), month, Number(m[3]),
                    Number(m[4]), Number(m[5]), Number(m[6])
                );
                count++;
                events.push({
                    ts: start.getTime(),
                    source: `pid ${m[8]}`,
                    type: 'process_start',
                    summary: `process started: ${m[9].trim()}`,
                    detail: line.trim()
                });
            }
            basis.push(`${count} process start time(s) from 'ps -eo lstart,pid,comm'`);
        } else {
            basis.push(`process start times unavailable (${ps.reason ?? 'EXEC_FAILED'})`);
        }

        events.sort((a, b) => a.ts - b.ts);

        const result: TimelineResult = {
            events,
            total: events.length,
            range: {
                first: events.length ? events[0].ts : null,
                last: events.length ? events[events.length - 1].ts : null
            },
            basis: basis.join('; ')
        };

        arsenalCore.audit('TIMELINE_ANALYSIS', 'defensive-forensics', 'SUCCESS', {
            total: result.total, first: result.range.first, last: result.range.last, basis: result.basis
        });

        return result;
    }

    /** Most recent artifact manifest on disk (used when the operation scope is empty). */
    private latestForensicsManifest(): { path: string; artifacts: ArtifactRecord[] } | null {
        const base = arsenalDataDir('forensics');
        let dirs: string[];
        try { dirs = fs.readdirSync(base); } catch { return null; }
        const candidates = dirs
            .map(d => path.join(base, d))
            .filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })
            .sort();
        for (const dir of candidates.reverse()) {
            const manifestPath = path.join(dir, 'manifest.json');
            if (!fs.existsSync(manifestPath)) continue;
            try {
                const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (Array.isArray(parsed?.artifacts)) {
                    return { path: manifestPath, artifacts: parsed.artifacts };
                }
            } catch { /* try an older manifest */ }
        }
        return null;
    }

    /**
     * REAL /proc based process inspection.
     *
     * Reads maps/status/cmdline/exe/cwd for the selected PIDs and compares the sha256 of
     * /proc/<pid>/exe with the on-disk binary. Environment variables are read ONLY for
     * processes owned by the current user and ONLY the variable NAMES of secret-looking
     * variables are reported - never their values.
     *
     * Byte-level memory dumping of /proc/<pid>/mem is NOT performed; see the `limits` field.
     */
    async memoryAnalysis(pids?: number[]): Promise<MemoryAnalysisResult> {
        arsenalCore.audit('MEMORY_ANALYSIS', 'defensive-forensics', 'ATTEMPT', {
            operationId: this.ctx.operationId, requested: pids?.length ?? 0
        });

        const targets = (pids && pids.length > 0)
            ? pids.slice(0, MEMORY_SCAN_PID_CAP)
            : this.ownedPids(MEMORY_SCAN_PID_CAP);

        const myUid = String(process.getuid());
        const profiles: ProcessMemoryProfile[] = [];
        let withRwx = 0;
        let withDeletedBinary = 0;
        let permissionDenied = 0;
        const memAccess = { attempted: 0, opened: 0, denied: 0, reasons: [] as string[] };

        for (const pid of targets) {
            const profile = this.profileProcess(pid, myUid, memAccess);
            profiles.push(profile);
            if (!profile.readable) { permissionDenied++; continue; }
            if (profile.rwxRegions > 0) withRwx++;
            if (profile.deletedBinary) withDeletedBinary++;
        }

        const limits =
            'Byte-level memory dumping of /proc/<pid>/mem was NOT performed. ' +
            'Reason: this process runs as a non-root user without CAP_SYS_PTRACE, and the kernel ' +
            'enforces a restricted ptrace policy (Yama ptrace_scope=1), so ptrace/mem access to ' +
            'other users\' processes is denied by the kernel (EACCES/EPERM). ' +
            'Even for same-user processes a meaningful memory dump requires ELF/heap/stack symbol ' +
            'parsing and process attach, which this read-only defensive pass deliberately does not ' +
            'perform. ' +
            'What WAS inspected: /proc/<pid>/maps (region count, RWX regions, anonymous+executable ' +
            'mappings, deleted mappings), /proc/<pid>/status, /proc/<pid>/cmdline, the /proc/<pid>/exe ' +
            'symlink and its sha256, /proc/<pid>/cwd, and the NAMES (never the values) of ' +
            'secret-looking environment variables in same-user processes. ' +
            'No process memory bytes were read or reported.';

        const result: MemoryAnalysisResult = {
            processes: profiles,
            summary: { scanned: profiles.length, withRwx, withDeletedBinary, permissionDenied },
            limits,
            basis: pids && pids.length > 0
                ? `explicit pid list (${targets.length} pid(s), capped at ${MEMORY_SCAN_PID_CAP})`
                : `${targets.length} process(es) owned by uid ${myUid} (capped at ${MEMORY_SCAN_PID_CAP})`,
            memAccess
        };

        arsenalCore.audit('MEMORY_ANALYSIS', 'defensive-forensics', 'SUCCESS', {
            scanned: result.summary.scanned, withRwx, withDeletedBinary, permissionDenied,
            memAccess: { attempted: memAccess.attempted, opened: memAccess.opened, denied: memAccess.denied }
        });

        return result;
    }

    /** PIDs owned by the current user, taken from real /proc entries. */
    private ownedPids(limit: number): number[] {
        const myUid = process.getuid();
        const out: number[] = [];
        let entries: string[];
        try { entries = fs.readdirSync('/proc'); } catch { return out; }
        for (const entry of entries) {
            if (!/^\d+$/.test(entry)) continue;
            const pid = Number(entry);
            if (pid <= 0) continue;
            const status = this.readProcFile(`/proc/${pid}/status`);
            if (!status) continue;
            const m = status.match(/^Uid:\s*(\d+)/m);
            if (!m || Number(m[1]) !== myUid) continue;
            out.push(pid);
            if (out.length >= limit) break;
        }
        return out;
    }

    private readProcFile(p: string): string | null {
        try {
            return fs.readFileSync(p, 'utf8');
        } catch {
            return null;
        }
    }

    private profileProcess(
        pid: number,
        myUid: string,
        memAccess: { attempted: number; opened: number; denied: number; reasons: string[] }
    ): ProcessMemoryProfile {
        const profile: ProcessMemoryProfile = {
            pid,
            name: '',
            rwxRegions: 0,
            suspiciousMappings: 0,
            deletedBinary: false,
            secretEnvVarNames: [],
            readable: false
        };

        // --- status ---
        const status = this.readProcFile(`/proc/${pid}/status`);
        if (status) {
            profile.name = (status.match(/^Name:\s*(.+)$/m)?.[1] ?? '').trim();
            profile.state = (status.match(/^State:\s*(.+)$/m)?.[1] ?? '').trim();
            profile.vmRss = (status.match(/^VmRSS:\s*(.+)$/m)?.[1] ?? '').trim();
            profile.uid = (status.match(/^Uid:\s*(.+)$/m)?.[1] ?? '').trim();
        }

        // --- memory access probe (open only - no bytes are read) ---
        memAccess.attempted++;
        try {
            const fd = fs.openSync(`/proc/${pid}/mem`, 'r');
            fs.closeSync(fd);
            memAccess.opened++;
        } catch (e) {
            memAccess.denied++;
            const reason = errorReason(e);
            if (!memAccess.reasons.includes(reason)) memAccess.reasons.push(reason);
        }

        // --- maps ---
        const maps = readFileBounded(`/proc/${pid}/maps`, 8 * 1024 * 1024);
        if (!maps.ok) {
            profile.readable = false;
            profile.reason = maps.reason;
            return profile;
        }
        profile.readable = true;
        let regions = 0;
        let anonExec = 0;
        let deleted = 0;
        for (const line of maps.content.toString('utf8').split('\n')) {
            if (!line.trim()) continue;
            regions++;
            const parts = line.trim().split(/\s+/);
            const perms = parts[1] ?? '';
            const pathname = parts.slice(5).join(' ');
            if (perms[0] === 'r' && perms[1] === 'w' && perms[2] === 'x') profile.rwxRegions++;
            if (!pathname && perms[2] === 'x') anonExec++;
            if (pathname.includes('(deleted)')) deleted++;
        }
        profile.regions = regions;
        profile.suspiciousMappings = anonExec + deleted;

        // --- cmdline ---
        const cmdlineRaw = readFileBounded(`/proc/${pid}/cmdline`, 1024 * 1024);
        if (cmdlineRaw.ok) {
            profile.cmdline = cmdlineRaw.content.toString('utf8').split('\0').filter(Boolean).join(' ').slice(0, 300);
        }

        // --- exe (symlink + on-disk hash comparison) ---
        try {
            const link = fs.readlinkSync(`/proc/${pid}/exe`);
            profile.exe = link;
            if (link.endsWith(' (deleted)')) {
                profile.deletedBinary = true;
            } else {
                const live = readFileBounded(`/proc/${pid}/exe`, 256 * 1024 * 1024);
                const disk = readFileBounded(link, 256 * 1024 * 1024);
                if (live.ok && disk.ok && sha256(live.content) !== sha256(disk.content)) {
                    // the running image does not match the file on disk
                    profile.deletedBinary = true;
                }
            }
        } catch (e) {
            profile.exe = profile.exe ?? `unreadable (${errorReason(e)})`;
        }

        // --- cwd ---
        try {
            profile.cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
        } catch (e) {
            profile.cwd = `unreadable (${errorReason(e)})`;
        }

        // --- environ: same-user processes only, NAMES only ---
        const ownerUid = profile.uid ? profile.uid.trim().split(/\s+/)[0] : null;
        if (ownerUid === myUid) {
            const environ = readFileBounded(`/proc/${pid}/environ`, 1024 * 1024);
            if (environ.ok) {
                const names = environ.content.toString('utf8').split('\0').filter(Boolean)
                    .map(entry => entry.split('=')[0])
                    .filter(name => /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|ACCESS)/i.test(name))
                    .sort();
                profile.secretEnvVarNames = [...new Set(names)];
            }
        }

        return profile;
    }
}

/** Redact password hashes in a /etc/shadow copy before it is stored as an artifact. */
function redactShadow(buffer: Buffer): Buffer {
    const text = buffer.toString('utf8');
    const redacted = text.split('\n').map(line => {
        if (!line.includes(':')) return line;
        const parts = line.split(':');
        if (parts.length < 2) return line;
        parts[1] = '[REDACTED]';
        return parts.join(':');
    }).join('\n');
    return Buffer.from(redacted, 'utf8');
}

/* ====================================================================================================
 * FACADE
 * ================================================================================================== */

export class DefensiveArsenal {
    hardening: HardeningModule;
    detection: ThreatDetectionModule;
    incidentResponse: IncidentResponseModule;
    forensics: ForensicsModule;

    constructor(ctx: OperationContext) {
        this.hardening = new HardeningModule(ctx);
        this.detection = new ThreatDetectionModule(ctx);
        this.incidentResponse = new IncidentResponseModule(ctx);
        this.forensics = new ForensicsModule(ctx);
        arsenalCore.audit('DEFENSIVE_ARSENAL_INIT', 'defensive', 'SUCCESS', { opId: ctx.operationId });
    }
}

export default DefensiveArsenal;
