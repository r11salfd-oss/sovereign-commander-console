#!/usr/bin/env tsx
/**
 * Ground-truth probe for the Network Arsenal.
 *
 * Every assertion is checked against live host state (/proc/net/tcp, /proc/net/dev) or against a
 * real service that this probe starts on 127.0.0.1. Nothing here asserts a fabricated result:
 * when the host forbids something (raw packet capture), the probe asserts the *honest* report.
 */
import http from 'http';
import fs from 'fs';
import net from 'net';
import { arsenalCore, NetworkArsenal } from '../src/neo/arsenal/index.ts';

const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
    console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
    if (!cond) failures.push(name);
}

/* ------------------------------------------------------------------ *
 * A real HTTP service on loopback so probes talk to something alive.  *
 * ------------------------------------------------------------------ */
const BANNER = 'SOVEREIGN-ARSENAL-PROBE/1.0 (real-service)';
const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain',
        'X-Probe-Banner': BANNER,
        Server: 'sovereign-arsenal-probe'
    });
    if (req.method === 'TRACE') {
        res.writeHead(200, { 'Content-Type': 'message/http' });
        res.end(`TRACE ${req.url}\r\nHost: ${req.headers.host}\r\n\r\n`);
        return;
    }
    res.end(`probe response for ${req.method} ${req.url}\n`);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
const port = (server.address() as net.AddressInfo).port;
console.log(`[setup] real HTTP service listening on 127.0.0.1:${port}\n`);

const ctx = arsenalCore.createOperation('OFFENSIVE', ['127.0.0.1', 'localhost'], '127.0.0.1', 'AUTH-PROBE');
const net_ = new NetworkArsenal(ctx);

console.log('=== 1. PORT SCAN (real TCP connect) ===');
const scan = await net_.scanner.tcpConnectScan('127.0.0.1', [port, 1]);
const openPort = scan.find(p => p.port === port);
check('live port reported open', openPort?.state === 'open', JSON.stringify(openPort));
const closedPort = scan.find(p => p.port === 1);
check('dead port reported closed or filtered', closedPort?.state === 'closed' || closedPort?.state === 'filtered', JSON.stringify(closedPort));

console.log('\n=== 2. INTERFACE COUNTERS (real /proc/net/dev) ===');
const counters = net_.analyzer.readInterfaceCounters();
check('counters read from /proc/net/dev', counters.length > 0, `${counters.length} interfaces: ${counters.map(c => c.interface).join(',')}`);
const lo = counters.find(c => c.interface === 'lo');
check('loopback counters are numeric and non-negative', !!lo && lo.rxBytes >= 0 && lo.txBytes >= 0,
    lo ? `lo rx=${lo.rxBytes}B tx=${lo.txBytes}B pkt ${lo.rxPackets}/${lo.txPackets}` : 'lo not present');
const raw = fs.readFileSync('/proc/net/dev', 'utf8');
const rawLo = raw.split('\n').find(l => l.trim().startsWith('lo:'));
const rawRx = rawLo ? Number(rawLo.trim().split(/\s+/)[1]) : -1;
check('loopback rx counter matches /proc/net/dev exactly', !!lo && lo.rxBytes === rawRx, `module=${lo?.rxBytes} proc=${rawRx}`);

console.log('\n=== 3. BANNER GRAB / SESSION CAPTURE (real bytes) ===');
const cap = await net_.analyzer.capture('lo', `127.0.0.1:${port}`);
check('capture produced a real session', cap.sessions.length === 1, `sessions=${cap.sessions.length}`);
const sess = cap.sessions[0];
check('session received real bytes from the live service', (sess?.bytesReceived || 0) > 0, `${sess?.bytesReceived} bytes, ${sess?.bytesSent} sent`);
check('captured banner contains the real server response', !!sess?.banner && sess.banner.includes('SOVEREIGN-ARSENAL-PROBE'),
    (sess?.banner || '').split('\r\n')[0]);
check('capture reports the raw-packet limitation honestly', cap.rawPacketCapture === false ? !!cap.reason : true,
    cap.rawPacketCapture ? 'CAP_NET_RAW present' : String(cap.reason).slice(0, 80));
check('capture did not fabricate packets', Array.isArray(cap.packets) && cap.packets.length === 0, `packets=${cap.packets.length}`);

console.log('\n=== 4. CONNECTION TABLE (real /proc/net/tcp) ===');
const conns = await net_.monitor.getConnections();
check('connections parsed from the kernel table', conns.length > 0, `${conns.length} entries`);
const listening = conns.filter(c => c.state === 'LISTEN');
check('listening sockets detected', listening.length > 0, `${listening.length} LISTEN`);
const ourServer = conns.find(c => c.localPort === port && c.state === 'LISTEN');
check('our probe server appears in the parsed table with the right port', !!ourServer,
    ourServer ? `${ourServer.localAddress}:${ourServer.localPort} ${ourServer.state}` : 'not found');
check('every parsed entry has a numeric port', conns.every(c => Number.isInteger(c.localPort) && Number.isInteger(c.remotePort)), 'sanity');
// Cross-check against the kernel's own view through `ss`.
let ssCount = -1;
try {
    const { execFileSync } = await import('child_process');
    const out = execFileSync('ss', ['-tan'], { encoding: 'utf8' });
    ssCount = out.split('\n').filter(l => l.trim().length > 0).length - 1;
} catch { /* ss may be absent */ }
check('parsed connection count is consistent with ss(8)', ssCount < 0 || Math.abs(conns.length - ssCount) <= 6,
    `module=${conns.length} ss=${ssCount}`);

console.log('\n=== 5. ANOMALY DETECTION (real traffic table) ===');
const anom = await net_.monitor.detectAnomalies();
check('anomaly detector ran over the live table', anom.analyzed === conns.length, `analyzed=${anom.analyzed}`);
check('every anomaly carries concrete evidence', anom.anomalies.every(a => a.detail && a.evidence !== undefined),
    `${anom.anomalies.length} anomalies: ${anom.anomalies.map(a => a.type).join(',') || '(none on this host)'}`);

console.log('\n=== 6. IDS RULE ENGINE (real rules -> real file -> real match) ===');
const ruleText = 'alert tcp any any -> any 80 (msg:"plaintext web traffic"; sid:1000001; rev:1;)';
const deployed = await net_.idsips.deployRules([ruleText]);
check('rules deployed', deployed.deployed === 1, `deployed=${deployed.deployed}`);
check('rule file written to disk', !!deployed.ruleFile && fs.existsSync(deployed.ruleFile), deployed.ruleFile);
if (deployed.ruleFile && fs.existsSync(deployed.ruleFile)) {
    const text = fs.readFileSync(deployed.ruleFile, 'utf8');
    check('rule file contains the rule body', text.includes('msg:') && text.includes('sid:'), text.split('\n')[0]);
    check('rule file preserves the original sid', text.includes('sid:1000001;'), text.split('\n')[0]);
    check('rule file preserves the destination port', /->\s+any\s+80\s/.test(text), text.split('\n')[0]);
}
check('parsed rule keeps the destination port', deployed.rules[0]?.match.remotePort === 80, JSON.stringify(deployed.rules[0]?.match));
const alerts = await net_.idsips.analyzeAlerts();
check('IDS analyzed the live connection table', alerts.analyzed > 0, `analyzed=${alerts.analyzed}`);
check('parsed rule retains sid + severity', deployed.rules[0]?.id?.length > 0 && deployed.rules[0]?.severity === 'MEDIUM',
    JSON.stringify(deployed.rules[0]));

console.log('\n=== 7. FIREWALL BYPASS PROBES (real HTTP requests) ===');
const outOfScope = await net_.bypass.testTechniques('example.com');
check('out-of-scope target refused with zero techniques', outOfScope.tested === 0 && outOfScope.techniques.length === 0,
    `tested=${outOfScope.tested}`);
const refusals = arsenalCore.getAuditLog(200).filter(a => a.action === 'FIREWALL_BYPASS_TEST' && a.result === 'REFUSED');
check('refusal recorded in the audit chain', refusals.length > 0, `${refusals.length} refusal entries`);

console.log('\n=== 8. SCOPE ENFORCEMENT ON CAPTURE ===');
const refusedCapture = await net_.analyzer.capture('lo', '10.0.0.1:80');
check('out-of-scope capture produced no session', refusedCapture.sessions.length === 0, `sessions=${refusedCapture.sessions.length}`);

console.log('\n=== 9. PROTOCOL CLASSIFICATION (real captured banner) ===');
const proto = await net_.analyzer.analyzeProtocol([
    { host: '127.0.0.1', port, bytesReceived: sess?.bytesReceived || 0, banner: sess?.banner || '' }
]);
check('protocol classified from real bytes', Object.keys(proto.protocols).length > 0, JSON.stringify(proto.protocols));
check('the real HTTP banner was classified as HTTP', proto.protocols.http === 1, JSON.stringify(proto.protocols));

server.close();
console.log(`\n${failures.length === 0 ? 'ALL PASSED' : 'FAILURES: ' + failures.join(' | ')}`);
console.log(`summary: ${failures.length} failure(s)`);
process.exit(failures.length === 0 ? 0 : 1);
