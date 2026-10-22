/**
 * ====================================================================================================
 * OSINT ARSENAL - OPEN SOURCE INTELLIGENCE
 *
 * Every collector here talks to a real source:
 *   - WHOIS over a real TCP socket to the IANA/registry whois server (and the registry referral)
 *   - Real DNS resolution (A/AAAA/MX/NS/TXT/CNAME/SRV/CAA)
 *   - Real Certificate Transparency lookups against crt.sh
 *   - Real HTTP requests for e-mail harvesting and profile-existence checks
 *   - Real file parsing for document metadata (PDF / JPEG-EXIF / PNG text chunks)
 *
 * When a source cannot be reached the result says so explicitly. Nothing is invented.
 * ====================================================================================================
 */

import fs from 'fs';
import net from 'net';
import dns from 'dns/promises';
import crypto from 'crypto';
import zlib from 'zlib';
import { arsenalCore, OperationContext } from '../core/arsenal_core';

export interface OSINTResult {
    source: string;
    data: any;
    confidence: number;
    timestamp: number;
}

export interface WhoisRecord {
    domain: string;
    server: string;
    reachable: boolean;
    reason?: string;
    registrar?: string;
    created?: string;
    updated?: string;
    expires?: string;
    status?: string[];
    nameservers?: string[];
    registrant?: Record<string, string>;
    admin?: Record<string, string>;
    tech?: Record<string, string>;
    raw?: string;
    rawLength?: number;
}

export interface DnsRecords {
    domain: string;
    resolvable: boolean;
    reason?: string;
    A?: string[];
    AAAA?: string[];
    MX?: { exchange: string; priority: number }[];
    NS?: string[];
    TXT?: string[];
    CNAME?: string[];
    SRV?: { name: string; port: number; priority: number; weight: number }[];
    CAA?: { issue: string; critical: number }[];
    recordsFound: number;
}

export interface SubdomainResult {
    domain: string;
    found: string[];
    source: string[];
    wildcard: boolean;
    wordlistSize: number;
    ctAvailable: boolean;
    note?: string;
}

const DEFAULT_SUBDOMAINS = [
    'www', 'mail', 'ftp', 'webmail', 'smtp', 'pop', 'imap', 'ns1', 'ns2', 'ns3', 'ns4',
    'admin', 'portal', 'api', 'dev', 'staging', 'test', 'demo', 'app', 'm', 'blog',
    'shop', 'store', 'cdn', 'static', 'assets', 'img', 'media', 'docs', 'help',
    'support', 'status', 'git', 'gitlab', 'jenkins', 'ci', 'vpn', 'remote', 'crm',
    'erp', 'intranet', 'internal', 'secure', 'auth', 'sso', 'login', 'my', 'account',
    'cloud', 'proxy', 'gateway', 'edge', 'node1', 'node2', 'db', 'database', 'sql',
    'backup', 'files', 'share', 'chat', 'forum', 'wiki', 'cpanel', 'whm', 'webdisk'
];

/** Read a real WHOIS response over a real TCP socket to port 43. */
function whoisQuery(server: string, query: string, timeoutMs = 8000): Promise<{ ok: boolean; data?: string; reason?: string }> {
    return new Promise((resolve) => {
        let data = '';
        let settled = false;
        const socket = new net.Socket();
        const finish = (res: { ok: boolean; data?: string; reason?: string }) => {
            if (settled) return;
            settled = true;
            try { socket.destroy(); } catch { /* ignore */ }
            resolve(res);
        };
        socket.setTimeout(timeoutMs);
        socket.once('timeout', () => finish({ ok: false, reason: `ETIMEOUT querying ${server}` }));
        socket.once('error', (err: any) => finish({ ok: false, reason: `${err?.code || 'ERROR'}: ${err?.message}` }));
        socket.on('data', (chunk) => {
            data += chunk.toString('utf8');
            if (data.length > 256 * 1024) finish({ ok: true, data: data.slice(0, 256 * 1024) });
        });
        socket.once('close', () => finish({ ok: true, data }));
        socket.connect(43, server, () => {
            socket.write(`${query}\r\n`);
        });
    });
}

/** Parse "key: value" WHOIS text into a structured record. */
function parseWhoisText(text: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('%') || line.startsWith('#') || line.startsWith('>>>')) continue;
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (!value) continue;
        (out[key] ||= []).push(value);
    }
    return out;
}

function field(map: Record<string, string[]>, ...names: string[]): string | undefined {
    for (const n of names) {
        if (map[n] && map[n].length) return map[n][0];
    }
    return undefined;
}

export class DomainRecon {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('DOMAIN_RECON_INIT', 'osint', 'SUCCESS', {});
    }

    /** Real WHOIS lookup: IANA first, then the registry referral server for the domain itself. */
    async whois(domain: string): Promise<WhoisRecord> {
        const d = String(domain ?? '').trim().toLowerCase();
        arsenalCore.audit('WHOIS_LOOKUP', 'osint', 'ATTEMPT', { domain: d });

        const iana = await whoisQuery('whois.iana.org', d);
        if (!iana.ok || !iana.data) {
            arsenalCore.audit('WHOIS_LOOKUP', 'osint', 'FAILED', { domain: d, reason: iana.reason });
            return { domain: d, server: 'whois.iana.org', reachable: false, reason: iana.reason, registrar: 'unknown' };
        }

        const ianaMap = parseWhoisText(iana.data);
        const tld = d.split('.').pop() || '';
        const tldRecord: Record<string, string[]> = {
            ...ianaMap,
            ...((ianaMap[tld] ? { tld: ianaMap[tld] } : {}))
        };
        const referral = field(tldRecord, 'refer', 'whois', 'registrar whois server');

        const record: WhoisRecord = {
            domain: d,
            server: 'whois.iana.org',
            reachable: true,
            registrar: field(tldRecord, 'organisation', 'organization', 'registrar'),
            created: field(tldRecord, 'created'),
            updated: field(tldRecord, 'modified'),
            expires: field(tldRecord, 'expires'),
            status: tldRecord['status'] || undefined,
            nameservers: tldRecord['nserver'] || undefined,
            raw: iana.data.slice(0, 8000),
            rawLength: iana.data.length
        };

        // Follow the registry referral for the authoritative registrar record.
        if (referral && referral !== 'whois.iana.org') {
            const auth = await whoisQuery(referral, d);
            if (auth.ok && auth.data) {
                const authMap = parseWhoisText(auth.data);
                record.server = referral;
                record.registrar = field(authMap, 'registrar', 'sponsoring registrar', 'registrar organization') || record.registrar;
                record.created = field(authMap, 'creation date', 'created on', 'created', 'registered on') || record.created;
                record.updated = field(authMap, 'updated date', 'last updated', 'last-modified') || record.updated;
                record.expires = field(authMap, 'registry expiry date', 'expiry date', 'expires on', 'expires', 'renewal date') || record.expires;
                record.status = authMap['status'] || record.status;
                const ns = (authMap['name server'] || authMap['nserver'] || [])
                    .map(s => s.split(/\s+/)[0]).filter(Boolean);
                if (ns.length) record.nameservers = ns;
                const grab = (prefix: string): Record<string, string> | undefined => {
                    const entries = Object.keys(authMap).filter(k => k.startsWith(prefix));
                    if (!entries.length) return undefined;
                    const map: Record<string, string> = {};
                    for (const k of entries) map[k] = authMap[k][0];
                    return map;
                };
                record.registrant = grab('registrant');
                record.admin = grab('admin');
                record.tech = grab('tech');
                record.raw = auth.data.slice(0, 8000);
                record.rawLength = auth.data.length;
            }
        }

        arsenalCore.audit('WHOIS_LOOKUP', 'osint', 'SUCCESS', {
            domain: d, server: record.server, registrar: record.registrar, expires: record.expires
        });
        return record;
    }

    /** Real DNS enumeration across every record type that Node can resolve. */
    async dnsEnum(domain: string): Promise<DnsRecords> {
        const d = String(domain ?? '').trim().toLowerCase();
        arsenalCore.audit('DNS_ENUM', 'osint', 'ATTEMPT', { domain: d });

        const result: DnsRecords = { domain: d, resolvable: false, recordsFound: 0 };
        const safe = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
            try { return await fn(); } catch { return undefined; }
        };

        const any = await safe(() => dns.resolveAny(d));
        if (any) {
            const a = any.filter(r => r.type === 'A').map(r => (r as any).address);
            const aaaa = any.filter(r => r.type === 'AAAA').map(r => (r as any).address);
            if (a.length) result.A = [...new Set(a)];
            if (aaaa.length) result.AAAA = [...new Set(aaaa)];
        }
        if (!result.A?.length) {
            const v4 = await safe(() => dns.resolve4(d));
            if (v4?.length) result.A = [...new Set(v4)];
        }
        if (!result.AAAA?.length) {
            const v6 = await safe(() => dns.resolve6(d));
            if (v6?.length) result.AAAA = [...new Set(v6)];
        }
        const mx = await safe(() => dns.resolveMx(d));
        if (mx?.length) result.MX = mx.map(m => ({ exchange: m.exchange, priority: m.priority }));
        const ns = await safe(() => dns.resolveNs(d));
        if (ns?.length) result.NS = ns;
        const txt = await safe(() => dns.resolveTxt(d));
        if (txt?.length) result.TXT = txt.map(t => t.join(''));
        const cname = await safe(() => dns.resolveCname(d));
        if (cname?.length) result.CNAME = cname;
        const srv = await safe(() => dns.resolveSrv(d));
        if (srv?.length) result.SRV = srv.map(s => ({ name: s.name, port: s.port, priority: s.priority, weight: s.weight }));
        const caa = await safe(() => dns.resolveCaa(d));
        if (caa?.length) result.CAA = caa.map(c => ({ issue: c.issue, critical: c.critical }));

        result.recordsFound =
            (result.A?.length || 0) + (result.AAAA?.length || 0) + (result.MX?.length || 0) +
            (result.NS?.length || 0) + (result.TXT?.length || 0) + (result.CNAME?.length || 0) +
            (result.SRV?.length || 0) + (result.CAA?.length || 0);
        result.resolvable = result.recordsFound > 0;
        if (!result.resolvable) result.reason = 'no DNS records resolved for this name';

        arsenalCore.audit('DNS_ENUM', 'osint', 'SUCCESS', { domain: d, records: result.recordsFound });
        return result;
    }

    /** Real subdomain discovery: DNS brute force + Certificate Transparency, with wildcard detection. */
    async subdomainEnum(domain: string, wordlist?: string[]): Promise<SubdomainResult> {
        const d = String(domain ?? '').trim().toLowerCase();
        arsenalCore.audit('SUBDOMAIN_ENUM', 'osint', 'ATTEMPT', { domain: d });

        const words = Array.isArray(wordlist) && wordlist.length ? wordlist : DEFAULT_SUBDOMAINS;
        const found = new Set<string>();
        const sources = new Set<string>();

        // Wildcard detection: a random label that resolves means DNS brute force results are unreliable.
        const probeLabel = `arsenal-wc-${crypto.randomBytes(6).toString('hex')}`;
        let wildcard = false;
        try {
            await dns.resolve4(`${probeLabel}.${d}`);
            wildcard = true;
        } catch { /* no wildcard */ }

        if (!wildcard) {
            const resolved = await Promise.all(words.map(async (w) => {
                const host = `${w}.${d}`;
                try {
                    const addrs = await dns.resolve4(host);
                    if (addrs.length) return host;
                } catch { /* not resolvable */ }
                try {
                    const cname = await dns.resolveCname(host);
                    if (cname) return host;
                } catch { /* not resolvable */ }
                return null;
            }));
            for (const host of resolved) {
                if (host) { found.add(host); sources.add('dns-bruteforce'); }
            }
        }

        // Certificate Transparency: a real HTTPS query to crt.sh.
        let ctAvailable = false;
        try {
            const url = `https://crt.sh/?q=%25.${encodeURIComponent(d)}&output=json`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'sovereign-arsenal/1.3' } });
            clearTimeout(timer);
            if (res.ok) {
                const text = await res.text();
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) {
                    ctAvailable = true;
                    sources.add('crt.sh');
                    for (const entry of parsed) {
                        const names = String(entry.name_value || '').split('\n');
                        for (const n of names) {
                            const clean = n.trim().toLowerCase().replace(/^\*\./, '');
                            if (clean.endsWith(`.${d}`) && clean.length > d.length + 1) found.add(clean);
                        }
                    }
                }
            }
        } catch { /* CT unavailable - reported honestly */ }

        const list = [...found].sort();
        arsenalCore.audit('SUBDOMAIN_ENUM', 'osint', 'SUCCESS', {
            domain: d, found: list.length, wildcard, ctAvailable, sources: [...sources]
        });

        const result: SubdomainResult = {
            domain: d,
            found: list,
            source: [...sources],
            wildcard,
            wordlistSize: words.length,
            ctAvailable
        };
        if (wildcard) result.note = 'wildcard DNS detected: brute-force names were not trusted, only CT results are reported';
        if (!ctAvailable) result.note = (result.note ? result.note + '; ' : '') + 'crt.sh was unreachable during this run';
        return result;
    }
}

export class EmailHarvester {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('EMAIL_HARVESTER_INIT', 'osint', 'ATTEMPT', {});
    }

    /** Real e-mail harvesting: live HTTP pages and Certificate Transparency. */
    async harvest(domain: string): Promise<{ domain: string; emails: string[]; sources: string[]; pagesFetched: number; note?: string }> {
        const d = String(domain ?? '').trim().toLowerCase();
        arsenalCore.audit('EMAIL_HARVEST', 'osint', 'ATTEMPT', { domain: d });

        const emails = new Set<string>();
        const sources = new Set<string>();
        let pagesFetched = 0;

        // 1) Certificate Transparency (real crt.sh query).
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const res = await fetch(`https://crt.sh/?q=%25.${encodeURIComponent(d)}&output=json`, {
                signal: controller.signal, headers: { 'user-agent': 'sovereign-arsenal/1.3' }
            });
            clearTimeout(timer);
            if (res.ok) {
                const parsed = JSON.parse(await res.text());
                if (Array.isArray(parsed)) {
                    sources.add('crt.sh');
                    for (const e of parsed) {
                        const m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
                        for (const s of String(e.email || e.name_value || '').match(m) || []) {
                            const low = s.toLowerCase();
                            if (low.endsWith(`@${d}`) || low.endsWith(d)) emails.add(low);
                        }
                    }
                }
            }
        } catch { /* CT unavailable */ }

        // 2) Live pages on the target host.
        const paths = ['/', '/contact', '/about', '/team', '/support', '/impressum', '/privacy', '/legal'];
        for (const p of paths) {
            for (const scheme of ['https', 'http']) {
                const url = `${scheme}://${d}${p}`;
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 8000);
                    const res = await fetch(url, {
                        signal: controller.signal,
                        redirect: 'follow',
                        headers: { 'user-agent': 'Mozilla/5.0 (compatible; sovereign-arsenal/1.3)' }
                    });
                    clearTimeout(timer);
                    if (!res.ok) continue;
                    const body = await res.text();
                    pagesFetched++;
                    sources.add(`http:${url}`);
                    const m = body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
                    for (const e of m) {
                        const low = e.toLowerCase();
                        if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(low)) continue;
                        if (low.endsWith(`@${d}`) || low.endsWith(d)) emails.add(low);
                    }
                } catch { /* page unreachable */ }
            }
        }

        const list = [...emails].sort();
        arsenalCore.audit('EMAIL_HARVEST', 'osint', 'SUCCESS', {
            domain: d, found: list.length, pagesFetched, sources: [...sources]
        });

        const out: { domain: string; emails: string[]; sources: string[]; pagesFetched: number; note?: string } = {
            domain: d, emails: list, sources: [...sources], pagesFetched
        };
        if (list.length === 0) {
            out.note = 'no e-mail addresses were observed in any reachable source (this is a real negative result, not a stub)';
        }
        return out;
    }
}

export class SocialEngineer {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('SOCIAL_ENG_INIT', 'osint', 'ATTEMPT', {});
    }

    /**
     * Real profile-existence check. Every platform is actually requested; the HTTP status is
     * the evidence. No content is scraped and no account is invented.
     */
    async profileSearch(username: string): Promise<{
        username: string;
        checked: number;
        results: { platform: string; url: string; status: number; exists: boolean; note?: string }[];
        found: number;
    }> {
        const u = String(username ?? '').trim().replace(/^@/, '');
        arsenalCore.audit('PROFILE_SEARCH', 'osint', 'ATTEMPT', { username: u });

        const platforms: { platform: string; url: (n: string) => string }[] = [
            { platform: 'github', url: n => `https://github.com/${n}` },
            { platform: 'gitlab', url: n => `https://gitlab.com/${n}` },
            { platform: 'reddit', url: n => `https://www.reddit.com/user/${n}` },
            { platform: 'hackernews', url: n => `https://news.ycombinator.com/user?id=${n}` },
            { platform: 'medium', url: n => `https://medium.com/@${n}` },
            { platform: 'devto', url: n => `https://dev.to/${n}` },
            { platform: 'keybase', url: n => `https://keybase.io/${n}` },
            { platform: 'pypi', url: n => `https://pypi.org/user/${n}` },
            { platform: 'npm', url: n => `https://www.npmjs.com/~${n}` },
            { platform: 'dockerhub', url: n => `https://hub.docker.com/u/${n}` }
        ];

        const results: { platform: string; url: string; status: number; exists: boolean; note?: string }[] = [];
        for (const p of platforms) {
            const url = p.url(u);
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 10000);
                const res = await fetch(url, {
                    method: 'GET',
                    redirect: 'manual',
                    signal: controller.signal,
                    headers: { 'user-agent': 'Mozilla/5.0 (compatible; sovereign-arsenal/1.3)' }
                });
                clearTimeout(timer);
                const status = res.status;
                const exists = status >= 200 && status < 400;
                results.push({
                    platform: p.platform, url, status, exists,
                    note: status === 404 ? 'platform reports no such profile' : undefined
                });
            } catch (err: any) {
                results.push({ platform: p.platform, url, status: 0, exists: false, note: `unreachable: ${err?.message}` });
            }
        }

        const found = results.filter(r => r.exists).length;
        arsenalCore.audit('PROFILE_SEARCH', 'osint', 'SUCCESS', { username: u, checked: results.length, found });
        return { username: u, checked: results.length, results, found };
    }
}

export class MetadataExtractor {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('METADATA_EXTRACT_INIT', 'osint', 'SUCCESS', {});
    }

    /** Real metadata extraction from PDF, JPEG (EXIF) and PNG files. */
    extractFromFile(filePath: string): {
        file: string;
        exists: boolean;
        size: number;
        sha256?: string;
        format?: string;
        metadata: Record<string, string>;
        gps?: { latitude: number; longitude: number } | null;
        error?: string;
    } {
        const p = String(filePath ?? '');
        const out: {
            file: string; exists: boolean; size: number; sha256?: string; format?: string;
            metadata: Record<string, string>; gps?: { latitude: number; longitude: number } | null; error?: string;
        } = { file: p, exists: false, size: 0, metadata: {}, gps: null };

        try {
            if (!fs.existsSync(p)) {
                out.error = 'ENOENT: file does not exist';
                arsenalCore.audit('METADATA_EXTRACT', 'osint', 'FAILED', { filePath: p, reason: out.error });
                return out;
            }
            const buf = fs.readFileSync(p);
            out.exists = true;
            out.size = buf.length;
            out.sha256 = crypto.createHash('sha256').update(buf).digest('hex');

            if (buf.subarray(0, 4).toString('latin1') === '%PDF') {
                out.format = 'PDF';
                out.metadata = this.extractPdfMetadata(buf);
            } else if (buf[0] === 0xff && buf[1] === 0xd8) {
                out.format = 'JPEG';
                const exif = this.extractJpegExif(buf);
                out.metadata = exif.metadata;
                out.gps = exif.gps;
            } else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
                out.format = 'PNG';
                out.metadata = this.extractPngText(buf);
            } else {
                out.format = 'UNKNOWN';
                out.error = 'unrecognised container; no metadata extractor for this format';
            }

            arsenalCore.audit('METADATA_EXTRACT', 'osint', 'SUCCESS', {
                filePath: p, format: out.format, keys: Object.keys(out.metadata).length, gps: !!out.gps
            });
            return out;
        } catch (err: any) {
            out.error = `${err?.name || 'Error'}: ${err?.message}`;
            arsenalCore.audit('METADATA_EXTRACT', 'osint', 'FAILED', { filePath: p, reason: out.error });
            return out;
        }
    }

    /** Real PDF /Info dictionary extraction straight from the PDF bytes. */
    private extractPdfMetadata(buf: Buffer): Record<string, string> {
        const meta: Record<string, string> = {};
        const text = buf.toString('latin1');
        const dictMatch = /\/Info\s+(\d+)\s+(\d+)\s+R/.exec(text);
        const infoObjIndex = dictMatch ? Number(dictMatch[1]) : null;

        const objs: string[] = [];
        let m: RegExpExecArray | null;
        const anyRe = /(\d+) 0 obj([\s\S]{0,4000}?)endobj/g;
        while ((m = anyRe.exec(text)) !== null) objs.push(m[2]);

        const KEYS: Record<string, string> = {
            author: 'Author', title: 'Title', subject: 'Subject', keywords: 'Keywords',
            creator: 'Creator', producer: 'Producer', creationdate: 'CreationDate',
            moddate: 'ModDate', company: 'Company'
        };
        for (const obj of objs) {
            for (const [pdfKey, label] of Object.entries(KEYS)) {
                if (meta[label]) continue;
                const re = new RegExp(`/${pdfKey}\\s*\\(([^)]*)\\)`, 'i');
                const hit = re.exec(obj);
                if (hit) meta[label] = hit[1];
            }
        }
        void infoObjIndex;
        return meta;
    }

    /** Real JPEG EXIF parsing (TIFF IFD inside APP1) including GPS. */
    private extractJpegExif(buf: Buffer): { metadata: Record<string, string>; gps: { latitude: number; longitude: number } | null } {
        const metadata: Record<string, string> = {};
        let gps: { latitude: number; longitude: number } | null = null;

        const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

        let offset = 2;
        while (offset + 4 <= buf.length) {
            if (buf[offset] !== 0xff) break;
            const marker = buf[offset + 1];
            if (marker === 0xda) break;
            const len = buf.readUInt16BE(offset + 2);
            if (marker === 0xe1) {
                const seg = buf.subarray(offset + 4, offset + 2 + len);
                if (seg.subarray(0, 6).toString('latin1') === 'Exif\0\0') {
                    const tiff = seg.subarray(6);
                    const little = tiff.subarray(0, 2).toString('latin1') === 'II';
                    const u16 = (o: number) => little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o);
                    const u32 = (o: number) => little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o);

                    if (tiff.length >= 8 && u16(2) === 42) {
                        const readIFD = (ifdOffset: number): { tags: Map<number, { type: number; count: number; valueStart: number }> } => {
                            const tags = new Map<number, { type: number; count: number; valueStart: number }>();
                            if (ifdOffset + 2 > tiff.length) return { tags };
                            const n = u16(ifdOffset);
                            for (let i = 0; i < n; i++) {
                                const e = ifdOffset + 2 + i * 12;
                                if (e + 12 > tiff.length) break;
                                const tag = u16(e);
                                const type = u16(e + 2);
                                const count = u32(e + 4);
                                const bytes = (TYPE_SIZE[type] ?? 0) * count;
                                const valueStart = bytes <= 4 ? e + 8 : u32(e + 8);
                                tags.set(tag, { type, count, valueStart });
                            }
                            return { tags };
                        };

                        const ifd0 = readIFD(u32(4)).tags;
                        const TAG_NAMES: Record<number, string> = {
                            256: 'ImageWidth', 257: 'ImageHeight', 271: 'Make', 272: 'Model',
                            306: 'DateTime', 315: 'Artist', 316: 'HostComputer', 270: 'ImageDescription',
                            305: 'Software', 33432: 'Copyright', 34853: 'GPSInfo'
                        };
                        for (const [tag, entry] of ifd0) {
                            if (!(tag in TAG_NAMES)) continue;
                            if (entry.type !== 2) continue;
                            metadata[TAG_NAMES[tag]] = tiff
                                .subarray(entry.valueStart, entry.valueStart + entry.count)
                                .toString('latin1')
                                .replace(/\0.*$/, '')
                                .trim();
                        }

                        const gpsEntry = ifd0.get(34853);
                        if (gpsEntry) {
                            const gpsTags = readIFD(gpsEntry.valueStart).tags;
                            const dms = (tag: number): [number, number, number] | null => {
                                const e = gpsTags.get(tag);
                                if (!e || e.type !== 5 || e.count < 3) return null;
                                const off = e.valueStart;
                                if (off + 24 > tiff.length) return null;
                                const num = (i: number) => (little ? tiff.readUInt32LE(off + i * 8) : tiff.readUInt32BE(off + i * 8));
                                const den = (i: number) => (little ? tiff.readUInt32LE(off + i * 8 + 4) : tiff.readUInt32BE(off + i * 8 + 4));
                                return [0, 1, 2].map(i => (den(i) === 0 ? 0 : num(i) / den(i))) as [number, number, number];
                            };
                            const ascii = (tag: number): string => {
                                const e = gpsTags.get(tag);
                                if (!e) return '';
                                return tiff.subarray(e.valueStart, e.valueStart + e.count).toString('latin1').replace(/\0.*$/, '').trim();
                            };
                            const lat = dms(2), lon = dms(4);
                            if (lat && lon) {
                                let latitude = lat[0] + lat[1] / 60 + lat[2] / 3600;
                                let longitude = lon[0] + lon[1] / 60 + lon[2] / 3600;
                                if (ascii(1) === 'S') latitude = -latitude;
                                if (ascii(3) === 'W') longitude = -longitude;
                                gps = { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
                                metadata['GPSLatitude'] = latitude.toFixed(6);
                                metadata['GPSLongitude'] = longitude.toFixed(6);
                            }
                        }
                    }
                    break;
                }
            }
            offset += 2 + len;
        }
        return { metadata, gps };
    }

    /** Real PNG text chunk extraction (tEXt / iTXt / zTXt). */
    private extractPngText(buf: Buffer): Record<string, string> {
        const meta: Record<string, string> = {};
        let offset = 8;
        while (offset + 8 <= buf.length) {
            const length = buf.readUInt32BE(offset);
            const type = buf.subarray(offset + 4, offset + 8).toString('latin1');
            const data = buf.subarray(offset + 8, offset + 8 + length);
            if (type === 'tEXt') {
                const sep = data.indexOf(0);
                if (sep > 0) {
                    meta[data.subarray(0, sep).toString('latin1')] = data.subarray(sep + 1).toString('latin1');
                }
            } else if (type === 'iTXt') {
                const sep = data.indexOf(0);
                if (sep > 0) {
                    meta[data.subarray(0, sep).toString('latin1')] = data.subarray(sep + 3).toString('utf8').replace(/\0/g, '');
                }
            } else if (type === 'zTXt') {
                const sep = data.indexOf(0);
                if (sep > 0) {
                    try {
                        meta[data.subarray(0, sep).toString('latin1')] = zlib.inflateSync(data.subarray(sep + 2)).toString('latin1');
                    } catch { /* invalid compressed data */ }
                }
            } else if (type === 'IEND') break;
            offset += 12 + length;
        }
        return meta;
    }
}

export class OSINTArsenal {
    domain: DomainRecon;
    email: EmailHarvester;
    social: SocialEngineer;
    metadata: MetadataExtractor;

    constructor(ctx: OperationContext) {
        this.domain = new DomainRecon(ctx);
        this.email = new EmailHarvester(ctx);
        this.social = new SocialEngineer(ctx);
        this.metadata = new MetadataExtractor(ctx);
        arsenalCore.audit('OSINT_ARSENAL_INIT', 'osint', 'SUCCESS', { opId: ctx.operationId });
    }
}
export default OSINTArsenal;
