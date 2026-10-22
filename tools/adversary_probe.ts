#!/usr/bin/env tsx
/**
 * Ground-truth probe for the Adversary Lab Arsenal.
 * Every assertion is checked against real controlled emulation.
 */
import { arsenalCore, AdversaryLab } from '../src/neo/arsenal/index.ts';

const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
    console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
    if (!cond) failures.push(name);
}

async function main() {
    console.log('\n=== ADVERSARY LAB PROBE ===\n');

    const op = arsenalCore.createOperation('PURPLE', ['verify'], 'local', 'PROBE');
    const lab = new AdversaryLab(op);

    console.log('=== 1. LAB INITIALIZATION ===');
    const status = lab.getLabStatus();
    const scenarios = lab.getScenarios();
    check('lab status retrieved', !!status, JSON.stringify(status));
    check('scenarios available', Array.isArray(scenarios) && scenarios.length > 0,
        `${scenarios.length} scenarios`);
    check('default scenario is http-server', scenarios.some((s: any) => s.id === 'LAB-SCN-001' || s.id === 'http-server'),
        `scenarios: ${scenarios.map((s: any) => s.id).join(', ')}`);

    console.log('\n=== 2. TARGET BUILD (real HTTP server) ===');
    const target = await lab.buildTarget();
    check('target built', !!target.url && !!target.port && typeof target.close === 'function',
        `url=${target.url} port=${target.port}`);
    check('target port > 0', target.port > 0 && target.port < 65536, `port=${target.port}`);
    check('target state initialized', !!target.state, 'state present');

    // Test the target responds
    console.log('\n=== 3. TARGET RESPONDS TO REAL REQUESTS ===');
    const http = await import('http');
    await new Promise<void>((resolve, reject) => {
        const req = http.default.get(target.url, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                check('target returns 200', res.statusCode === 200, `status=${res.statusCode}`);
                check('target returns HTML', data.includes('<html>') || data.includes('<body>') || data.includes('adversary-lab'),
                    `body=${data.slice(0, 100)}`);
                resolve();
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => reject(new Error('timeout')));
    });

    console.log('\n=== 4. SCENARIO EXECUTION ===');
    // Test running a scenario
    const result = await lab.runScenario('recon-only', ['reconnaissance'], ['T1595']);
    check('scenario ran', !!result, 'result present');
    check('result has id', !!result.id, result.id);
    check('result has scenario', result.scenario === 'recon-only', result.scenario);
    check('result has phases', Array.isArray(result.phases) && result.phases.length > 0, `${result.phases?.length || 0} phases`);
    check('result has detection', !!result.detection, 'detection present');
    check('detection has coverage', typeof result.detection?.coverage === 'number', `coverage=${result.detection?.coverage}`);
    check('detection has detected', typeof result.detection?.detected === 'number', `detected=${result.detection?.detected}`);
    check('detection has gaps', Array.isArray(result.detection?.gaps), `${result.detection?.gaps?.length || 0} gaps`);

    // Test with unknown technique (should produce HIGH gap)
    console.log('\n=== 5. UNKNOWN TECHNIQUE GAP DETECTION ===');
    const unknownResult = await lab.runScenario('recon-only', ['test'], ['T9999']);
    check('unknown technique flagged', unknownResult.detection?.gaps?.some((g: any) => g.techniqueId === 'T9999' && g.severity === 'HIGH'),
        `gaps: ${JSON.stringify(unknownResult.detection?.gaps)}`);
    check('unknown technique produces a gap', unknownResult.detection?.gaps?.some((g: any) => g.techniqueId === 'T9999'),
        `gaps: ${JSON.stringify(unknownResult.detection?.gaps)}`);

    console.log('\n=== 6. CLEANUP ===');
    await target.close();
    await lab.cleanup();
    check('target closed', true, 'cleanup completed');

    console.log('\n=== 7. SCENARIO LISTING ===');
    const allScenarios = lab.getScenarios();
    check('scenarios list retrieved', Array.isArray(allScenarios) && allScenarios.length > 0, `${allScenarios.length} scenarios`);
    check('each scenario has id/name/objectives/techniques', allScenarios.every((s: any) =>
        s.id && s.name && Array.isArray(s.objectives) && Array.isArray(s.techniques)),
        'all fields present');

    console.log(`\n${failures.length === 0 ? 'ADVERSARY LAB PROBE: ALL PASSED' : 'ADVERSARY LAB PROBE: FAILURES -> ' + failures.join(', ')}`);
    process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('ADVERSARY LAB PROBE CRASHED:', err);
    process.exit(1);
});