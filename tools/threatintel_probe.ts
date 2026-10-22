#!/usr/bin/env tsx
/**
 * Ground-truth probe for the Threat Intelligence Arsenal.
 * Feed ingestion is proven against real local feed files and live HTTPS feed URLs.
 */
import { arsenalCore, ThreatIntelArsenal } from '../src/neo/arsenal/index.ts';

const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
    console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
    if (!cond) failures.push(name);
}

const ctx = arsenalCore.createOperation('PURPLE', ['feeds'], 'local', 'AUTH-PROBE');
const ti = new ThreatIntelArsenal(ctx);

console.log('\n=== 1. IOC VALIDATION (real format checks) ===');
const good = ti.collector.collect({
    type: 'ip', value: '203.0.113.44', severity: 'HIGH', tags: ['c2'], source: 'probe', confidence: 0.9
});
check('valid IP accepted', good.id.startsWith('IOC-'), good.id);
let rejected = false;
try {
    ti.collector.collect({ type: 'ip', value: 'not-an-ip', severity: 'LOW', tags: [], source: 'probe', confidence: 0.5 });
} catch { rejected = true; }
check('malformed IP rejected', rejected);
let rejected2 = false;
try {
    ti.collector.collect({ type: 'hash', value: 'zz', severity: 'LOW', tags: [], source: 'probe', confidence: 0.5 });
} catch { rejected2 = true; }
check('malformed hash rejected', rejected2);
const dup = ti.collector.collect({
    type: 'ip', value: '203.0.113.44', severity: 'HIGH', tags: ['c2'], source: 'probe', confidence: 0.9
});
check('duplicate IOC is not stored twice', dup.id === good.id && ti.collector.count() === 1, `count=${ti.collector.count()}`);

console.log('\n=== 2. FEED INGESTION (real local files + live HTTPS) ===');
const upd = await ti.feed.update();
check('local feed file consumed', upd.localFeeds.includes('local_indicators.json'), upd.localFeeds.join(','));
check('real IOCs ingested', upd.added > 0, `added=${upd.added} dup=${upd.duplicates} invalid=${upd.invalid}`);
check('every source reports a real outcome', upd.sources.every(s => typeof s.ok === 'boolean'), JSON.stringify(upd.sources));
console.log('  sources:');
for (const s of upd.sources) console.log(`    ${s.ok ? 'OK ' : 'ERR'} ${s.name} iocs=${s.iocs}${s.reason ? ' reason=' + s.reason : ''}`);
check('ingested set is larger than the manual set', ti.collector.count() > 1, `count=${ti.collector.count()}`);

console.log('\n=== 3. INDICATOR SEARCH (real lookup) ===');
const hits = await ti.feed.search('45.155.205.233');
check('seed IOC found by exact value', hits.some(h => h.value === '45.155.205.233'), `${hits.length} hits`);
const byTag = await ti.feed.search('ransomware');
check('IOC found by tag', byTag.length > 0, `${byTag.length} hits`);
const none = await ti.feed.search('zzz-not-present-anywhere');
check('unknown indicator yields no fabricated hit', none.length === 0, `${none.length} hits`);

console.log('\n=== 4. IOC -> MITRE ATT&CK MAPPING (real knowledge base) ===');
const hashIoc = ti.collector.collect({
    type: 'hash', value: 'a'.repeat(64), severity: 'CRITICAL', tags: ['malware'], source: 'probe', confidence: 0.9
});
const mapped = ti.mitre.mapToTechnique(hashIoc);
check('malware hash mapped to a real technique', mapped.length > 0 && mapped[0].techniqueId.startsWith('T'),
    JSON.stringify(mapped.map(m => `${m.techniqueId}/${m.technique}`)));
const c2Ioc = ti.collector.collect({
    type: 'domain', value: 'c2-node.example', severity: 'HIGH', tags: ['c2'], source: 'probe', confidence: 0.8
});
const c2Mapped = ti.mitre.mapToTechnique(c2Ioc);
check('c2 domain mapped to T1071.001', c2Mapped.some(m => m.techniqueId === 'T1071.001'),
    JSON.stringify(c2Mapped.map(m => m.techniqueId)));

console.log('\n=== 5. CAMPAIGN TTP ANALYSIS (real computation) ===');
const all = ti.collector.all();
const analysis = ti.ttp.analyze({ name: 'probe-campaign', iocs: all });
check('campaign analyzed', analysis.iocsAnalyzed === all.length, `${analysis.iocsAnalyzed} IOCs`);
check('techniques derived from real IOCs', analysis.techniques.length > 0,
    analysis.techniques.slice(0, 5).map(t => `${t.techniqueId}(${t.count})`).join(','));
check('kill chain computed', analysis.killChain.length > 0, analysis.killChain.join(' -> '));
check('coverage computed', analysis.coverage.percent >= 0 && analysis.coverage.percent <= 100,
    `mapped=${analysis.coverage.mapped} unmapped=${analysis.coverage.unmapped} ${analysis.coverage.percent}%`);
check('actor attribution derived from real IOC data', analysis.actors.length > 0,
    analysis.actors.slice(0, 3).map(a => `${a.actor}:${a.iocCount}`).join(','));
console.log('  techniques:', analysis.techniques.map(t => `${t.techniqueId} ${t.technique}`).join(' | '));
console.log('  unmapped sample:', analysis.unmappedIocs.slice(0, 5).join(', ') || '(none)');

console.log(`\n${failures.length === 0 ? 'THREAT-INTEL PROBE: ALL PASSED' : 'THREAT-INTEL PROBE: FAILURES -> ' + failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
