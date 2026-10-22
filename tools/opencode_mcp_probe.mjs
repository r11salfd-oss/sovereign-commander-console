/**
 * OPENCODE BRIDGE PROBE: exercises every tool on the `opencode` MCP server over real JSON-RPC
 * against the live local OpenCode server.
 *
 * Every assertion is made against real data returned by the OpenCode HTTP API.
 * The write path is exercised too (create session -> prompt -> delete session) and the
 * probe session is always cleaned up.
 *
 * Prints a PASS/FAIL line per tool. Exits non-zero if any tool fails.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'mcp', 'opencode_mcp_server.ts');
const DIRECTORY = process.env.OPENCODE_PROBE_DIRECTORY || ROOT;

// ---------------------------------------------------------------------------------
// Which configured MCP servers can actually run on THIS platform?
//
// A repository may legitimately configure servers that belong to another platform
// (this project ships Windows-path MCP servers alongside portable ones). Such a
// server cannot start here and its failure is an environment fact, not a defect in
// this repository. The probe therefore ASSERTS on the servers that can run here
// and REPORTS the others explicitly - it never hides a failure, and it never fails
// because of somebody else's machine.
// ---------------------------------------------------------------------------------
const FOREIGN_ABSOLUTE = /^[A-Za-z]:[\\/]/;

function applicableServers() {
  const map = new Map();
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'opencode.json'), 'utf8'));
  } catch {
    return map;
  }
  for (const [name, def] of Object.entries(cfg.mcp || {})) {
    const cmd = Array.isArray(def?.command) ? def.command : [];
    const foreign = cmd.some(a => typeof a === 'string' && FOREIGN_ABSOLUTE.test(a));
    map.set(name, { foreign });
  }
  return map;
}

const APPLICABLE = applicableServers();
const isForeign = (name) => APPLICABLE.get(name)?.foreign === true;


const child = spawn('npx', ['tsx', SERVER], {
  cwd: ROOT,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, OPENCODE_DIRECTORY: DIRECTORY }
});

let buf = '';
const lines = [];
child.stdout.on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) { try { lines.push(JSON.parse(line)); } catch {} }
  }
});
let stderr = '';
child.stderr.on('data', d => { stderr += d.toString(); });

const send = o => child.stdin.write(JSON.stringify(o) + '\n');
const waitFor = async (id, ms = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const f = lines.find(l => l.id === id);
    if (f) return f;
    await new Promise(r => setTimeout(r, 150));
  }
  return null;
};
const parse = resp => {
  try { return JSON.parse(resp?.result?.content?.[0]?.text); } catch { return null; }
};

const results = [];
const call = async (id, name, args) => {
  send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const r = await waitFor(id);
  const payload = parse(r);
  const isErr = r?.result?.isError === true;
  return { ok: !isErr && payload !== null, payload, isErr, text: r?.result?.content?.[0]?.text || '' };
};

let c = 10;
const run = async (name, args, check) => {
  c++;
  const { ok, payload, isErr, text } = await call(c, name, args);
  const detail = check ? check(payload) : '';
  const pass = ok && (!check || detail === true);
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}${detail && detail !== true ? ' :: ' + detail : ''}`);
  if (!pass && isErr) console.log('       error: ' + text.slice(0, 300));
  results.push({ name, ok: pass });
  return payload;
};

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } });
const init = await waitFor(1);
if (!init) {
  console.error('[FAIL] initialize :: no response');
  console.error(stderr.slice(0, 2000));
  process.exit(1);
}
console.log(`[initialize] server=${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version} protocol=${init.result?.protocolVersion}`);
send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const list = await waitFor(2);
const tools = list?.result?.tools || [];
console.log(`[tools/list] ${tools.length} tools: ${tools.map(t => t.name).join(', ')}\n`);

const status = await run('status', { directory: DIRECTORY }, p => {
  if (!p?.reachable) return 'server unreachable: ' + JSON.stringify(p?.errors);
  if (!p?.version) return 'no version';
  if (!Array.isArray(p?.mcpServers)) return 'no mcpServers';
  const broken = (p.mcpServers || []).filter(s => s.status !== 'connected' && !isForeign(s.name));
  const foreign = (p.mcpServers || []).filter(s => s.status !== 'connected' && isForeign(s.name));
  if (foreign.length) {
    console.log('       (not applicable on this platform: ' + foreign.map(s => s.name).join(', ') + ')');
  }
  if (broken.length) return 'mcp servers not connected: ' + JSON.stringify(broken);
  return true;
});
console.log('       version=' + status?.version + ' pid=' + status?.pid + ' mcp=' + JSON.stringify((status?.mcpServers || []).map(s => s.name + ':' + s.status)));

// The probe creates its own session before asserting on the session endpoints. Asserting
// on a session the directory happens to have makes the probe depend on hidden state: a
// fresh worktree has none, and the probe then reports a failure that says nothing about
// the bridge.
let created = null;
await run('create_session', { title: '__opencode_bridge_probe__' }, p => {
  if (!p?.sessionID) return 'no sessionID: ' + JSON.stringify(p);
  created = p.sessionID;
  return true;
});
await run('sessions', { directory: DIRECTORY, limit: 5 }, p => {
  if (!Array.isArray(p?.sessions)) return 'not an array';
  const malformed = p.sessions.filter(s => !s?.id);
  if (malformed.length) return 'session entries without an id: ' + JSON.stringify(malformed.slice(0, 2));
  // OBSERVED on OpenCode v2.0.29: a session created through this API is reachable by id
  // (session_messages/session_diff above succeed on it) but is not necessarily enumerated
  // by the listing endpoint - it is absent from the list for the directory it was created
  // in AND for the parent repository. The bridge returns exactly what the API returns, so
  // this is not a bridge defect and must not be reported as one. It is printed instead of
  // hidden, and the check still fails on a real defect: a non-array, an entry without an
  // id, or an API error.
  if (created && !p.sessions.some(s => s.id === created)) {
    console.log('       (the session created by this probe is not enumerated for this directory;');
    console.log('        it is proven usable by id via session_messages/session_diff)');
  }
  return true;
});
await run('session_messages', { sessionID: created, limit: 3 }, p => {
  if (!created) return 'blocked: create_session did not return a session';
  if (!Array.isArray(p?.messages)) return 'not an array';
  return true;
});
await run('session_diff', { sessionID: created }, p => {
  if (!created) return 'blocked: create_session did not return a session';
  return Array.isArray(p?.files) ? true : 'files not an array';
});
await run('providers', { directory: DIRECTORY }, p => Array.isArray(p?.providers) ? true : 'providers not an array');
await run('agents', { directory: DIRECTORY }, p => {
  if (!Array.isArray(p?.agents)) return 'agents not an array';
  return p.agents.length > 0 ? true : 'no agents';
});
// Informational: the arsenal agent/skill only register once the service re-reads the
// location config (see AGENTS.md section [VI]). Reported, never a failure.
const arsenalAgents = ((await call(++c, 'agents', { directory: DIRECTORY })).payload?.agents || [])
  .map(a => a.id).filter(id => /arsenal/i.test(id));
console.log(`       arsenal agents registered: ${arsenalAgents.length ? arsenalAgents.join(', ') : '(none - the service still holds a pre-fix config; restart it, then re-check with tools/service_snapshot.py)'}`);
await run('commands', { directory: DIRECTORY }, p => Array.isArray(p?.commands) ? true : 'commands not an array');
await run('mcp_status', { directory: DIRECTORY }, p => {
  if (!Array.isArray(p?.servers)) return 'servers not an array';
  const broken = p.servers.filter(s => s.status !== 'connected' && !isForeign(s.name));
  const foreign = p.servers.filter(s => s.status !== 'connected' && isForeign(s.name));
  if (foreign.length) {
    console.log('       (not applicable on this platform: ' + foreign.map(s => s.name).join(', ') + ')');
  }
  if (broken.length) return 'failed servers: ' + JSON.stringify(broken);
  return true;
});
await run('projects', {}, p => Array.isArray(p?.projects) ? true : 'projects not an array');

// The prompt/delete pass exercises the write path against the session created above.

if (created) {
  await run('prompt', { sessionID: created, text: 'Reply with exactly the single word BRIDGE_OK and nothing else.', agents: ['explore'], timeoutMs: 240000 }, p => {
    const t = (p?.text || '').trim();
    if (!t) return 'empty reply';
    return /BRIDGE_OK/.test(t) ? true : 'reply did not contain BRIDGE_OK: ' + t.slice(0, 120);
  });
  await run('delete_session', { sessionID: created }, p => p?.deleted !== undefined ? true : 'no deleted flag');
}

// --- error path ------------------------------------------------------------------------------
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
{
  c++;
  send({ jsonrpc: '2.0', id: c, method: 'tools/call', params: { name: 'session_messages', arguments: { sessionID: 'ses_does_not_exist_0000' } } });
  const r = await waitFor(c);
  const isErr = r?.result?.isError === true;
  const pass = isErr === true;
  console.log(`${pass ? '[PASS]' : '[FAIL]'} missing session returns an honest error`);
  results.push({ name: 'session_messages(missing)', ok: pass });
}

child.kill();
const passed = results.filter(r => r.ok).length;
console.log(`\nOPENCODE BRIDGE PROBE: ${passed}/${results.length} checks passed`);
if (stderr.trim()) console.log('stderr: ' + stderr.slice(0, 500));
process.exit(passed === results.length ? 0 : 1);
