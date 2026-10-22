/**
 * The single probe-execution contract.
 *
 * WHY THIS EXISTS AS A MODULE: the evidence rule for a failing probe was previously
 * implemented inline in arsenal_verify.ts, which meant it could only be verified by
 * reading it. A rule that is only read is a rule that decays. Extracting it makes the
 * failure path itself testable: root_guard feeds it a probe that crashes and a probe
 * that is killed by a timeout, then asserts that the resulting message carries the
 * exit status, the signal and the child's own output.
 *
 * The contract:
 *   - a probe that exits 0 without reporting PASS is a failure, not a pass
 *   - a failure always reports HOW it ended: status=<code> signal=<name>
 *   - a failure always carries the tail of the child's stdout and stderr
 *   - when both streams are empty the message says so, which is the diagnostic
 */

import { execSync } from 'child_process';

export interface ProbeRunOptions {
    /** Working directory for the child. Probes import the arsenal by relative path. */
    cwd: string;
    /** Milliseconds before the child is killed. A killed child reports its signal. */
    timeoutMs?: number;
}

export interface ProbeOutcome {
    stdout: string;
}

const MAX_REPORTED_LINES = 14;

function tailOf(text: string): string {
    const lines = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    return lines.slice(-MAX_REPORTED_LINES).join(' | ');
}

/**
 * A failing probe already knows which assertion failed. Reporting only the tail of its output can
 * push that line out of view, which turns a diagnosable failure into a mystery - the same defect
 * (#7) this runner exists to prevent. Named failures win over the tail when they exist.
 */
function failureLines(text: string): string {
    const lines = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    const named = lines.filter(line => /\[FAIL\]/.test(line) || /^FAILURES:/.test(line) || /failure\(s\)/.test(line));
    return named.length > 0 ? named.slice(-20).join(' | ') : tailOf(text);
}

interface ExecFailure {
    stdout?: Buffer | string | null;
    stderr?: Buffer | string | null;
    message?: string;
    status?: number | null;
    signal?: string | null;
}

/** Turn an execSync failure into a message that contains every fact needed to diagnose it. */
export function describeFailure(err: unknown): string {
    const e = err as ExecFailure;
    const combined = [String(e.stdout ?? ''), String(e.stderr ?? '')].join('\n');
    const output = failureLines(combined);
    const how = `status=${e.status ?? 'null'} signal=${e.signal ?? 'none'}`;
    const command = String(e.message ?? 'probe failed').split('\n')[0];
    return `${command} [${how}] :: ${output || '(probe produced no output on either stream)'}`;
}

/**
 * Run one probe and enforce the contract.
 *
 * @throws Error whose message carries status, signal and the child's output tail.
 */
export function runProbe(scriptPath: string, options: ProbeRunOptions): ProbeOutcome {
    const { cwd, timeoutMs = 300_000 } = options;

    let stdout: string;
    try {
        stdout = execSync(`npx tsx ${JSON.stringify(scriptPath)}`, {
            cwd,
            encoding: 'utf8',
            timeout: timeoutMs,
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (err) {
        throw new Error(describeFailure(err));
    }

    // A zero exit code is not sufficient: the probe must also state that it verified
    // something. Silence is treated as failure rather than as success.
    if (!/PASS/i.test(stdout)) {
        throw new Error(`probe exited 0 but reported no PASS result [status=0 signal=none] :: ${tailOf(stdout) || '(no output)'}`);
    }

    return { stdout };
}
