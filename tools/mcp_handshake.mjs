#!/usr/bin/env node
/**
 * Real MCP JSON-RPC handshake probe for the sovereign-arsenal MCP server.
 * Prints exactly 3 JSON lines: initialize result, tools/list result, tools/call result.
 * Lives in the repo because /tmp is not durable here.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'mcp', 'arsenal_mcp_server.ts');

const child = spawn('npx', ['tsx', SERVER], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
});

let buf = '';
const lines = [];
child.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) {
            try { lines.push(JSON.parse(line)); } catch { /* ignore non-json */ }
        }
    }
});

let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });

const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');

const waitFor = async (id, timeoutMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const found = lines.find((l) => l.id === id);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 200));
    }
    return null;
};

const done = async () => {
    const out = lines.filter((l) => l.id !== undefined);
    for (const l of out) console.log(JSON.stringify(l));
    if (out.length < 3) {
        if (stderr) process.stderr.write(stderr.slice(0, 1500));
    }
    child.kill();
    process.exit(0);
};

setTimeout(() => send({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'arsenal-verify', version: '1.0.0' } }
}), 1500);

(async () => {
    const init = await waitFor(1, 60000);
    if (!init) { await done(); return; }
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    await waitFor(2, 30000);
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'commander_status', arguments: {} } });
    await waitFor(3, 30000);
    await done();
})();

setTimeout(async () => { await done(); }, 120000);
