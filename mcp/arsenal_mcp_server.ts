#!/usr/bin/env node
/**
 * ====================================================================================================
 * SOVEREIGN ARSENAL - MCP SERVER (dependency-free)
 *
 * Implements the MCP stdio transport directly: newline-delimited JSON-RPC 2.0 over stdin/stdout.
 * No @modelcontextprotocol/sdk dependency on purpose - the arsenal must start with nothing but
 * this repo and a TypeScript runner. A missing package must never be able to disable the arsenal.
 *
 * Supported methods: initialize, notifications/initialized, tools/list, tools/call, ping.
 * ====================================================================================================
 */

import {
    integratedArsenal,
    arsenalCore,
    NetworkArsenal,
    WebArsenal,
    CryptoArsenal,
    OSINTArsenal,
    ThreatIntelArsenal,
    arsenalCommander
} from '../src/neo/arsenal/index.ts';
import fs from 'fs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'sovereign-arsenal', version: '1.3.0' };

const TOOLS = [
    {
        name: 'arsenal_status',
        description: 'Get the current arsenal posture, active modules, and governance state',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'create_operation',
        description: 'Create a governed operation. Returns an operationId that all downstream work must reference.',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['OFFENSIVE', 'DEFENSIVE', 'PURPLE', 'NEUTRAL'] },
                scope: { type: 'array', items: { type: 'string' } },
                target: { type: 'string' },
                auth: { type: 'string', description: 'Authorization token/reference' }
            },
            required: ['mode', 'scope', 'auth']
        }
    },
    {
        name: 'network_scan',
        description: 'Run a real TCP connect scan against a target. Only ports that actually accept a connection are reported as open.',
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string' },
                ports: { type: 'array', items: { type: 'number' } },
                auth: { type: 'string' }
            },
            required: ['target', 'ports', 'auth']
        }
    },
    {
        name: 'web_assess',
        description: 'Run the web application assessment module (crawl + directory discovery) against a target URL',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                auth: { type: 'string' }
            },
            required: ['url', 'auth']
        }
    },
    {
        name: 'purple_exercise',
        description: 'Run a purple team exercise (adversary emulation plus real detection validation). Returns computed coverage, detected/missed counts and explicit detection gaps.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                objectives: { type: 'array', items: { type: 'string' } },
                techniques: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'MITRE ATT&CK technique ids to emulate. Omit for the default APT baseline.'
                },
                auth: { type: 'string' }
            },
            required: ['name', 'objectives', 'auth']
        }
    },
    {
        name: 'commander_run',
        description: 'Run a unified Arsenal Commander mission: auto-chains modules, maps findings to MITRE ATT&CK, scores risk, generates a report and collects evidence',
        inputSchema: {
            type: 'object',
            properties: {
                mission: {
                    type: 'string',
                    enum: ['FULL_RECON', 'QUICK_SCAN', 'WEB_ASSESS', 'PURPLE_EXERCISE', 'HARDENING_AUDIT', 'THREAT_HUNT', 'COMPREHENSIVE_ASSESS']
                },
                target: { type: 'string' },
                scope: { type: 'array', items: { type: 'string' } },
                auth: { type: 'string' },
                autoChain: { type: 'array', items: { type: 'string' } },
                autoReport: { type: 'boolean' },
                collectEvidence: { type: 'boolean' },
                mapTTP: { type: 'boolean' }
            },
            required: ['mission', 'scope', 'auth']
        }
    },
    {
        name: 'commander_status',
        description: 'Get Arsenal Commander health, capabilities and available missions',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'get_findings',
        description: 'List recorded findings, optionally filtered by severity or category',
        inputSchema: {
            type: 'object',
            properties: {
                severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] },
                category: { type: 'string' }
            }
        }
    },
    {
        name: 'get_audit',
        description: 'Read the immutable audit trail',
        inputSchema: {
            type: 'object',
            properties: { limit: { type: 'number' } }
        }
    },
    {
        name: 'crypto_audit',
        description:
            'Real cryptographic assessment: Shannon entropy and weak-algorithm detection over a local file, hash identification plus dictionary cracking, and live TLS version / certificate analysis of a host.',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Local file to analyse for entropy and weak algorithm usage' },
                hash: { type: 'string', description: 'Hash to identify and attempt to crack with the bundled wordlist' },
                host: { type: 'string', description: 'Host to probe for TLS versions and certificate details' },
                port: { type: 'number', description: 'TLS port (default 443)' },
                auth: { type: 'string' }
            },
            required: ['auth']
        }
    },
    {
        name: 'osint_domain',
        description:
            'Live OSINT on a domain: WHOIS over TCP/43, DNS record enumeration, and subdomain discovery via DNS brute force and certificate transparency.',
        inputSchema: {
            type: 'object',
            properties: {
                domain: { type: 'string' },
                auth: { type: 'string' }
            },
            required: ['domain', 'auth']
        }
    },
    {
        name: 'threat_intel',
        description:
            'Threat intelligence: ingest real IOC feeds (local files and live HTTPS feeds), search indicators and map them to MITRE ATT&CK techniques and kill-chain phases.',
        inputSchema: {
            type: 'object',
            properties: {
                indicator: { type: 'string', description: 'Indicator to search for (ip, domain, url, hash, email)' },
                updateFeeds: { type: 'boolean', description: 'Refresh the configured feeds before searching' },
                auth: { type: 'string' }
            },
            required: ['auth']
        }
    }
];

type JsonRpcMessage = { jsonrpc: '2.0'; id?: number | string | null; method?: string; params?: any; result?: any; error?: any };

function send(msg: JsonRpcMessage): void {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

function ok(id: number | string | null | undefined, result: any): void {
    send({ jsonrpc: '2.0', id: id ?? null, result });
}

function fail(id: number | string | null | undefined, code: number, message: string): void {
    send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

const text = (payload: any) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });

async function callTool(name: string, args: any): Promise<any> {
    switch (name) {
        case 'arsenal_status':
            return text(integratedArsenal.getPosture());

        case 'create_operation': {
            const op = arsenalCore.createOperation(args.mode, args.scope, args.target, args.auth);
            return text(op);
        }

        case 'network_scan': {
            const op = arsenalCore.createOperation('OFFENSIVE', [args.target], args.target, args.auth);
            const net = new NetworkArsenal(op);
            const before = arsenalCore.getFindings().length;
            const results = await net.scanner.tcpConnectScan(args.target, args.ports);
            return text({
                operationId: op.operationId,
                results,
                openPorts: results.filter((r: any) => r.state === 'open').map((r: any) => r.port),
                newFindings: arsenalCore.getFindings().length - before
            });
        }

        case 'web_assess': {
            const op = arsenalCore.createOperation('PURPLE', [args.url], args.url, args.auth);
            const web = new WebArsenal(op);
            const crawl = await web.scanner.crawl({ url: args.url });
            const dirs = await web.scanner.directoryBrute({ url: args.url });
            return text({ operationId: op.operationId, crawl, dirs });
        }

        case 'purple_exercise': {
            const op = arsenalCore.createOperation('PURPLE', args.objectives, undefined, args.auth);
            integratedArsenal.initialize('PURPLE', op);
            const ex = await integratedArsenal.purpleTeam!.runPurpleExercise(
                args.name,
                args.objectives,
                args.techniques
            );
            return text(ex);
        }

        case 'commander_run': {
            const res = await arsenalCommander.run({
                mission: args.mission,
                target: args.target,
                scope: args.scope,
                auth: args.auth,
                autoChain: args.autoChain,
                autoReport: args.autoReport !== false,
                collectEvidence: args.collectEvidence !== false,
                mapTTP: args.mapTTP !== false
            });
            return text(res);
        }

        case 'commander_status':
            return text(arsenalCommander.getStatus());

        case 'get_findings':
            return text(arsenalCore.getFindings({
                severity: args.severity,
                category: args.category
            }));

        case 'get_audit':
            return text(arsenalCore.getAuditLog(args.limit || 50));

        case 'crypto_audit': {
            const op = arsenalCore.createOperation('DEFENSIVE', ['local', args.host || 'local'], args.host || 'local', args.auth);
            const c = new CryptoArsenal(op);
            const out: any = { operationId: op.operationId };
            if (args.file) {
                if (!fs.existsSync(args.file)) return text({ ...out, file: args.file, error: 'file not found' });
                const buf = fs.readFileSync(args.file);
                out.file = args.file;
                out.bytes = buf.length;
                out.entropy = c.analyzer.entropyAnalysis(buf);
                out.algorithms = c.analyzer.analyzeAlgorithm(buf.toString('utf8'));
            }
            if (args.hash) {
                out.hash = {
                    type: c.cracker.identifyHash(args.hash),
                    crack: await c.cracker.crackHash(args.hash)
                };
            }
            if (args.host) {
                const port = args.port || 443;
                out.tls = await c.ssl.checkTLSVersion(args.host, port);
                out.certificate = await c.ssl.analyzeCertificate(args.host, port);
            }
            if (!args.file && !args.hash && !args.host) {
                out.error = 'provide at least one of: file, hash, host';
            }
            return text(out);
        }

        case 'osint_domain': {
            const op = arsenalCore.createOperation('PURPLE', [args.domain], args.domain, args.auth);
            const o = new OSINTArsenal(op);
            const whois = await o.domain.whois(args.domain);
            const dns = await o.domain.dnsEnum(args.domain);
            const subs = await o.domain.subdomainEnum(args.domain);
            return text({ operationId: op.operationId, whois, dns, subdomains: subs });
        }

        case 'threat_intel': {
            const op = arsenalCore.createOperation('PURPLE', ['local'], undefined, args.auth);
            const t = new ThreatIntelArsenal(op);
            await t.feed.update(); // always load feeds before searching
            let feed = null;
            if (args.updateFeeds) feed = await t.feed.update();
            const hits = args.indicator ? await t.feed.search(args.indicator) : [];
            const techniques = t.mitre.mapAll(hits);
            return text({
                operationId: op.operationId,
                feed,
                totalIndicators: t.collector.count(),
                search: args.indicator || null,
                hits,
                techniques
            });
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

async function handle(msg: JsonRpcMessage): Promise<void> {
    const { id, method, params } = msg;

    // Notifications carry no id and expect no response.
    if (id === undefined || id === null) {
        if (method && method !== 'notifications/initialized') {
            // Unknown notification - ignore silently per JSON-RPC.
        }
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
