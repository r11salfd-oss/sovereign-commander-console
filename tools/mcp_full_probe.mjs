/**
 * MCP FULL PROBE: exercises every tool on the sovereign-arsenal server over real JSON-RPC.
 * Prints a PASS/FAIL line per tool. Exits non-zero if any tool fails.
 */
import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'mcp', 'arsenal_mcp_server.ts');

const srv = net.createServer(c => c.end());
await new Promise(r => srv.listen(0, '127.0.0.1', r));
// The kernel assigns the port; a fixed one collides with any other instance on the host.
const srvPort = srv.address().port;

const child = spawn('npx', ['tsx', SERVER], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const lines = [];
child.stdout.on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line) { try { lines.push(JSON.parse(line)); } catch {} }
  }
});
let stderr = '';
child.stderr.on('data', d => { stderr += d.toString(); });

const send = o => child.stdin.write(JSON.stringify(o) + '\n');
const waitFor = async (id, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const f = lines.find(l => l.id === id);
    if (f) return f;
    await new Promise(r => setTimeout(r, 150));
  }
  return null;
};
const parse = (resp) => {
  try { return JSON.parse(resp?.result?.content?.[0]?.text); } catch { return null; }
};

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } });
const init = await waitFor(1);
console.log(`[initialize] server=${init?.result?.serverInfo?.name} v${init?.result?.serverInfo?.version} protocol=${init?.result?.protocolVersion}`);
send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const list = await waitFor(2);
const tools = list?.result?.tools || [];
console.log(`[tools/list] ${tools.length} tools: ${tools.map(t => t.name).join(', ')}\n`);

const results = [];
const call = async (id, name, args) => {
  send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const r = await waitFor(id);
  const payload = parse(r);
  const isErr = r?.result?.isError === true;
  const ok = !isErr && payload !== null;
  results.push({ name, ok, isErr, payload });
  return { ok, payload, isErr };
};

let c = 10;
const run = async (name, args, check) => {
  c++;
  const { ok, payload, isErr } = await call(c, name, args);
  const detail = check ? check(payload) : '';
  const pass = ok && (!check || detail === true);
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}${detail && detail !== true ? ' :: ' + detail : ''}`);
  if (!pass && isErr) console.log('       error: ' + JSON.stringify(payload));
  return payload;
};

await run('arsenal_status', {}, p => p ? true : 'null payload');
await run('create_operation', { mode: 'PURPLE', scope: ['127.0.0.1'], target: '127.0.0.1', auth: 'PROBE' }, p => p?.operationId ? true : 'no operationId');
await run('network_scan', { target: '127.0.0.1', ports: [srvPort, srvPort + 1], auth: 'PROBE' }, p => {
  const open = p?.openPorts || [];
  return open.includes(srvPort) ? true : `expected ${srvPort} open, got ${JSON.stringify(p?.results)}`;
});
await run('commander_status', {}, p => p?.status === 'OPERATIONAL' ? true : 'status=' + p?.status);
await run('commander_run', { mission: 'QUICK_SCAN', target: '127.0.0.1', scope: ['127.0.0.1'], auth: 'PROBE' }, p => {
  const issues = [];
  if (!p?.success) issues.push('success=false');
  if (!p?.operationId) issues.push('no operationId');
  if (!p?.ttpCoverage?.length) issues.push('no ttp coverage');
  if (!(p?.riskAssessment?.overallScore > 0)) issues.push('risk score = ' + p?.riskAssessment?.overallScore);
  if (!p?.evidenceIds?.length) issues.push('no evidence');
  return issues.length ? issues.join('; ') : true;
});
await run('get_findings', {}, p => Array.isArray(p) ? true : 'not an array');
await run('get_audit', { limit: 10 }, p => Array.isArray(p) && p.length > 0 ? true : 'empty audit');
await run('web_assess', { url: `http://127.0.0.1:${srvPort}/`, auth: 'PROBE' }, p => p?.operationId ? true : 'no operationId');
await run('crypto_audit', { hash: '5f4dcc3b5aa765d61d8327deb882cf99', auth: 'PROBE' }, p => p?.hash?.type === 'MD5' ? true : 'hash type mismatch');
await run('osint_domain', { domain: 'github.com', auth: 'PROBE' }, p => p?.whois?.reachable === true ? true : 'whois failed');
await run('threat_intel', { indicator: '198.51.100.7', updateFeeds: false, auth: 'PROBE' }, p => p?.hits?.length > 0 ? true : 'no hits');
// Error path: an unknown tool must produce isError:true, not a crash or a silent success.
{
  c++;
  send({ jsonrpc: '2.0', id: c, method: 'tools/call', params: { name: 'unknown_tool_xyz', arguments: {} } });
  const r = await waitFor(c);
  const isErr = r?.result?.isError === true;
  const msg = r?.result?.content?.[0]?.text || '';
  const pass = isErr && /Unknown tool/i.test(msg);
  console.log(`${pass ? '[PASS]' : '[FAIL]'} unknown_tool_xyz handled with isError=true :: ${msg.slice(0, 60)}`);
  results.push({ name: 'unknown_tool_xyz', ok: pass });
}

srv.close();
child.kill();
const passed = results.filter(r => r.ok).length;
console.log(`\nMCP PROBE: ${passed}/${results.length} tool calls responded successfully`);
if (stderr.trim()) console.log('stderr: ' + stderr.slice(0, 500));
process.exit(passed === results.length ? 0 : 1);
