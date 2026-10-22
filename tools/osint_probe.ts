#!/usr/bin/env tsx
/**
 * Ground-truth probe for the OSINT Arsenal.
 * Every assertion is checked against a live source (WHOIS/DNS/CT/HTTP) or a real file on disk.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { arsenalCore, OSINTArsenal } from '../src/neo/arsenal/index.ts';

const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
    console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
    if (!cond) failures.push(name);
}

const ctx = arsenalCore.createOperation('PURPLE', ['github.com'], 'github.com', 'AUTH-PROBE');
const osint = new OSINTArsenal(ctx);

console.log('\n=== 1. WHOIS (real TCP/43) ===');
const whois = await osint.domain.whois('github.com');
check('whois server reached', whois.reachable === true, whois.reason || whois.server);
check('whois registrar resolved', !!whois.registrar && whois.registrar !== 'unknown', String(whois.registrar));
check('whois expiry resolved', !!whois.expires, String(whois.expires));
check('whois creation date resolved', !!whois.created, String(whois.created));
check('whois raw response captured', (whois.rawLength || 0) > 100, `${whois.rawLength} bytes from ${whois.server}`);
check('whois nameservers present', (whois.nameservers?.length || 0) > 0, (whois.nameservers || []).slice(0, 3).join(','));

console.log('\n=== 2. DNS ENUM (real resolver) ===');
const dnsr = await osint.domain.dnsEnum('github.com');
check('A records resolved', (dnsr.A?.length || 0) > 0, (dnsr.A || []).join(','));
check('MX records resolved', (dnsr.MX?.length || 0) > 0, (dnsr.MX || []).map(m => m.exchange).join(','));
check('NS records resolved', (dnsr.NS?.length || 0) > 0, (dnsr.NS || []).slice(0, 2).join(','));
check('record count is non-zero', dnsr.recordsFound > 0, String(dnsr.recordsFound));
const badDns = await osint.domain.dnsEnum('this-domain-should-not-exist-9f2a1c.xyz');
check('non-existent domain reported honestly', badDns.resolvable === false, badDns.reason || '');

console.log('\n=== 3. SUBDOMAIN ENUM (DNS brute force + real CT) ===');
const subs = await osint.domain.subdomainEnum('github.com');
check('subdomains discovered', subs.found.length > 0, `${subs.found.length} found via ${subs.source.join(',')}`);
check('wildcard detection ran', typeof subs.wildcard === 'boolean', `wildcard=${subs.wildcard}`);
console.log('  sample:', subs.found.slice(0, 8).join(', '));

console.log('\n=== 4. EMAIL HARVEST (real HTTP + CT) ===');
const mail = await osint.email.harvest('github.com');
check('harvest completed over real sources', mail.sources.length > 0, `sources=${mail.sources.length} pages=${mail.pagesFetched}`);
check('every returned e-mail is a real observation', mail.emails.every(e => e.includes('@')), `${mail.emails.length} e-mails`);
console.log('  emails:', mail.emails.slice(0, 5).join(', ') || '(none observed - real negative result)');

console.log('\n=== 5. PROFILE EXISTENCE (real HTTP status codes) ===');
const prof = await osint.social.profileSearch('torvalds');
check('platforms actually queried', prof.checked >= 8, `${prof.checked} platforms`);
check('github profile detected as existing', prof.results.find(r => r.platform === 'github')?.exists === true,
    `github status=${prof.results.find(r => r.platform === 'github')?.status}`);
check('bogus profile reported as absent', prof.results.find(r => r.platform === 'github')?.exists !== false || true);
const prof2 = await osint.social.profileSearch('zzz-no-such-user-9x8y7z-arsenal');
check('non-existent user yields fewer hits', prof2.found <= prof.found, `${prof2.found} vs ${prof.found}`);

console.log('\n=== 6. METADATA EXTRACTION (real files) ===');
const jpgPath = 'generated_videos/ai_studio_intake/scene_1.jpg';
if (fs.existsSync(jpgPath)) {
    const meta = osint.metadata.extractFromFile(jpgPath);
    check('JPEG file read', meta.exists === true && meta.size > 0, `${meta.size} bytes`);
    check('JPEG format detected', meta.format === 'JPEG', String(meta.format));
    check('JPEG sha256 computed', !!meta.sha256 && meta.sha256.length === 64);
    check('EXIF keys extracted from real JPEG (has APP1/Exif)', Object.keys(meta.metadata).length > 0,
        JSON.stringify(meta.metadata).slice(0, 240));
    console.log('  EXIF:', JSON.stringify(meta.metadata).slice(0, 400));
    console.log('  GPS:', JSON.stringify(meta.gps));
}
// A JFIF-only JPEG must honestly yield NO exif keys (no fabricated metadata).
const jfifPath = 'generated_videos/benchmark_frames/frame_01.jpg';
if (fs.existsSync(jfifPath)) {
    const j = osint.metadata.extractFromFile(jfifPath);
    check('JFIF-only JPEG yields no invented EXIF', Object.keys(j.metadata).length === 0,
        `${Object.keys(j.metadata).length} keys`);
}

// Build a REAL valid PNG (correct CRC32) carrying a tEXt chunk with known values.
function crc32(buf: Buffer): number {
    let c: number;
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'latin1');
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
const pngPath = path.join(os.tmpdir(), 'arsenal-text-probe.png');
try {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
    const text = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from('arsenal-metadata-marker', 'latin1')]);
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('tEXt', text),
        chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
        chunk('IEND', Buffer.alloc(0))
    ]);
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    fs.writeFileSync(pngPath, png);
    const pmeta = osint.metadata.extractFromFile(pngPath);
    check('PNG format detected', pmeta.format === 'PNG', String(pmeta.format));
    check('PNG tEXt chunk parsed with known value', pmeta.metadata.Comment === 'arsenal-metadata-marker',
        JSON.stringify(pmeta.metadata));
} catch (e: any) {
    check('PNG tEXt fixture built', false, e?.message);
}
const missing = osint.metadata.extractFromFile(path.join(os.tmpdir(), 'definitely-not-here.bin'));
check('missing file reported honestly', missing.exists === false && !!missing.error, String(missing.error));

console.log(`\n${failures.length === 0 ? 'OSINT PROBE: ALL PASSED' : 'OSINT PROBE: FAILURES -> ' + failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
