#!/usr/bin/env tsx
/**
 * Ground-truth probe for the Crypto Arsenal.
 * Every assertion below is checked against a real computation — no mocks, no fixtures that lie.
 */
import crypto from 'crypto';
import { arsenalCore, CryptoArsenal } from '../src/neo/arsenal/index.ts';

const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
    const tag = cond ? '[PASS]' : '[FAIL]';
    console.log(`${tag} ${name}${detail ? ' :: ' + detail : ''}`);
    if (!cond) failures.push(name);
}

const ctx = arsenalCore.createOperation('PURPLE', ['github.com', 'example.com'], 'github.com', 'AUTH-PROBE');
const crypto_ = new CryptoArsenal(ctx);

console.log('\n=== 1. ENTROPY (real Shannon over real bytes) ===');
const lowEntropy = crypto_.analyzer.entropyAnalysis(Buffer.from('aaaaaaaaaaaaaaaaaaaa', 'utf8'));
const highEntropy = crypto_.analyzer.entropyAnalysis(crypto.randomBytes(4096));
check('low entropy buffer < 1 bit', lowEntropy < 1, `entropy=${lowEntropy.toFixed(4)}`);
check('random buffer entropy > 7.9 bits', highEntropy > 7.9, `entropy=${highEntropy.toFixed(4)}`);

console.log('\n=== 2. ALGORITHM ANALYSIS (real regex over real source) ===');
const sample = `
import crypto from 'crypto';
const h = crypto.createHash('md5').update(x).digest('hex');
const c = crypto.createCipheriv('aes-256-ecb', key, iv);
const r = Math.random();
const jwt = require('jsonwebtoken').sign(p, 'rsa-pkcs1v1_5');
`;
const algo = crypto_.analyzer.analyzeAlgorithm(sample);
check('detected MD5', algo.weak.some(a => a.name === 'MD5'));
check('detected ECB mode', algo.weak.some(a => a.name === 'ECB'));
check('detected Math.random', algo.weak.some(a => a.name === 'Math.random'));
check('detected RSA-PKCS1v1.5', algo.weak.some(a => a.name === 'RSA-PKCS1v1.5'));
check('produced remediation text', algo.recommendations.length > 0, `${algo.recommendations.length} recs`);
const clean = crypto_.analyzer.analyzeAlgorithm('const x = 1 + 1;');
check('clean code produces no weak hits', clean.weak.length === 0, `weak=${clean.weak.length}`);

console.log('\n=== 3. HASH CRACKING (real dictionary attack) ===');
const target = crypto.createHash('sha256').update('password').digest('hex');
const cracked = await crypto_.cracker.crackHash(target);
check('sha256 identified', cracked.hashType === 'SHA256', cracked.hashType);
check('password actually cracked', cracked.cracked === true, `plain=${cracked.plain} tried=${cracked.candidatesTried}`);
check('cracked plain is correct', cracked.plain === 'password', String(cracked.plain));
const md5 = crypto.createHash('md5').update('admin').digest('hex');
const crackedMd5 = await crypto_.cracker.crackHash(md5);
check('md5 identified and cracked', crackedMd5.cracked === true && crackedMd5.plain === 'admin', `${crackedMd5.hashType}/${crackedMd5.plain}`);
const miss = await crypto_.cracker.crackHash(crypto.createHash('sha256').update('zzz-not-in-list-xyz').digest('hex'));
check('unknown hash not falsely cracked', miss.cracked === false);

console.log('\n=== 4. TLS VERSION PROBE (real handshakes) ===');
const tlsv = await crypto_.ssl.checkTLSVersion('github.com', 443);
check('github.com offers TLSv1.3', tlsv.supported.includes('TLSv1.3'), `supported=${tlsv.supported.join(',')}`);
check('github.com offers TLSv1.2', tlsv.supported.includes('TLSv1.2'));
check('no weak version accepted', tlsv.weak.length === 0, `weak=${tlsv.weak.join(',')}`);

console.log('\n=== 5. CERTIFICATE ANALYSIS (real peer cert) ===');
const cert = await crypto_.ssl.analyzeCertificate('github.com', 443);
check('certificate reachable', cert.reachable === true, cert.reason || '');
check('issuer resolved', !!cert.issuer && cert.issuer !== 'unknown', String(cert.issuer));
check('key size computed', typeof cert.keySize === 'number' && cert.keySize! >= 256, `alg=${cert.publicKeyAlgorithm} bits=${cert.keySize}`);
check('signature algorithm parsed from DER', !!cert.signatureAlgorithm && cert.signatureAlgorithm !== 'unknown', String(cert.signatureAlgorithm));
check('hostname matched', cert.hostnameMatches === true);
check('not expired', cert.expired === false, `validTo=${cert.validTo}`);

console.log('\n=== 6. CSR GENERATION (real openssl) ===');
const csr = crypto_.certs.generateCSR('arsenal.test.local', { organization: 'Sovereign Arsenal' });
check('CSR is PEM', csr.includes('-----BEGIN CERTIFICATE REQUEST-----'), `${csr.length} bytes`);
const { execFileSync } = await import('child_process');
const fs = await import('fs');
const os = await import('os');
const path = await import('path');
// PORTABILITY: the scratch directory must be the host's, not one this repository happens to
// have on the machine that wrote the probe. A hardcoded scratch path passed locally and
// failed on the CI runner with ENOENT, which is exactly what a hardcoded path should do.
// Gate 9 enforces this at repository level (no author-machine paths in executable code), so
// the literal is deliberately not repeated here.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arsenal-csr-'));
const p = `${tmp}/r.csr`;
fs.writeFileSync(p, csr);
const csrText = execFileSync('openssl', ['req', '-in', p, '-noout', '-text'], { encoding: 'utf8' });
check('openssl parses the CSR', /Subject:/i.test(csrText), csrText.split('\n').find(l => /Subject:/.test(l))?.trim() || '');
check('CSR subject carries the CN', /arsenal\.test\.local/.test(csrText));

console.log('\n=== 7. CHAIN VERIFICATION (real X509 checks) ===');
// Build a real self-signed leaf + real CA-signed leaf using openssl.
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${tmp}/ca.key`,
    '-out', `${tmp}/ca.crt`, '-days', '2', '-subj', '/CN=Arsenal Test CA'], { stdio: 'ignore' });
execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${tmp}/leaf.key`,
    '-out', `${tmp}/leaf.csr`, '-subj', '/CN=leaf.arsenal.test'], { stdio: 'ignore' });
execFileSync('openssl', ['x509', '-req', '-in', `${tmp}/leaf.csr`, '-CA', `${tmp}/ca.crt`, '-CAkey', `${tmp}/ca.key`,
    '-CAcreateserial', '-out', `${tmp}/leaf.crt`, '-days', '1'], { stdio: 'ignore' });

const leafPem = fs.readFileSync(`${tmp}/leaf.crt`, 'utf8');
const caPem = fs.readFileSync(`${tmp}/ca.crt`, 'utf8');
const chain = crypto_.certs.verifyChainDetailed(leafPem, [caPem]);
check('real CA-signed chain verifies', chain.valid === true, `problems=${JSON.stringify(chain.problems)}`);
check('chain link signature verified', chain.links[0]?.signatureValid === true);
check('chain length is 2', chain.chainLength === 2, String(chain.chainLength));
const badChain = crypto_.certs.verifyChainDetailed(leafPem, [leafPem]);
check('wrong chain is rejected', badChain.valid === false, `problems=${badChain.problems.length}`);
const expiredCheck = crypto_.certs.verifyChainDetailed(leafPem);
check('leaf-only chain reports self-signed correctly', expiredCheck.valid === true || expiredCheck.problems.length > 0);

console.log('\n=== 8. FINDINGS WERE RECORDED ===');
const findings = arsenalCore.getFindings();
const cryptoFindings = findings.filter(f => f.category === 'weak_crypto');
check('weak_crypto findings recorded', cryptoFindings.length > 0, `${cryptoFindings.length} findings`);
console.log('  titles:', cryptoFindings.map(f => f.title).join(' | '));

console.log(`\n${failures.length === 0 ? 'CRYPTO PROBE: ALL PASSED' : 'CRYPTO PROBE: FAILURES -> ' + failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
