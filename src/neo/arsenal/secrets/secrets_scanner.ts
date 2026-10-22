/**
 * ====================================================================================================
 * SECRETS SCANNER — REAL CREDENTIAL DETECTION ON REAL BYTES
 * ====================================================================================================
 * Standard: Diamond Standard (v3.0-HARDENED)
 *
 * This module performs REAL static analysis over REAL data:
 *  - the filesystem is walked READ-ONLY and the bytes are read from disk
 *  - every detection comes from a real regex match or a real Shannon entropy computation
 *  - git history is parsed from the real output of `git log -p`
 *  - file permissions are read from the real `fs.statSync` mode bits
 *  - every secret is REDACTED in every returned / reported field
 *
 * Nothing here returns invented data. If something cannot be checked it is reported as such.
 * ====================================================================================================
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { arsenalCore, OperationContext, SeverityLevel } from '../core/arsenal_core';

/* ------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

/** A single detected credential. The raw secret NEVER appears in this structure. */
export interface SecretFinding {
    id: string;
    /** Detector identifier, e.g. 'aws_access_key_id', 'generic_assignment', 'possible_secret'. */
    type: string;
    /** Path relative to the scan root. */
    file: string;
    /** 1-based line number in the source file (or in the diff hunk for git history). */
    line: number;
    /** 1-based column of the match. */
    column: number;
    /** Masked value: at most first 4 chars + '…' + last 2 chars. */
    redacted: string;
    /** Length of the raw secret (in characters). */
    length: number;
    /** First 12 hex chars of the sha256 of the raw secret. */
    sha256Prefix: string;
    /** Shannon entropy in bits/char, when the detector computed it. */
    entropy?: number;
    severity: SeverityLevel;
    /** 0..1 heuristic confidence of the detector. */
    confidence: number;
    /** The source line with the secret itself replaced by its masked form. */
    context: string;
    /** Always false: a static pattern match is a lead, not a confirmed live credential. */
    verified: boolean;
    /** Key name for env / assignment style detections. */
    keyName?: string;
    /** True when the file mode grants world-read (real stat mode & 0o004). */
    worldReadable?: boolean;
    /** Short commit hash when the finding came from git history. */
    commit?: string;
    /** Where the finding was observed. */
    source?: 'filesystem' | 'git_history' | 'env_file';
}

export interface ScanOptions {
    /** Maximum directory recursion depth. Default 25. */
    maxDepth?: number;
    /** Maximum number of files to open. Default 20000. */
    maxFiles?: number;
    /** Maximum size of a file that will be read. Default 5 MiB. */
    maxFileSize?: number;
    /** Extra directory names to skip. */
    excludeDirs?: string[];
    /** Emit arsenal findings for HIGH/CRITICAL detections. Default true. */
    addFindings?: boolean;
    /** Hard cap on returned findings. Default 2000. */
    maxFindings?: number;
}

export interface SkippedEntry {
    path: string;
    reason: string;
}

export interface ScanSummary {
    root: string;
    filesScanned: number;
    linesScanned: number;
    bytesScanned: number;
    findings: number;
    skipped: SkippedEntry[];
    skippedByReason: Record<string, number>;
    truncated: boolean;
    durationMs: number;
}

export interface SecretsReport {
    operationId: string;
    generatedAt: number;
    total: number;
    filesAffected: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    redactedSamples: Record<string, string[]>;
}

/* ------------------------------------------------------------------------------------------------
 * Detector definitions
 * ---------------------------------------------------------------------------------------------- */

interface Detector {
    type: string;
    regex: RegExp;
    severity: SeverityLevel;
    confidence: number;
    /** 'exposed_secret' for known credential formats, 'secret_exposure' for heuristic hits. */
    category: 'exposed_secret' | 'secret_exposure';
    /** Capture group holding the secret value (defaults to 0 = whole match). */
    group?: number;
    /** Capture group holding the key/identifier name (optional). */
    keyGroup?: number;
    /** Cheap literal prefilter to avoid running the regex on every line. */
    prefilter?: string[];
    /** Optional validator: return false to drop the candidate. */
    validate?: (value: string, keyName: string, fullMatch: string) => boolean;
    note: string;
}

/** Values that are obviously not real credentials. */
const PLACEHOLDER_RE =
    /^(changeme|placeholder|example|your[_-]?|<.*>|\$\{.*\}|process\.env|xxx+|todo|dummy|test|admin|password)$/i;

/** A key name that suggests the value is a digest rather than a secret. */
const HASH_KEY_RE = /hash|md5|sha\d|digest|checksum|uuid|etag|sum/i;

/** Secret-ish keyword used by the generic assignment detector and the entropy detector. */
const SECRET_KEYWORD_RE =
    /(api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key|client[_-]?secret)/i;

/** Config-ish files where a high-entropy string is suspicious even without a keyword. */
const CONFIG_FILE_RE =
    /(^|\/)\.env(\..*)?$|(^|\/)[^/]*\.env$|\.pem$|\.key$|\.p12$|\.pfx$|credentials[^/]*$|secrets?[^/]*$|\.ya?ml$|\.json$/i;

/**
 * Single combined "interesting marker" test. It is a strict superset of every format detector's
 * trigger, so gating on it cannot cause a false negative — it only avoids running 12 regexes on
 * every line of every file in a large tree.
 */
const MARKER_RE =
    /akia|secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|client[_-]?secret|gh[pousr]_|glpat-|xox|_live_|sk-|aiza|eyj|private key|:\/\//i;

const DETECTORS: Detector[] = [
    {
        type: 'aws_access_key_id',
        regex: /\bAKIA[0-9A-Z]{16}\b/g,
        severity: 'CRITICAL',
        confidence: 0.95,
        category: 'exposed_secret',
        prefilter: ['AKIA'],
        note: 'AWS access key id format (AKIA + 16 uppercase alphanumerics)'
    },
    {
        type: 'aws_secret_access_key',
        regex: /aws[_\- ]?secret[_\- ]?(access[_\- ]?)?key\s*[:=]\s*['"]([A-Za-z0-9/+=]{40})['"]/gi,
        severity: 'CRITICAL',
        confidence: 0.95,
        category: 'exposed_secret',
        group: 2,
        prefilter: ['secret'],
        note: 'AWS secret access key assignment'
    },
    {
        type: 'github_token',
        regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
        severity: 'HIGH',
        confidence: 0.9,
        category: 'exposed_secret',
        prefilter: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'],
        note: 'GitHub personal/OAuth/server/user/refresh token'
    },
    {
        type: 'gitlab_token',
        regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
        severity: 'HIGH',
        confidence: 0.9,
        category: 'exposed_secret',
        prefilter: ['glpat-'],
        note: 'GitLab personal access token'
    },
    {
        type: 'slack_token',
        regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
        severity: 'HIGH',
        confidence: 0.9,
        category: 'exposed_secret',
        prefilter: ['xox'],
        note: 'Slack bot/app/user/refresh/legacy token'
    },
    {
        type: 'stripe_live_key',
        regex: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/g,
        severity: 'CRITICAL',
        confidence: 0.95,
        category: 'exposed_secret',
        prefilter: ['_live_'],
        note: 'Stripe live secret or restricted key'
    },
    {
        type: 'openai_key',
        regex: /\bsk-[A-Za-z0-9]{20,}\b/g,
        severity: 'HIGH',
        confidence: 0.9,
        category: 'exposed_secret',
        prefilter: ['sk-'],
        note: 'OpenAI-style secret key'
    },
    {
        type: 'google_api_key',
        regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
        severity: 'HIGH',
        confidence: 0.9,
        category: 'exposed_secret',
        prefilter: ['AIza'],
        note: 'Google API key'
    },
    {
        type: 'jwt',
        regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        severity: 'HIGH',
        confidence: 0.85,
        category: 'exposed_secret',
        prefilter: ['eyJ'],
        note: 'JSON Web Token (three base64url segments)'
    },
    {
        type: 'private_key_block',
        regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g,
        severity: 'CRITICAL',
        confidence: 0.98,
        category: 'exposed_secret',
        prefilter: ['PRIVATE KEY'],
        note: 'PEM private key block header'
    },
    {
        type: 'basic_auth_url',
        regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\/\s:@]+:[^\/\s:@]+@/gi,
        severity: 'HIGH',
        confidence: 0.85,
        category: 'exposed_secret',
        prefilter: ['://'],
        note: 'URL with embedded basic-auth credentials'
    },
    {
        type: 'generic_assignment',
        regex:
            /(api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key|client[_-]?secret)\s*[:=]\s*['"]([^'"\n]{8,120})['"]/gi,
        severity: 'HIGH',
        confidence: 0.7,
        category: 'exposed_secret',
        group: 2,
        keyGroup: 1,
        validate: (value: string, keyName: string) => {
            const v = value.trim();
            if (!v) return false;
            if (PLACEHOLDER_RE.test(v)) return false;
            const distinct = new Set(v).size;
            if (distinct < 3) return false;
            if (/^[0-9a-f]+$/i.test(v) && v.length < 16 && !HASH_KEY_RE.test(keyName)) return false;
            return true;
        },
        note: 'Credential-looking key/value assignment with a non-placeholder value'
    }
];

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

/** Shannon entropy (bits per character) of a real string. */
export function shannonEntropyString(input: string): number {
    if (!input || input.length === 0) return 0;
    const freq = new Map<string, number>();
    for (const ch of input) freq.set(ch, (freq.get(ch) || 0) + 1);
    let entropy = 0;
    for (const count of freq.values()) {
        const p = count / input.length;
        entropy -= p * Math.log2(p);
    }
    return Math.round(entropy * 1000) / 1000;
}

/**
 * Mask a secret. At most the first 4 characters and the last 2 characters are exposed,
 * and the exposure shrinks for short values. Always returns the length and a sha256 prefix.
 */
export function maskSecretValue(value: string): { redacted: string; length: number; sha256Prefix: string } {
    const length = value.length;
    const sha256Prefix = crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
    if (length === 0) return { redacted: '', length: 0, sha256Prefix };
    const lead = Math.min(4, Math.max(0, Math.floor(length / 4)));
    const trail = Math.min(2, Math.max(0, Math.floor(length / 6)));
    let redacted: string;
    if (lead + trail >= length) {
        redacted = '*'.repeat(Math.min(length, 8));
    } else if (trail === 0) {
        redacted = `${value.slice(0, lead)}…`;
    } else {
        redacted = `${value.slice(0, lead)}…${value.slice(value.length - trail)}`;
    }
    return { redacted, length, sha256Prefix };
}

function isInside(root: string, target: string): boolean {
    const r = path.resolve(root);
    const t = path.resolve(target);
    return t === r || t.startsWith(r + path.sep);
}

function newId(prefix: string): string {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

interface RawDetection {
    type: string;
    secret: string;
    severity: SeverityLevel;
    confidence: number;
    category: 'exposed_secret' | 'secret_exposure';
    start: number;
    end: number;
    keyName?: string;
    entropy?: number;
}

/* ------------------------------------------------------------------------------------------------
 * Scanner
 * ---------------------------------------------------------------------------------------------- */

export class SecretsScanner {
    private ctx: OperationContext;
    private readonly actor = 'secrets-scanner';

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('SECRETS_SCANNER_INIT', this.actor, 'SUCCESS', { operationId: ctx.operationId });
    }

    /* ------------------------------------------------------------------------------------------
     * A) Directory scan
     * --------------------------------------------------------------------------------------- */

    async scanDirectory(rootPath: string, options: ScanOptions = {}): Promise<SecretFinding[]> {
        const started = Date.now();
        const opts = {
            maxDepth: options.maxDepth ?? 25,
            maxFiles: options.maxFiles ?? 20000,
            maxFileSize: options.maxFileSize ?? 5 * 1024 * 1024,
            excludeDirs: options.excludeDirs ?? [],
            addFindings: options.addFindings ?? true,
            maxFindings: options.maxFindings ?? 2000
        };

        arsenalCore.audit('SECRETS_SCAN_START', this.actor, 'ATTEMPT', { root: rootPath });

        if (!rootPath || !fs.existsSync(rootPath)) {
            arsenalCore.audit('SECRETS_SCAN', this.actor, 'FAILED', { root: rootPath, reason: 'path_not_found' });
            return [];
        }
        const root = fs.statSync(rootPath).isDirectory() ? path.resolve(rootPath) : path.dirname(path.resolve(rootPath));

        const collected = this.collectFiles(root, opts);
        const findings: SecretFinding[] = [];
        const seen = new Set<string>();
        let linesScanned = 0;
        let bytesScanned = 0;

        for (const file of collected.files) {
            let buf: Buffer;
            try {
                buf = fs.readFileSync(file.abs);
            } catch {
                continue;
            }
            bytesScanned += buf.length;
            // Binary detection: a NUL byte inside the first 1 KiB.
            const head = buf.subarray(0, 1024);
            if (head.includes(0)) {
                collected.skipped.push({ path: file.rel, reason: 'binary' });
                continue;
            }
            const text = buf.toString('utf8');
            const lines = text.split(/\r?\n/);
            linesScanned += lines.length;
            const configLike = CONFIG_FILE_RE.test(file.rel);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line || line.length < 6) continue;
                const raws = this.detectInLine(line, configLike);
                for (const raw of raws) {
                    const masked = maskSecretValue(raw.secret);
                    const dedupKey = `${file.rel}:${i + 1}:${masked.sha256Prefix}`;
                    if (seen.has(dedupKey)) continue;
                    seen.add(dedupKey);
                    const finding: SecretFinding = {
                        id: newId('SEC'),
                        type: raw.type,
                        file: file.rel,
                        line: i + 1,
                        column: raw.start + 1,
                        redacted: masked.redacted,
                        length: masked.length,
                        sha256Prefix: masked.sha256Prefix,
                        severity: raw.severity,
                        confidence: raw.confidence,
                        context: this.redactLine(line, raw.secret, masked.redacted),
                        verified: false,
                        source: 'filesystem'
                    };
                    if (raw.entropy !== undefined) finding.entropy = raw.entropy;
                    if (raw.keyName !== undefined) finding.keyName = raw.keyName;
                    findings.push(finding);
                    if (findings.length >= opts.maxFindings) break;
                }
                if (findings.length >= opts.maxFindings) break;
            }
            if (findings.length >= opts.maxFindings) break;
        }

        const byReason: Record<string, number> = {};
        for (const s of collected.skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;

        this.lastScanSummary = {
            root,
            filesScanned: collected.files.length,
            linesScanned,
            bytesScanned,
            findings: findings.length,
            skipped: collected.skipped,
            skippedByReason: byReason,
            truncated: findings.length >= opts.maxFindings,
            durationMs: Date.now() - started
        };

        if (opts.addFindings) this.emitFindings(findings);

        arsenalCore.audit('SECRETS_SCAN', this.actor, 'SUCCESS', {
            root,
            filesScanned: collected.files.length,
            linesScanned,
            bytesScanned,
            findings: findings.length,
            skipped: collected.skipped.length,
            skippedByReason: byReason,
            durationMs: Date.now() - started
        });

        return findings;
    }

    /** Internal summary of the last directory walk (kept public so callers can prove what was skipped). */
    lastScanSummary: ScanSummary | null = null;

    /* ------------------------------------------------------------------------------------------
     * B) Git history scan
     * --------------------------------------------------------------------------------------- */

    async scanGitHistory(repoPath: string, maxCommits = 50): Promise<SecretFinding[]> {
        const started = Date.now();
        arsenalCore.audit('SECRETS_GIT_SCAN_START', this.actor, 'ATTEMPT', { repoPath, maxCommits });

        if (!repoPath || !fs.existsSync(repoPath)) {
            arsenalCore.audit('SECRETS_GIT_SCAN', this.actor, 'FAILED', { repoPath, reason: 'path_not_found' });
            return [];
        }
        if (!fs.statSync(repoPath).isDirectory()) {
            arsenalCore.audit('SECRETS_GIT_SCAN', this.actor, 'FAILED', { repoPath, reason: 'not_a_directory' });
            return [];
        }

        const commits = Math.max(1, Math.min(500, maxCommits));

        const probe = await this.exec('git', ['rev-parse', '--is-inside-work-tree'], repoPath, 1024 * 1024);
        if (probe.code !== 0 || !/true/i.test(probe.stdout)) {
            const reason = probe.code === 127 || /not found|ENOENT/i.test(probe.stderr)
                ? 'git_unavailable'
                : 'not_a_git_repository';
            arsenalCore.audit('SECRETS_GIT_SCAN', this.actor, 'FAILED', {
                repoPath,
                reason,
                gitStderr: probe.stderr.slice(0, 400)
            });
            return [];
        }

        const log = await this.exec(
            'git',
            ['log', '-p', '--no-color', '-n', String(commits)],
            repoPath,
            8 * 1024 * 1024
        );
        if (log.code !== 0) {
            arsenalCore.audit('SECRETS_GIT_SCAN', this.actor, 'FAILED', {
                repoPath,
                reason: log.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'output_exceeded_8mb_cap' : 'git_log_failed',
                gitStderr: log.stderr.slice(0, 400)
            });
            return [];
        }

        const findings = this.parseUnifiedDiff(log.stdout, commits);
        this.emitFindings(findings);

        arsenalCore.audit('SECRETS_GIT_SCAN', this.actor, 'SUCCESS', {
            repoPath,
            commitsRequested: commits,
            diffBytes: log.stdout.length,
            findings: findings.length,
            durationMs: Date.now() - started
        });

        return findings;
    }

    /** Parse the real output of `git log -p` into detections over added lines. */
    private parseUnifiedDiff(diff: string, maxCommits: number): SecretFinding[] {
        const findings: SecretFinding[] = [];
        const seen = new Set<string>();
        const lines = diff.split('\n');
        let commit = '';
        let file = '';
        let newLine = 0;
        let commitsSeen = 0;

        for (const raw of lines) {
            if (raw.startsWith('commit ')) {
                commit = raw.slice(7).trim().split(' ')[0].slice(0, 12);
                commitsSeen++;
                file = '';
                newLine = 0;
                if (commitsSeen > maxCommits) break;
                continue;
            }
            if (raw.startsWith('diff --git ')) {
                file = '';
                newLine = 0;
                continue;
            }
            if (raw.startsWith('+++ ')) {
                let target = raw.slice(4).trim();
                if (target === '/dev/null') {
                    file = '';
                } else {
                    if (target.startsWith('b/')) target = target.slice(2);
                    file = target;
                }
                continue;
            }
            if (raw.startsWith('@@')) {
                const m = raw.match(/@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
                newLine = m ? parseInt(m[1], 10) : 0;
                continue;
            }
            if (!file) continue;

            if (raw.startsWith('+') && !raw.startsWith('+++')) {
                const content = raw.slice(1);
                const configLike = CONFIG_FILE_RE.test(file);
                const raws = this.detectInLine(content, configLike);
                for (const det of raws) {
                    const masked = maskSecretValue(det.secret);
                    const dedupKey = `${commit}:${file}:${newLine}:${masked.sha256Prefix}`;
                    if (seen.has(dedupKey)) continue;
                    seen.add(dedupKey);
                    const finding: SecretFinding = {
                        id: newId('SEC'),
                        type: det.type,
                        file,
                        line: newLine,
                        column: det.start + 1,
                        redacted: masked.redacted,
                        length: masked.length,
                        sha256Prefix: masked.sha256Prefix,
                        severity: det.severity,
                        confidence: det.confidence,
                        context: this.redactLine(content, det.secret, masked.redacted),
                        verified: false,
                        commit,
                        source: 'git_history'
                    };
                    if (det.entropy !== undefined) finding.entropy = det.entropy;
                    if (det.keyName !== undefined) finding.keyName = det.keyName;
                    findings.push(finding);
                }
                newLine++;
                continue;
            }
            if (raw.startsWith('-')) continue; // removed line: not present in the new file
            if (raw.startsWith(' ')) newLine++;
        }

        return findings;
    }

    /* ------------------------------------------------------------------------------------------
     * C) .env scan
     * --------------------------------------------------------------------------------------- */

    async scanEnvFiles(rootPath: string): Promise<SecretFinding[]> {
        const started = Date.now();
        arsenalCore.audit('SECRETS_ENV_SCAN_START', this.actor, 'ATTEMPT', { rootPath });

        if (!rootPath || !fs.existsSync(rootPath)) {
            arsenalCore.audit('SECRETS_ENV_SCAN', this.actor, 'FAILED', { rootPath, reason: 'path_not_found' });
            return [];
        }
        const root = fs.statSync(rootPath).isDirectory() ? path.resolve(rootPath) : path.dirname(path.resolve(rootPath));
        const opts = { maxDepth: 25, maxFiles: 20000, maxFileSize: 5 * 1024 * 1024, excludeDirs: [] as string[] };
        const collected = this.collectFiles(root, opts, (name) => this.isEnvFile(name));

        const findings: SecretFinding[] = [];
        const worldReadableFiles: Array<{ file: string; mode: string; credentials: number }> = [];

        for (const file of collected.files) {
            let text: string;
            let mode = 0;
            try {
                text = fs.readFileSync(file.abs, 'utf8');
                mode = fs.statSync(file.abs).mode;
            } catch {
                continue;
            }
            const worldReadable = (mode & 0o004) !== 0;
            const lines = text.split(/\r?\n/);
            let credentials = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line || line.startsWith('#')) continue;
                const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
                if (!m) continue;
                const keyName = m[1];
                let value = m[2].trim();
                if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
                    value = value.slice(1, -1);
                }
                if (!value) continue;
                if (PLACEHOLDER_RE.test(value.trim())) continue;

                const looksKnownFormat = this.detectInLine(value, false).some((d) => d.category === 'exposed_secret');
                const keyIsSecretish = SECRET_KEYWORD_RE.test(keyName) || /(credential|passphrase|private|dsn|salt|sign)/i.test(keyName);
                const entropy = shannonEntropyString(value);
                const highEntropy = value.length >= 20 && entropy >= 3.5;

                if (!looksKnownFormat && !keyIsSecretish && !highEntropy) continue;

                const masked = maskSecretValue(value);
                const severity: SeverityLevel = looksKnownFormat || keyIsSecretish ? 'HIGH' : 'MEDIUM';
                findings.push({
                    id: newId('SEC'),
                    type: 'env_credential',
                    file: file.rel,
                    line: i + 1,
                    column: 1,
                    redacted: masked.redacted,
                    length: masked.length,
                    sha256Prefix: masked.sha256Prefix,
                    entropy,
                    severity,
                    confidence: looksKnownFormat ? 0.9 : keyIsSecretish ? 0.75 : 0.45,
                    context: `${keyName}=${masked.redacted}`,
                    verified: false,
                    keyName,
                    worldReadable,
                    source: 'env_file'
                });
                credentials++;
            }

            if (worldReadable) {
                worldReadableFiles.push({ file: file.rel, mode: '0' + (mode & 0o777).toString(8), credentials });
                arsenalCore.addFinding({
                    title: `World-readable environment file: ${file.rel}`,
                    severity: credentials > 0 ? 'HIGH' : 'MEDIUM',
                    category: 'misconfiguration',
                    description:
                        `Environment file ${file.rel} is readable by any local user (mode 0${(mode & 0o777).toString(8)}). ` +
                        `It contains ${credentials} credential-looking value(s).`,
                    evidence: { file: file.rel, mode: `0${(mode & 0o777).toString(8)}`, credentials, root },
                    remediation: 'Restrict the file mode (chmod 600) and keep environment files out of version control',
                    verified: true
                });
            }
        }

        arsenalCore.audit('SECRETS_ENV_SCAN', this.actor, 'SUCCESS', {
            root,
            envFiles: collected.files.length,
            findings: findings.length,
            worldReadable: worldReadableFiles.length,
            durationMs: Date.now() - started
        });

        return findings;
    }

    /* ------------------------------------------------------------------------------------------
     * D) Report
     * --------------------------------------------------------------------------------------- */

    generateReport(findings: SecretFinding[]): SecretsReport {
        const byType: Record<string, number> = {};
        const bySeverity: Record<string, number> = {};
        const files = new Set<string>();
        const samples: Record<string, string[]> = {};

        for (const f of findings) {
            byType[f.type] = (byType[f.type] || 0) + 1;
            bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
            files.add(f.file);
            if (!samples[f.type]) samples[f.type] = [];
            if (samples[f.type].length < 3) {
                samples[f.type].push(`${f.file}:${f.line} ${f.redacted} (len=${f.length}, sha256=${f.sha256Prefix})`);
            }
        }

        const report: SecretsReport = {
            operationId: this.ctx.operationId,
            generatedAt: Date.now(),
            total: findings.length,
            filesAffected: files.size,
            byType,
            bySeverity,
            redactedSamples: samples
        };

        arsenalCore.audit('SECRETS_REPORT', this.actor, 'SUCCESS', {
            total: report.total,
            filesAffected: report.filesAffected
        });

        return report;
    }

    /* ------------------------------------------------------------------------------------------
     * E) Redaction utility
     * --------------------------------------------------------------------------------------- */

    /** Mask every credential-shaped value inside arbitrary text. */
    redact(text: string): string {
        if (!text) return text;
        let out = text;
        for (const det of DETECTORS) {
            const regex = new RegExp(det.regex.source, det.regex.flags.includes('g') ? det.regex.flags : det.regex.flags + 'g');
            out = out.replace(regex, (full, ...groups) => {
                const group = det.group ?? 0;
                const secret = typeof groups[group - 1] === 'string' ? (groups[group - 1] as string) : full;
                const keyName = det.keyGroup && typeof groups[det.keyGroup - 1] === 'string' ? (groups[det.keyGroup - 1] as string) : '';
                if (det.validate && !det.validate(secret, keyName, full)) return full;
                return full.replace(secret, maskSecretValue(secret).redacted);
            });
        }
        return out;
    }

    /* ------------------------------------------------------------------------------------------
     * Internals
     * --------------------------------------------------------------------------------------- */

    /** Run every detector over one real line of text. */
    private detectInLine(line: string, configLike: boolean): RawDetection[] {
        const out: RawDetection[] = [];

        if (MARKER_RE.test(line)) {
            const lower = line.toLowerCase();
            for (const det of DETECTORS) {
                if (det.prefilter && !det.prefilter.some((p) => lower.includes(p.toLowerCase()))) continue;
                const regex = det.regex;
                regex.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = regex.exec(line)) !== null) {
                    if (m[0].length === 0) {
                        regex.lastIndex++;
                        continue;
                    }
                    const group = det.group ?? 0;
                    const secret = group === 0 ? m[0] : m[group];
                    if (secret === undefined) continue;
                    const keyName = det.keyGroup !== undefined && m[det.keyGroup] !== undefined ? m[det.keyGroup] : '';
                    if (det.validate && !det.validate(secret, keyName, m[0])) continue;
                    out.push({
                        type: det.type,
                        secret,
                        severity: det.severity,
                        confidence: det.confidence,
                        category: det.category,
                        start: m.index,
                        end: m.index + m[0].length,
                        keyName: keyName || undefined
                    });
                    if (out.length > 50) break;
                }
            }
        }

        // Entropy detector: real Shannon entropy over real quoted values.
        if (line.includes('"') || line.includes("'")) {
            const quoted = /(['"])([^'"\n]{20,})\1/g;
            let qm: RegExpExecArray | null;
            while ((qm = quoted.exec(line)) !== null) {
                const value = qm[2];
                const entropy = shannonEntropyString(value);
                if (entropy < 4.2) continue;
                const keywordOnLine = SECRET_KEYWORD_RE.test(line);
                const base64ish = /^[A-Za-z0-9+/=_-]+$/.test(value) && value.length >= 20;
                const hexish = /^[0-9a-f]{16,}$/i.test(value);
                if (!keywordOnLine && !((base64ish || hexish) && configLike)) continue;
                out.push({
                    type: 'possible_secret',
                    secret: value,
                    severity: keywordOnLine ? 'MEDIUM' : 'LOW',
                    confidence: keywordOnLine ? 0.5 : 0.35,
                    category: 'secret_exposure',
                    start: qm.index + qm[1].length,
                    end: qm.index + qm[1].length + value.length,
                    entropy
                });
            }
        }

        return out;
    }

    /** Replace the secret inside a source line with its masked form. */
    private redactLine(line: string, secret: string, redacted: string): string {
        const trimmed = line.length > 300 ? line.slice(0, 300) + '…' : line;
        if (!secret) return trimmed;
        return trimmed.split(secret).join(redacted);
    }

    /** Walk the tree read-only and collect candidate files. */
    private collectFiles(
        root: string,
        opts: { maxDepth: number; maxFiles: number; maxFileSize: number; excludeDirs: string[] },
        fileFilter?: (name: string) => boolean
    ): { files: Array<{ abs: string; rel: string }>; skipped: SkippedEntry[] } {
        const files: Array<{ abs: string; rel: string }> = [];
        const skipped: SkippedEntry[] = [];
        const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', ...opts.excludeDirs]);
        const visited = new Set<string>();
        const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

        while (stack.length > 0) {
            const { dir, depth } = stack.pop() as { dir: string; depth: number };
            if (depth > opts.maxDepth) {
                skipped.push({ path: path.relative(root, dir) || '.', reason: 'max_depth' });
                continue;
            }
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                skipped.push({ path: path.relative(root, dir) || '.', reason: 'unreadable_directory' });
                continue;
            }

            for (const entry of entries) {
                if (files.length >= opts.maxFiles) break;
                const abs = path.join(dir, entry.name);
                const rel = path.relative(root, abs) || entry.name;

                let isDir = entry.isDirectory();
                let isFile = entry.isFile();

                if (entry.isSymbolicLink()) {
                    let real: string;
                    try {
                        real = fs.realpathSync(abs);
                    } catch {
                        skipped.push({ path: rel, reason: 'broken_symlink' });
                        continue;
                    }
                    if (!isInside(root, real)) {
                        skipped.push({ path: rel, reason: 'symlink_escapes_root' });
                        continue;
                    }
                    if (visited.has(real)) {
                        skipped.push({ path: rel, reason: 'symlink_loop' });
                        continue;
                    }
                    visited.add(real);
                    let rst: fs.Stats;
                    try {
                        rst = fs.statSync(abs);
                    } catch {
                        continue;
                    }
                    isDir = rst.isDirectory();
                    isFile = rst.isFile();
                }

                if (isDir) {
                    if (skipDirs.has(entry.name)) {
                        skipped.push({ path: rel, reason: 'excluded_directory' });
                        continue;
                    }
                    stack.push({ dir: abs, depth: depth + 1 });
                    continue;
                }
                if (!isFile) continue;

                if (entry.name.endsWith('.min.js')) {
                    skipped.push({ path: rel, reason: 'minified_bundle' });
                    continue;
                }
                if (fileFilter && !fileFilter(entry.name)) continue;

                let size = 0;
                try {
                    size = fs.statSync(abs).size;
                } catch {
                    continue;
                }
                if (size > opts.maxFileSize) {
                    skipped.push({ path: rel, reason: 'too_large' });
                    continue;
                }
                files.push({ abs, rel });
            }
        }

        return { files, skipped };
    }

    private isEnvFile(name: string): boolean {
        return name === '.env' || name.startsWith('.env.') || name.endsWith('.env');
    }

    /** Emit one arsenal finding per HIGH/CRITICAL detection. */
    private emitFindings(findings: SecretFinding[]): void {
        for (const f of findings) {
            if (f.severity !== 'HIGH' && f.severity !== 'CRITICAL') continue;
            arsenalCore.addFinding({
                title: `Exposed ${f.type} in ${f.file}:${f.line}`,
                severity: f.severity,
                category: 'exposed_secret',
                description:
                    `A ${f.type} was detected by static pattern matching on the real file contents. ` +
                    `Value: ${f.redacted} (length ${f.length}, sha256:${f.sha256Prefix}). ` +
                    `Confidence ${Math.round(f.confidence * 100)}%.`,
                evidence: {
                    file: f.file,
                    line: f.line,
                    column: f.column,
                    type: f.type,
                    redacted: f.redacted,
                    length: f.length,
                    sha256Prefix: f.sha256Prefix,
                    confidence: f.confidence,
                    context: f.context,
                    commit: f.commit,
                    source: f.source
                },
                remediation: 'Rotate the credential and remove it from version control',
                verified: false
            });
        }
    }

    /** Promise wrapper around child_process.execFile. */
    private exec(
        cmd: string,
        args: string[],
        cwd: string,
        maxBuffer: number
    ): Promise<{ stdout: string; stderr: string; code: number | string }> {
        return new Promise((resolve) => {
            execFile(
                cmd,
                args,
                { cwd, maxBuffer, encoding: 'utf8', windowsHide: true },
                (err, stdout, stderr) => {
                    const code = err ? ((err as any).code ?? 1) : 0;
                    const out: any = stdout;
                    const errOut: any = stderr;
                    resolve({
                        stdout: typeof out === 'string' ? out : out?.toString() ?? '',
                        stderr: typeof errOut === 'string' ? errOut : errOut?.toString() ?? '',
                        code
                    });
                }
            );
        });
    }
}

export default SecretsScanner;
