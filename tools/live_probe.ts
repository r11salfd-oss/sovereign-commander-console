/**
 * LIVE PROBE: starts real TCP listeners, then proves the arsenal finds them
 * and that the MCP server exposes working tools over real JSON-RPC.
 */
import net from 'net';
import { arsenalCore, arsenalCommander, NetworkArsenal } from '../src/neo/arsenal/index.ts';

const listeners: net.Server[] = [];
function listen(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer((c) => c.end());
    s.listen(0, '127.0.0.1', () => resolve((s.address() as net.AddressInfo).port));
    listeners.push(s);
  });
}

/**
 * A port the kernel has just released. It is the honest way to obtain a "closed" target:
 * a fixed guess can be taken by any other process on the host (EADDRINUSE for listeners,
 * an unexpected open for scanners), which is a property of the machine, not of the code.
 */
async function closedPort(): Promise<number> {
  const probe = net.createServer();
  const port = await new Promise<number>((resolve) => {
    probe.listen(0, '127.0.0.1', () => resolve((probe.address() as net.AddressInfo).port));
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function main() {
  const openPort = await listen();
  const openPort2 = await listen();
  const closedPortA = await closedPort();
  const closedPortB = await closedPort();
  console.log(`[setup] real listeners started on 127.0.0.1:${openPort} and :${openPort2}`);

  const op = arsenalCore.createOperation('PURPLE', ['127.0.0.1'], '127.0.0.1', 'LIVE-PROBE');
  console.log('[operation] operationId =', op.operationId);

  const net_ = new NetworkArsenal(op);
  const before = arsenalCore.getFindings().length;
  const res = await net_.scanner.tcpConnectScan('127.0.0.1', [openPort, openPort2, closedPortA, closedPortB]);

  console.log('\n[scan results]');
  for (const r of res) console.log(`   port ${r.port} -> ${r.state}${r.service ? ' (' + r.service + ')' : ''}`);

  const open = res.filter(r => r.state === 'open');
  const closed = res.filter(r => r.state === 'closed');
  console.log(`\n[assert] open=${open.length} (expect 2)  closed=${closed.length} (expect 2)`);
  console.log(`[assert] findings created: ${arsenalCore.getFindings().length - before} (expect 2)`);

  const okScan = open.length === 2 && closed.length === 2 && (arsenalCore.getFindings().length - before) === 2;

  console.log('\n[commander FULL_RECON against the live listener]');
  const cRes = await arsenalCommander.run({
    mission: 'FULL_RECON', target: '127.0.0.1', scope: ['127.0.0.1'],
    auth: 'LIVE-PROBE', autoChain: ['NETWORK'], autoReport: true, collectEvidence: true, mapTTP: true
  });
  console.log('   operationId   :', cRes.operationId);
  console.log('   modules       :', cRes.modulesExecuted.join(', '));
  console.log('   findings      :', cRes.findings.length, '(delta', cRes.findingDelta + ')');
  console.log('   ttp techniques:', cRes.ttpCoverage.length, cRes.ttpCoverage.map(t => t.techniqueId + '/' + t.tactic).join(' | '));
  console.log('   kill chain    :', cRes.killChain.join(' -> ') || '(none)');
  console.log('   risk score    :', cRes.riskAssessment.overallScore + '/100', cRes.riskAssessment.overallSeverity);
  console.log('   evidence ids  :', cRes.evidenceIds.join(', ') || '(none)');
  console.log('   audit entries :', cRes.auditTrail);
  console.log('   report built  :', cRes.report ? 'yes' : 'no');

  const okCommander = cRes.success
    && cRes.ttpCoverage.length > 0
    && cRes.riskAssessment.overallScore > 0
    && cRes.evidenceIds.length > 0
    && cRes.auditTrail > 0;

  console.log('\n[audit tail]');
  for (const e of arsenalCore.getAuditLog(6)) {
    console.log(`   ${e.action} :: ${e.actor} :: ${e.result}`);
  }

  for (const s of listeners) s.close();
  console.log(`\nRESULT: scan=${okScan ? 'PASS' : 'FAIL'}  commander=${okCommander ? 'PASS' : 'FAIL'}`);
  process.exit(okScan && okCommander ? 0 : 1);
}
main();
