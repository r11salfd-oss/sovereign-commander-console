#!/usr/bin/env node
/**
 * ====================================================================================================
 * OPENCODE BRIDGE - MCP SERVER (dependency-free)
 *
 * Exposes the *live* local OpenCode server to any MCP client as real tools.
 *
 * Why this exists:
 *   The project config used to register a local MCP server named "opencode" via
 *   `npx -y opencode mcp opencode`. That npm package does not exist (registry 404) and the
 *   `opencode mcp <name>` subcommand does not exist either, so the entry could never connect.
 *   A second entry named "opencode_console" had the same defect AND shadowed the remote server
 *   that the OpenCode Console publishes under that name, which cost us 11 working tools.
 *   Both broken entries were removed from opencode.json.
 *
 * Naming rule (learned the hard way - do not break it):
 *   OpenCode publishes its own MCP servers under the names "opencode" and "opencode_console".
 *   A config entry with the same name REPLACES the published server and its tools disappear.
 *   This bridge is therefore registered as "opencode_bridge" and never as "opencode".
 *
 * Design rules (same as the arsenal MCP server):
 *   - No npm dependency at startup. Node built-ins only. A missing package can never disable it.
 *   - Every tool result comes from a live HTTP call to the real OpenCode server. No fabrication.
 *   - If the server is unreachable the tool says so honestly, with the real error.
 *   - Credentials are read at runtime from the OpenCode service config; never stored in the repo.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdin/stdout (MCP stdio).
 * ====================================================================================================
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'opencode_bridge', version: '1.0.0' };

/** Default project directory used when the caller does not pass one. */
const DEFAULT_DIRECTORY =
    process.env.OPENCODE_DIRECTORY ||
    process.env.ARSENAL_ROOT ||
    process.cwd();

// ---------------------------------------------------------------------------------------------------------------
// Server discovery
// ---------------------------------------------------------------------------------------------------------------

let cachedBaseUrl: string | null = null;

function readServicePassword(): { username: string; password: string } | null {
    const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
    const envPw = process.env.OPENCODE_SERVER_PASSWORD;
    if (envPw) return { username, password: envPw };

    // The opencode background service persists its generated password here.
    const candidates = [
        path.join(os.homedir(), '.config', 'opencode', 'service.json'),
        path.join(os.homedir(), '.local', 'share', 'opencode', 'service.json')
    ];
    for (const file of candidates) {
        try {
            if (!fs.existsSync(file)) continue;
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (parsed && typeof parsed.password === 'string' && parsed.password.length > 0) {
                return { username, password: parsed.password };
            }
        } catch {
            // A malformed service file must not stop the server from starting.
        }
    }
    return null;
}

function opencodeBinary(): string | null {
    const fromPath = (() => {
        try {
            return execFileSync('sh', ['-lc', 'command -v opencode'], {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
        } catch {
            return '';
        }
    })();
    if (fromPath) return fromPath;
    const local = path.join(os.homedir(), '.opencode', 'bin', 'opencode');
    return fs.existsSync(local) ? local : null;
}

/**
 * Resolve the base URL of the running OpenCode server.
 * Order: explicit env -> `opencode service status` -> the documented default port.
 */
function resolveBaseUrl(): string {
    if (cachedBaseUrl) return cachedBaseUrl;

    const explicit = process.env.OPENCODE_SERVER_URL?.trim();
    if (explicit) {
        cachedBaseUrl = explicit.replace(/\/+$/, '');
        return cachedBaseUrl;
    }

    const bin = opencodeBinary();
    if (bin) {
        try {
            const out = execFileSync(bin, ['service', 'status'], {
                encoding: 'utf8',
                timeout: 8000,
                stdio: ['ignore', 'pipe', 'ignore']
            });
            const match = out.match(/https?:\/\/[^\s"']+/);
            if (match) {
                cachedBaseUrl = match[0].replace(/\/+$/, '');
                return cachedBaseUrl;
            }
        } catch {
            // Fall through to the default port.
        }
    }

    cachedBaseUrl = 'http://127.0.0.1:4096';
    return cachedBaseUrl;
}

interface ApiResult {
    ok: boolean;
    status: number;
    body: any;
    error?: string;
}

async function api(
    method: string,
    apiPath: string,
    opts: { query?: Record<string, string>; body?: any; timeoutMs?: number } = {}
): Promise<ApiResult> {
    const base = resolveBaseUrl();
    const url = new URL(base + apiPath);
    for (const [k, v] of Object.entries(opts.query || {})) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    const creds = readServicePassword();
    if (creds) {
        headers.Authorization =
            'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);
    try {
        const res = await fetch(url.toString(), {
            method,
            headers: opts.body !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            signal: controller.signal
        });
        const text = await res.text();
        let body: any = null;
        if (text) {
            try {
                body = JSON.parse(text);
            } catch {
                body = { raw: text.slice(0, 2000) };
            }
        }
        if (!res.ok) {
            const message =
                (body && (body.message || body._tag)) ||
                `HTTP ${res.status} ${res.statusText}`;
            return { ok: false, status: res.status, body, error: String(message) };
        }
        return { ok: true, status: res.status, body };
    } catch (e: any) {
        const reason = e?.name === 'AbortError' ? `request timed out after ${opts.timeoutMs || 20000}ms` : e?.message;
        return {
            ok: false,
            status: 0,
            body: null,
            error: `cannot reach opencode server at ${base}: ${reason}`
        };
    } finally {
        clearTimeout(timer);
    }
}

/** Unwrap the `{ data: ... }` envelope the v2 API uses for most routes. */
function unwrap(body: any): any {
    if (body && typeof body === 'object' && 'data' in body) return body.data;
    return body;
}

/** deepObject style query used by the v2 API for location-scoped routes. */
function locationQuery(directory: string): Record<string, string> {
    return { 'location[directory]': directory };
}

/**
 * Normalise a v2 session message.
 * The API returns `{ id, time, type: 'user'|'assistant'|'idle', text?, content?: Part[] }`
 * where assistant parts live in `content` (not `parts`) and the role lives in `type` (not `role`).
 */
function normalizeMessage(m: any) {
    const content: any[] = Array.isArray(m?.content) ? m.content : Array.isArray(m?.parts) ? m.parts : [];
    return {
        id: m?.id ?? null,
        role: m?.type ?? m?.role ?? null,
        agent: m?.agent ?? null,
        model: m?.model ? `${m.model.providerID}/${m.model.id}` : null,
        outcome: m?.outcome ?? null,
        created: m?.time?.created ?? null,
        completed: m?.time?.completed ?? null,
        text: typeof m?.text === 'string' ? m.text : undefined,
        parts: content.map((p: any) => ({
            type: p.type,
            text: p.text ? String(p.text).slice(0, 4000) : undefined,
            tool: p.tool ?? undefined,
            state: p.state ? { status: p.state.status, title: p.state.title } : undefined
        }))
    };
}

/** Text of the last assistant turn, or null when the agent has not answered yet. */
function lastAssistantText(messages: any[]): { message: any; text: string } | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if ((m?.type ?? m?.role) !== 'assistant') continue;
        const content: any[] = Array.isArray(m?.content) ? m.content : Array.isArray(m?.parts) ? m.parts : [];
        const joined = content
            .filter((p: any) => p.type === 'text' && p.text)
            .map((p: any) => String(p.text))
            .join('\n');
        if (joined.trim().length > 0) return { message: m, text: joined };
    }
    return null;
}

function directoryOf(args: any): string {
    const dir = args?.directory;
    return typeof dir === 'string' && dir.trim().length > 0 ? dir.trim() : DEFAULT_DIRECTORY;
}

// ---------------------------------------------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------------------------------------------

const TOOLS = [
    {
        name: 'status',
        description:
            'Live status of the local OpenCode server: version, pid, URLs, current location, MCP server health and session count. Reads the real API - never guesses.',
        inputSchema: {
            type: 'object',
            properties: {
                directory: { type: 'string', description: 'Project directory (defaults to the workspace root)' }
            }
        }
    },
    {
        name: 'sessions',
        description: 'List the OpenCode sessions of a project directory (id, title, agent, model, outcome, timestamps).',
        inputSchema: {
            type: 'object',
            properties: {
                directory: { type: 'string' },
                limit: { type: 'number', description: 'Max sessions to return (default 20, max 100)' },
                search: { type: 'string' }
            }
        }
    },
    {
        name: 'session_messages',
        description: 'Read the messages of an OpenCode session (role, model, text parts, tool calls).',
        inputSchema: {
            type: 'object',
            properties: {
                sessionID: { type: 'string' },
                limit: { type: 'number', description: 'Max messages (default 20, max 100)' }
            },
            required: ['sessionID']
        }
    },
    {
        name: 'session_diff',
        description: 'Get the file diff produced by an OpenCode session.',
        inputSchema: {
            type: 'object',
            properties: { sessionID: { type: 'string' } },
            required: ['sessionID']
        }
    },
    {
        name: 'providers',
        description: 'List the model providers opencode can use in a directory, with their connected/authenticated state.',
        inputSchema: {
            type: 'object',
            properties: { directory: { type: 'string' } }
        }
    },
    {
        name: 'agents',
        description: 'List the agents available in a directory (primary, subagent, hidden) with their descriptions.',
        inputSchema: {
            type: 'object',
            properties: { directory: { type: 'string' } }
        }
    },
    {
        name: 'commands',
        description: 'List the slash commands available in a directory.',
        inputSchema: {
            type: 'object',
            properties: { directory: { type: 'string' } }
        }
    },
    {
        name: 'mcp_status',
        description:
            'Report the health of every MCP server opencode has configured in a directory, including the exact error text of any server that failed to connect.',
        inputSchema: {
            type: 'object',
            properties: { directory: { type: 'string' } }
        }
    },
    {
        name: 'projects',
        description: 'List every project opencode knows about (id, canonical path, VCS, activity timestamps).',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'create_session',
        description: 'Create a new OpenCode session and return its id.',
        inputSchema: {
            type: 'object',
            properties: { title: { type: 'string' } }
        }
    },
    {
        name: 'prompt',
        description:
            'Send a prompt to an OpenCode session and wait for the reply. This really runs an agent - it costs tokens and can take minutes.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionID: { type: 'string' },
                text: { type: 'string' },
                agents: { type: 'array', items: { type: 'string' }, description: 'Agent ids to run (e.g. ["plan"])' },
                timeoutMs: { type: 'number' }
            },
            required: ['sessionID', 'text']
        }
    },
    {
        name: 'interrupt',
        description: 'Interrupt (abort) a running OpenCode session.',
        inputSchema: {
            type: 'object',
            properties: { sessionID: { type: 'string' } },
            required: ['sessionID']
        }
    },
    {
        name: 'delete_session',
        description: 'Delete an OpenCode session and all of its data. Destructive - use only on sessions you created.',
        inputSchema: {
            type: 'object',
            properties: { sessionID: { type: 'string' } },
            required: ['sessionID']
        }
    }
];

// ---------------------------------------------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------------------------------------------

async function callTool(name: string, args: any): Promise<any> {
    switch (name) {
        case 'status': {
            const directory = directoryOf(args);
            const info = await api('GET', '/api/info');
            const location = await api('GET', '/api/location');
            const mcp = await api('GET', '/api/mcp', { query: locationQuery(directory) });
            const sessions = await api('GET', '/api/session', { query: { directory, limit: '100' } });
            const providers = await api('GET', '/api/provider', { query: locationQuery(directory) });

            const sessionList = unwrap(sessions.body) || [];
            const mcpList = unwrap(mcp.body) || [];
            const providerList = unwrap(providers.body) || [];

            return text({
                reachable: info.ok,
                baseUrl: resolveBaseUrl(),
                version: info.ok ? unwrap(info.body)?.version ?? info.body?.version ?? null : null,
                pid: info.ok ? unwrap(info.body)?.pid ?? info.body?.pid ?? null : null,
                urls: info.ok ? unwrap(info.body)?.urls ?? info.body?.urls ?? [] : [],
                serverLocation: location.ok ? unwrap(location.body) : null,
                queriedDirectory: directory,
                mcpServers: mcpList.map((m: any) => ({
                    name: m.name,
                    status: m.status?.status ?? m.status,
                    error: m.status?.error ?? null
                })),
                sessionCount: Array.isArray(sessionList) ? sessionList.length : null,
                providers: providerList.map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    activation: p.activation ?? null,
                    models: Array.isArray(p.models) ? p.models.length : undefined
                })),
                connectedProviders: providers.body?.connected ?? null,
                errors: [info, mcp, sessions, providers].filter(r => !r.ok).map(r => r.error)
            });
        }

        case 'sessions': {
            const directory = directoryOf(args);
            const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
            const res = await api('GET', '/api/session', {
                query: { directory, limit: String(limit), ...(args.search ? { search: args.search } : {}) }
            });
            if (!res.ok) return err(res.error!);
            const list = unwrap(res.body) || [];
            return text({
                directory,
                count: list.length,
                sessions: list.map((s: any) => ({
                    id: s.id,
                    title: s.title,
                    agent: s.agent,
                    model: s.model ? `${s.model.providerID}/${s.model.id}` : null,
                    outcome: s.outcome ?? null,
                    projectID: s.projectID,
                    created: s.time?.created ?? null,
                    updated: s.time?.updated ?? null,
                    cost: s.cost ?? 0
                }))
            });
        }

        case 'session_messages': {
            const sessionID = args.sessionID;
            if (!sessionID) return err('sessionID is required');
            const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
            const res = await api('GET', `/api/session/${encodeURIComponent(sessionID)}/message`, {
                query: { limit: String(limit) }
            });
            if (!res.ok) return err(res.error!);
            const list = unwrap(res.body) || [];
            return text({
                sessionID,
                count: list.length,
                messages: list.map(normalizeMessage)
            });
        }

        case 'session_diff': {
            const sessionID = args.sessionID;
            if (!sessionID) return err('sessionID is required');
            const res = await api('GET', `/api/session/${encodeURIComponent(sessionID)}/diff`);
            if (!res.ok) return err(res.error!);
            const list = unwrap(res.body) || [];
            return text({ sessionID, files: list });
        }

        case 'providers': {
            const directory = directoryOf(args);
            const res = await api('GET', '/api/provider', { query: locationQuery(directory) });
            if (!res.ok) return err(res.error!);
            const list = unwrap(res.body) || [];
            return text({
                directory,
                connected: res.body?.connected ?? [],
                providers: list.map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    activation: p.activation ?? null,
                    npm: p.npm ?? null,
                    models: Array.isArray(p.models)
                        ? p.models.map((m: any) => ({
                              id: m.id,
                              name: m.name,
                              attachment: m.attachment ?? null,
                              reasoning: m.reasoning ?? null,
                              cost: m.cost ?? null
                          }))
                        : []
                }))
            });
        }

        case 'agents': {
            const directory = directoryOf(args);
            const res = await api('GET', '/api/agent', { query: locationQuery(directory) });
            if (!res.ok) return err(res.error!);
            const list = unwrap(res.body) || [];
            return text({
                directory,
                count: list.length,
                agents: list.map((a: any) => ({
                    id: a.id,
                    name: a.name,
                    mode: a.mode,
                    hidden: a.hidden ?? false,
                    description: a.description ?? null
                }))
            });
        }

        case 'commands': {
            const directory = directoryOf(args);
            const res = await api('GET', '/api/command', { query: locationQuery(directory) });
            if (!res.ok) return err(res.error!);
            const list = unwrap(res.body) || [];
            return text({
                directory,
                commands: list.map((c: any) => ({
                    name: c.name,
                    description: c.description ?? null,
                    agent: c.agent ?? null
                }))
            });
        }

        case 'mcp_status': {
            const directory = directoryOf(args);
            const res = await api('GET', '/api/mcp', { query: locationQuery(directory) });
            if (!res.ok) return err(res.error!);
            const list = unwrap(res.body) || [];
            const failed = list.filter((m: any) => (m.status?.status ?? m.status) !== 'connected');
            return text({
                directory,
                total: list.length,
                connected: list.length - failed.length,
                failed: failed.length,
                servers: list.map((m: any) => ({
                    name: m.name,
                    status: m.status?.status ?? m.status,
                    error: m.status?.error ?? null,
                    tools: Array.isArray(m.tools) ? m.tools.length : undefined
                }))
            });
        }

        case 'projects': {
            const res = await api('GET', '/api/project');
            if (!res.ok) return err(res.error!);
            const list = unwrap(res.body) || [];
            return text({
                count: list.length,
                projects: list.map((p: any) => ({
                    id: p.id,
                    canonical: p.canonical,
                    vcs: p.vcs ?? null,
                    created: p.time?.created ?? null,
                    updated: p.time?.updated ?? null,
                    active: p.time?.active ?? null
                }))
            });
        }

        case 'create_session': {
            const res = await api('POST', '/api/session', {
                body: args.title ? { title: args.title } : {}
            });
            if (!res.ok) return err(res.error!);
            const session = unwrap(res.body);
            return text({
                sessionID: session?.id ?? null,
                title: session?.title ?? null,
                projectID: session?.projectID ?? null,
                location: session?.location ?? null
            });
        }

        case 'prompt': {
            const sessionID = args.sessionID;
            if (!sessionID) return err('sessionID is required');
            if (!args.text) return err('text is required');
            const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 180000, 10000), 900000);

            // The v2 API queues the user turn in the session inbox and answers with the
            // queued envelope, not with the assistant reply.
            const body: any = { text: args.text };
            if (Array.isArray(args.agents) && args.agents.length) {
                body.agents = args.agents.map((a: any) =>
                    typeof a === 'string' ? { name: a } : a
                );
            }
            if (args.delivery === 'steer' || args.delivery === 'queue') body.delivery = args.delivery;

            const queued = await api('POST', `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
                body,
                timeoutMs: 60000
            });
            if (!queued.ok) return err(queued.error!);
            const envelope = unwrap(queued.body);

            // Wait for the session to go idle, then read the answer back.
            const wait = await api(
                'POST',
                `/api/experimental/session/${encodeURIComponent(sessionID)}/wait`,
                { body: {}, timeoutMs }
            );
            let messages: any[] = [];
            const readMessages = async () => {
                const res = await api('GET', `/api/session/${encodeURIComponent(sessionID)}/message`, {
                    query: { limit: '10' },
                    timeoutMs: 30000
                });
                if (res.ok) messages = unwrap(res.body) || [];
            };
            await readMessages();

            let answered = lastAssistantText(messages);
            if (!answered && (!wait.ok || wait.status === 0)) {
                // The wait route did not answer - fall back to polling for an assistant turn.
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    await new Promise(r => setTimeout(r, 2000));
                    await readMessages();
                    answered = lastAssistantText(messages);
                    if (answered) break;
                }
            }

            const assistant = answered?.message ?? null;
            return text({
                sessionID,
                queuedMessageID: envelope?.id ?? null,
                delivery: envelope?.delivery ?? null,
                waitedFor: wait.ok,
                waitError: wait.ok ? null : wait.error ?? null,
                messageID: assistant?.id ?? null,
                role: assistant?.type ?? assistant?.role ?? null,
                model: assistant?.model ? `${assistant.model.providerID}/${assistant.model.id}` : null,
                outcome: assistant?.outcome ?? null,
                text: answered?.text ?? '',
                parts: assistant ? normalizeMessage(assistant).parts : []
            });
        }

        case 'interrupt': {
            const sessionID = args.sessionID;
            if (!sessionID) return err('sessionID is required');
            const res = await api('POST', `/api/session/${encodeURIComponent(sessionID)}/interrupt`, {
                body: {}
            });
            if (!res.ok) return err(res.error!);
            return text({ sessionID, interrupted: unwrap(res.body) });
        }

        case 'delete_session': {
            const sessionID = args.sessionID;
            if (!sessionID) return err('sessionID is required');
            const res = await api('DELETE', `/api/session/${encodeURIComponent(sessionID)}`);
            if (!res.ok) return err(res.error!);
            return text({ sessionID, deleted: unwrap(res.body) });
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// JSON-RPC plumbing (MCP stdio)
// ---------------------------------------------------------------------------------------------------------------

interface JsonRpcMessage {
    jsonrpc: string;
    id?: number | string | null;
    method?: string;
    params?: any;
}

function send(payload: any): void {
    process.stdout.write(JSON.stringify(payload) + '\n');
}

function ok(id: number | string | null | undefined, result: any): void {
    send({ jsonrpc: '2.0', id: id ?? null, result });
}

function fail(id: number | string | null | undefined, code: number, message: string): void {
    send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

const text = (payload: any) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
const err = (message: string) => ({ content: [{ type: 'text', text: `Error: ${message}` }], isError: true });

async function handle(msg: JsonRpcMessage): Promise<void> {
    const { id, method, params } = msg;

    if (id === undefined || id === null) {
        // Notification - no response expected.
        return;
    }

    switch (method) {
        case 'initialize':
            ok(id, {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER_INFO
            });
            return;

        case 'ping':
            ok(id, {});
            return;

        case 'tools/list':
            ok(id, { tools: TOOLS });
            return;

        case 'tools/call': {
            const name = params?.name;
            const args = params?.arguments ?? {};
            try {
                if (!name) throw new Error('tools/call requires a tool name');
                const result = await callTool(name, args);
                ok(id, result);
            } catch (e: any) {
                ok(id, {
                    content: [{ type: 'text', text: `Error: ${e.message}` }],
                    isError: true
                });
            }
            return;
        }

        default:
            fail(id, -32601, `Method not found: ${method}`);
    }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
            const msg = JSON.parse(line) as JsonRpcMessage;
            void handle(msg);
        } catch (e: any) {
            fail(null, -32700, `Parse error: ${e.message}`);
        }
    }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
