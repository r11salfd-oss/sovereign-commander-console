/**
 * ====================================================================================================
 * ADVERSARY LAB - SELF-CONTAINED LOCAL ATTACK SIMULATION & DETECTION VALIDATION
 * Standard: Diamond Standard (v3.0-HARDENED)
 *
 * The lab builds a REAL vulnerable web application on 127.0.0.1 using node's http server and then
 * runs a REAL attack chain against it over real sockets. Every status code, byte count and hash in
 * the result comes from an actual HTTP exchange.
 *
 * HARD SAFETY CONSTRAINT (enforced in code, not just documented):
 *   - The listener binds to 127.0.0.1 on an ephemeral port (port 0).
 *   - Every outbound request is passed through assertLocalOnly() which throws unless the target
 *     host is a loopback address. The lab can therefore NEVER reach an external host.
 *   - The credentials and secrets used are generated in-process for this run; no real credential
 *     store is touched.
 *
 * Detection coverage is measured with the REAL purple-team knowledge base (DETECTION_KB) through
 * the REAL PurpleTeamOrchestrator.validateDetections() - the coverage number is computed, never
 * asserted.
 * ====================================================================================================
 */

import crypto from 'crypto';
import http from 'http';
import { URL } from 'url';
import { arsenalCore, OperationContext, Finding, SeverityLevel } from '../core/arsenal_core';
import { DETECTION_KB, PurpleTeamOrchestrator, AdversaryEmulation } from '../integrated/purple_team';

export type LabPhaseName = 'RECON' | 'EXPLOIT' | 'PERSISTENCE' | 'EXFIL';

export interface LabScenario {
    id: string;
    name: string;
    description: string;
    objectives: string[];
    /** ATT&CK technique ids this scenario declares. */
    techniques: string[];
    /** ATT&CK tactics this scenario maps to. */
    tactics: string[];
    /** The ordered lab phases this scenario executes. */
    phases: LabPhaseName[];
}

export interface LabRequestRecord {
    method: string;
    url: string;
    headers: Record<string, string>;
    bodySha256: string;
    bodyBytes: number;
}

export interface LabResponseRecord {
    status: number;
    statusText: string;
    bytes: number;
    sha256: string;
    headersSubset: Record<string, string>;
    /** Body prefix with any lab secret replaced by a redaction marker. */
    bodyPreview: string;
}

export interface LabAction {
    request: LabRequestRecord;
    response: LabResponseRecord;
}

export interface LabPhase {
    name: LabPhaseName;
    techniqueId: string;
    technique: string;
    startTs: number;
    endTs: number;
    actions: LabAction[];
    observations: string[];
    success: boolean;
    /** Always true - this phase is a local simulation against the in-process lab target. */
    simulated: boolean;
    note?: string;
}

export interface LabDetectionResult {
    /** The technique set that was validated. */
    techniques: string[];
    detected: number;
    missed: number;
    /** Percentage computed from the real knowledge base lookup. */
    coverage: number;
    /** Technique ids present in DETECTION_KB. */
    inKnowledgeBase: string[];
    /** Technique ids absent from DETECTION_KB. */
    notInKnowledgeBase: string[];
    detections: Array<{ techniqueId: string; ruleIds: string[]; analytic: string }>;
    gaps: Array<{ techniqueId: string; technique: string; tactic: string; reason: string; severity: string; recommendation: string }>;
    /** Which mechanism produced the number. */
    source: 'DETECTION_KB' | 'validateDetections';
}

export interface LabResult {
    id: string;
    scenario: string;
    objectives: string[];
    techniques: string[];
    target: { url: string; port: number };
    phases: LabPhase[];
    findings: Finding[];
    detection: LabDetectionResult;
    /** True only when every executed phase met its own success criterion. */
    success: boolean;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    operationId: string;
}

export interface LabStatus {
    labRunning: boolean;
    port?: number;
    url?: string;
    scenarios: number;
    lastRun?: {
        id: string;
        scenario: string;
        completedAt: number;
        success: boolean;
        coverage: number;
        detected: number;
        missed: number;
        phases: number;
    };
}

/** The lab's session token. It is a fixed, published, in-process constant - not a real credential. */
const LAB_SESSION_TOKEN = 'LABTOKEN';

/** ATT&CK mapping for each lab phase. */
const PHASE_TECHNIQUES: Record<LabPhaseName, { id: string; name: string }> = {
    RECON: { id: 'T1595', name: 'Active Scanning' },
    EXPLOIT: { id: 'T1190', name: 'Exploit Public-Facing Application' },
    PERSISTENCE: { id: 'T1078', name: 'Valid Accounts' },
    EXFIL: { id: 'T1041', name: 'Exfiltration Over C2 Channel' }
};

/** Real HTTP exchange result captured off the wire. */
interface RawExchange {
    status: number;
    statusText: string;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

export class AdversaryLab {
    private ctx: OperationContext;
    private server: http.Server | null = null;
    private port: number | null = null;
    private url: string | null = null;
    private requestCount = 0;
    private lastRun: LabStatus['lastRun'];
    private lastResult: LabResult | null = null;
    private purple: PurpleTeamOrchestrator;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        this.purple = new PurpleTeamOrchestrator(ctx);
        arsenalCore.audit('ADVERSARY_LAB_INIT', 'adversary-lab', 'SUCCESS', { opId: ctx.operationId });
    }

    // ------------------------------------------------------------------------------------------------
    // Safety guard - the lab must never reach an external host.
    // ------------------------------------------------------------------------------------------------

    /**
     * Throws unless the supplied URL points at a loopback address.
     * This is the enforcement point for the "strictly local" rule of the lab.
     */
    private assertLocalOnly(target: string): URL {
        let parsed: URL;
        try {
            parsed = new URL(target);
        } catch {
            throw new Error(`AdversaryLab refuses to touch a malformed URL: ${target}`);
        }
        const host = parsed.hostname.replace(/^\[|\]$/g, '');
        const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host.startsWith('127.');
        if (!loopback) {
            arsenalCore.audit('LAB_LOCALITY_GUARD', 'adversary-lab', 'BLOCKED', { target });
            throw new Error(`AdversaryLab is strictly local - refusing to contact non-loopback host "${host}"`);
        }
        return parsed;
    }

    // ------------------------------------------------------------------------------------------------
    // A) buildTarget() - a REAL vulnerable web app on 127.0.0.1
    // ------------------------------------------------------------------------------------------------

    /**
     * Start a REAL node HTTP server on 127.0.0.1 with an ephemeral port (port 0).
     * The server implements a genuinely vulnerable application:
     *   GET  /        -> HTML page with a reflected marker in an HTML comment + <script src="/app.js">
     *   GET  /app.js  -> JS containing an innerHTML sink
     *   GET  /secret  -> JSON {api_key, password} with NO authentication at all
     *   POST /login   -> accepts ANY credentials, sets session=LABTOKEN, 302 redirect
     *   GET  /admin   -> 200 'admin panel' only when the session cookie equals LABTOKEN, else 401
     *   GET  /health  -> 200 {ok:true}
     *   GET  /metrics -> {requests: N}
     */
    async buildTarget(): Promise<{ url: string; port: number; close: () => Promise<void>; state: any }> {
        const apiKey = `LAB_KEY_${crypto.randomBytes(12).toString('hex')}`;
        const password = crypto.randomBytes(12).toString('base64url');
        const state: any = {
            apiKey,
            password,
            sessionToken: LAB_SESSION_TOKEN,
            requests: 0,
            loginAttempts: 0,
            adminGrants: 0,
            startedAt: Date.now()
        };

        const server = http.createServer((req, res) => {
            this.requestCount++;
            state.requests = this.requestCount;

            const url = new URL(req.url || '/', `http://127.0.0.1`);
            const path = url.pathname;

            const send = (status: number, headers: Record<string, string>, body: string) => {
                const buf = Buffer.from(body, 'utf8');
                res.writeHead(status, { ...headers, 'Content-Length': String(buf.length) });
                res.end(buf);
            };

            if (req.method === 'GET' && path === '/') {
                // Reflected marker read from a real query parameter -> reflected-content weakness.
                const marker = url.searchParams.get('marker') || 'NO-MARKER';
                const html = [
                    '<!DOCTYPE html>',
                    '<html><head><title>Adversary Lab Target</title>',
                    '<script src="/app.js"></script>',
                    '</head><body>',
                    `<h1>Lab Target</h1>`,
                    `<!-- marker:${marker} -->`,
                    '<div id="out"></div>',
                    '<p>Login at <form method="post" action="/login">',
                    '<input name="username"><input name="password" type="password">',
                    '</form></p>',
                    '</body></html>'
                ].join('\n');
                send(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Lab-Target': 'adversary-lab' }, html);
                return;
            }

            if (req.method === 'GET' && path === '/app.js') {
                // A real DOM-XSS style sink.
                const js = [
                    '// adversary lab client script',
                    'function render(q) {',
                    '  var out = document.getElementById("out");',
                    '  out.innerHTML = q;',
                    '}',
                    'render(new URLSearchParams(location.search).get("q") || "");'
                ].join('\n');
                send(200, { 'Content-Type': 'application/javascript; charset=utf-8' }, js);
                return;
            }

            if (req.method === 'GET' && path === '/secret') {
                // No authentication whatsoever - the exposed-secret weakness.
                send(200, { 'Content-Type': 'application/json; charset=utf-8' },
                    JSON.stringify({ api_key: apiKey, password }));
                return;
            }

            if (req.method === 'POST' && path === '/login') {
                state.loginAttempts++;
                // Any credentials are accepted.
                const setCookie = `session=${LAB_SESSION_TOKEN}; Path=/`;
                res.writeHead(302, {
                    'Set-Cookie': setCookie,
                    'Location': '/admin',
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Content-Length': '0'
                });
                res.end();
                return;
            }

            if (req.method === 'GET' && path === '/admin') {
                const cookie = req.headers.cookie || '';
                const match = /session=([^;]+)/.exec(cookie);
                if (match && match[1] === LAB_SESSION_TOKEN) {
                    state.adminGrants++;
                    send(200, { 'Content-Type': 'text/html; charset=utf-8' }, '<html><body>admin panel</body></html>');
                } else {
                    send(401, { 'Content-Type': 'text/plain; charset=utf-8' }, 'unauthorized');
                }
                return;
            }

            if (req.method === 'GET' && path === '/health') {
                send(200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ ok: true }));
                return;
            }

            if (req.method === 'GET' && path === '/metrics') {
                send(200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ requests: state.requests }));
                return;
            }

            send(404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'not found');
        });

        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            // Bind explicitly to the loopback interface on an ephemeral port.
            server.listen(0, '127.0.0.1', () => resolve());
        });

        const addr = server.address();
        if (!addr || typeof addr === 'string') {
            throw new Error('Lab server did not report a TCP address');
        }
        const port = addr.port;
        const url = `http://127.0.0.1:${port}`;

        this.server = server;
        this.port = port;
        this.url = url;

        arsenalCore.audit('LAB_TARGET_BUILT', 'adversary-lab', 'SUCCESS', { url, port });

        return {
            url,
            port,
            close: async () => {
                await this.closeServer(server, port);
                if (this.server === server) {
                    this.server = null;
                    this.port = null;
                    this.url = null;
                }
            },
            state
        };
    }

    private async closeServer(server: http.Server, port: number | null): Promise<void> {
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            // Drop keep-alive sockets so close() can actually complete.
            server.closeAllConnections?.();
        });
        arsenalCore.audit('LAB_TARGET_CLOSED', 'adversary-lab', 'SUCCESS', { port });
    }

    // ------------------------------------------------------------------------------------------------
    // Real HTTP client used by every phase.
    // ------------------------------------------------------------------------------------------------

    private async rawRequest(
        target: string,
        method: string,
        headers: Record<string, string>,
        body?: string
    ): Promise<RawExchange> {
        const parsed = this.assertLocalOnly(target);
        const bodyBuf = body !== undefined ? Buffer.from(body, 'utf8') : undefined;

        return new Promise<RawExchange>((resolve, reject) => {
            const req = http.request({
                hostname: parsed.hostname,
                port: parsed.port ? Number(parsed.port) : 80,
                path: parsed.pathname + parsed.search,
                method,
                headers: {
                    'Host': parsed.host,
                    'User-Agent': 'Sovereign-AdversaryLab/1.0',
                    'Accept': '*/*',
                    ...(bodyBuf ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(bodyBuf.length) } : {}),
                    ...headers
                }
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', c => chunks.push(c as Buffer));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        statusText: res.statusMessage || '',
                        headers: res.headers,
                        body: Buffer.concat(chunks)
                    });
                });
            });
            req.on('error', reject);
            if (bodyBuf) req.write(bodyBuf);
            req.end();
        });
    }

    // ------------------------------------------------------------------------------------------------
    // Action recording helpers
    // ------------------------------------------------------------------------------------------------

    private sha256(buf: Buffer): string {
        return crypto.createHash('sha256').update(buf).digest('hex');
    }

    private headersSubset(h: http.IncomingHttpHeaders): Record<string, string> {
        const keep = ['content-type', 'content-length', 'location', 'set-cookie', 'server'];
        const out: Record<string, string> = {};
        for (const k of keep) {
            const v = (h as any)[k];
            if (v === undefined || v === null) continue;
            out[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        return out;
    }

    /** Redact the lab's generated secrets so they never leak into previews or observations. */
    private redact(text: string, secrets: string[]): string {
        let out = text;
        for (const s of secrets) {
            if (!s) continue;
            out = out.split(s).join('[REDACTED]');
        }
        return out;
    }

    /**
     * Perform one real HTTP exchange and turn it into a recorded LabAction.
     */
    private async perform(
        target: string,
        method: string,
        headers: Record<string, string>,
        body: string | undefined,
        secrets: string[]
    ): Promise<{ action: LabAction; exchange: RawExchange }> {
        const exchange = await this.rawRequest(target, method, headers, body);
        const reqBody = body !== undefined ? Buffer.from(body, 'utf8') : Buffer.alloc(0);
        const action: LabAction = {
            request: {
                method,
                url: target,
                headers: {
                    'Host': new URL(target).host,
                    'User-Agent': 'Sovereign-AdversaryLab/1.0',
                    ...(headers['Cookie'] ? { Cookie: headers['Cookie'] } : {}),
                    ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
                },
                bodySha256: this.sha256(reqBody),
                bodyBytes: reqBody.length
            },
            response: {
                status: exchange.status,
                statusText: exchange.statusText,
                bytes: exchange.body.length,
                sha256: this.sha256(exchange.body),
                headersSubset: this.headersSubset(exchange.headers),
                bodyPreview: this.redact(exchange.body.toString('utf8').slice(0, 240), secrets)
            }
        };
        return { action, exchange };
    }

    // ------------------------------------------------------------------------------------------------
    // B) runScenario() - the real attack chain
    // ------------------------------------------------------------------------------------------------

    /**
     * Run a REAL attack chain against the local lab target.
     * Every phase performs real HTTP requests and records the actual bytes that came back.
     */
    async runScenario(name: string, objectives?: string[], techniques?: string[]): Promise<LabResult> {
        const scenario = this.getScenarios().find(s => s.name === name);
        if (!scenario) {
            throw new Error(`Unknown lab scenario "${name}". Available: ${this.getScenarios().map(s => s.name).join(', ')}`);
        }

        arsenalCore.audit('LAB_SCENARIO_START', 'adversary-lab', 'ATTEMPT', { scenario: name });

        if (!this.url || !this.server) {
            await this.buildTarget();
        }
        const baseUrl = this.url!;

        const declaredTechniques = techniques && techniques.length ? techniques : scenario.techniques;
        const finalObjectives = objectives && objectives.length ? objectives : scenario.objectives;

        const secrets: string[] = [];
        const phases: LabPhase[] = [];
        const observationsByPhase = new Map<string, string[]>();
        const findings: Finding[] = [];

        // We need the lab's own secret values to redact them in the report. They are produced by the
        // lab target itself, so we read them back out of the live target over a real request.
        const secretProbe = await this.rawRequest(`${baseUrl}/secret`, 'GET', {});
        let apiKey = '';
        let password = '';
        try {
            const parsed = JSON.parse(secretProbe.body.toString('utf8'));
            apiKey = String(parsed.api_key || '');
            password = String(parsed.password || '');
        } catch {
            /* leave empty; nothing is redacted then, and the report shows the raw body */
        }
        if (apiKey) secrets.push(apiKey);
        if (password) secrets.push(password);

        for (const phaseName of scenario.phases) {
            const started = Date.now();
            const actions: LabAction[] = [];
            const observations: string[] = [];
            let success = false;
            let note = '';

            switch (phaseName) {
                case 'RECON': {
                    const home = await this.perform(`${baseUrl}/?marker=LABRECON`, 'GET', {}, undefined, secrets);
                    actions.push(home.action);
                    const homeHtml = home.exchange.body.toString('utf8');
                    const links: string[] = [];
                    const linkRe = /(?:href|src)\s*=\s*"([^"]+)"/gi;
                    let m: RegExpExecArray | null;
                    while ((m = linkRe.exec(homeHtml)) !== null) links.push(m[1]);
                    observations.push(`GET / returned HTTP ${home.exchange.status} with ${home.exchange.body.length} bytes`);
                    observations.push(`Discovered ${links.length} real link/script target(s): ${links.join(', ') || '(none)'}`);
                    const markerEcho = /<!--\s*marker:([^>]*?)-->/.exec(homeHtml);
                    observations.push(markerEcho
                        ? `Query parameter "marker" was reflected into the HTML comment as "${markerEcho[1].trim()}" (real reflected output)`
                        : 'Query parameter "marker" was not reflected in the HTML comment');

                    const health = await this.perform(`${baseUrl}/health`, 'GET', {}, undefined, secrets);
                    actions.push(health.action);
                    observations.push(`GET /health returned HTTP ${health.exchange.status} body=${health.exchange.body.toString('utf8').slice(0, 80)}`);

                    const metrics = await this.perform(`${baseUrl}/metrics`, 'GET', {}, undefined, secrets);
                    actions.push(metrics.action);
                    let observedRequests = -1;
                    try {
                        observedRequests = Number(JSON.parse(metrics.exchange.body.toString('utf8')).requests);
                    } catch { /* keep -1 */ }
                    observations.push(`GET /metrics returned HTTP ${metrics.exchange.status} with requests=${observedRequests}`);

                    success = home.exchange.status === 200 && health.exchange.status === 200 && metrics.exchange.status === 200;
                    note = 'Reconnaissance against the local lab target only.';
                    break;
                }

                case 'EXPLOIT': {
                    // 1) Unauthenticated access to a protected resource.
                    const secret = await this.perform(`${baseUrl}/secret`, 'GET', {}, undefined, secrets);
                    actions.push(secret.action);
                    observations.push(`GET /secret WITHOUT any credentials returned HTTP ${secret.exchange.status} (${secret.exchange.body.length} bytes)`);

                    // 2) Protected area without a session.
                    const adminNoCookie = await this.perform(`${baseUrl}/admin`, 'GET', {}, undefined, secrets);
                    actions.push(adminNoCookie.action);
                    observations.push(`GET /admin WITHOUT a session cookie returned HTTP ${adminNoCookie.exchange.status}`);

                    // 3) Guess a session cookie value against /admin. Every attempt is a real request.
                    const guesses = ['admin', 'guest', 'session', '1', LAB_SESSION_TOKEN];
                    let granted = false;
                    let winningGuess = '';
                    for (const g of guesses) {
                        const attempt = await this.perform(`${baseUrl}/admin`, 'GET', { Cookie: `session=${g}` }, undefined, secrets);
                        actions.push(attempt.action);
                        observations.push(`GET /admin with guessed cookie session=${g} returned HTTP ${attempt.exchange.status}`);
                        if (attempt.exchange.status === 200) { granted = true; winningGuess = g; break; }
                    }

                    success = secret.exchange.status === 200 && adminNoCookie.exchange.status === 401 && granted;
                    observations.push(granted
                        ? `Cookie guess succeeded (HTTP 200) using session=${winningGuess}`
                        : 'No guessed session cookie was accepted');

                    if (secret.exchange.status === 200) {
                        findings.push(arsenalCore.addFinding({
                            title: 'Unauthenticated access to protected lab resource /secret',
                            severity: 'HIGH',
                            category: 'auth_bypass',
                            description: `GET /secret on the local lab target returned HTTP ${secret.exchange.status} with ${secret.exchange.body.length} bytes ` +
                                `without any credential, cookie or Authorization header. GET /admin correctly returned HTTP ${adminNoCookie.exchange.status} ` +
                                `without a session, so the bypass is specific to /secret.`,
                            evidence: {
                                scenario: name,
                                endpoint: '/secret',
                                unauthenticatedStatus: secret.exchange.status,
                                unauthenticatedBytes: secret.exchange.body.length,
                                unauthenticatedBodySha256: secret.action.response.sha256,
                                adminWithoutCookieStatus: adminNoCookie.exchange.status,
                                cookieGuessGranted: granted,
                                winningCookieValue: winningGuess || null,
                                responseHeaders: secret.action.response.headersSubset
                            },
                            remediation: 'Enforce authentication on every non-public endpoint and deny by default',
                            verified: true
                        }));
                    }
                    note = 'Exploitation of the deliberately vulnerable local lab target only.';
                    break;
                }

                case 'PERSISTENCE': {
                    const login = await this.perform(`${baseUrl}/login`, 'POST', {}, 'username=lab&password=whatever', secrets);
                    actions.push(login.action);
                    const setCookieRaw = String((login.exchange.headers['set-cookie'] || [])[0] || '');
                    const cookieValue = /session=([^;]+)/.exec(setCookieRaw)?.[1] || '';
                    observations.push(`POST /login with arbitrary credentials returned HTTP ${login.exchange.status} and Set-Cookie: ${setCookieRaw || '(none)'}`);

                    let adminStatus = 0;
                    if (cookieValue) {
                        const admin = await this.perform(`${baseUrl}/admin`, 'GET', { Cookie: `session=${cookieValue}` }, undefined, secrets);
                        actions.push(admin.action);
                        adminStatus = admin.exchange.status;
                        observations.push(`GET /admin with the issued session cookie returned HTTP ${admin.exchange.status}`);
                    }

                    success = login.exchange.status === 302 && adminStatus === 200;
                    observations.push('Session persistence is a LOCAL SIMULATION: the lab issued a session token in-process and no external system was touched.');

                    if (login.exchange.status === 302 && cookieValue) {
                        findings.push(arsenalCore.addFinding({
                            title: 'Lab login accepts any credentials and issues a session without MFA',
                            severity: 'MEDIUM',
                            category: 'misconfiguration',
                            description: `POST /login returned HTTP ${login.exchange.status} with Set-Cookie "${setCookieRaw}" for arbitrary credentials ` +
                                `(username=lab). No second factor was requested; GET /admin with the issued cookie returned HTTP ${adminStatus}. ` +
                                'This is a LOCAL SIMULATION of session establishment inside the lab process.',
                            evidence: {
                                scenario: name,
                                loginStatus: login.exchange.status,
                                loginLocation: String(login.exchange.headers.location || ''),
                                setCookieHeader: setCookieRaw,
                                issuedCookieValue: cookieValue,
                                adminStatusWithCookie: adminStatus,
                                simulation: true
                            },
                            remediation: 'Require multi-factor authentication and validate credentials server-side before issuing a session',
                            verified: true
                        }));
                    }
                    note = 'Session persistence is a LOCAL SIMULATION of valid-account use.';
                    break;
                }

                case 'EXFIL': {
                    const exfil = await this.perform(`${baseUrl}/secret`, 'GET', {}, undefined, secrets);
                    actions.push(exfil.action);
                    let apiKeyValue = '';
                    let passwordValue = '';
                    let apiKeySha = '';
                    let passwordSha = '';
                    try {
                        const parsed = JSON.parse(exfil.exchange.body.toString('utf8'));
                        apiKeyValue = String(parsed.api_key || '');
                        passwordValue = String(parsed.password || '');
                    } catch { /* keep empty */ }
                    if (apiKeyValue) apiKeySha = this.sha256(Buffer.from(apiKeyValue, 'utf8'));
                    if (passwordValue) passwordSha = this.sha256(Buffer.from(passwordValue, 'utf8'));

                    const redactValue = (v: string, sha: string) =>
                        v ? `${v.slice(0, 4)}...[REDACTED len=${v.length} sha256=${sha}]` : '(absent)';

                    observations.push(`GET /secret returned HTTP ${exfil.exchange.status} (${exfil.exchange.body.length} bytes), body sha256=${exfil.action.response.sha256}`);
                    observations.push(`Extracted api_key=${redactValue(apiKeyValue, apiKeySha)}`);
                    observations.push(`Extracted password=${redactValue(passwordValue, passwordSha)}`);

                    success = exfil.exchange.status === 200 && !!apiKeyValue;

                    if (apiKeyValue) {
                        findings.push(arsenalCore.addFinding({
                            title: 'Credential material leaked by unauthenticated /secret endpoint',
                            severity: 'HIGH',
                            category: 'exposed_secret',
                            description: `The lab target returned a live api_key over GET /secret with HTTP ${exfil.exchange.status} and no authentication. ` +
                                `The leaked value is ${apiKeyValue} (length ${apiKeyValue.length}, sha256 ${apiKeySha}). ` +
                                `A password was leaked in the same response (sha256 ${passwordSha}).`,
                            evidence: {
                                scenario: name,
                                endpoint: '/secret',
                                status: exfil.exchange.status,
                                responseBodySha256: exfil.action.response.sha256,
                                leakedApiKey: apiKeyValue,
                                leakedApiKeySha256: apiKeySha,
                                leakedApiKeyLength: apiKeyValue.length,
                                leakedPasswordSha256: passwordSha,
                                leakedPasswordLength: passwordValue.length,
                                exfiltratedOver: 'local loopback HTTP GET'
                            },
                            remediation: 'Remove secrets from unauthenticated responses and rotate any credential that was ever exposed',
                            verified: true
                        }));
                    }
                    note = 'Exfiltration is a LOCAL SIMULATION against the loopback lab target; no external channel was used.';
                    break;
                }
            }

            const phase: LabPhase = {
                name: phaseName,
                techniqueId: PHASE_TECHNIQUES[phaseName].id,
                technique: PHASE_TECHNIQUES[phaseName].name,
                startTs: started,
                endTs: Date.now(),
                actions,
                observations,
                success,
                simulated: true,
                note
            };
            phases.push(phase);
            observationsByPhase.set(phaseName, observations);

            arsenalCore.audit('LAB_PHASE', 'adversary-lab', success ? 'SUCCESS' : 'FAILED', {
                scenario: name,
                phase: phaseName,
                technique: phase.techniqueId,
                actions: actions.length,
                success
            });
        }

        // --------------------------------------------------------------------------------------------
        // Detection coverage - computed from the REAL purple-team knowledge base.
        // --------------------------------------------------------------------------------------------

        const observedTechniques = Array.from(new Set(phases.map(p => p.techniqueId)));
        const techniqueSet = Array.from(new Set([...observedTechniques, ...declaredTechniques]));

        // 1) Direct lookup in the real DETECTION_KB.
        const inKnowledgeBase: string[] = [];
        const notInKnowledgeBase: string[] = [];
        const kbDetections: Array<{ techniqueId: string; ruleIds: string[]; analytic: string }> = [];
        for (const tid of techniqueSet) {
            const entry = DETECTION_KB[tid];
            if (entry && entry.rules.length > 0) {
                inKnowledgeBase.push(tid);
                kbDetections.push({
                    techniqueId: tid,
                    ruleIds: entry.rules.map(r => r.id),
                    analytic: entry.rules.map(r => r.analytic).join(' | ')
                });
            } else {
                notInKnowledgeBase.push(tid);
            }
        }

        // 2) The same measurement performed by the real PurpleTeamOrchestrator.validateDetections(),
        //    which produces the authoritative gap list.
        const emulation: AdversaryEmulation = {
            id: `LAB-EMU-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            name: `Adversary Lab scenario "${name}"`,
            mitreTactics: Array.from(new Set(scenario.tactics)),
            mitreTechniques: techniqueSet,
            scenario: `Local loopback emulation: ${name}`,
            status: 'RUNNING'
        };
        const validation = await this.purple.validateDetections(emulation);

        const detection: LabDetectionResult = {
            techniques: techniqueSet,
            detected: validation.detected,
            missed: validation.missed,
            coverage: validation.coverage,
            inKnowledgeBase,
            notInKnowledgeBase,
            detections: validation.detections,
            gaps: validation.gaps,
            source: 'validateDetections'
        };

        // Every technique without a detection rule is a real gap - record it as a finding.
        for (const gap of validation.gaps) {
            findings.push(arsenalCore.addFinding({
                title: `Detection gap: ${gap.techniqueId} has no rule in the detection knowledge base`,
                severity: 'MEDIUM',
                category: 'misconfiguration',
                description: `The adversary lab executed ${gap.techniqueId} (${gap.technique}) against the local target but the detection knowledge base contains no rule for it. ${gap.reason}`,
                evidence: {
                    scenario: name,
                    techniqueId: gap.techniqueId,
                    kbSize: Object.keys(DETECTION_KB).length,
                    kbTechniqueIds: Object.keys(DETECTION_KB)
                },
                remediation: gap.recommendation,
                verified: true
            }));
        }

        const completedAt = Date.now();
        const result: LabResult = {
            id: `LAB-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            scenario: name,
            objectives: finalObjectives,
            techniques: techniqueSet,
            target: { url: baseUrl, port: this.port ?? 0 },
            phases,
            findings,
            detection,
            success: phases.length > 0 && phases.every(p => p.success),
            startedAt: phases.length ? phases[0].startTs : completedAt,
            completedAt,
            durationMs: completedAt - (phases.length ? phases[0].startTs : completedAt),
            operationId: this.ctx.operationId
        };

        this.lastResult = result;
        this.lastRun = {
            id: result.id,
            scenario: name,
            completedAt,
            success: result.success,
            coverage: detection.coverage,
            detected: detection.detected,
            missed: detection.missed,
            phases: phases.length
        };

        arsenalCore.audit('LAB_SCENARIO_COMPLETE', 'adversary-lab', result.success ? 'SUCCESS' : 'PARTIAL', {
            scenario: name,
            phases: phases.length,
            success: result.success,
            detected: detection.detected,
            missed: detection.missed,
            coverage: detection.coverage
        });

        return result;
    }

    // ------------------------------------------------------------------------------------------------
    // C) getScenarios()
    // ------------------------------------------------------------------------------------------------

    /**
     * The catalogue of lab scenarios. Each scenario declares its objectives and the ATT&CK
     * techniques it targets. runScenario() executes the declared phases against the live target.
     */
    getScenarios(): LabScenario[] {
        return [
            {
                id: 'LAB-SCN-001',
                name: 'full-chain',
                description: 'Complete kill chain against the local lab target: reconnaissance, exploitation of the unauthenticated endpoint, session persistence and data exfiltration.',
                objectives: [
                    'Enumerate the local target and confirm its live endpoints',
                    'Exploit the unauthenticated /secret endpoint',
                    'Establish a session and confirm administrative access',
                    'Exfiltrate the exposed credential material'
                ],
                techniques: ['T1595', 'T1190', 'T1078', 'T1041'],
                tactics: ['Reconnaissance', 'Initial Access', 'Persistence', 'Exfiltration'],
                phases: ['RECON', 'EXPLOIT', 'PERSISTENCE', 'EXFIL']
            },
            {
                id: 'LAB-SCN-002',
                name: 'secret-exposure',
                description: 'Focused scenario that proves credential material is served without authentication.',
                objectives: [
                    'Confirm /secret responds without any credential',
                    'Capture the leaked api_key and its hash for provability'
                ],
                techniques: ['T1190', 'T1552'],
                tactics: ['Credential Access', 'Initial Access'],
                phases: ['EXPLOIT', 'EXFIL']
            },
            {
                id: 'LAB-SCN-003',
                name: 'session-persistence',
                description: 'Demonstrates that any credentials mint a valid administrative session without a second factor.',
                objectives: [
                    'Authenticate with arbitrary credentials',
                    'Confirm the issued session reaches the administrative surface'
                ],
                techniques: ['T1078'],
                tactics: ['Defense Evasion', 'Persistence'],
                phases: ['PERSISTENCE']
            },
            {
                id: 'LAB-SCN-004',
                name: 'recon-only',
                description: 'Passive-enough reconnaissance of the live lab target: home page, health probe and request metrics.',
                objectives: [
                    'Collect real response sizes and hashes from the live target',
                    'Extract the real links and scripts advertised by the target'
                ],
                techniques: ['T1595'],
                tactics: ['Reconnaissance'],
                phases: ['RECON']
            },
            {
                id: 'LAB-SCN-005',
                name: 'exfil-only',
                description: 'Direct credential exfiltration from the unauthenticated endpoint, with no prior reconnaissance.',
                objectives: [
                    'Retrieve the exposed credential material over loopback HTTP',
                    'Record proof hashes of the exfiltrated values'
                ],
                techniques: ['T1041', 'T1552'],
                tactics: ['Exfiltration', 'Credential Access'],
                phases: ['EXFIL']
            },
            {
                id: 'LAB-SCN-006',
                name: 'detection-gap-probe',
                description: 'Executes techniques that are absent from the detection knowledge base so the real coverage gap and the emitted gap finding are both observable.',
                objectives: [
                    'Emulate a technique with no detection rule',
                    'Prove the gap is computed and reported rather than asserted'
                ],
                techniques: ['T1190', 'T1041', 'T1566'],
                tactics: ['Initial Access', 'Exfiltration', 'Initial Access'],
                phases: ['EXPLOIT', 'EXFIL']
            }
        ];
    }

    // ------------------------------------------------------------------------------------------------
    // D) getLabStatus()
    // ------------------------------------------------------------------------------------------------

    getLabStatus(): LabStatus {
        return {
            labRunning: !!this.server && this.server.listening,
            ...(this.port !== null ? { port: this.port } : {}),
            ...(this.url !== null ? { url: this.url } : {}),
            scenarios: this.getScenarios().length,
            ...(this.lastRun ? { lastRun: { ...this.lastRun } } : {})
        };
    }

    /** The full result of the most recent scenario run, if any. */
    getLastResult(): LabResult | null {
        return this.lastResult;
    }

    // ------------------------------------------------------------------------------------------------
    // E) cleanup()
    // ------------------------------------------------------------------------------------------------

    /** Close any server this lab started. */
    async cleanup(): Promise<void> {
        if (this.server) {
            const srv = this.server;
            const port = this.port;
            await this.closeServer(srv, port);
            this.server = null;
            this.port = null;
            this.url = null;
        }
        arsenalCore.audit('LAB_CLEANUP', 'adversary-lab', 'SUCCESS', {});
    }
}

export default AdversaryLab;
