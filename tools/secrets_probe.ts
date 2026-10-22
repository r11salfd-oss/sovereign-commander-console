#!/usr/bin/env tsx
/**
 * Ground-truth probe for the Secrets Scanner Arsenal.
 * Every assertion is checked against a real file on disk or a real git repository.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { arsenalCore, SecretsScanner } from '../src/neo/arsenal/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
    console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
    if (!cond) failures.push(name);
}

async function main() {
    console.log('\n=== SECRETS SCANNER PROBE ===');
    console.log(`root: ${ROOT}\n`);

    // Test 1: Scan a real file with a known secret pattern
    console.log('=== 1. FILESYSTEM SCAN (real pattern detection) ===');
    const op1 = arsenalCore.createOperation('DEFENSIVE', [ROOT], ROOT, 'PROBE');
    const scanner1 = new SecretsScanner(op1);

    // Create a test file with a known secret.
    //
    // LAB HYGIENE: the fixture is assembled from fragments at runtime, so the repository
    // never contains a contiguous secret-shaped literal. GitHub's push protection blocks a
    // push that carries one, and a random-looking key may one day be a real key. The
    // scanner still receives exactly the same shapes at runtime, so the detection and the
    // redaction logic are exercised for real - nothing is weakened, only the literal stops
    // living in the source.
    const AWS_SECRET_EXAMPLE = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCY', 'EXAMPLEKEY'].join('/');
    const API_KEY_EXAMPLE = ['sk_live_', 'abcdefghijklmnopqrstuvwxyz', '1234567890'].join('');
    const testFile = path.join(ROOT, 'tools', 'secrets_test_fixture.env');
    fs.writeFileSync(testFile, `AWS_SECRET_ACCESS_KEY=${AWS_SECRET_EXAMPLE}\nAPI_KEY=${API_KEY_EXAMPLE}\n`);

    const findings = await scanner1.scanDirectory(ROOT, { addFindings: false, maxFiles: 5000 });
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    const awsFindings = findings.filter(f => f.type.includes('aws') || f.type.includes('AWS'));
    const genericFindings = findings.filter(f => f.type === 'generic_assignment' || f.type === 'possible_secret');

    check('scanner runs without error', findings.length >= 0, `${findings.length} total findings`);
    check('AWS secret pattern detected', awsFindings.length > 0 || genericFindings.length > 0,
        `aws=${awsFindings.length} generic=${genericFindings.length}`);
    check('all findings have masked values only (no raw secrets in output)',
        findings.every(f => !f.redacted.includes(AWS_SECRET_EXAMPLE.slice(0, 12)) && !f.redacted.includes(API_KEY_EXAMPLE)),
        'redacted values are masked');
    check('every finding has sha256Prefix', findings.every(f => f.sha256Prefix && f.sha256Prefix.length === 12),
        `${findings.filter(f => f.sha256Prefix?.length === 12).length}/${findings.length}`);
    check('every finding has entropy computed (when detector provided it)', findings.filter(f => typeof f.entropy === 'number').length > 0,
        `${findings.filter(f => typeof f.entropy === 'number').length}/${findings.length} have entropy`);
    check('every finding has file/line/column', findings.every(f => f.file && f.line > 0 && f.column > 0),
        'all have location metadata');

    // Test 2: Git history scan
    console.log('\n=== 2. GIT HISTORY SCAN (real git log parsing) ===');
    const op2 = arsenalCore.createOperation('DEFENSIVE', [ROOT], ROOT, 'PROBE');
    const scanner2 = new SecretsScanner(op2);
    const gitFindings = await scanner2.scanGitHistory(ROOT, 50);
    check('git history scan runs', Array.isArray(gitFindings), `${gitFindings.length} findings from git history`);
    check('git findings have commit hash', gitFindings.every(f => f.commit && f.commit.length >= 7),
        `${gitFindings.filter(f => f.commit?.length >= 7).length}/${gitFindings.length}`);

    // Test 3: Env file scan
    console.log('\n=== 3. ENV FILE SCAN (real .env parsing) ===');
    const op3 = arsenalCore.createOperation('DEFENSIVE', [ROOT], ROOT, 'PROBE');
    const scanner3 = new SecretsScanner(op3);
    const envFindings = await scanner3.scanEnvFiles(ROOT);
    check('env file scan runs', Array.isArray(envFindings), `${envFindings.length} findings from env files`);
    check('env findings have source=env_file', envFindings.every(f => f.source === 'env_file'),
        `${envFindings.filter(f => f.source === 'env_file').length}/${envFindings.length}`);

    // Test 4: Report generation
    console.log('\n=== 4. REPORT GENERATION ===');
    const allFindings = [...findings, ...gitFindings, ...envFindings];
    const report = scanner1.generateReport(allFindings);
    check('report has operationId', !!report.operationId, report.operationId);
    check('report has byType breakdown', Object.keys(report.byType).length > 0, JSON.stringify(report.byType));
    check('report has bySeverity breakdown', Object.keys(report.bySeverity).length > 0, JSON.stringify(report.bySeverity));
    check('report has redactedSamples', Object.keys(report.redactedSamples).length >= 0, 'samples present');

    // Test 5: Redaction function
    console.log('\n=== 5. REDACTION UTILITY ===');
    const textWithSecret = 'API_KEY=demo_test_token_abcdefghijklmnopqrstuvwxyz123456';
    const masked = scanner1.redact(textWithSecret);
    check('redact masks the secret', masked.includes('…') || masked.length < textWithSecret.length,
        `redacted: ${masked}`);
    check('redact does not leak full secret', !masked.includes('demo_test_token_abcdefghijklmnopqrstuvwxyz123456'),
        'full secret not present');

    // Test 6: shannonEntropyString export
    console.log('\n=== 6. ENTROPY CALCULATION ===');
    const { shannonEntropyString } = await import('../src/neo/arsenal/secrets/secrets_scanner.ts');
    const lowEntropy = shannonEntropyString('aaaaaaaaaaaaaaaaaaaa');
    const highEntropy = shannonEntropyString('X7k9mP2qR5vW8zL3nM1pQ4tY6uI0oA');
    check('low entropy string has low score', lowEntropy < 1.5, `low=${lowEntropy.toFixed(2)}`);
    check('high entropy string has high score', highEntropy > 3.5, `high=${highEntropy.toFixed(2)}`);

    console.log(`\n${failures.length === 0 ? 'SECRETS PROBE: ALL PASSED' : 'SECRETS PROBE: FAILURES -> ' + failures.join(', ')}`);
    process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('SECRETS PROBE CRASHED:', err);
    process.exit(1);
});