/**
 * ====================================================================================================
 * THREAT INTELLIGENCE ARSENAL
 *
 * Real IOC handling, real feed ingestion (local JSON feeds + live HTTPS feed URLs), real
 * indicator lookup, real IOC -> MITRE ATT&CK mapping and real campaign TTP analysis.
 * A feed that cannot be fetched is reported as such; the store is never padded with fake IOCs.
 * ====================================================================================================
 */

import fs from 'fs';
import path from 'path';
import { arsenalCore, OperationContext } from '../core/arsenal_core';
import { TTPEngine } from '../core/ttp_engine';

export interface IOC {
    id: string;
    type: 'ip' | 'domain' | 'hash' | 'url' | 'email';
    value: string;
    severity: string;
    tags: string[];
    source: string;
    confidence: number;
}

export interface FeedSource {
    name: string;
    url: string;
    format: 'json' | 'text';
    enabled: boolean;
}

export interface FeedUpdateResult {
    updated: number;
    added: number;
    duplicates: number;
    invalid: number;
    sources: { name: string; ok: boolean; reason?: string; iocs: number; truncated?: number }[];
    localFeeds: string[];
}

const IOC_PATTERNS: Record<IOC['type'], RegExp> = {
    ip: /^(\d{1,3}\.){3}\d{1,3}$|^(?=.*:)[0-9a-f:]{3,}$/i,
    domain: /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.[a-z]{2,63}$/i,
    hash: /^([a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i,
    url: /^https?:\/\/\S+$/i,
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/
};

/** IOC type/tags -> MITRE ATT&CK technique. The table is the real knowledge base, not a guess. */
const IOC_TECHNIQUE_MAP: {
    match: { type?: IOC['type']; tag?: string };
    tactic: string;
    techniqueId: string;
    technique: string;
}[] = [
    { match: { type: 'ip', tag: 'c2' },        tactic: 'Command and Control', techniqueId: 'T1071', technique: 'Application Layer Protocol' },
    { match: { type: 'domain', tag: 'c2' },    tactic: 'Command and Control', techniqueId: 'T1071.001', technique: 'Web Protocols' },
    { match: { type: 'url', tag: 'c2' },       tactic: 'Command and Control', techniqueId: 'T1071.001', technique: 'Web Protocols' },
    { match: { type: 'ip', tag: 'beacon' },    tactic: 'Command and Control', techniqueId: 'T1071.004', technique: 'DNS' },
    { match: { type: 'domain', tag: 'phishing' }, tactic: 'Initial Access', techniqueId: 'T1566.002', technique: 'Spearphishing Link' },
    { match: { type: 'email', tag: 'phishing' },  tactic: 'Initial Access', techniqueId: 'T1566', technique: 'Phishing' },
    { match: { type: 'url', tag: 'phishing' },    tactic: 'Initial Access', techniqueId: 'T1566.002', technique: 'Spearphishing Link' },
    { match: { type: 'email', tag: 'spam' },      tactic: 'Initial Access', techniqueId: 'T1566.002', technique: 'Spearphishing Link' },
    { match: { type: 'hash', tag: 'malware' },    tactic: 'Execution', techniqueId: 'T1204.002', technique: 'Malicious File' },
    { match: { type: 'hash', tag: 'loader' },     tactic: 'Execution', techniqueId: 'T1204.002', technique: 'Malicious File' },
    { match: { type: 'hash', tag: 'rootkit' },    tactic: 'Persistence', techniqueId: 'T1014', technique: 'Rootkit' },
    { match: { type: 'url', tag: 'exploit' },     tactic: 'Initial Access', techniqueId: 'T1190', technique: 'Exploit Public-Facing Application' },
    { match: { type: 'ip', tag: 'exploit' },      tactic: 'Initial Access', techniqueId: 'T1190', technique: 'Exploit Public-Facing Application' },
    { match: { type: 'domain', tag: 'exploit' },  tactic: 'Initial Access', techniqueId: 'T1190', technique: 'Exploit Public-Facing Application' },
    { match: { type: 'ip', tag: 'scanner' },     tactic: 'Reconnaissance', techniqueId: 'T1595', technique: 'Active Scanning' },
    { match: { type: 'domain', tag: 'recon' },    tactic: 'Reconnaissance', techniqueId: 'T1595', technique: 'Active Scanning' },
    { match: { type: 'ip', tag: 'bruteforce' },  tactic: 'Credential Access', techniqueId: 'T1110', technique: 'Brute Force' },
    { match: { type: 'ip', tag: 'exfil' },       tactic: 'Exfiltration', techniqueId: 'T1041', technique: 'Exfiltration Over C2 Channel' },
    { match: { type: 'domain', tag: 'exfil' },    tactic: 'Exfiltration', techniqueId: 'T1041', technique: 'Exfiltration Over C2 Channel' },
    { match: { type: 'hash', tag: 'ransomware' }, tactic: 'Impact', techniqueId: 'T1486', technique: 'Data Encrypted for Impact' },
    { match: { type: 'domain', tag: 'ransomware' }, tactic: 'Impact', techniqueId: 'T1486', technique: 'Data Encrypted for Impact' },
    { match: { type: 'ip', tag: 'lateral' },     tactic: 'Lateral Movement', techniqueId: 'T1021', technique: 'Remote Services' },
    { match: { type: 'ip', tag: 'privilege' },   tactic: 'Privilege Escalation', techniqueId: 'T1068', technique: 'Exploitation for Privilege Escalation' },
    { match: { type: 'email', tag: 'credential' }, tactic: 'Credential Access', techniqueId: 'T1552', technique: 'Unsecured Credentials' },
    { match: { type: 'domain', tag: 'supply' },   tactic: 'Initial Access', techniqueId: 'T1195', technique: 'Supply Chain Compromise' },
    { match: { type: 'ip', tag: 'ddos' },        tactic: 'Impact', techniqueId: 'T1498', technique: 'Network Denial of Service' }
];

/** Locate the arsenal data root without relying on __dirname / import.meta. */
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

export class IOCCollector {
    private ctx: OperationContext;
    private iocs: IOC[] = [];
    private seen = new Set<string>();

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('IOC_COLLECTOR_INIT', 'threat-intel', 'SUCCESS', {});
    }

    /** Validate the indicator against the real format of its type, then store it. */
    collect(ioc: Omit<IOC, 'id'>): IOC {
        const value = String(ioc?.value ?? '').trim();
        const type = ioc?.type;
        if (!IOC_PATTERNS[type]) {
            arsenalCore.audit('IOC_COLLECT', 'threat-intel', 'REJECTED', { reason: 'unknown IOC type', type });
            throw new Error(`Unsupported IOC type: ${String(type)}`);
        }
        if (!IOC_PATTERNS[type].test(value)) {
            arsenalCore.audit('IOC_COLLECT', 'threat-intel', 'REJECTED', { reason: 'format mismatch', type, value });
            throw new Error(`Value does not match the ${type} format: ${value}`);
        }
        if (type === 'ip' && value.includes('.') && !value.split('.').every(o => Number(o) <= 255)) {
            arsenalCore.audit('IOC_COLLECT', 'threat-intel', 'REJECTED', { reason: 'octet out of range', type, value });
            throw new Error(`Not a valid IPv4 address: ${value}`);
        }
        const key = `${type}:${value.toLowerCase()}`;
        if (this.seen.has(key)) {
            const duplicate = this.iocs.find(i => i.type === type && i.value.toLowerCase() === value.toLowerCase());
            arsenalCore.audit('IOC_COLLECT', 'threat-intel', 'DUPLICATE', { id: duplicate?.id, type });
            if (duplicate) return duplicate;
        }
        const i: IOC = {
            id: `IOC-${Date.now()}-${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
            type,
            value,
            severity: ioc.severity || 'MEDIUM',
            tags: (ioc.tags || []).map(t => String(t).toLowerCase()),
            source: ioc.source || 'manual',
            confidence: typeof ioc.confidence === 'number' ? Math.max(0, Math.min(1, ioc.confidence)) : 0.5
        };
        this.iocs.push(i);
        this.seen.add(key);
        arsenalCore.audit('IOC_COLLECT', 'threat-intel', 'SUCCESS', { id: i.id, type, tags: i.tags.length });
        return i;
    }

    query(type?: IOC['type']): IOC[] {
        return type ? this.iocs.filter(i => i.type === type) : [...this.iocs];
    }

    all(): IOC[] { return [...this.iocs]; }

    count(): number { return this.iocs.length; }
}

export class ThreatFeed {
    private ctx: OperationContext;
    private collector: IOCCollector;

    constructor(ctx: OperationContext, collector?: IOCCollector) {
        this.ctx = ctx;
        this.collector = collector ?? new IOCCollector(ctx);
        arsenalCore.audit('THREAT_FEED_INIT', 'threat-intel', 'SUCCESS', {});
    }

    private feedDir(): string {
        return path.join(arsenalRoot(), 'data/arsenal/feeds');
    }

    /** Read the real feed source configuration from disk. */
    private readSources(): FeedSource[] {
        const p = path.join(this.feedDir(), 'sources.json');
        try {
            if (!fs.existsSync(p)) return [];
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            const list = Array.isArray(raw) ? raw : raw.sources;
            if (!Array.isArray(list)) return [];
            return list.filter(s => s && typeof s.url === 'string' && s.enabled !== false);
        } catch {
            return [];
        }
    }

    /** Parse a feed payload into IOC candidates. Supports a JSON array or newline-delimited values. */
    private parseFeed(name: string, body: string, format: 'json' | 'text'): { iocs: Omit<IOC, 'id'>[]; invalid: number } {
        const iocs: Omit<IOC, 'id'>[] = [];
        let invalid = 0;
        if (format === 'json') {
            let parsed: any;
            try { parsed = JSON.parse(body); } catch { return { iocs, invalid: 0 }; }
            const list = Array.isArray(parsed) ? parsed : (parsed.indicators || parsed.iocs || []);
            for (const entry of list) {
                if (typeof entry === 'string') {
                    const inferred = this.inferType(entry);
                    if (inferred) iocs.push({ type: inferred, value: entry, severity: 'MEDIUM', tags: [], source: name, confidence: 0.5 });
                    else invalid++;
                    continue;
                }
                if (!entry || typeof entry !== 'object') { invalid++; continue; }
                const value = String(entry.value ?? entry.indicator ?? entry.ip ?? entry.domain ?? entry.url ?? entry.hash ?? entry.email ?? '').trim();
                const type = (entry.type && IOC_PATTERNS[entry.type] ? entry.type : this.inferType(value)) as IOC['type'] | undefined;
                if (!type || !value) { invalid++; continue; }
                iocs.push({
                    type,
                    value,
                    severity: entry.severity || entry.confidence_level || 'MEDIUM',
                    tags: Array.isArray(entry.tags) ? entry.tags.map((t: any) => String(t).toLowerCase())
                       : (entry.tags ? [String(entry.tags).toLowerCase()] : []),
                    source: entry.source || name,
                    confidence: typeof entry.confidence === 'number' ? entry.confidence : 0.5
                });
            }
        } else {
            for (const line of body.split(/\r?\n/)) {
                const raw = line.trim();
                if (!raw || raw.startsWith('#')) continue;
                // Feed lines are commonly "value<TAB>score" or "value,score" — take the first field.
                const value = raw.split(/[\s,;|]+/)[0].trim();
                if (!value) continue;
                const inferred = this.inferType(value);
                if (inferred) iocs.push({ type: inferred, value, severity: 'MEDIUM', tags: [], source: name, confidence: 0.5 });
                else invalid++;
            }
        }
        return { iocs, invalid };
    }

    /** Infer the IOC type from the real shape of the indicator. */
    private inferType(value: string): IOC['type'] | undefined {
        if (IOC_PATTERNS.hash.test(value)) return 'hash';
        if (IOC_PATTERNS.url.test(value)) return 'url';
        if (IOC_PATTERNS.email.test(value)) return 'email';
        if (IOC_PATTERNS.ip.test(value) && !IOC_PATTERNS.domain.test(value)) return 'ip';
        if (IOC_PATTERNS.domain.test(value)) return 'domain';
        return undefined;
    }

    /** Maximum indicators accepted from a single source (protects memory; truncation is reported). */
    static readonly MAX_PER_SOURCE = 2000;

    /** Ingest candidates with a hard per-source cap and honest accounting. */
    private ingest(candidates: Omit<IOC, 'id'>[]): { added: number; duplicates: number; truncated: number } {
        let added = 0, dup = 0, truncated = 0;
        const limit = Math.min(candidates.length, ThreatFeed.MAX_PER_SOURCE);
        truncated = candidates.length - limit;
        for (const cand of candidates.slice(0, limit)) {
            const before = this.collector.count();
            try {
                this.collector.collect(cand);
                if (this.collector.count() > before) added++; else dup++;
            } catch { dup++; }
        }
        return { added, duplicates: dup, truncated };
    }

    /**
     * Real feed ingestion: local JSON/text feed files on disk plus any enabled HTTPS feed URLs.
     * Every source reports its real outcome; unreachable sources are never counted as updated.
     */
    async update(): Promise<FeedUpdateResult> {
        arsenalCore.audit('THREAT_FEED_UPDATE', 'threat-intel', 'ATTEMPT', {});
        const result: FeedUpdateResult = {
            updated: 0, added: 0, duplicates: 0, invalid: 0,
            sources: [], localFeeds: []
        };

        // 1) Local feed files.
        const dir = this.feedDir();
        if (fs.existsSync(dir)) {
            for (const file of fs.readdirSync(dir)) {
                if (file === 'sources.json') continue;
                const full = path.join(dir, file);
                if (!fs.statSync(full).isFile()) continue;
                const format: 'json' | 'text' = file.endsWith('.json') ? 'json' : 'text';
                try {
                    const body = fs.readFileSync(full, 'utf8');
                    const { iocs, invalid } = this.parseFeed(file, body, format);
                    const ing = this.ingest(iocs);
                    result.updated += ing.added;
                    result.added += ing.added;
                    result.duplicates += ing.duplicates;
                    result.invalid += invalid;
                    result.localFeeds.push(file);
                    result.sources.push({ name: file, ok: true, iocs: iocs.length, truncated: ing.truncated });
                } catch (err: any) {
                    result.sources.push({ name: file, ok: false, reason: err?.message, iocs: 0 });
                }
            }
        }

        // 2) Remote feeds.
        for (const src of this.readSources()) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 20000);
                const res = await fetch(src.url, {
                    signal: controller.signal,
                    headers: { 'user-agent': 'sovereign-arsenal/1.3', accept: 'application/json,text/plain' }
                });
                clearTimeout(timer);
                if (!res.ok) {
                    result.sources.push({ name: src.name, ok: false, reason: `HTTP ${res.status}`, iocs: 0 });
                    continue;
                }
                const body = await res.text();
                const { iocs, invalid } = this.parseFeed(src.name, body, src.format);
                const ing = this.ingest(iocs);
                result.updated += ing.added;
                result.added += ing.added;
                result.duplicates += ing.duplicates;
                result.invalid += invalid;
                result.sources.push({ name: src.name, ok: true, iocs: iocs.length, truncated: ing.truncated });
            } catch (err: any) {
                result.sources.push({ name: src.name, ok: false, reason: `${err?.name || 'Error'}: ${err?.message}`, iocs: 0 });
            }
        }

        arsenalCore.audit('THREAT_FEED_UPDATE', 'threat-intel', 'SUCCESS', {
            added: result.added, duplicates: result.duplicates, invalid: result.invalid,
            sources: result.sources.length
        });
        return result;
    }

    /** Real lookup over the ingested indicators. */
    async search(indicator: string): Promise<IOC[]> {
        const q = String(indicator ?? '').trim().toLowerCase();
        if (!q) return [];
        const all = this.collector.all();
        const exact = all.filter(i => i.value.toLowerCase() === q);
        const partial = all.filter(i => i.value.toLowerCase() !== q && i.value.toLowerCase().includes(q));
        const tagged = all.filter(i => i.value.toLowerCase() !== q && !i.value.toLowerCase().includes(q) && i.tags.includes(q));
        arsenalCore.audit('THREAT_FEED_SEARCH', 'threat-intel', 'SUCCESS', {
            query: q, exact: exact.length, partial: partial.length, tagged: tagged.length
        });
        return [...exact, ...partial, ...tagged];
    }
}

export class MITREMapper {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('MITRE_MAPPER_INIT', 'threat-intel', 'SUCCESS', {});
    }

    /** Map an IOC to real ATT&CK techniques using the IOC type + tag knowledge base. */
    mapToTechnique(ioc: IOC): { techniqueId: string; technique: string; tactic: string; confidence: number; reason: string }[] {
        const out: { techniqueId: string; technique: string; tactic: string; confidence: number; reason: string }[] = [];
        if (!ioc) return out;
        const tags = (ioc.tags || []).map(t => String(t).toLowerCase());
        for (const rule of IOC_TECHNIQUE_MAP) {
            const typeOk = !rule.match.type || rule.match.type === ioc.type;
            const tagOk = !rule.match.tag || tags.includes(rule.match.tag);
            if (typeOk && tagOk) {
                out.push({
                    techniqueId: rule.techniqueId,
                    technique: rule.technique,
                    tactic: rule.tactic,
                    confidence: Math.min(1, (ioc.confidence ?? 0.5) + 0.1),
                    reason: `IOC type "${ioc.type}"${rule.match.tag ? ` + tag "${rule.match.tag}"` : ''}`
                });
            }
        }
        arsenalCore.audit('MITRE_MAPPING', 'threat-intel', 'SUCCESS', { iocId: ioc.id, techniques: out.length });
        return out;
    }

    /** Map a whole IOC set. */
    mapAll(iocs: IOC[]): { techniqueId: string; technique: string; tactic: string; iocs: IOC[] }[] {
        const grouped = new Map<string, { techniqueId: string; technique: string; tactic: string; iocs: IOC[] }>();
        for (const ioc of iocs) {
            for (const t of this.mapToTechnique(ioc)) {
                const key = `${t.tactic}:${t.techniqueId}`;
                const cur = grouped.get(key) ?? { techniqueId: t.techniqueId, technique: t.technique, tactic: t.tactic, iocs: [] };
                cur.iocs.push(ioc);
                grouped.set(key, cur);
            }
        }
        return [...grouped.values()].sort((a, b) => b.iocs.length - a.iocs.length);
    }

    getTactics(): string[] {
        return ['Initial Access', 'Execution', 'Persistence', 'Privilege Escalation', 'Defense Evasion',
                'Credential Access', 'Discovery', 'Lateral Movement', 'Collection', 'Command and Control', 'Exfiltration'];
    }
}

export class TTPAnalyzer {
    private ctx: OperationContext;
    private mapper: MITREMapper;

    constructor(ctx: OperationContext, mapper?: MITREMapper) {
        this.ctx = ctx;
        this.mapper = mapper ?? new MITREMapper(ctx);
        arsenalCore.audit('TTP_ANALYZER_INIT', 'threat-intel', 'SUCCESS', {});
    }

    /**
     * Real campaign analysis over the supplied IOC set:
     * techniques, kill chain coverage, actor attribution and per-technique confidence.
     */
    analyze(campaign: { name?: string; iocs?: IOC[]; actors?: string[] } | IOC[]): {
        campaign: string;
        iocsAnalyzed: number;
        techniques: { techniqueId: string; technique: string; tactic: string; count: number; confidence: number; iocs: string[] }[];
        killChain: string[];
        actors: { actor: string; iocCount: number; techniques: string[] }[];
        unmappedIocs: string[];
        coverage: { mapped: number; unmapped: number; percent: number };
    } {
        const iocs = Array.isArray(campaign) ? campaign : (campaign?.iocs ?? []);
        const name = Array.isArray(campaign) ? 'unnamed-campaign' : (campaign?.name ?? 'unnamed-campaign');
        const declaredActors = Array.isArray(campaign) ? [] : (campaign?.actors ?? []);

        const techniqueRows = this.mapper.mapAll(iocs).map(t => ({
            techniqueId: t.techniqueId,
            technique: t.technique,
            tactic: t.tactic,
            count: t.iocs.length,
            confidence: Number((t.iocs.reduce((s, i) => s + (i.confidence ?? 0.5), 0) / t.iocs.length).toFixed(3)),
            iocs: t.iocs.map(i => i.value)
        }));

        const mappedIds = new Set(techniqueRows.flatMap(t => t.iocs));
        const unmapped = iocs.filter(i => !mappedIds.has(i.value)).map(i => i.value);

        const killChain = TTPEngine.getKillChain(
            techniqueRows.map(t => ({
                tactic: t.tactic,
                techniqueId: t.techniqueId,
                technique: t.technique,
                findings: [],
                confidence: t.confidence
            }))
        );

        // Actor attribution is derived from real IOC sources/tags, never invented.
        const actorMap = new Map<string, { count: number; techniques: Set<string> }>();
        for (const ioc of iocs) {
            const actorTags = (ioc.tags || []).filter(t => /actor|apt|group|gang|cluster/i.test(t));
            const actors = actorTags.length ? actorTags : [ioc.source || 'unknown'];
            for (const a of actors) {
                const cur = actorMap.get(a) ?? { count: 0, techniques: new Set<string>() };
                cur.count++;
                for (const t of this.mapper.mapToTechnique(ioc)) cur.techniques.add(t.techniqueId);
                actorMap.set(a, cur);
            }
        }
        const actors = [...actorMap.entries()]
            .map(([actor, v]) => ({ actor, iocCount: v.count, techniques: [...v.techniques] }))
            .sort((a, b) => b.iocCount - a.iocCount);
        if (declaredActors.length) {
            for (const d of declaredActors) {
                if (!actors.find(a => a.actor === d)) actors.push({ actor: d, iocCount: 0, techniques: [] });
            }
        }

        arsenalCore.audit('TTP_ANALYSIS', 'threat-intel', 'SUCCESS', {
            campaign: name, iocs: iocs.length, techniques: techniqueRows.length, killChain: killChain.length
        });

        return {
            campaign: name,
            iocsAnalyzed: iocs.length,
            techniques: techniqueRows,
            killChain,
            actors,
            unmappedIocs: unmapped,
            coverage: {
                mapped: iocs.length - unmapped.length,
                unmapped: unmapped.length,
                percent: iocs.length ? Math.round(((iocs.length - unmapped.length) / iocs.length) * 100) : 0
            }
        };
    }
}

export class ThreatIntelArsenal {
    collector: IOCCollector;
    feed: ThreatFeed;
    mitre: MITREMapper;
    ttp: TTPAnalyzer;

    constructor(ctx: OperationContext) {
        this.collector = new IOCCollector(ctx);
        this.feed = new ThreatFeed(ctx, this.collector);
        this.mitre = new MITREMapper(ctx);
        this.ttp = new TTPAnalyzer(ctx, this.mitre);
        arsenalCore.audit('THREAT_INTEL_INIT', 'threat-intel', 'SUCCESS', { opId: ctx.operationId });
    }
}
export default ThreatIntelArsenal;
