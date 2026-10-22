#!/usr/bin/env tsx
/**
 * ====================================================================================================
 * GATE 9 - ROOT GUARDS
 * Run: npx tsx tools/root_guard.ts
 *
 * Every other gate asserts that a capability works. This gate asserts that the *classes of defect*
 * that produced the real CI failures cannot silently return. Each check is bound to a root cause,
 * not to the symptom that exposed it (the full mapping is docs/ROOT_CAUSE_REGISTER.md):
 *
 *   R1  machine/state-bound assumptions  (#1, #5, #8, #9)      -> checks [1] and [2]
 *   R2  gates assumed green unseen       (#2, #3, #4)          -> check [5]
 *   R3  assertions that cannot hold or failures without evidence (#6, #7, #10) -> checks [3] and [4]
 *
 * A guard that can only pass is not a guard. Each one below is written so that it fails loudly when
 * its invariant is violated, and each one states the invariant in its output.
 * ====================================================================================================
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { runProbe } from './lib/probe_runner.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let passed = 0;
let failed = 0;
const failures: { name: string; detail: string }[] = [];

interface CheckResult {
    ok: boolean;
    detail: string;
}

function truncate(text: string, max = 300): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

async function check(name: string, fn: () => CheckResult | Promise<CheckResult>): Promise<void> {
    try {
        const result = await fn();
        if (result.ok) {
            passed += 1;
            console.log(`  [OK]   ${name}\n         ${truncate(result.detail, 400)}`);
        } else {
            failed += 1;
            failures.push({ name, detail: result.detail });
            console.log(`  [FAIL] ${name}\n         ${truncate(result.detail, 1500)}`);
        }
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        failed += 1;
        failures.push({ name, detail });
        console.log(`  [FAIL] ${name}\n         ${truncate(detail, 1500)}`);
    }
}

function pythonJson(script: string): unknown {
    const out = execFileSync('python3', ['-c', script], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    return JSON.parse(out);
}

// ---------------------------------------------------------------------------------------------------
// R1 - machine-bound assumptions
// ---------------------------------------------------------------------------------------------------

/**
 * [1] Executable code must not depend on the author's machine or on a port being free.
 *
 * Scope is deliberately the code the gates execute on Linux: tools/, mcp/ and src/neo/. The
 * upstream Windows host tooling under scripts/ is out of scope and is named as such in the output,
 * because a guard that silently ignores a directory is worse than no guard.
 *
 * An escape hatch exists for genuinely justified cases: a line carrying `path-guard: allow` is
 * exempt, and every exemption is printed so it must be defended in review.
 */
interface BoundaryPattern {
    label: string;
    re: RegExp;
    /** A line that carries one of these tokens gives each call its own artifact. */
    requiresDiscriminator?: boolean;
}

/** Tokens that make an artifact path unique per process or per call. */
const DISCRIMINATOR = /process\.pid|randomUUID|Date\.now|mkdtemp/;

const MACHINE_PATTERNS: BoundaryPattern[] = [
    { label: 'author scratch directory', re: /\/tmp\/opencode/g },
    { label: 'mounted Windows drive', re: /\/mnt\/[a-z]\//g },
    { label: 'Windows user profile', re: /[A-Za-z]:\\\\Users/gi },
    { label: 'legacy Servers Center root', re: /[A-Za-z]:\\\\Servers-Center/gi },
    { label: 'author home directory', re: /\/home\/[A-Za-z0-9._-]+\//g },
    // A writable artifact with one fixed filename is the same class as a fixed port: it asserts
    // exclusive ownership that the code does not have. `writeFileSync` truncates before it writes,
    // so a second process can make a reader see an empty file - measured at 1,289,070 empty reads
    // out of 1,614,814 under contention. The filename must carry a discriminator.
    { label: 'shared writable artifact filename (needs process.pid / randomUUID / Date.now)',
      re: /path\.join\([^\n]*['"`][^'"`\n]*\.rules['"`]/g,
      requiresDiscriminator: true },
    // A fixed listening port is the same class of mistake as a fixed path: it asserts a property
    // of the host (that the port is free) that the code does not own. Two probes collided on such
    // a port with EADDRINUSE while this gate was being written. Ephemeral ports (listen(0)) are
    // assigned by the kernel and are correct in every probe.
    { label: 'fixed listening port (asserts the port is free)', re: /\blisten\s*\(\s*[1-9][0-9]{0,4}\b/g }
];
const GUARDED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.sh', '.json']);

function scanMachineBoundPaths() {
    const tracked = execFileSync('git', ['ls-files', 'tools', 'mcp', 'src/neo'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60_000
    })
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(file => GUARDED_EXTENSIONS.has(path.extname(file)));

    const violations: string[] = [];
    const exemptions: string[] = [];

    for (const file of tracked) {
        const full = path.join(ROOT, file);
        if (!fs.existsSync(full)) continue;
        const lines = fs.readFileSync(full, 'utf8').split('\n');
        lines.forEach((text, index) => {
            for (const { label, re, requiresDiscriminator } of MACHINE_PATTERNS) {
                re.lastIndex = 0;
                if (!re.test(text)) continue;
                if (requiresDiscriminator && DISCRIMINATOR.test(text)) {
                    exemptions.push(`${file}:${index + 1} (${label}) -> per-call artifact`);
                    continue;
                }
                const where = `${file}:${index + 1}`;
                if (text.includes('path-guard: allow')) {
                    exemptions.push(`${where} (${label})`);
                } else {
                    violations.push(`${where} (${label}) -> ${truncate(text, 120)}`);
                }
            }
        });
    }

    return { scanned: tracked.length, violations, exemptions };
}

/**
 * [2] The Servers Center resolution must never diverge between the two languages again.
 *
 * Defect #1 was not "a path was wrong". It was that the Python suite resolved the inventory for
 * itself and ran a TypeScript child that resolved it *again*, from a different default, and saw
 * zero. The fix is a contract: the parent computes the resolution once and hands it to the child
 * explicitly. This check freezes that contract so a future edit cannot quietly drop it.
 */
const SUITE = 'scripts/test_servers_center_integration.py';

function assertResolutionContract() {
    const full = path.join(ROOT, SUITE);
    if (!fs.existsSync(full)) return { ok: false, detail: `${SUITE} is missing` };
    const src = fs.readFileSync(full, 'utf8');

    // The invariant is about MEANING, not about the shape of the literal: the child must inherit
    // the parent environment, receive both resolution variables, and receive the parent's OWN
    // manifest resolution rather than a value it would have to derive again.
    const missing: string[] = [];
    if (!/child_env\s*=\s*(?:dict\(os\.environ\)|os\.environ\.copy\(\))/.test(src)) {
        missing.push('the child environment is not derived from the parent environment');
    }
    if (!/child_env\[\s*["']SERVERS_CENTER_ROOT["']\s*\]\s*=\s*\S+/.test(src)) {
        missing.push('SERVERS_CENTER_ROOT is not assigned on child_env');
    }
    if (!/child_env\[\s*["']SERVERS_CENTER_MANIFEST["']\s*\]\s*=\s*_resolved_manifest_path\(\)/.test(src)) {
        missing.push("SERVERS_CENTER_MANIFEST is not set to the parent's own resolution (_resolved_manifest_path())");
    }
    if (!/env\s*=\s*child_env/.test(src)) {
        missing.push('the TypeScript child is launched without env=child_env');
    }

    if (missing.length > 0) {
        return { ok: false, detail: `resolution contract broken: ${missing.join('; ')}` };
    }
    return {
        ok: true,
        detail: "parent copies its environment, adds ROOT and its own _resolved_manifest_path(), and passes env=child_env"
    };
}

// ---------------------------------------------------------------------------------------------------
// R3 - assertions that cannot hold, and failures without evidence
// ---------------------------------------------------------------------------------------------------

interface BackgroundProcess {
    /** Number of units of work the child completed, parsed from its shutdown line. */
    stop: () => Promise<number>;
}

/**
 * Start a helper process and wait until it reports readiness on stdout.
 *
 * Both helpers are external processes on purpose: the guard runs the probe with execSync, which
 * blocks this event loop, so a generator living in this process would be frozen for exactly the
 * window it is supposed to stress.
 */
async function startBackgroundProcess(label: string, command: string, args: string[], readyPattern: RegExp): Promise<BackgroundProcess> {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
        stdout += String(chunk);
    });
    child.stderr?.on('data', chunk => {
        stderr += String(chunk);
    });
    // 'close' fires after the stdio pipes are closed; 'exit' can fire before the last chunk of
    // stdout has been delivered. Waiting for 'exit' here silently lost the generator's total.
    const closed = new Promise<void>(resolve => {
        child.once('close', () => resolve());
    });

    await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 20_000;
        const poll = () => {
            if (readyPattern.test(stdout)) {
                resolve();
                return;
            }
            if (child.exitCode !== null) {
                reject(new Error(`${label} exited early (code ${child.exitCode}) :: ${stderr || '(no stderr)'}`));
                return;
            }
            if (Date.now() > deadline) {
                // A helper that never becomes ready must not be left running behind the gate.
                child.kill('SIGKILL');
                reject(new Error(`${label} was not ready within 20s :: ${stderr || '(no stderr)'}`));
                return;
            }
            setTimeout(poll, 25);
        };
        poll();
    });

    return {
        stop: async (): Promise<number> => {
            const kill = setTimeout(() => child.kill('SIGKILL'), 5_000);
            child.kill('SIGTERM');
            await closed;
            clearTimeout(kill);
            return Number(/total (\d+)/.exec(stdout)?.[1] ?? 0);
        }
    };
}

/**
 * [3] A timing-sensitive assertion must hold under adversarial scheduling AND under contention on
 * the artifacts it touches.
 *
 * Defect #6 was an exact-equality comparison against a monotonically increasing counter: true on an
 * idle machine, false under load. Defect #9 was a rule set written to one shared path: true while
 * one process owned it, false when another process deployed rules at the same time. This check
 * reproduces both conditions at once, with a separate process for each, and fails if either
 * generator did no work - so it cannot pass vacuously.
 */
async function assertProbeSurvivesContention(): Promise<CheckResult> {
    const probe = path.join(ROOT, 'tools/network_probe.ts');
    const loader = path.join(HERE, 'lib/loopback_load.mjs');
    const deployer = path.join(HERE, 'lib/rule_deployer.ts');
    for (const file of [probe, loader, deployer]) {
        if (!fs.existsSync(file)) return { ok: false, detail: `${path.relative(ROOT, file)} is missing` };
    }

    let connections = 0;
    let deployments = 0;

    const network = await startBackgroundProcess('loopback load generator', process.execPath, [loader], /ready \d+/);
    let rules: BackgroundProcess;
    try {
        // `node --import tsx` runs the deployment loop IN this child, so SIGTERM reaches the handler
        // that reports the total. `npx tsx` spawns a grandchild: killing npx left the deployer
        // running and its output pipe open - observed as three orphaned deployers and a lost total.
        rules = await startBackgroundProcess('rule deployer', process.execPath, ['--import', 'tsx', deployer], /^ready$/m);
    } catch (err) {
        await network.stop();
        throw err;
    }

    try {
        runProbe(probe, { cwd: ROOT, timeoutMs: 180_000 });
        runProbe(probe, { cwd: ROOT, timeoutMs: 180_000 });
    } finally {
        connections = await network.stop();
        deployments = await rules.stop();
    }

    if (connections === 0) {
        return { ok: false, detail: 'the load generator completed no loopback connections, so the probe was never under network load' };
    }
    if (deployments === 0) {
        return { ok: false, detail: 'the rule deployer deployed no rule sets, so shared-artifact contention was never exercised' };
    }
    return {
        ok: true,
        detail: `network probe passed 2/2 while a separate process completed ${connections} loopback connections and another deployed ${deployments} IDS rule sets`
    };
}


/**
 * [4] The failure path must carry evidence - and that must be tested, not assumed.
 *
 * Defect #7 was a CI failure that printed "Command failed:" with no stdout, no stderr and no
 * signal, so it could not be diagnosed. The runner now reports all three. This check proves the
 * runner does so by feeding it three probes whose behaviour is known in advance:
 *   - a crash        -> must report status=3 and the child's own stderr
 *   - a hang         -> must report the signal that ended it (SIGTERM from the timeout)
 *   - a silent exit 0 -> must be treated as failure, because silence is not proof
 */
function assertFailureEvidenceContract(): CheckResult {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-guard-'));
    const write = (name: string, body: string) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, body);
        return file;
    };

    const capture = (file: string, timeoutMs: number): string => {
        try {
            runProbe(file, { cwd: ROOT, timeoutMs });
        } catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
        return '';
    };

    try {
        const crashMessage = capture(
            write('crash_probe.ts', "import fs from 'fs';\nfs.writeSync(2, 'synthetic-crash-marker\\n');\nprocess.exitCode = 3;\n"),
            60_000
        );
        if (!crashMessage.includes('status=3')) {
            return { ok: false, detail: `crash probe did not report status=3 :: ${truncate(crashMessage)}` };
        }
        if (!crashMessage.includes('synthetic-crash-marker')) {
            return { ok: false, detail: `crash probe did not carry the child's stderr :: ${truncate(crashMessage)}` };
        }

        const hangMessage = capture(write('hang_probe.ts', 'setTimeout(() => {}, 60000);\n'), 1_500);
        const signal = /signal=(SIGTERM|SIGKILL)/.exec(hangMessage)?.[1];
        if (!signal) {
            return { ok: false, detail: `timeout was not reported as a signal :: ${truncate(hangMessage)}` };
        }

        const silentMessage = capture(write('silent_probe.ts', 'process.exitCode = 0;\n'), 60_000);
        if (!/no PASS result/.test(silentMessage)) {
            return { ok: false, detail: `a silent exit 0 was not treated as failure :: ${truncate(silentMessage)}` };
        }

        return { ok: true, detail: `crash -> status=3 + stderr, timeout -> signal=${signal}, silent exit 0 -> failure` };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------------------------------
// R2 - gates assumed green without ever having run
// ---------------------------------------------------------------------------------------------------

/**
 * [5] The gate inventory is real, the ledger is auditable, and this gate cannot be orphaned.
 *
 * Defects #2, #3 and #4 shared one mechanism: nothing asserted that a gate had ever executed, and
 * the advisory ledger was hand-maintained prose. This check parses the workflow itself and asks
 * three questions that prose cannot answer:
 *   - is every gate 1..10 present? (a deleted gate is a silent loss of coverage)
 *   - does every local artifact a gate invokes exist? (a gate pointing at a deleted file is a no-op)
 *   - is every ledger exemption owned, dated and unreachable-by-default? (rot becomes visible)
 */
interface WorkflowGate {
    name: string;
    run: string;
}

interface WorkflowFacts {
    gates: WorkflowGate[];
    ledger: Record<string, { package?: string; severity?: string; reason?: string; owner?: string; expires?: string }>;
}

function readWorkflowFacts(): WorkflowFacts {
    const script = [
        'import json, yaml',
        "wf = yaml.safe_load(open('.github/workflows/ci.yml'))",
        'gates = []',
        "for job in wf.get('jobs', {}).values():",
        "    for step in job.get('steps', []) or []:",
        "        name = str(step.get('name', ''))",
        "        if 'Gate' in name:",
        "            gates.append({'name': name, 'run': str(step.get('run', '') or '')})",
        "ledger = json.loads(wf.get('env', {}).get('SOVEREIGN_AUDIT_BASELINE', '{}'))",
        "print(json.dumps({'gates': gates, 'ledger': ledger}))"
    ].join('\n');
    return pythonJson(script) as WorkflowFacts;
}

function assertGateInventory(facts: WorkflowFacts): CheckResult {
    const names = facts.gates.map(gate => gate.name);
    const missingGates: string[] = [];
    for (let n = 1; n <= 10; n += 1) {
        if (!names.some(name => new RegExp(`Gate ${n}:`).test(name))) missingGates.push(String(n));
    }
    if (missingGates.length > 0) {
        return { ok: false, detail: `workflow is missing gate step(s): ${missingGates.join(', ')}` };
    }

    if (!facts.gates.some(gate => gate.run.includes('root_guard.ts'))) {
        return { ok: false, detail: 'no workflow step runs tools/root_guard.ts, so this gate is orphaned' };
    }

    const referenced = new Set<string>();
    const localArtifact = /(?:^|[\s"'`=])((?:tools|scripts|mcp)\/[A-Za-z0-9._/-]+\.(?:ts|mjs|js|py|json))/g;
    for (const gate of facts.gates) {
        for (const match of gate.run.matchAll(localArtifact)) {
            const file = match[1];
            if (file.includes('*') || file.includes('$')) continue;
            referenced.add(file);
        }
    }
    const missingArtifacts = [...referenced].filter(file => !fs.existsSync(path.join(ROOT, file)));
    if (missingArtifacts.length > 0) {
        return { ok: false, detail: `gate(s) invoke nonexistent artifact(s): ${missingArtifacts.join(', ')}` };
    }

    const ledgerProblems: string[] = [];
    const today = new Date();
    const horizon = new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000);
    for (const [id, entry] of Object.entries(facts.ledger)) {
        const label = `${id} (${entry.package ?? 'unknown package'})`;
        if (!/^https:\/\/github\.com\/advisories\/GHSA-/.test(id)) ledgerProblems.push(`${label}: id is not an advisory id`);
        if (!entry.package) ledgerProblems.push(`${label}: no package`);
        if (!['critical', 'high'].includes(String(entry.severity))) ledgerProblems.push(`${label}: severity must be critical or high`);
        if (!entry.reason || entry.reason.trim().length < 20) ledgerProblems.push(`${label}: reason is too thin to review`);
        if (!entry.owner || entry.owner.trim().length === 0) ledgerProblems.push(`${label}: no owner`);
        const expires = entry.expires ? new Date(`${entry.expires}T00:00:00Z`) : null;
        if (!entry.expires || Number.isNaN(expires?.getTime())) {
            ledgerProblems.push(`${label}: expires is missing or not an ISO date`);
        } else if (expires && expires < today) {
            ledgerProblems.push(`${label}: expired on ${entry.expires}`);
        } else if (expires && expires > horizon) {
            ledgerProblems.push(`${label}: expiry ${entry.expires} is beyond the 120-day review horizon`);
        }
    }
    if (ledgerProblems.length > 0) {
        return { ok: false, detail: `ledger is not auditable: ${ledgerProblems.join('; ')}` };
    }

    return {
        ok: true,
        detail: `gates 1-10 present; ${referenced.size} referenced artifacts exist; ${Object.keys(facts.ledger).length} ledger entr${Object.keys(facts.ledger).length === 1 ? 'y' : 'ies'} owned, dated and within horizon`
    };
}

// ---------------------------------------------------------------------------------------------------

async function main() {
    console.log('='.repeat(100));
    console.log('GATE 9 - ROOT GUARDS');
    console.log('Each check encodes a root cause class, so the defect cannot return unnoticed.');
    console.log('='.repeat(100));

    console.log('\n[R1] MACHINE-BOUND ASSUMPTIONS');
    await check('no author-machine paths or fixed ports in executable code', () => {
        const { scanned, violations, exemptions } = scanMachineBoundPaths();
        if (violations.length > 0) {
            return { ok: false, detail: `${violations.length} violation(s) in ${scanned} file(s): ${violations.slice(0, 6).join('; ')}` };
        }
        const note = exemptions.length > 0 ? `; ${exemptions.length} explicit exemption(s): ${exemptions.join('; ')}` : '; 0 exemptions';
        return { ok: true, detail: `${scanned} file(s) under tools/, mcp/, src/neo/ scanned${note}` };
    });
    await check('Servers Center resolution is computed once and passed to the child', () => assertResolutionContract());

    console.log('\n[R3] ASSERTIONS THAT MUST HOLD, AND FAILURES THAT MUST CARRY EVIDENCE');
    await check('probe holds under adversarial load and shared-artifact contention', () => assertProbeSurvivesContention());
    await check('failure evidence contract (status, signal, output) is tested', () => assertFailureEvidenceContract());

    console.log('\n[R2] GATES THAT MUST EXIST AND A LEDGER THAT MUST BE AUDITABLE');
    await check('gate inventory, referenced artifacts and ledger integrity', () => {
        let facts: WorkflowFacts;
        try {
            facts = readWorkflowFacts();
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            return { ok: false, detail: `cannot parse .github/workflows/ci.yml (PyYAML required, installed by the Gate 7 step): ${truncate(detail)}` };
        }
        return assertGateInventory(facts);
    });

    console.log(`\n${'='.repeat(100)}`);
    console.log(`GATE 9 RESULT: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('\nFAILURES');
        for (const failure of failures) console.log(`  - ${failure.name}: ${truncate(failure.detail, 1500)}`);
        console.log('\nRoot guard violations. Fix the invariant, never the guard.');
    } else {
        console.log('Every root class is guarded by a check that can fail.');
    }
    console.log('='.repeat(100));
    process.exitCode = failed > 0 ? 1 : 0;
}

void main();
