/**
 * ====================================================================================================
 * CRYPTO ARSENAL - CRYPTOGRAPHIC ANALYSIS & SECURITY
 *
 * Every capability here performs real work against real bytes / real TLS handshakes / real openssl
 * invocations. Nothing is simulated and no result is ever invented:
 *   - entropy is computed over the actual buffer
 *   - certificate data is parsed with crypto.X509Certificate
 *   - TLS versions are proven by an actual handshake attempt
 *   - hashes are cracked by an actual dictionary attack over a real wordlist
 *   - CSRs are produced by the real openssl binary and verified by it
 * ====================================================================================================
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import tls from 'tls';
import { execFileSync } from 'child_process';
import { arsenalCore, OperationContext } from '../core/arsenal_core';

export interface CryptoAlgorithmHit {
    name: string;
    occurrences: number;
    evidence: string[];
    weak: boolean;
    reason?: string;
}

export interface CertificateReport {
    host: string;
    port: number;
    reachable: boolean;
    reason?: string;
    subject?: string;
    issuer?: string;
    validFrom?: string;
    validTo?: string;
    daysRemaining?: number;
    expired?: boolean;
    notYetValid?: boolean;
    selfSigned?: boolean;
    serialNumber?: string;
    fingerprint256?: string;
    signatureAlgorithm?: string;
    publicKeyAlgorithm?: string;
    keySize?: number;
    san?: string[];
    isCA?: boolean;
    hostnameMatches?: boolean;
    vulnerabilities: { type: string; severity: string; detail: string }[];
}

export interface ChainVerification {
    valid: boolean;
    leaf?: {
        subject: string;
        issuer: string;
        validFrom: string;
        validTo: string;
        expired: boolean;
        selfSigned: boolean;
    };
    chainLength: number;
    links: { subject: string; issuer: string; subjectIssuedByNext: boolean; signatureValid: boolean }[];
    problems: string[];
}

/** Shannon's entropy over the real byte distribution. */
export function shannonEntropy(buf: Buffer): number {
    if (!buf || buf.length === 0) return 0;
    const freq = new Uint32Array(256);
    for (const b of buf) freq[b]++;
    let entropy = 0;
    for (const count of freq) {
        if (count === 0) continue;
        const p = count / buf.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

/* ---------------------------------------------------------------------------------------------
 * Minimal DER reader — used to extract the real signatureAlgorithm OID from a certificate.
 * Node's X509Certificate does not expose the signature algorithm, so it is parsed from the
 * actual DER bytes rather than guessed.
 * ------------------------------------------------------------------------------------------- */

function readTLV(buf: Buffer, off: number): { tag: number; len: number; contentStart: number; contentEnd: number } {
    const tag = buf[off];
    let p = off + 1;
    let len = buf[p++];
    if (len & 0x80) {
        const n = len & 0x7f;
        len = 0;
        for (let i = 0; i < n; i++) len = len * 256 + buf[p++];
    }
    return { tag, len, contentStart: p, contentEnd: p + len };
}

function decodeOid(content: Buffer): string | null {
    if (content.length === 0) return null;
    const bytes: number[] = [];
    let v = 0n;
    for (const b of content) {
        v = (v << 7n) | BigInt(b & 0x7f);
        if (!(b & 0x80)) {
            bytes.push(Number(v));
            v = 0n;
        }
    }
    if (bytes.length === 0) return null;
    const first = bytes[0];
    let arc1: number, arc2: number;
    if (first < 40) { arc1 = 0; arc2 = first; }
    else if (first < 80) { arc1 = 1; arc2 = first - 40; }
    else { arc1 = 2; arc2 = first - 80; }
    return [arc1, arc2, ...bytes.slice(1)].join('.');
}

const SIG_OID_NAMES: Record<string, string> = {
    '1.2.840.113549.1.1.5':  'sha1WithRSAEncryption',
    '1.2.840.113549.1.1.10': 'RSASSA-PSS',
    '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
    '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
    '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
    '1.2.840.10045.4.1':     'ecdsa-with-SHA1',
    '1.2.840.10045.4.3.2':   'ecdsa-with-SHA256',
    '1.2.840.10045.4.3.3':   'ecdsa-with-SHA384',
    '1.2.840.10045.4.3.4':   'ecdsa-with-SHA512',
    '1.3.101.112':           'Ed25519',
    '1.3.101.113':           'Ed448'
};

const EC_CURVE_BITS: Record<string, number> = {
    'prime256v1': 256, 'secp256r1': 256,
    'secp384r1': 384, 'secp521r1': 521,
    'secp224r1': 224,
    'ed25519': 256, 'ed448': 456,
    'x25519': 256, 'x448': 448
};

/** Extract the real signature algorithm from the certificate DER. */
export function signatureAlgorithmFromDer(raw: Buffer): string | null {
    try {
        const cert = readTLV(raw, 0);
        const tbs = readTLV(raw, cert.contentStart);
        const sigAlg = readTLV(raw, tbs.contentEnd);
        const oid = readTLV(raw, sigAlg.contentStart);
        if (oid.tag !== 0x06) return null;
        const dotted = decodeOid(raw.subarray(oid.contentStart, oid.contentEnd));
        if (!dotted) return null;
        return SIG_OID_NAMES[dotted] ?? `oid:${dotted}`;
    } catch {
        return null;
    }
}

/** Real key size in bits, derived from the actual public key material. */
export function publicKeyBits(key: crypto.KeyObject): { algorithm: string; bits?: number } {
    const algorithm = key.asymmetricKeyType || 'unknown';
    const details: any = key.asymmetricKeyDetails ?? {};
    if (typeof details.modulusLength === 'number') return { algorithm, bits: details.modulusLength };
    if (typeof details.divisorLength === 'number') return { algorithm, bits: details.divisorLength };
    if (details.namedCurve && EC_CURVE_BITS[details.namedCurve]) {
        return { algorithm: `${algorithm}-${details.namedCurve}`, bits: EC_CURVE_BITS[details.namedCurve] };
    }
    return { algorithm };
}


/**
 * Resolve the arsenal data root. Uses only process-level information so the module stays
 * loadable as both ESM and CommonJS (no __dirname / import.meta).
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

export class CryptoAnalyzer {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('CRYPTO_ANALYZER_INIT', 'crypto', 'SUCCESS', {});
    }

    /**
     * Detect cryptographic algorithm usage in real source/text by scanning for real API calls
     * and algorithm names. Every hit carries the matched line as evidence.
     */
    analyzeAlgorithm(data: string): {
        algorithms: CryptoAlgorithmHit[];
        weak: CryptoAlgorithmHit[];
        strong: CryptoAlgorithmHit[];
        recommendations: string[];
        entropy: number;
    } {
        const text = String(data ?? '');
        const lines = text.split(/\r?\n/);

        const SIGNATURES: { name: string; re: RegExp; weak: boolean; reason?: string }[] = [
            { name: 'MD5',            re: /\bmd5\b|createHash\(\s*['"]md5['"]/gi, weak: true,  reason: 'MD5 is broken for collision resistance' },
            { name: 'SHA1',           re: /\bsha-?1\b|createHash\(\s*['"]sha-?1['"]/gi, weak: true, reason: 'SHA1 is deprecated for signing' },
            { name: 'DES',            re: /\bdes\b|des-?ede3|['"]des-/gi, weak: true,  reason: 'DES/3DES has a 64-bit block size' },
            { name: 'RC4',            re: /\brc4\b/gi, weak: true, reason: 'RC4 is a broken stream cipher' },
            { name: 'ECB',            re: /\bmode:\s*['"]ecb['"]|['"]aes-\d+-ecb['"]|['"]des-ede3['"]/gi, weak: true, reason: 'ECB leaks plaintext structure' },
            { name: 'Math.random',    re: /Math\.random\s*\(/g, weak: true, reason: 'Math.random is not cryptographically secure' },
            { name: 'AES-CBC',        re: /\bcreateCipheriv?\b[\s\S]{0,80}?['"]aes-\d+-cbc['"]/gi, weak: false },
            { name: 'AES-GCM',        re: /['"]aes-\d+-gcm['"]/gi, weak: false },
            { name: 'RSA-PKCS1v1.5',  re: /['"]rsa-pkcs1v1_5['"]|RSA_PKCS1_PADDING/gi, weak: true, reason: 'PKCS#1 v1.5 padding is susceptible to Bleichenbacher attacks' },
            { name: 'RSA-OAEP',       re: /['"]rsa-oaep['"]|RSA_PKCS1_OAEP_PADDING/gi, weak: false },
            { name: 'RSA-PSS',        re: /['"]rsa-pss['"]/gi, weak: false },
            { name: 'SHA256',         re: /\bsha-?256\b|createHash\(\s*['"]sha256['"]/gi, weak: false },
            { name: 'SHA512',         re: /\bsha-?512\b/gi, weak: false },
            { name: 'bcrypt',         re: /\bbcrypt\b/gi, weak: false },
            { name: 'scrypt',         re: /\bscrypt\b/gi, weak: false },
            { name: 'argon2',         re: /\bargon2/i, weak: false },
            { name: 'PBKDF2',         re: /\bpbkdf2\b|pbkdf2Sync/gi, weak: false },
            { name: 'HKDF',           re: /\bhkdf\b/gi, weak: false },
            { name: 'ECDH',           re: /\becdh\b|createECDH/gi, weak: false },
            { name: 'Ed25519',        re: /\bed25519\b/gi, weak: false },
            { name: 'X25519',         re: /\bx25519\b/gi, weak: false },
            { name: 'ChaCha20',       re: /\bchacha20\b/gi, weak: false },
            { name: 'TLSv1.0',       re: /\bTLSv1\b(?![\d.])|minVersion:\s*['"]TLSv1['"]/g, weak: true, reason: 'TLS 1.0 is deprecated (RFC 8996)' },
            { name: 'TLSv1.1',       re: /\bTLSv1\.1\b|minVersion:\s*['"]TLSv1\.1['"]/g, weak: true, reason: 'TLS 1.1 is deprecated (RFC 8996)' },
            { name: 'SSLv3',          re: /\bsslv3\b/gi, weak: true, reason: 'SSLv3 is broken' }
        ];

        const algorithms: CryptoAlgorithmHit[] = [];
        for (const sig of SIGNATURES) {
            const evidence: string[] = [];
            let occurrences = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                sig.re.lastIndex = 0;
                if (sig.re.test(line)) {
                    occurrences++;
                    if (evidence.length < 5) {
                        evidence.push(`L${i + 1}: ${line.trim().slice(0, 200)}`);
                    }
                }
            }
            if (occurrences > 0) {
                algorithms.push({
                    name: sig.name,
                    occurrences,
                    evidence,
                    weak: sig.weak,
                    reason: sig.reason
                });
            }
        }

        const weak = algorithms.filter(a => a.weak);
        const strong = algorithms.filter(a => !a.weak);

        const recommendations: string[] = [];
        if (weak.some(a => a.name === 'MD5')) recommendations.push('Replace MD5 with SHA-256 or better');
        if (weak.some(a => a.name === 'SHA1')) recommendations.push('Replace SHA-1 with SHA-256 or better');
        if (weak.some(a => a.name === 'DES')) recommendations.push('Replace DES/3DES with AES-256-GCM');
        if (weak.some(a => a.name === 'ECB')) recommendations.push('Switch block cipher mode to GCM or CBC with a random IV');
        if (weak.some(a => a.name === 'Math.random')) recommendations.push('Use crypto.randomBytes for security-sensitive randomness');
        if (weak.some(a => a.name.startsWith('RSA-PKCS1'))) recommendations.push('Use RSA-OAEP or an ECDH key agreement');
        if (weak.some(a => a.name.startsWith('TLS'))) recommendations.push('Enforce TLS 1.2+ (prefer TLS 1.3)');
        if (recommendations.length === 0 && algorithms.length === 0) {
            recommendations.push('No cryptographic primitives detected in the supplied content');
        }

        const entropy = shannonEntropy(Buffer.from(text, 'utf8'));

        arsenalCore.audit('ALGO_ANALYSIS', 'crypto', 'SUCCESS', {
            algorithms: algorithms.length, weak: weak.length, entropy: Number(entropy.toFixed(3))
        });

        if (weak.length > 0) {
            arsenalCore.addFinding({
                title: `Weak or deprecated cryptography detected: ${weak.map(w => w.name).join(', ')}`,
                severity: weak.some(w => ['MD5', 'DES', 'RC4', 'SSLv3'].includes(w.name)) ? 'HIGH' : 'MEDIUM',
                category: 'weak_crypto',
                description: `Static analysis found ${weak.length} weak or deprecated cryptographic primitive(s): ` +
                             `${weak.map(w => `${w.name} (${w.occurrences}x)`).join(', ')}.`,
                evidence: { weak: weak.map(w => ({ name: w.name, occurrences: w.occurrences, reason: w.reason, evidence: w.evidence })) },
                remediation: recommendations.join('; '),
                verified: true
            });
        }

        return { algorithms, weak, strong, recommendations, entropy };
    }

    /** Real Shannon entropy over the supplied buffer. */
    entropyAnalysis(data: Buffer): number {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''), 'utf8');
        const entropy = shannonEntropy(buf);
        arsenalCore.audit('ENTROPY_ANALYSIS', 'crypto', 'SUCCESS', {
            bytes: buf.length, entropy: Number(entropy.toFixed(4))
        });
        return entropy;
    }
}

export class HashCracker {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('HASH_CRACKER_INIT', 'crypto-offensive', 'ATTEMPT', {});
    }

    identifyHash(hash: string): string {
        const h = String(hash ?? '').trim();
        if (/^[a-f0-9]{32}$/i.test(h)) return 'MD5';
        if (/^[a-f0-9]{40}$/i.test(h)) return 'SHA1';
        if (/^[a-f0-9]{64}$/i.test(h)) return 'SHA256';
        if (/^[a-f0-9]{128}$/i.test(h)) return 'SHA512';
        if (/^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(h)) return 'BCRYPT';
        if (/^\$argon2(id|i|d)\$/.test(h)) return 'ARGON2';
        if (/^\$6\$/.test(h)) return 'SHA512_CRYPT';
        if (/^\$5\$/.test(h)) return 'SHA256_CRYPT';
        if (/^\$1\$/.test(h)) return 'MD5_CRYPT';
        return 'UNKNOWN';
    }

    /** Locate a real wordlist on disk; returns null when none exists. */
    private loadDefaultWordlist(): { path: string; words: string[] } | null {
        const candidates = [
            path.join(arsenalRoot(), 'data/arsenal/wordlists/common.txt'),
            path.join(arsenalRoot(), 'wordlists/common.txt')
        ];
        for (const p of candidates) {
            try {
                if (fs.existsSync(p)) {
                    const words = fs.readFileSync(p, 'utf8')
                        .split(/\r?\n/)
                        .map(l => l.trim())
                        .filter(l => l.length > 0 && !l.startsWith('#'));
                    if (words.length > 0) return { path: p, words };
                }
            } catch { /* try next candidate */ }
        }
        return null;
    }

    /**
     * Real dictionary attack: every candidate in the wordlist is hashed with the real algorithm
     * and compared byte-for-byte against the target hash.
     */
    async crackHash(hash: string, wordlist?: string[]): Promise<{
        cracked: boolean;
        plain?: string;
        hashType: string;
        candidatesTried: number;
        wordlistSource: string;
        durationMs: number;
        note?: string;
    }> {
        const started = Date.now();
        const target = String(hash ?? '').trim();
        const hashType = this.identifyHash(target);

        let words: string[] = [];
        let wordlistSource = 'provided';
        if (Array.isArray(wordlist) && wordlist.length > 0) {
            words = wordlist;
        } else {
            const loaded = this.loadDefaultWordlist();
            if (loaded) {
                words = loaded.words;
                wordlistSource = loaded.path;
            } else {
                arsenalCore.audit('HASH_CRACK_ATTEMPT', 'crypto-offensive', 'SKIPPED', {
                    reason: 'no wordlist available on disk', hashType
                });
                return {
                    cracked: false, hashType, candidatesTried: 0,
                    wordlistSource: 'none', durationMs: Date.now() - started,
                    note: 'No wordlist available. Provide a wordlist array or install data/arsenal/wordlists/common.txt'
                };
            }
        }

        arsenalCore.audit('HASH_CRACK_ATTEMPT', 'crypto-offensive', 'ATTEMPT', {
            hashType, candidates: words.length, wordlistSource
        });

        const digestFor = (word: string): string | null => {
            try {
                switch (hashType) {
                    case 'MD5':        return crypto.createHash('md5').update(word).digest('hex');
                    case 'SHA1':       return crypto.createHash('sha1').update(word).digest('hex');
                    case 'SHA256':     return crypto.createHash('sha256').update(word).digest('hex');
                    case 'SHA512':     return crypto.createHash('sha512').update(word).digest('hex');
                    case 'MD5_CRYPT':  return this.cryptMd5(target, word);
                    case 'SHA256_CRYPT':return this.cryptSha256(target, word);
                    case 'SHA512_CRYPT':return this.cryptSha512(target, word);
                    default:           return null;
                }
            } catch {
                return null;
            }
        };

        // Unsupported algorithms (bcrypt/argon2) are reported honestly rather than faked.
        if (hashType === 'BCRYPT' || hashType === 'ARGON2' || hashType === 'UNKNOWN') {
            arsenalCore.audit('HASH_CRACK_ATTEMPT', 'crypto-offensive', 'SKIPPED', {
                reason: `hash type ${hashType} is not supported by the dictionary cracker`,
                hashType
            });
            return {
                cracked: false, hashType, candidatesTried: 0, wordlistSource,
                durationMs: Date.now() - started,
                note: `Dictionary cracking supports MD5/SHA1/SHA256/SHA512 and crypt(3) hashes; got ${hashType}`
            };
        }

        let tried = 0;
        for (const word of words) {
            tried++;
            const digest = digestFor(word);
            if (digest && digest.toLowerCase() === target.toLowerCase()) {
                arsenalCore.audit('HASH_CRACK_ATTEMPT', 'crypto-offensive', 'SUCCESS', {
                    hashType, candidatesTried: tried, durationMs: Date.now() - started
                });
                return {
                    cracked: true, plain: word, hashType, candidatesTried: tried,
                    wordlistSource, durationMs: Date.now() - started
                };
            }
        }

        arsenalCore.audit('HASH_CRACK_ATTEMPT', 'crypto-offensive', 'FAILED', {
            hashType, candidatesTried: tried, durationMs: Date.now() - started
        });
        return {
            cracked: false, hashType, candidatesTried: tried,
            wordlistSource, durationMs: Date.now() - started,
            note: `No match in ${tried} candidates`
        };
    }

    /** Real crypt(3) MD5 verification via the system libc. */
    private cryptMd5(target: string, word: string): string | null {
        const salt = target.split('$')[2] ?? '';
        return this.runCrypt(`${salt}$${word}`, target);
    }
    private cryptSha256(target: string, word: string): string | null {
        const parts = target.split('$');
        const salt = parts[2] ?? '';
        return this.runCrypt(`$5$${salt}$${word}`, target);
    }
    private cryptSha512(target: string, word: string): string | null {
        const parts = target.split('$');
        const salt = parts[2] ?? '';
        return this.runCrypt(`$6$${salt}$${word}`, target);
    }
    private runCrypt(candidate: string, target: string): string | null {
        try {
            const out = execFileSync('python3', [
                '-c',
                'import crypt,sys;print(crypt.crypt(sys.argv[1], sys.argv[2]))',
                candidate, target
            ], { encoding: 'utf8', timeout: 5000 }).trim();
            return out || null;
        } catch {
            return null;
        }
    }
}

export class SSLAnalyzer {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('SSL_ANALYZER_INIT', 'crypto-defensive', 'SUCCESS', {});
    }

    /** Open a real TLS connection and return the real negotiated parameters + peer certificate. */
    private handshake(host: string, port: number, opts: tls.ConnectionOptions = {}): Promise<{
        ok: boolean;
        reason?: string;
        protocol?: string;
        cipher?: string;
        cert?: crypto.X509Certificate;
        socket?: tls.TLSSocket;
    }> {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (result: { ok: boolean; reason?: string; protocol?: string; cipher?: string; cert?: crypto.X509Certificate; socket?: tls.TLSSocket }) => {
                if (settled) return;
                settled = true;
                try { socket.destroy(); } catch { /* ignore */ }
                resolve(result);
            };
            const socket = tls.connect({
                host, port, rejectUnauthorized: false, timeout: 8000, servername: host, ...opts
            }, () => {
                try {
                    const x509 = socket.getPeerX509Certificate?.() ?? (() => {
                        const raw = socket.getPeerCertificate(true)?.raw;
                        if (!raw) return undefined;
                        return new crypto.X509Certificate(
                            '-----BEGIN CERTIFICATE-----\n' + raw.toString('base64') + '\n-----END CERTIFICATE-----\n'
                        );
                    })();
                    finish({
                        ok: true,
                        protocol: socket.getProtocol(),
                        cipher: socket.getCipher()?.name,
                        cert: x509,
                        socket
                    });
                } catch (err: any) {
                    finish({ ok: false, reason: err?.message || 'handshake parse failure' });
                }
            });
            socket.once('error', (err: any) => finish({ ok: false, reason: `${err?.code || 'ERROR'}: ${err?.message}` }));
            socket.once('timeout', () => finish({ ok: false, reason: 'ETIMEOUT: TLS handshake timed out' }));
        });
    }

    /** Parse and assess a real certificate. */
    async analyzeCertificate(host: string, port: number = 443): Promise<CertificateReport> {
        arsenalCore.audit('SSL_CERT_ANALYZE', 'crypto-defensive', 'ATTEMPT', { host, port });
        const hs = await this.handshake(host, port);

        if (!hs.ok || !hs.cert) {
            arsenalCore.audit('SSL_CERT_ANALYZE', 'crypto-defensive', 'FAILED', { host, port, reason: hs.reason });
            return {
                host, port, reachable: false, reason: hs.reason || 'no certificate obtained',
                vulnerabilities: []
            };
        }

        const x = hs.cert;
        const subject = x.subject.replace(/\n/g, ', ');
        const issuer = x.issuer.replace(/\n/g, ', ');
        const validFrom = x.validFrom;
        const validTo = x.validTo;
        const now = new Date();
        const notYetValid = new Date(validFrom) > now;
        const expired = new Date(validTo) < now;
        const daysRemaining = Math.floor((new Date(validTo).getTime() - now.getTime()) / 86400000);
        const selfSigned = subject === issuer;
        const sigAlg = signatureAlgorithmFromDer(x.raw) ?? 'unknown';
        const keyInfo = publicKeyBits(x.publicKey);
        const pubAlg = keyInfo.algorithm;
        const keySize = keyInfo.bits;
        const san = x.subjectAltName ? x.subjectAltName.split(',').map(s => s.trim()) : [];
        const fingerprint256 = x.fingerprint256;

        const vulnerabilities: { type: string; severity: string; detail: string }[] = [];
        if (expired) vulnerabilities.push({ type: 'expired_certificate', severity: 'HIGH', detail: `Certificate expired on ${validTo}` });
        if (notYetValid) vulnerabilities.push({ type: 'not_yet_valid', severity: 'HIGH', detail: `Certificate is not valid before ${validFrom}` });
        if (daysRemaining >= 0 && daysRemaining < 15) vulnerabilities.push({ type: 'expiring_soon', severity: 'MEDIUM', detail: `Certificate expires in ${daysRemaining} day(s)` });
        if (selfSigned) vulnerabilities.push({ type: 'self_signed', severity: 'MEDIUM', detail: 'Certificate is self-signed' });
        if (/sha1/i.test(sigAlg)) vulnerabilities.push({ type: 'weak_signature_algorithm', severity: 'HIGH', detail: `Signature algorithm is ${sigAlg}` });
        if (/md5/i.test(sigAlg)) vulnerabilities.push({ type: 'broken_signature_algorithm', severity: 'CRITICAL', detail: `Signature algorithm is ${sigAlg}` });
        if (pubAlg === 'rsa' && keySize !== undefined && keySize < 2048) {
            vulnerabilities.push({ type: 'weak_key_size', severity: 'HIGH', detail: `RSA key is ${keySize} bits` });
        }
        if (pubAlg === 'rsa' && keySize !== undefined && keySize >= 2048 && keySize < 3072) {
            vulnerabilities.push({ type: 'moderate_key_size', severity: 'LOW', detail: `RSA key is ${keySize} bits (3072+ recommended)` });
        }
        if (/tlsv1\.0|tlsv1\.1/i.test(hs.protocol || '')) {
            vulnerabilities.push({ type: 'weak_tls_version', severity: 'HIGH', detail: `Negotiated ${hs.protocol}` });
        }

        // Hostname match against SAN first, then CN.
        const cn = (() => {
            const m = /CN\s*=\s*([^,\n]+)/.exec(x.subject);
            return m ? m[1].trim() : '';
        })();
        const sanHosts = san.map(s => s.replace(/^DNS:/i, '').replace(/^IP Address:/i, '').trim());
        const hostnameMatches = sanHosts.some(s => s.toLowerCase() === host.toLowerCase())
            || (cn.toLowerCase() === host.toLowerCase())
            || sanHosts.some(s => s.startsWith('*.') && host.toLowerCase().endsWith(s.slice(1).toLowerCase()));
        if (!hostnameMatches) {
            vulnerabilities.push({ type: 'hostname_mismatch', severity: 'HIGH', detail: `Certificate does not cover ${host}` });
        }

        const report: CertificateReport = {
            host, port, reachable: true,
            subject, issuer, validFrom, validTo, daysRemaining, expired, notYetValid,
            selfSigned, serialNumber: x.serialNumber, fingerprint256,
            signatureAlgorithm: sigAlg, publicKeyAlgorithm: pubAlg, keySize,
            san: sanHosts, isCA: x.ca, hostnameMatches,
            vulnerabilities
        };

        arsenalCore.audit('SSL_CERT_ANALYZE', 'crypto-defensive', 'SUCCESS', {
            host, port, protocol: hs.protocol, issuer, daysRemaining, vulnerabilities: vulnerabilities.length
        });

        if (vulnerabilities.some(v => v.severity === 'CRITICAL' || v.severity === 'HIGH')) {
            arsenalCore.addFinding({
                title: `Weak TLS configuration on ${host}:${port}`,
                severity: vulnerabilities.some(v => v.severity === 'CRITICAL') ? 'CRITICAL' : 'HIGH',
                category: 'weak_crypto',
                description: vulnerabilities.map(v => `${v.type}: ${v.detail}`).join('; '),
                evidence: { host, port, protocol: hs.protocol, cipher: hs.cipher, issuer, validTo, vulnerabilities },
                remediation: 'Serve a modern certificate (RSA 3072+/ECDSA P-256, SHA-256 signature) and enforce TLS 1.2+',
                verified: true
            });
        }

        return report;
    }

    /** Prove which TLS versions the server really accepts by attempting real handshakes. */
    async checkTLSVersion(host: string, port: number = 443): Promise<{
        supported: string[];
        rejected: string[];
        weak: string[];
        best: string | null;
        details: { version: string; accepted: boolean; cipher?: string; reason?: string }[];
    }> {
        const versions: { label: string; min: tls.SecureVersion; max: tls.SecureVersion }[] = [
            { label: 'TLSv1.0', min: 'TLSv1', max: 'TLSv1' },
            { label: 'TLSv1.1', min: 'TLSv1.1', max: 'TLSv1.1' },
            { label: 'TLSv1.2', min: 'TLSv1.2', max: 'TLSv1.2' },
            { label: 'TLSv1.3', min: 'TLSv1.3', max: 'TLSv1.3' }
        ];

        const details: { version: string; accepted: boolean; cipher?: string; reason?: string }[] = [];
        for (const v of versions) {
            const hs = await this.handshake(host, port, { minVersion: v.min, maxVersion: v.max });
            details.push({
                version: v.label,
                accepted: hs.ok,
                cipher: hs.cipher,
                reason: hs.ok ? undefined : hs.reason
            });
        }

        const supported = details.filter(d => d.accepted).map(d => d.version);
        const rejected = details.filter(d => !d.accepted).map(d => d.version);
        const weak = supported.filter(v => v === 'TLSv1.0' || v === 'TLSv1.1');

        arsenalCore.audit('TLS_VERSION_CHECK', 'crypto-defensive', 'SUCCESS', { host, port, supported, weak });

        if (weak.length > 0) {
            arsenalCore.addFinding({
                title: `Deprecated TLS version accepted on ${host}:${port}`,
                severity: 'HIGH',
                category: 'weak_crypto',
                description: `The server completed a real handshake using ${weak.join(', ')}.`,
                evidence: { host, port, supported, weak, details },
                remediation: 'Disable TLS 1.0 and 1.1; require TLS 1.2 minimum and prefer TLS 1.3',
                verified: true
            });
        }

        const best = supported.includes('TLSv1.3') ? 'TLSv1.3'
                   : supported.includes('TLSv1.2') ? 'TLSv1.2'
                   : supported[0] ?? null;

        return { supported, rejected, weak, best, details };
    }
}

export class CertTools {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('CERT_TOOLS_INIT', 'crypto', 'SUCCESS', {});
    }

    private opensslAvailable(): boolean {
        try {
            execFileSync('openssl', ['version'], { stdio: 'ignore', timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Generate a REAL PKCS#10 CSR with the system openssl and verify it with openssl before
     * returning. Returns the actual PEM text.
     */
    generateCSR(commonName: string, opts: { organization?: string; keySize?: number } = {}): string {
        const cn = String(commonName ?? '').trim();
        arsenalCore.audit('CSR_GENERATE', 'crypto', 'ATTEMPT', { commonName: cn });

        if (!cn) {
            throw new Error('generateCSR requires a non-empty commonName');
        }
        if (!this.opensslAvailable()) {
            arsenalCore.audit('CSR_GENERATE', 'crypto', 'FAILED', { reason: 'openssl binary not available' });
            throw new Error('openssl is not available on this host; CSR generation cannot be performed');
        }

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arsenal-csr-'));
        const keyPath = path.join(tmp, 'key.pem');
        const csrPath = path.join(tmp, 'req.csr');
        const keySize = opts.keySize && opts.keySize >= 2048 ? opts.keySize : 2048;
        const subject = `/CN=${cn.replace(/\//g, '')}${opts.organization ? `/O=${opts.organization.replace(/\//g, '')}` : ''}`;

        try {
            execFileSync('openssl', ['req', '-new', '-newkey', `rsa:${keySize}`, '-nodes',
                '-keyout', keyPath, '-out', csrPath, '-subj', subject],
                { stdio: 'ignore', timeout: 30000 });

            // Prove the CSR really parses before handing it back.
            const text = execFileSync('openssl', ['req', '-in', csrPath, '-noout', '-text'],
                { encoding: 'utf8', timeout: 10000 });
            if (!/Certificate Request:/i.test(text)) {
                throw new Error('openssl produced an unparsable CSR');
            }

            const pem = fs.readFileSync(csrPath, 'utf8');
            arsenalCore.audit('CSR_GENERATE', 'crypto', 'SUCCESS', { commonName: cn, keySize, bytes: pem.length });
            return pem;
        } catch (err: any) {
            arsenalCore.audit('CSR_GENERATE', 'crypto', 'FAILED', { reason: err?.message });
            throw new Error(`CSR generation failed: ${err?.message || err}`);
        } finally {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }

    /**
     * Real chain verification using crypto.X509Certificate:
     *  - subject/issuer chaining via checkIssued()
     *  - actual signature verification via verify(publicKey)
     *  - validity window evaluation
     */
    verifyChain(cert: string): boolean {
        return this.verifyChainDetailed(cert).valid;
    }

    verifyChainDetailed(certPem: string, chainPem?: string[]): ChainVerification {
        arsenalCore.audit('CERT_CHAIN_VERIFY', 'crypto', 'ATTEMPT', { chainProvided: Array.isArray(chainPem) });
        const problems: string[] = [];

        let leaf: crypto.X509Certificate;
        try {
            leaf = new crypto.X509Certificate(certPem);
        } catch (err: any) {
            arsenalCore.audit('CERT_CHAIN_VERIFY', 'crypto', 'FAILED', { reason: err?.message });
            return { valid: false, chainLength: 0, links: [], problems: [`unparsable certificate: ${err?.message}`] };
        }

        const expired = new Date(leaf.validTo) < new Date();
        const notYetValid = new Date(leaf.validFrom) > new Date();
        if (expired) problems.push(`leaf certificate expired on ${leaf.validTo}`);
        if (notYetValid) problems.push(`leaf certificate is not valid before ${leaf.validFrom}`);

        const links: ChainVerification['links'] = [];
        let chainLength = 1;
        if (Array.isArray(chainPem) && chainPem.length > 0) {
            chainLength = chainPem.length + 1;
            let current = leaf;
            for (let i = 0; i < chainPem.length; i++) {
                let issuer: crypto.X509Certificate;
                try {
                    issuer = new crypto.X509Certificate(chainPem[i]);
                } catch {
                    problems.push(`chain element ${i + 1} is unparsable`);
                    break;
                }
                const subjectIssuedByNext = current.checkIssued(issuer);
                let signatureValid = false;
                try {
                    signatureValid = current.verify(issuer.publicKey);
                } catch {
                    signatureValid = false;
                }
                links.push({
                    subject: current.subject.replace(/\n/g, ', '),
                    issuer: issuer.subject.replace(/\n/g, ', '),
                    subjectIssuedByNext,
                    signatureValid
                });
                if (!subjectIssuedByNext) problems.push(`link ${i + 1}: issuer mismatch (${current.issuer.replace(/\n/g, ', ')} vs ${issuer.subject.replace(/\n/g, ', ')})`);
                if (!signatureValid) problems.push(`link ${i + 1}: signature verification FAILED`);
                current = issuer;
            }
            if (!current.ca) problems.push('the last chain element is not marked as a CA');
        } else {
            const selfSigned = leaf.subject === leaf.issuer;
            if (selfSigned) {
                let selfSig = false;
                try { selfSig = leaf.verify(leaf.publicKey); } catch { selfSig = false; }
                links.push({
                    subject: leaf.subject.replace(/\n/g, ', '),
                    issuer: leaf.issuer.replace(/\n/g, ', '),
                    subjectIssuedByNext: true,
                    signatureValid: selfSig
                });
                if (!selfSig) problems.push('self-signed certificate signature verification FAILED');
            }
        }

        const valid = problems.length === 0;
        arsenalCore.audit('CERT_CHAIN_VERIFY', 'crypto', valid ? 'SUCCESS' : 'FAILED', {
            chainLength, problems: problems.length
        });
        if (!valid) {
            arsenalCore.addFinding({
                title: `Certificate chain verification failed (${problems.length} problem(s))`,
                severity: 'HIGH',
                category: 'weak_crypto',
                description: problems.join('; '),
                evidence: { problems, links, chainLength },
                remediation: 'Reissue the certificate with a valid chain rooted in a trusted CA',
                verified: true
            });
        }

        return {
            valid,
            leaf: {
                subject: leaf.subject.replace(/\n/g, ', '),
                issuer: leaf.issuer.replace(/\n/g, ', '),
                validFrom: leaf.validFrom,
                validTo: leaf.validTo,
                expired,
                selfSigned: leaf.subject === leaf.issuer
            },
            chainLength,
            links,
            problems
        };
    }
}

export class CryptoArsenal {
    analyzer: CryptoAnalyzer;
    cracker: HashCracker;
    ssl: SSLAnalyzer;
    certs: CertTools;

    constructor(ctx: OperationContext) {
        this.analyzer = new CryptoAnalyzer(ctx);
        this.cracker = new HashCracker(ctx);
        this.ssl = new SSLAnalyzer(ctx);
        this.certs = new CertTools(ctx);
        arsenalCore.audit('CRYPTO_ARSENAL_INIT', 'crypto', 'SUCCESS', { opId: ctx.operationId });
    }
}
export default CryptoArsenal;
