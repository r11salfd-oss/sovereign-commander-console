/**
 * ====================================================================================================
 * WEB ARSENAL - WEB APPLICATION SECURITY TESTING
 * ====================================================================================================
 * HONESTY CONTRACT (enforced by this module):
 *  - Every check performs a REAL HTTP request and reports ONLY what was observed in the real
 *    response (status, headers, body, elapsed time).
 *  - If a probe could not be executed (target unreachable, out of scope, no injection point),
 *    the result carries `verified: false` and an explicit `reason`. Nothing is ever fabricated.
 *  - A finding is recorded only when a real observation supports it.
 *  - DOM XSS is reported as STATIC RISK ONLY - it cannot be confirmed without a browser engine.
 * SAFETY CONTRACT:
 *  - Every probe is gated by the operation scope (`ctx.scope`). Out-of-scope hosts are refused
 *    and the refusal is audited.
 *  - Probes are read-only (GET/OPTIONS/HEAD plus POST into discovered forms) and are capped
 *    per method call to stay inside the engagement request budget.
 * ====================================================================================================
 */

import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { arsenalCore, OperationContext, SeverityLevel } from '../core/arsenal_core';

export interface WebTarget {
    url: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
}

export interface CrawlResult {
    url: string;
    status: number;
    contentType: string;
    title: string;
    length: number;
    server?: string;
    error?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Result contracts
 * ---------------------------------------------------------------------------------------------- */

export interface HttpObservation {
    url: string;
    finalUrl: string;
    method: string;
    status: number;
    headers: Record<string, string>;
    body: string;
    length: number;
    elapsedMs: number;
    redirected: boolean;
    error?: string;
}

export interface SQLiBaseline {
    url: string;
    status: number;
    length: number;
    bodyHash: string;
    elapsedMs: number;
}

export interface SQLiPayloadResult {
    payload: string;
    technique: 'error' | 'boolean' | 'time' | 'control';
    status: number;
    length: number;
    elapsedMs: number;
    signal: string;
    evidence: string;
}

export interface SQLiTestResult {
    vulnerable: boolean;
    verified: boolean;
    parameter: string;
    baseline: SQLiBaseline | null;
    payloadsTested: SQLiPayloadResult[];
    detectionMethod: 'error' | 'boolean' | 'time' | 'none';
    confidence: number;
    reason?: string;
}

export interface XssProbeResult {
    url: string;
    param: string;
    payload: string;
    markerFound: boolean;
    encoded: boolean;
    raw: boolean;
    status: number;
    length: number;
}

export interface XssReflectedResult {
    vulnerable: boolean;
    verified: boolean;
    reflected: boolean;
    reflected_but_encoded: boolean;
    marker: string;
    probes: XssProbeResult[];
    evidence: { marker: string; hits: Array<{ url: string; param: string; payload: string; status: number; excerpt: string }> };
    reason?: string;
}

export interface XssStoredAttempt {
    action: string;
    method: string;
    fields: string[];
    postedStatus: number;
    postedBytes: number;
    location?: string;
    markerFoundAfter: boolean;
    checkedUrls: string[];
    error?: string;
}

export interface XssStoredResult {
    vulnerable: boolean;
    verified: boolean;
    marker: string;
    attempts: XssStoredAttempt[];
    evidence: { marker: string; observedAt: string[]; excerpt?: string };
    reason?: string;
}

export interface DomSinkHit {
    file: string;
    line: number;
    pattern: string;
    source: string;
    snippet: string;
}

export interface XssDomResult {
    vulnerable: false;
    verified: false;
    method: 'static-analysis';
    sinks: DomSinkHit[];
    filesScanned: string[];
    note: string;
    reason?: string;
}

export interface ExposedResource {
    path: string;
    status: number;
    finalUrl: string;
    bodyBytes: number;
    contentType?: string;
    secretLike?: boolean;
}

export interface BypassAttempt {
    path: string;
    status: number;
    result: string;
    bodyBytes: number;
}

export interface AuthBypassResult {
    bypassed: boolean;
    exposed: ExposedResource[];
    protected: Array<{ path: string; status: number }>;
    absent: Array<{ path: string; status: number }>;
    redirect: Array<{ path: string; status: number; finalStatus: number; finalUrl: string }>;
    other: Array<{ path: string; status: number; error?: string }>;
    bypassAttempts: BypassAttempt[];
    methods: { options: { status: number; allow?: string; error?: string }; trace: { status: number; bodyBytes: number; error?: string } };
    reason?: string;
}

export interface ApiEndpoint {
    url: string;
    status: number;
    headers: Record<string, string>;
    bodyBytes: number;
    redirected: boolean;
    contentType?: string;
}

export interface ApiVulnerability {
    url: string;
    type: string;
    severity: SeverityLevel;
    detail: string;
    evidence: any;
}

export interface ApiScanResult {
    endpoints: ApiEndpoint[];
    vulnerabilities: ApiVulnerability[];
    checked: number;
    reason?: string;
}

export interface RateLimitResult {
    rateLimited: boolean;
    requests: number;
    statusCounts: Record<string, number>;
    firstAvgMs: number;
    lastAvgMs: number;
    latencyGrowthMs: number;
    lockoutDetected: boolean;
    sensitiveTarget: boolean;
    verdict: string;
    limited?: boolean;
    bypassable?: boolean;
    reason?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------------------------------- */

/** Common paths used for directory discovery. */
const DIR_WORDLIST = [
    'admin', 'login', 'logout', 'api', 'dashboard', 'config', 'backup', 'test',
    'debug', 'console', 'status', 'health', 'info.php', 'phpmyadmin', '.env',
    '.git/HEAD', 'wp-admin', 'server-status', 'actuator', 'graphql'
];

/** Real DB error signatures observed in response bodies (case-insensitive). */
const DB_ERROR_SIGNATURES = [
    'sql syntax', 'mysql_fetch', 'mysqli_', 'ora-', 'postgresql', 'pg_query',
    'sqlite/jdbcdriver', 'unclosed quotation mark', 'warning: mysql_'
];

/** Sensitive paths probed by AuthBypass with their honest classification when exposed. */
const SENSITIVE_PATHS: Array<{
    path: string;
    severity: SeverityLevel;
    category: 'auth_bypass' | 'exposed_secret' | 'none';
    note: string;
}> = [
    { path: '/.env',                 severity: 'CRITICAL', category: 'exposed_secret', note: 'environment file may contain API keys and credentials' },
    { path: '/.git/config',          severity: 'CRITICAL', category: 'exposed_secret', note: 'git configuration exposes repository remotes and possibly credentials' },
    { path: '/.git/HEAD',            severity: 'HIGH',     category: 'auth_bypass',   note: 'git metadata is publicly readable' },
    { path: '/wp-admin/',            severity: 'HIGH',     category: 'auth_bypass',   note: 'WordPress administration surface is publicly reachable' },
    { path: '/phpmyadmin/',          severity: 'HIGH',     category: 'auth_bypass',   note: 'phpMyAdmin database console is publicly reachable' },
    { path: '/admin',                severity: 'HIGH',     category: 'auth_bypass',   note: 'administration surface is publicly reachable' },
    { path: '/administrator',        severity: 'HIGH',     category: 'auth_bypass',   note: 'administration surface is publicly reachable' },
    { path: '/server-status',        severity: 'MEDIUM',   category: 'auth_bypass',   note: 'server status page is publicly reachable' },
    { path: '/server-info',          severity: 'MEDIUM',   category: 'auth_bypass',   note: 'server information page is publicly reachable' },
    { path: '/actuator/env',         severity: 'CRITICAL', category: 'exposed_secret', note: 'Spring actuator exposes environment properties' },
    { path: '/actuator/health',      severity: 'MEDIUM',   category: 'auth_bypass',   note: 'Spring actuator health endpoint is publicly reachable' },
    { path: '/api/v1/users',         severity: 'HIGH',     category: 'auth_bypass',   note: 'user listing API is reachable without authentication' },
    { path: '/config.json',          severity: 'HIGH',     category: 'exposed_secret', note: 'configuration file is publicly readable' },
    { path: '/backup.zip',           severity: 'HIGH',     category: 'exposed_secret', note: 'backup archive is publicly readable' },
    { path: '/dump.sql',             severity: 'CRITICAL', category: 'exposed_secret', note: 'database dump is publicly readable' },
    { path: '/robots.txt',           severity: 'INFO',     category: 'none',          note: 'robots.txt is informational' },
    { path: '/sitemap.xml',          severity: 'INFO',     category: 'none',          note: 'sitemap.xml is informational' }
];

/** Path-normalisation bypass attempts applied to a protected administrative path. */
const BYPASS_ATTEMPTS = [
    '/admin/..;/admin',
    '/admin%2f..%2fadmin',
    '/ADMIN',
    '/admin/.',
    '//admin',
    '/admin%00'
];

/** API endpoint candidates probed by APISecurity.scanEndpoints. */
const API_CANDIDATES = [
    '/api', '/api/v1', '/api/v2', '/graphql', '/openapi.json', '/swagger.json',
    '/swagger-ui/', '/health', '/metrics', '/info', '/debug', '/actuator', '/status'
];

/** Paths that should never be reachable anonymously. */
const SENSITIVE_API_PATHS = ['/metrics', '/actuator', '/debug', '/graphql', '/swagger', '/actuator/env'];

/** Security headers expected on an hardened web surface. */
const SECURITY_HEADERS = [
    'x-frame-options',
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options'
];

/** Body markers that indicate verbose server-side error output. */
const VERBOSE_ERROR_PATTERNS = [
    /at .+\(.+:\d+:\d+\)/,
    /Traceback \(most recent call last\)/,
    /Exception\b/,
    /java\.lang\./,
    /node_modules/,
    /SQLSTATE\[/
];

/** Body markers that indicate credential-ish data returned to an anonymous caller. */
const SENSITIVE_DATA_MARKERS = ['password', 'token', 'secret', 'api_key', 'email'];

/** DOM sinks (write operations that can execute attacker controlled data). */
const DOM_SINKS = [
    '.innerHTML =', '.outerHTML =', 'document.write(', 'eval(', 'new Function(',
    'setTimeout("', "setTimeout('", 'setInterval("', "setInterval('"
];

/** DOM sources (attacker controllable data read inside the script). */
const DOM_SOURCES = [
    'location.hash', 'location.search', 'document.URL', 'document.location',
    'postMessage(', 'event.data', 'e.data', 'message.data'
];

const USER_AGENT = 'Sovereign-Arsenal/1.2';

/* ------------------------------------------------------------------------------------------------
 * Low level helpers
 * ---------------------------------------------------------------------------------------------- */

function sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function randomId(prefix: string, bytes = 4): string {
    return prefix + crypto.randomBytes(bytes).toString('hex');
}

function headersToObject(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => { out[key.toLowerCase()] = value; });
    return out;
}

/**
 * Real HTTP observation. Uses the global fetch with an AbortController timeout.
 * `redirect: 'manual'` is used by default so that 3xx responses are observable
 * instead of being silently followed.
 */
async function observe(url: string, opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    redirect?: 'follow' | 'manual';
} = {}): Promise<HttpObservation> {
    const method = (opts.method || 'GET').toUpperCase();
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
        const res = await fetch(url, {
            method,
            headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) },
            body: opts.body,
            redirect: opts.redirect ?? 'manual',
            signal: controller.signal
        });
        const body = await res.text();
        return {
            url,
            finalUrl: res.url || url,
            method,
            status: res.status,
            headers: headersToObject(res.headers),
            body,
            length: body.length,
            elapsedMs: Date.now() - started,
            redirected: !!res.redirected
        };
    } catch (err: any) {
        const message = err?.name === 'AbortError'
            ? `timeout after ${timeoutMs}ms`
            : String(err?.message || err);
        return {
            url,
            finalUrl: url,
            method,
            status: 0,
            headers: {},
            body: '',
            length: 0,
            elapsedMs: Date.now() - started,
            redirected: false,
            error: message
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Raw HTTP request. Required for TRACE: the WHATWG fetch implementation forbids the
 * TRACE method, so a socket level request is the only honest way to observe it.
 */
function rawRequest(url: string, method: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    error?: string;
}> {
    return new Promise(resolve => {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch (e: any) {
            resolve({ status: 0, headers: {}, body: '', error: `invalid url: ${url}` });
            return;
        }
        const isHttps = parsed.protocol === 'https:';
        const mod = isHttps ? https : http;
        const req = mod.request({
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: (parsed.pathname || '/') + (parsed.search || ''),
            method: method.toUpperCase(),
            headers: { 'User-Agent': USER_AGENT, ...headers }
        }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { if (body.length < 64_000) body += chunk; });
            res.on('end', () => {
                const flat: Record<string, string> = {};
                for (const [k, v] of Object.entries(res.headers)) {
                    flat[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
                }
                resolve({ status: res.statusCode || 0, headers: flat, body });
            });
        });
        req.setTimeout(timeoutMs, () => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)); });
        req.on('error', (err: any) => resolve({ status: 0, headers: {}, body: '', error: String(err?.message || err) }));
        req.end();
    });
}

function setParam(url: string, param: string, value: string): string {
    const u = new URL(url);
    u.searchParams.set(param, value);
    return u.toString();
}

function encodeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function bodyExcerpt(body: string, needle: string, radius = 160): string {
    const idx = body.toLowerCase().indexOf(needle.toLowerCase());
    if (idx < 0) return body.slice(0, radius * 2).trim();
    const start = Math.max(0, idx - radius);
    return body.slice(start, Math.min(body.length, idx + needle.length + radius)).trim();
}

function lineOf(source: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') line++;
    return line;
}

interface ScopeDecision {
    allowed: boolean;
    host: string;
    reason: string;
}

/**
 * Scope gate. A host is only probeable when it is covered by `ctx.scope`.
 * Scope entries may be bare hosts, host:port, or full URLs.
 */
function evaluateScope(ctx: OperationContext, url: string): ScopeDecision {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { allowed: false, host: '', reason: `target url could not be parsed: ${url}` };
    }
    const host = parsed.hostname.toLowerCase();
    const hostPort = parsed.host.toLowerCase();
    const scope = Array.isArray(ctx.scope) ? ctx.scope : [];

    if (scope.length === 0) {
        return { allowed: false, host, reason: 'operation scope is empty - refusing to probe' };
    }

    for (const raw of scope) {
        if (typeof raw !== 'string') continue;
        let entry = raw.trim().toLowerCase();
        if (!entry) continue;
        if (entry.includes('://')) {
            try { entry = new URL(entry).host.toLowerCase(); }
            catch { entry = entry.replace(/^[a-z0-9+.-]+:\/\//, ''); }
        }
        entry = entry.replace(/^\/+/, '').replace(/\/.*$/, '');
        if (!entry) continue;

        let bareHost = entry;
        let entryPort = '';
        if (entry.startsWith('[')) {
            const close = entry.indexOf(']');
            if (close < 0) continue;
            bareHost = entry.slice(0, close + 1);
            entryPort = entry.slice(close + 1).replace(/^:/, '');
        } else {
            const idx = entry.lastIndexOf(':');
            if (idx > 0) {
                bareHost = entry.slice(0, idx);
                entryPort = entry.slice(idx + 1);
            }
        }

        if (bareHost === hostPort) return { allowed: true, host, reason: 'host matches operation scope' };
        if (bareHost === host && (entryPort === '' || entryPort === parsed.port)) {
            return { allowed: true, host, reason: 'host matches operation scope' };
        }
        if (!entry.startsWith('[') && entryPort === '' && (host === bareHost || host.endsWith('.' + bareHost))) {
            return { allowed: true, host, reason: 'host is covered by operation scope' };
        }
    }

    return {
        allowed: false,
        host,
        reason: `host "${host}" is not covered by operation scope [${scope.join(', ')}] - refusing to probe`
    };
}

function buildRequestHeaders(target?: WebTarget): Record<string, string> {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (target?.headers) Object.assign(headers, target.headers);
    if (target?.cookies && Object.keys(target.cookies).length > 0) {
        headers['Cookie'] = Object.entries(target.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }
    return headers;
}

interface DiscoveredForm {
    action: string;
    method: string;
    fields: string[];
    types: Record<string, string>;
}

function extractForms(body: string, baseUrl: string): DiscoveredForm[] {
    const forms: DiscoveredForm[] = [];
    const formRe = /<form[^>]*>([\s\S]*?)<\/form>/gi;
    let m: RegExpExecArray | null;
    while ((m = formRe.exec(body)) !== null) {
        const openTag = (m[0].match(/^<form[^>]*>/i) || [''])[0];
        const block = m[1];
        const actionMatch = openTag.match(/action\s*=\s*["']([^"']*)["']/i);
        const methodMatch = openTag.match(/method\s*=\s*["']([^"']*)["']/i);
        const fields: string[] = [];
        const types: Record<string, string> = {};
        const inputRe = /<(?:input|textarea|select)[^>]*>/gi;
        let im: RegExpExecArray | null;
        while ((im = inputRe.exec(block)) !== null) {
            const nameMatch = im[0].match(/name\s*=\s*["']([^"']+)["']/i);
            if (!nameMatch) continue;
            const typeMatch = im[0].match(/type\s*=\s*["']([^"']*)["']/i);
            fields.push(nameMatch[1]);
            types[nameMatch[1]] = typeMatch ? typeMatch[1].toLowerCase() : 'text';
        }
        let action = actionMatch ? actionMatch[1] : '';
        try { action = action ? new URL(action, baseUrl).toString() : baseUrl; }
        catch { action = baseUrl; }
        forms.push({
            action,
            method: (methodMatch ? methodMatch[1] : 'GET').toUpperCase(),
            fields,
            types
        });
    }
    return forms;
}

function extractLinks(body: string, baseUrl: string): string[] {
    const links: string[] = [];
    const linkRe = /<a[^>]+href\s*=\s*["']([^"'#]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(body)) !== null) {
        try { links.push(new URL(m[1], baseUrl).toString()); } catch { /* malformed href */ }
    }
    return links;
}

function extractScriptSources(body: string, baseUrl: string): string[] {
    const scripts: string[] = [];
    const scriptRe = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(body)) !== null) {
        try { scripts.push(new URL(m[1], baseUrl).toString()); } catch { /* malformed src */ }
    }
    return scripts;
}

function extractInlineScripts(body: string): string[] {
    const inline: string[] = [];
    const re = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) inline.push(m[1]);
    return inline;
}

/* ------------------------------------------------------------------------------------------------
 * WebScanner - crawl / directory brute force (existing behaviour, shared helpers)
 * ---------------------------------------------------------------------------------------------- */

export class WebScanner {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('WEB_SCANNER_INIT', 'web-scanner', 'SUCCESS', {});
    }

    /** Real HTTP request helper with timeout. Returns the real response, or an error. */
    private async fetchPage(target: WebTarget, url: string): Promise<{ res: Response; body: string } | null> {
        try {
            const res = await fetch(url, {
                headers: buildRequestHeaders(target),
                redirect: 'follow',
                signal: AbortSignal.timeout(10_000)
            });
            const body = await res.text();
            return { res, body };
        } catch {
            return null;
        }
    }

    /**
     * REAL crawl: fetches the target over HTTP and parses the actual HTML for
     * links, forms and script endpoints. Nothing is invented.
     */
    async crawl(target: WebTarget): Promise<any> {
        arsenalCore.audit('WEB_CRAWL', 'web-scanner', 'ATTEMPT', { url: target.url });

        const scope = evaluateScope(this.ctx, target.url);
        if (!scope.allowed) {
            arsenalCore.audit('WEB_CRAWL', 'web-scanner', 'REFUSAL', { url: target.url, reason: scope.reason });
            return {
                pages: [], forms: [], links: [], scripts: [],
                reachable: false,
                error: scope.reason
            };
        }

        const fetched = await this.fetchPage(target, target.url);
        if (!fetched) {
            arsenalCore.audit('WEB_CRAWL', 'web-scanner', 'FAILED', { url: target.url, reason: 'unreachable' });
            return {
                pages: [], forms: [], links: [], scripts: [],
                reachable: false,
                error: `Target ${target.url} is not reachable over HTTP`
            };
        }

        const { res, body } = fetched;
        const contentType = res.headers.get('content-type') || 'unknown';
        const server = res.headers.get('server') || undefined;

        const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';

        const links = extractLinks(body, target.url);
        const forms = extractForms(body, target.url);
        const scripts = extractScriptSources(body, target.url);

        const pages: CrawlResult[] = [{
            url: target.url,
            status: res.status,
            contentType,
            title,
            length: body.length,
            server
        }];

        arsenalCore.audit('WEB_CRAWL', 'web-scanner', 'SUCCESS', {
            url: target.url, status: res.status, links: links.length, forms: forms.length, bytes: body.length
        });

        // Real findings from real observations
        if (res.status >= 500) {
            arsenalCore.addFinding({
                title: `Server error response ${res.status} on ${target.url}`,
                severity: 'MEDIUM',
                category: 'misconfiguration',
                description: `The target returned HTTP ${res.status} with a ${contentType} body`,
                evidence: { url: target.url, status: res.status },
                remediation: 'Investigate the server-side error and disable verbose error output in production',
                verified: true
            });
        }
        if (forms.some(f => f.method === 'GET' && f.fields.some(x => /pass|pwd/i.test(x)))) {
            arsenalCore.addFinding({
                title: `Form submits credentials over GET on ${target.url}`,
                severity: 'MEDIUM',
                category: 'misconfiguration',
                description: 'A form field matching a password pattern is submitted with method=GET, exposing credentials in URLs and logs',
                evidence: { url: target.url, forms: forms.map(f => ({ action: f.action, method: f.method })) },
                remediation: 'Use method=POST for credential submission and add CSRF protection',
                verified: true
            });
        }
        const insecureForms = forms.filter(f => f.action.startsWith('http://'));
        if (insecureForms.length > 0) {
            arsenalCore.addFinding({
                title: `Form posts over plaintext HTTP on ${target.url}`,
                severity: 'HIGH',
                category: 'weak_crypto',
                description: `${insecureForms.length} form(s) submit to a non-TLS endpoint`,
                evidence: { url: target.url, actions: insecureForms.map(f => f.action) },
                remediation: 'Enforce HTTPS for all form submissions and redirect HTTP to TLS',
                verified: true
            });
        }

        return {
            reachable: true,
            pages, forms, links: Array.from(new Set(links)), scripts: Array.from(new Set(scripts)),
            status: res.status,
            contentType,
            title
        };
    }

    /**
     * REAL directory discovery: issues actual HTTP requests for each candidate path.
     */
    async directoryBrute(target: WebTarget, wordlist: string[] = DIR_WORDLIST): Promise<any> {
        arsenalCore.audit('DIR_BRUTE', 'web-scanner', 'ATTEMPT', { url: target.url, words: wordlist.length });

        const scope = evaluateScope(this.ctx, target.url);
        if (!scope.allowed) {
            arsenalCore.audit('DIR_BRUTE', 'web-scanner', 'REFUSAL', { url: target.url, reason: scope.reason });
            return { reachable: false, found: [], tested: 0, error: scope.reason };
        }

        const base = target.url.endsWith('/') ? target.url : target.url + '/';
        const found: Array<{ path: string; status: number; length: number }> = [];
        let reachable = false;

        for (const word of wordlist) {
            const url = new URL(word, base).toString();
            const fetched = await this.fetchPage(target, url);
            if (!fetched) continue;
            reachable = true;
            const { res, body } = fetched;
            if (res.status !== 404 && res.status !== 400) {
                found.push({ path: url, status: res.status, length: body.length });
            }
        }

        arsenalCore.audit('DIR_BRUTE', 'web-scanner', 'SUCCESS', {
            url: target.url, reachable, found: found.length
        });

        const sensitive = found.filter(f => /(\.env|\.git|config|backup|phpmyadmin|admin|console|actuator)/i.test(f.path));
        if (sensitive.length > 0) {
            arsenalCore.addFinding({
                title: `Sensitive path exposed on ${target.url}`,
                severity: 'HIGH',
                category: 'misconfiguration',
                description: `${sensitive.length} sensitive path(s) responded with a non-404 status`,
                evidence: { url: target.url, paths: sensitive.map(f => ({ path: f.path, status: f.status })) },
                remediation: 'Block access to administrative and configuration paths at the web server or WAF layer',
                verified: true
            });
        }

        return { reachable, found, tested: wordlist.length };
    }
}

/* ------------------------------------------------------------------------------------------------
 * SQL Injection scanner - real probing
 * ---------------------------------------------------------------------------------------------- */

export class SQLInjectionScanner {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('SQLI_SCANNER_INIT', 'web-offensive', 'ATTEMPT', {});
    }

    /**
     * REAL SQL injection test against one query parameter.
     * Detection is evidence based:
     *  - error   : a database error signature appeared in a real response body
     *  - boolean : the true/false pair differed materially while a benign control pair did not
     *  - time    : the sleep pair differed by >= 2000ms
     */
    async testParameter(url: string, param: string): Promise<SQLiTestResult> {
        arsenalCore.audit('SQLI_TEST', 'web-offensive', 'ATTEMPT', { url, param });

        const scope = evaluateScope(this.ctx, url);
        if (!scope.allowed) {
            arsenalCore.audit('SQLI_TEST', 'web-offensive', 'REFUSAL', { url, param, reason: scope.reason });
            return {
                vulnerable: false, verified: false, parameter: param,
                baseline: null, payloadsTested: [], detectionMethod: 'none', confidence: 0,
                reason: scope.reason
            };
        }

        const marker = randomId('arsenalm', 6);
        const baselineUrl = setParam(url, param, marker);
        const baselineObs = await observe(baselineUrl);

        if (baselineObs.error || baselineObs.status === 0) {
            arsenalCore.audit('SQLI_TEST', 'web-offensive', 'FAILED', {
                url, param, reason: baselineObs.error || 'no response'
            });
            return {
                vulnerable: false, verified: false, parameter: param,
                baseline: null, payloadsTested: [], detectionMethod: 'none', confidence: 0,
                reason: `baseline request failed: ${baselineObs.error || 'no HTTP response'}`
            };
        }

        const baseline: SQLiBaseline = {
            url: baselineUrl,
            status: baselineObs.status,
            length: baselineObs.length,
            bodyHash: sha256(baselineObs.body),
            elapsedMs: baselineObs.elapsedMs
        };

        const payloadsTested: SQLiPayloadResult[] = [];
        const record = async (
            payload: string,
            technique: SQLiPayloadResult['technique'],
            timeoutMs = 10_000
        ): Promise<HttpObservation> => {
            const probeUrl = setParam(url, param, payload);
            const obs = await observe(probeUrl, { timeoutMs });
            let signal = 'none';
            let evidence = '';
            const lower = obs.body.toLowerCase();
            for (const sig of DB_ERROR_SIGNATURES) {
                if (lower.includes(sig)) {
                    signal = 'db-error';
                    evidence = bodyExcerpt(obs.body, sig);
                    break;
                }
            }
            if (!evidence) {
                evidence = `status=${obs.status} length=${obs.length} baselineLength=${baseline.length} ` +
                           `statusChanged=${obs.status !== baseline.status} bodyHash=${sha256(obs.body).slice(0, 16)}`;
            }
            payloadsTested.push({
                payload, technique, status: obs.status, length: obs.length,
                elapsedMs: obs.elapsedMs, signal, evidence
            });
            return obs;
        };

        // --- 1. error based probes -------------------------------------------------------
        const errorPayloads = ["'", '"', "')", "1' OR '1'='1", '1; SELECT 1', '1 UNION SELECT NULL'];
        let errorHit: SQLiPayloadResult | null = null;
        for (const payload of errorPayloads) {
            const obs = await record(payload, 'error');
            const last = payloadsTested[payloadsTested.length - 1];
            if (last.signal === 'db-error' && !errorHit) errorHit = last;
            if (obs.error) break;
        }

        // --- 2. boolean based probes -----------------------------------------------------
        const booleanPairs: Array<{ label: string; truthy: string; falsy: string }> = [
            { label: 'quoted', truthy: "1' AND '1'='1", falsy: "1' AND '1'='2" },
            { label: 'numeric', truthy: '1 AND 1=1', falsy: '1 AND 1=2' }
        ];
        const controlA = `${marker}AA`;
        const controlB = `${marker}BB`;
        const controlTrue = await record(controlA, 'control');
        const controlFalse = await record(controlB, 'control');
        const controlDiffers = materiallyDiffers(controlTrue, controlFalse);

        let booleanHit: { label: string; truthy: SQLiPayloadResult; falsy: SQLiPayloadResult } | null = null;
        for (const pair of booleanPairs) {
            const truthy = await record(pair.truthy, 'boolean');
            const falsy = await record(pair.falsy, 'boolean');
            if (materiallyDiffers(truthy, falsy) && !controlDiffers) {
                booleanHit = {
                    label: pair.label,
                    truthy: payloadsTested[payloadsTested.length - 2],
                    falsy: payloadsTested[payloadsTested.length - 1]
                };
                break;
            }
        }

        // --- 3. time based probes (only when error/boolean are inconclusive) --------------
        let timeHit: { truthy: SQLiPayloadResult; falsy: SQLiPayloadResult; delta: number } | null = null;
        if (!errorHit && !booleanHit) {
            const timePairs = [
                { truthy: "1' AND SLEEP(3)-- -", falsy: "1' AND SLEEP(0)-- -" },
                { truthy: '1 AND pg_sleep(3)', falsy: '1 AND pg_sleep(0)' }
            ];
            for (const pair of timePairs) {
                const truthy = await record(pair.truthy, 'time', 6000);
                const falsy = await record(pair.falsy, 'time', 6000);
                const delta = truthy.elapsedMs - falsy.elapsedMs;
                if (delta >= 2000) {
                    timeHit = {
                        truthy: payloadsTested[payloadsTested.length - 2],
                        falsy: payloadsTested[payloadsTested.length - 1],
                        delta
                    };
                    break;
                }
            }
        }

        // --- verdict ---------------------------------------------------------------------
        let vulnerable = false;
        let detectionMethod: SQLiTestResult['detectionMethod'] = 'none';
        let confidence = 0;
        let primary: SQLiPayloadResult | null = null;

        if (errorHit) {
            vulnerable = true;
            detectionMethod = 'error';
            confidence = 0.95;
            primary = errorHit;
        } else if (booleanHit) {
            vulnerable = true;
            detectionMethod = 'boolean';
            confidence = 0.85;
            primary = booleanHit.truthy;
        } else if (timeHit) {
            vulnerable = true;
            detectionMethod = 'time';
            confidence = 0.8;
            primary = timeHit.truthy;
        }

        const reason = vulnerable
            ? undefined
            : `no injection signal observed in ${payloadsTested.length} real requests (baseline status ${baseline.status}, length ${baseline.length})`;

        arsenalCore.audit('SQLI_TEST', 'web-offensive', vulnerable ? 'SUCCESS' : 'NO_FINDING', {
            url, param, vulnerable, detectionMethod, payloads: payloadsTested.length,
            baselineStatus: baseline.status
        });

        if (vulnerable && primary) {
            arsenalCore.addFinding({
                title: `SQL injection confirmed in parameter "${param}" on ${url}`,
                severity: 'HIGH',
                category: 'sql_injection',
                description:
                    `A ${detectionMethod}-based probe against the "${param}" parameter produced a materially different ` +
                    `server response. Detection method: ${detectionMethod}. Payload: ${primary.payload}`,
                evidence: {
                    url,
                    parameter: param,
                    detectionMethod,
                    payload: primary.payload,
                    status: primary.status,
                    responseLength: primary.length,
                    responseExcerpt: primary.evidence,
                    baseline
                },
                remediation:
                    'Use parameterised queries / prepared statements, validate input types server side and ' +
                    'stop returning raw database error text to the client',
                verified: true
            });
        }

        return {
            vulnerable,
            verified: vulnerable,
            parameter: param,
            baseline,
            payloadsTested,
            detectionMethod,
            confidence,
            reason
        };
    }
}

/** Two responses differ materially when the body length moved by more than 5 chars or the status changed. */
function materiallyDiffers(a: HttpObservation, b: HttpObservation): boolean {
    if (a.error || b.error) return false;
    if (a.status !== b.status) return true;
    return Math.abs(a.length - b.length) > 5;
}

/* ------------------------------------------------------------------------------------------------
 * XSS scanner - reflected / stored / static DOM
 * ---------------------------------------------------------------------------------------------- */

export class XSSScanner {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('XSS_SCANNER_INIT', 'web-offensive', 'ATTEMPT', {});
    }

    /**
     * REAL reflected XSS test. A unique marker is injected into every query parameter of the
     * URL and the raw response body is searched for that marker.
     *  - marker present verbatim (unencoded) together with a script capable payload -> vulnerable
     *  - marker present only in HTML encoded form                              -> reflected_but_encoded
     *  - marker absent                                                      -> not reflected
     */
    async testReflected(url: string): Promise<XssReflectedResult> {
        arsenalCore.audit('XSS_TEST', 'web-offensive', 'ATTEMPT', { url });

        const marker = randomId('xssprobe', 4);
        const scope = evaluateScope(this.ctx, url);
        if (!scope.allowed) {
            arsenalCore.audit('XSS_TEST', 'web-offensive', 'REFUSAL', { url, reason: scope.reason });
            return {
                vulnerable: false, verified: false, reflected: false, reflected_but_encoded: false,
                marker, probes: [], evidence: { marker, hits: [] }, reason: scope.reason
            };
        }

        let parsed: URL;
        try { parsed = new URL(url); }
        catch {
            const reason = `target url could not be parsed: ${url}`;
            arsenalCore.audit('XSS_TEST', 'web-offensive', 'FAILED', { url, reason });
            return {
                vulnerable: false, verified: false, reflected: false, reflected_but_encoded: false,
                marker, probes: [], evidence: { marker, hits: [] }, reason
            };
        }

        const allParams = Array.from(new Set(Array.from(parsed.searchParams.keys())));
        if (allParams.length === 0) {
            const reason = 'no query parameter present on the target url - there is no reflection point to inject into';
            arsenalCore.audit('XSS_TEST', 'web-offensive', 'NO_FINDING', { url, reason });
            return {
                vulnerable: false, verified: false, reflected: false, reflected_but_encoded: false,
                marker, probes: [], evidence: { marker, hits: [] }, reason
            };
        }

        const params = allParams.slice(0, 8);
        const payloads = [
            `<script>${marker}</script>`,
            `"><img src=x onerror=alert(${marker})>`,
            `javascript:alert('${marker}')`,
            marker
        ];
        const scriptCapable = /(<script|onerror\s*=|javascript:)/i;

        const probes: XssProbeResult[] = [];
        const hits: XssReflectedResult['evidence']['hits'] = [];
        let vulnerable = false;
        let reflected = false;
        let reflectedButEncoded = false;

        for (const param of params) {
            for (const payload of payloads) {
                const probeUrl = setParam(url, param, payload);
                const obs = await observe(probeUrl);
                if (obs.error || obs.status === 0) {
                    probes.push({
                        url: probeUrl, param, payload, markerFound: false, encoded: false,
                        raw: false, status: 0, length: 0
                    });
                    continue;
                }
                const markerFound = obs.body.includes(marker);
                const raw = markerFound && obs.body.includes(payload);
                const encodedForm = encodeHtml(payload);
                const encoded = markerFound && !raw && (obs.body.includes(encodedForm) || obs.body.includes(encodeURIComponent(payload)));

                probes.push({
                    url: probeUrl, param, payload, markerFound, encoded, raw,
                    status: obs.status, length: obs.length
                });

                if (markerFound) {
                    reflected = true;
                    if (raw && scriptCapable.test(payload)) vulnerable = true;
                    hits.push({
                        url: probeUrl, param, payload, status: obs.status,
                        excerpt: bodyExcerpt(obs.body, marker)
                    });
                }
                if (encoded) reflectedButEncoded = true;
            }
        }

        arsenalCore.audit('XSS_TEST', 'web-offensive', vulnerable ? 'SUCCESS' : 'NO_FINDING', {
            url, marker, probes: probes.length, reflected, reflected_but_encoded: reflectedButEncoded
        });

        if (vulnerable) {
            arsenalCore.addFinding({
                title: `Reflected XSS confirmed in ${params.length} parameter(s) on ${url}`,
                severity: 'HIGH',
                category: 'xss',
                description:
                    `The marker ${marker} was returned verbatim in the HTTP response body for a script capable ` +
                    `payload, which means the parameter is reflected without output encoding.`,
                evidence: { url, marker, probes: probes.filter(p => p.markerFound), hits },
                remediation:
                    'Apply context aware output encoding for every reflected value and enable a strict ' +
                    'Content-Security-Policy as a second layer of defence',
                verified: true
            });
        }

        return {
            vulnerable,
            verified: vulnerable,
            reflected,
            reflected_but_encoded: reflectedButEncoded && !vulnerable,
            marker,
            probes,
            evidence: { marker, hits },
            reason: vulnerable
                ? undefined
                : (reflected
                    ? (reflectedButEncoded
                        ? 'input is reflected but the server HTML-encodes it - no script capable payload survived'
                        : 'input is reflected but no script capable payload was returned unencoded')
                    : 'the marker was not present in any response body - the parameter does not appear to be reflected')
        };
    }

    /**
     * REAL stored XSS attempt. The marker payload is submitted into every form discovered on the
     * page and the target is re-fetched afterwards. Stored XSS is only reported when the marker
     * is actually observed again in a later response.
     */
    async testStored(url: string): Promise<XssStoredResult> {
        arsenalCore.audit('XSS_STORED_TEST', 'web-offensive', 'ATTEMPT', { url });

        const marker = randomId('storedprobe', 4);
        const scope = evaluateScope(this.ctx, url);
        if (!scope.allowed) {
            arsenalCore.audit('XSS_STORED_TEST', 'web-offensive', 'REFUSAL', { url, reason: scope.reason });
            return {
                vulnerable: false, verified: false, marker, attempts: [],
                evidence: { marker, observedAt: [] }, reason: scope.reason
            };
        }

        const page = await observe(url, { redirect: 'follow' });
        if (page.error || page.status === 0) {
            const reason = `target could not be fetched: ${page.error || 'no HTTP response'}`;
            arsenalCore.audit('XSS_STORED_TEST', 'web-offensive', 'FAILED', { url, reason });
            return {
                vulnerable: false, verified: false, marker, attempts: [],
                evidence: { marker, observedAt: [] }, reason
            };
        }

        const forms = extractForms(page.body, url);
        if (forms.length === 0) {
            const reason = 'no forms were discovered on the target page - no persistence could be attempted';
            arsenalCore.audit('XSS_STORED_TEST', 'web-offensive', 'NO_FINDING', { url, reason });
            return {
                vulnerable: false, verified: false, marker, attempts: [],
                evidence: { marker, observedAt: [] }, reason
            };
        }

        const attempts: XssStoredAttempt[] = [];
        const observedAt: string[] = [];
        let excerpt: string | undefined;

        for (const form of forms.slice(0, 5)) {
            const params = new URLSearchParams();
            for (const field of form.fields) {
                const type = (form.types[field] || 'text').toLowerCase();
                if (/pass|pwd|secret|token/.test(field)) params.set(field, 'arsenal-test');
                else if (type === 'checkbox') params.set(field, 'on');
                else if (type === 'file') continue;
                else params.set(field, marker);
            }
            if (params.toString().length === 0) continue;

            const attempt: XssStoredAttempt = {
                action: form.action,
                method: form.method,
                fields: form.fields,
                postedStatus: 0,
                postedBytes: 0,
                markerFoundAfter: false,
                checkedUrls: []
            };

            if (form.method === 'GET') {
                attempt.error = 'GET forms are not submitted by this test (no state change is performed)';
                attempts.push(attempt);
                continue;
            }

            const posted = await observe(form.action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
                redirect: 'manual'
            });
            attempt.postedStatus = posted.status;
            attempt.postedBytes = posted.length;
            if (posted.headers['location']) attempt.location = posted.headers['location'];

            // Re-fetch the page and the form target to look for persisted content.
            const checkUrls = Array.from(new Set([url, form.action]));
            for (const checkUrl of checkUrls) {
                const after = await observe(checkUrl, { redirect: 'follow' });
                attempt.checkedUrls.push(checkUrl);
                if (after.error || after.status === 0) continue;
                if (after.body.includes(marker)) {
                    attempt.markerFoundAfter = true;
                    observedAt.push(checkUrl);
                    if (!excerpt) excerpt = bodyExcerpt(after.body, marker);
                }
            }

            attempts.push(attempt);
        }

        const vulnerable = attempts.some(a => a.markerFoundAfter);

        arsenalCore.audit('XSS_STORED_TEST', 'web-offensive', vulnerable ? 'SUCCESS' : 'NO_FINDING', {
            url, marker, attempts: attempts.length, persisted: vulnerable
        });

        if (vulnerable) {
            arsenalCore.addFinding({
                title: `Stored XSS confirmed on ${url}`,
                severity: 'HIGH',
                category: 'xss',
                description:
                    `The marker ${marker} submitted into a discovered form was observed again in a later ` +
                    `GET response, which means the application persists and renders unencoded user input.`,
                evidence: { url, marker, attempts, observedAt, excerpt },
                remediation:
                    'Store and render user supplied content with context aware output encoding and ' +
                    'sanitise stored HTML before it is re-displayed',
                verified: true
            });
        }

        return {
            vulnerable,
            verified: vulnerable,
            marker,
            attempts,
            evidence: { marker, observedAt, excerpt },
            reason: vulnerable
                ? undefined
                : 'no persistence observable - the marker was not returned by any post-submission fetch'
        };
    }

    /**
     * STATIC ONLY DOM XSS analysis. Without a browser engine a DOM XSS cannot be proven, so this
     * method reports the static risk (source -> sink correlation in same origin scripts) and always
     * returns `vulnerable: false, verified: false`.
     */
    async testDOM(url: string): Promise<XssDomResult> {
        arsenalCore.audit('XSS_DOM_STATIC', 'web-offensive', 'ATTEMPT', { url });

        const note = 'DOM XSS cannot be confirmed without a browser; findings are static-risk only';
        const scope = evaluateScope(this.ctx, url);
        if (!scope.allowed) {
            arsenalCore.audit('XSS_DOM_STATIC', 'web-offensive', 'REFUSAL', { url, reason: scope.reason });
            return { vulnerable: false, verified: false, method: 'static-analysis', sinks: [], filesScanned: [], note, reason: scope.reason };
        }

        const page = await observe(url, { redirect: 'follow' });
        if (page.error || page.status === 0) {
            const reason = `target could not be fetched: ${page.error || 'no HTTP response'}`;
            arsenalCore.audit('XSS_DOM_STATIC', 'web-offensive', 'FAILED', { url, reason });
            return { vulnerable: false, verified: false, method: 'static-analysis', sinks: [], filesScanned: [], note, reason };
        }

        const pageUrl = new URL(url);
        const filesScanned: string[] = [];
        const sources: Array<{ file: string; code: string }> = [{ file: url, code: page.body }];

        for (const inline of extractInlineScripts(page.body)) {
            sources.push({ file: `${url}#inline-script`, code: inline });
        }

        const scriptUrls = Array.from(new Set(extractScriptSources(page.body, url)))
            .filter(src => {
                try {
                    const u = new URL(src);
                    return u.host === pageUrl.host;
                } catch { return false; }
            })
            .slice(0, 20);

        for (const scriptUrl of scriptUrls) {
            const js = await observe(scriptUrl, { redirect: 'follow' });
            if (js.error || js.status === 0) continue;
            filesScanned.push(scriptUrl);
            sources.push({ file: scriptUrl, code: js.body });
        }

        const sinks: DomSinkHit[] = [];
        for (const source of sources) {
            const code = source.code;
            const sourceMatches = DOM_SOURCES.filter(s => code.includes(s));
            if (sourceMatches.length === 0) continue;
            for (const sinkPattern of DOM_SINKS) {
                let idx = code.indexOf(sinkPattern);
                while (idx >= 0 && sinks.length < 50) {
                    sinks.push({
                        file: source.file,
                        line: lineOf(code, idx),
                        pattern: sinkPattern,
                        source: sourceMatches[0],
                        snippet: code.slice(Math.max(0, idx - 60), Math.min(code.length, idx + sinkPattern.length + 60)).trim()
                    });
                    idx = code.indexOf(sinkPattern, idx + sinkPattern.length);
                }
            }
        }

        arsenalCore.audit('XSS_DOM_STATIC', 'web-offensive', sinks.length > 0 ? 'RISK' : 'NO_FINDING', {
            url, filesScanned: filesScanned.length, sinks: sinks.length, method: 'static-analysis'
        });

        if (sinks.length > 0) {
            arsenalCore.addFinding({
                title: `Possible DOM XSS sink reachable from an attacker controlled source in ${filesScanned.length + 1} script(s)`,
                severity: 'LOW',
                category: 'xss',
                description:
                    `Static analysis found ${sinks.length} dangerous sink occurrence(s) in files that also read an ` +
                    `attacker controllable source (location.hash / location.search / postMessage). This is a ` +
                    `static risk signal only - it was NOT verified against a live browser.`,
                evidence: { url, method: 'static-analysis', sinks },
                remediation:
                    'Avoid assigning untrusted data to innerHTML/outerHTML/document.write, drop eval/new Function ' +
                    'and validate postMessage origins before use',
                verified: false
            });
        }

        return {
            vulnerable: false,
            verified: false,
            method: 'static-analysis',
            sinks,
            filesScanned,
            note
        };
    }
}

/* ------------------------------------------------------------------------------------------------
 * Auth bypass - real exposure and normalisation bypass probing
 * ---------------------------------------------------------------------------------------------- */

export class AuthBypass {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('AUTH_BYPASS_INIT', 'web-offensive', 'ATTEMPT', {});
    }

    /**
     * REAL authentication bypass / exposure test.
     * Sensitive paths are actually requested and classified by the observed status code.
     * Path normalisation bypasses are attempted against a protected administrative path.
     * OPTIONS and TRACE are sent for real (TRACE over a raw socket because fetch forbids it).
     */
    async testBypass(target: WebTarget): Promise<AuthBypassResult> {
        arsenalCore.audit('AUTH_BYPASS_TEST', 'web-offensive', 'ATTEMPT', { url: target.url });

        const scope = evaluateScope(this.ctx, target.url);
        if (!scope.allowed) {
            arsenalCore.audit('AUTH_BYPASS_TEST', 'web-offensive', 'REFUSAL', { url: target.url, reason: scope.reason });
            return {
                bypassed: false, exposed: [], protected: [], absent: [], redirect: [], other: [],
                bypassAttempts: [],
                methods: { options: { status: 0, error: scope.reason }, trace: { status: 0, bodyBytes: 0, error: scope.reason } },
                reason: scope.reason
            };
        }

        let origin: string;
        try { origin = new URL(target.url).origin; }
        catch {
            const reason = `target url could not be parsed: ${target.url}`;
            arsenalCore.audit('AUTH_BYPASS_TEST', 'web-offensive', 'FAILED', { url: target.url, reason });
            return {
                bypassed: false, exposed: [], protected: [], absent: [], redirect: [], other: [],
                bypassAttempts: [],
                methods: { options: { status: 0, error: reason }, trace: { status: 0, bodyBytes: 0, error: reason } },
                reason
            };
        }

        const requestHeaders = buildRequestHeaders(target);
        const exposed: ExposedResource[] = [];
        const protectedPaths: AuthBypassResult['protected'] = [];
        const absent: AuthBypassResult['absent'] = [];
        const redirects: AuthBypassResult['redirect'] = [];
        const other: AuthBypassResult['other'] = [];

        let budget = 40;
        const spend = (): boolean => {
            if (budget <= 0) return false;
            budget--;
            return true;
        };

        for (const entry of SENSITIVE_PATHS) {
            if (!spend()) {
                other.push({ path: entry.path, status: 0, error: 'request budget exhausted' });
                continue;
            }
            const url = origin + entry.path;
            const obs = await observe(url, { headers: requestHeaders, redirect: 'manual' });

            if (obs.error || obs.status === 0) {
                other.push({ path: entry.path, status: 0, error: obs.error || 'no response' });
                continue;
            }
            if (obs.status >= 300 && obs.status < 400) {
                const location = obs.headers['location'];
                let finalStatus = obs.status;
                let finalUrl = url;
                if (location && spend()) {
                    let next = location;
                    try { next = new URL(location, url).toString(); } catch { /* keep raw */ }
                    const hop = await observe(next, { headers: requestHeaders, redirect: 'manual' });
                    finalStatus = hop.status;
                    finalUrl = hop.finalUrl || next;
                }
                redirects.push({ path: entry.path, status: obs.status, finalStatus, finalUrl });
                continue;
            }
            if (obs.status === 200) {
                const secretLike = /(password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization)\s*[=:]/i.test(obs.body);
                exposed.push({
                    path: entry.path,
                    status: obs.status,
                    finalUrl: obs.finalUrl || url,
                    bodyBytes: obs.length,
                    contentType: obs.headers['content-type'],
                    secretLike
                });
                continue;
            }
            if (obs.status === 401 || obs.status === 403) {
                protectedPaths.push({ path: entry.path, status: obs.status });
                continue;
            }
            if (obs.status === 404 || obs.status === 410) {
                absent.push({ path: entry.path, status: obs.status });
                continue;
            }
            other.push({ path: entry.path, status: obs.status });
        }

        // --- path normalisation bypass attempts -----------------------------------------
        const adminCandidates = ['/admin', '/administrator', '/wp-admin/', '/admin/'];
        const protectedAdmin = protectedPaths.find(p => adminCandidates.includes(p.path));
        const bypassBase = protectedAdmin ? protectedAdmin.path : '/admin';
        const bypassAttempts: BypassAttempt[] = [];

        for (const attemptPath of BYPASS_ATTEMPTS) {
            if (!spend()) {
                bypassAttempts.push({ path: attemptPath, status: 0, result: 'skipped (request budget exhausted)', bodyBytes: 0 });
                continue;
            }
            const url = origin + attemptPath;
            const obs = await observe(url, { headers: requestHeaders, redirect: 'manual' });
            let result: string;
            if (obs.error || obs.status === 0) result = 'error';
            else if (obs.status === 200) result = protectedAdmin ? 'bypass-succeeded' : 'reachable';
            else if (obs.status === 401 || obs.status === 403) result = 'blocked';
            else if (obs.status >= 300 && obs.status < 400) result = 'redirect';
            else if (obs.status === 404 || obs.status === 410) result = 'not-found';
            else result = 'other';
            bypassAttempts.push({ path: attemptPath, status: obs.status, result, bodyBytes: obs.length });
        }

        // --- HTTP method probing -----------------------------------------------------------
        let options: AuthBypassResult['methods']['options'] = { status: 0 };
        let trace: AuthBypassResult['methods']['trace'] = { status: 0, bodyBytes: 0 };
        if (spend()) {
            const opt = await observe(origin + '/', { method: 'OPTIONS', headers: requestHeaders, redirect: 'manual' });
            options = { status: opt.status, allow: opt.headers['allow'], error: opt.error };
        }
        if (spend()) {
            const raw = await rawRequest(origin + '/', 'TRACE', requestHeaders);
            trace = { status: raw.status, bodyBytes: raw.body.length, error: raw.error };
        }

        const traceAllowed = trace.status > 0 && trace.status !== 405 && trace.status !== 501;
        const bypassSucceeded = bypassAttempts.some(a => a.result === 'bypass-succeeded');
        // `bypassed` reports authentication bypass only. An accepted TRACE is reported
        // separately as a misconfiguration finding.
        const bypassed = bypassSucceeded;

        arsenalCore.audit('AUTH_BYPASS_TEST', 'web-offensive', 'SUCCESS', {
            url: target.url, exposed: exposed.length, protected: protectedPaths.length,
            absent: absent.length, bypassSucceeded, traceAllowed
        });

        // --- findings ---------------------------------------------------------------------
        for (const resource of exposed) {
            const meta = SENSITIVE_PATHS.find(p => p.path === resource.path);
            if (!meta || meta.category === 'none') continue;

            if (meta.category === 'exposed_secret') {
                arsenalCore.addFinding({
                    title: `Exposed sensitive resource ${resource.path} on ${target.url}`,
                    severity: meta.severity,
                    category: 'exposed_secret',
                    description:
                        `${resource.path} returned HTTP ${resource.status} with ${resource.bodyBytes} bytes of ` +
                        `unauthenticated content. ${meta.note}.`,
                    evidence: {
                        url: resource.finalUrl, path: resource.path, status: resource.status,
                        bodyBytes: resource.bodyBytes, contentType: resource.contentType,
                        secretLikeContent: resource.secretLike
                    },
                    remediation:
                        'Deny unauthenticated access to configuration, environment and dump files at the web ' +
                        'server or reverse proxy layer and rotate any secret that was exposed',
                    verified: true
                });
                continue;
            }

            arsenalCore.addFinding({
                title: `Unauthenticated access to ${resource.path} on ${target.url}`,
                severity: meta.severity,
                category: 'auth_bypass',
                description:
                    `${resource.path} returned HTTP ${resource.status} with ${resource.bodyBytes} bytes without ` +
                    `any authentication. ${meta.note}.`,
                evidence: {
                    url: resource.finalUrl, path: resource.path, status: resource.status,
                    bodyBytes: resource.bodyBytes, contentType: resource.contentType
                },
                remediation:
                    'Require authentication (and authorization) before serving this path and review the ' +
                    'reverse proxy / server configuration for accidental public exposure',
                verified: true
            });

            if (resource.secretLike) {
                arsenalCore.addFinding({
                    title: `Credential-like content served from ${resource.path} on ${target.url}`,
                    severity: 'CRITICAL',
                    category: 'exposed_secret',
                    description:
                        `The unauthenticated response of ${resource.path} contains credential-like assignments ` +
                        `(password / token / secret / api_key style key=value pairs).`,
                    evidence: { url: resource.finalUrl, path: resource.path, status: resource.status },
                    remediation: 'Remove the file from the public web root and rotate the exposed credentials',
                    verified: true
                });
            }
        }

        if (bypassSucceeded) {
            arsenalCore.addFinding({
                title: `Path normalisation bypass reached ${bypassBase} on ${target.url}`,
                severity: 'CRITICAL',
                category: 'auth_bypass',
                description:
                    `A normalised path variant returned HTTP 200 while the canonical administrative path ` +
                    `returned HTTP ${protectedAdmin?.status ?? 'protected'}.`,
                evidence: {
                    url: target.url, canonicalPath: bypassBase,
                    canonicalStatus: protectedAdmin?.status,
                    attempts: bypassAttempts.filter(a => a.result === 'bypass-succeeded')
                },
                remediation:
                    'Normalise and canonicalise the request path before routing and reject paths containing ' +
                    'encoded separators or null bytes',
                verified: true
            });
        }

        if (traceAllowed) {
            arsenalCore.addFinding({
                title: `HTTP TRACE is accepted on ${target.url}`,
                severity: 'MEDIUM',
                category: 'misconfiguration',
                description:
                    `A real TRACE request returned HTTP ${trace.status}. TRACE reflects the request back to the ` +
                    `client and can be used for cross-site tracing attacks.`,
                evidence: { url: target.url, status: trace.status, bodyBytes: trace.bodyBytes },
                remediation: 'Disable the TRACE method on the web server and at the reverse proxy',
                verified: true
            });
        }

        return {
            bypassed,
            exposed,
            protected: protectedPaths,
            absent,
            redirect: redirects,
            other,
            bypassAttempts,
            methods: { options, trace }
        };
    }
}

/* ------------------------------------------------------------------------------------------------
 * API security - endpoint scanning and rate limiting measurement
 * ---------------------------------------------------------------------------------------------- */

export class APISecurity {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('API_SECURITY_INIT', 'web-defensive', 'SUCCESS', {});
    }

    /**
     * REAL API endpoint scan. Endpoints are discovered from the crawled page and from a fixed
     * candidate list, then actually fetched. Every reported vulnerability is backed by an
     * observed status code, response header or response body.
     */
    async scanEndpoints(baseUrl: string): Promise<ApiScanResult> {
        arsenalCore.audit('API_SCAN', 'web-defensive', 'ATTEMPT', { baseUrl });

        const scope = evaluateScope(this.ctx, baseUrl);
        if (!scope.allowed) {
            arsenalCore.audit('API_SCAN', 'web-defensive', 'REFUSAL', { baseUrl, reason: scope.reason });
            return { endpoints: [], vulnerabilities: [], checked: 0, reason: scope.reason };
        }

        let origin: string;
        let base: URL;
        try {
            base = new URL(baseUrl);
            origin = base.origin;
        } catch {
            const reason = `base url could not be parsed: ${baseUrl}`;
            arsenalCore.audit('API_SCAN', 'web-defensive', 'FAILED', { baseUrl, reason });
            return { endpoints: [], vulnerabilities: [], checked: 0, reason };
        }

        // Endpoint discovery - real links from the landing page plus a fixed candidate list.
        const discovered = new Set<string>();
        const landing = await observe(baseUrl, { redirect: 'follow' });
        if (!landing.error && landing.status > 0) {
            for (const link of extractLinks(landing.body, baseUrl)) {
                try {
                    const u = new URL(link);
                    if (u.host === base.host) discovered.add(u.toString());
                } catch { /* malformed link */ }
            }
        }
        for (const candidate of API_CANDIDATES) {
            discovered.add(origin + candidate);
        }
        discovered.add(baseUrl);

        const endpoints: ApiEndpoint[] = [];
        const vulnerabilities: ApiVulnerability[] = [];
        let checked = 0;

        for (const url of Array.from(discovered).slice(0, 34)) {
            const obs = await observe(url, { redirect: 'follow' });
            if (obs.error || obs.status === 0) continue;
            checked++;

            const endpoint: ApiEndpoint = {
                url: obs.finalUrl || url,
                status: obs.status,
                headers: obs.headers,
                bodyBytes: obs.length,
                redirected: obs.redirected,
                contentType: obs.headers['content-type']
            };
            endpoints.push(endpoint);

            const isHttps = url.startsWith('https:');
            // Header hardening is only assessed on responses that actually serve content
            // (an error page is not a meaningful hardening observation).
            const missing = obs.status < 400 ? SECURITY_HEADERS.filter(h => {
                if (h === 'strict-transport-security' && !isHttps) return false;
                return !obs.headers[h];
            }) : [];
            if (missing.length > 0) {
                vulnerabilities.push({
                    url: endpoint.url,
                    type: 'missing-security-headers',
                    severity: 'LOW',
                    detail: `Response is missing ${missing.join(', ')}`,
                    evidence: { status: obs.status, missingHeaders: missing, observedHeaders: obs.headers }
                });
            }

            const acao = obs.headers['access-control-allow-origin'];
            const acac = obs.headers['access-control-allow-credentials'];
            if (acao === '*' && String(acac).toLowerCase() === 'true') {
                vulnerabilities.push({
                    url: endpoint.url,
                    type: 'permissive-cors',
                    severity: 'HIGH',
                    detail: 'Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true',
                    evidence: { status: obs.status, 'access-control-allow-origin': acao, 'access-control-allow-credentials': acac }
                });
            }

            const verbose = VERBOSE_ERROR_PATTERNS.find(re => re.test(obs.body));
            if (verbose) {
                vulnerabilities.push({
                    url: endpoint.url,
                    type: 'verbose-error',
                    severity: 'MEDIUM',
                    detail: `Response body contains verbose server error output (${verbose})`,
                    evidence: { status: obs.status, pattern: String(verbose), excerpt: bodyExcerpt(obs.body, obs.body.slice(0, 1), 220) }
                });
            }

            if (obs.status === 200 && !obs.redirected) {
                const lower = obs.body.toLowerCase();
                const hits = SENSITIVE_DATA_MARKERS.filter(m => lower.includes(m));
                if (hits.length > 0) {
                    vulnerabilities.push({
                        url: endpoint.url,
                        type: 'unauthenticated-sensitive-data',
                        severity: 'HIGH',
                        detail: `Unauthenticated HTTP 200 response contains credential-like fields: ${hits.join(', ')}`,
                        evidence: { status: obs.status, markers: hits, bodyBytes: obs.length, excerpt: bodyExcerpt(obs.body, hits[0]) }
                    });
                }
            }

            let pathname = url;
            try { pathname = new URL(url).pathname.toLowerCase(); } catch { /* keep raw */ }
            if (SENSITIVE_API_PATHS.some(p => pathname.includes(p)) && obs.status === 200) {
                vulnerabilities.push({
                    url: endpoint.url,
                    type: 'sensitive-endpoint-unauthenticated',
                    severity: 'HIGH',
                    detail: `Sensitive endpoint ${pathname} answered HTTP 200 without any authentication`,
                    evidence: { status: obs.status, bodyBytes: obs.length, path: pathname }
                });
            }
        }

        arsenalCore.audit('API_SCAN', 'web-defensive', 'SUCCESS', {
            baseUrl, checked, endpoints: endpoints.length, vulnerabilities: vulnerabilities.length
        });

        for (const v of vulnerabilities) {
            arsenalCore.addFinding({
                title: `${v.type} on ${v.url}`,
                severity: v.severity,
                category: findingCategoryFor(v.type),
                description: v.detail,
                evidence: { url: v.url, type: v.type, ...v.evidence },
                remediation: remediationFor(v.type),
                verified: true
            });
        }

        return { endpoints, vulnerabilities, checked };
    }

    /**
     * REAL rate limiting measurement. Sends N sequential requests and measures status codes and
     * latency drift. A finding is only raised when the endpoint is sensitive AND no limiting was
     * observed, because an unlimited sensitive endpoint is the actual risk.
     */
    async testRateLimiting(baseUrl: string, requests = 30): Promise<RateLimitResult> {
        arsenalCore.audit('RATE_LIMIT_TEST', 'web-defensive', 'ATTEMPT', { baseUrl, requests });

        const scope = evaluateScope(this.ctx, baseUrl);
        if (!scope.allowed) {
            arsenalCore.audit('RATE_LIMIT_TEST', 'web-defensive', 'REFUSAL', { baseUrl, reason: scope.reason });
            return {
                rateLimited: false, requests: 0, statusCounts: {}, firstAvgMs: 0, lastAvgMs: 0,
                latencyGrowthMs: 0, lockoutDetected: false, sensitiveTarget: false,
                verdict: `not measured: ${scope.reason}`,
                limited: false, bypassable: false, reason: scope.reason
            };
        }

        const count = Math.min(Math.max(1, requests), 40);
        const statusCounts: Record<string, number> = {};
        const timings: number[] = [];
        let firstBody = '';
        let firstStatus = 0;

        for (let i = 0; i < count; i++) {
            const obs = await observe(baseUrl, { redirect: 'follow' });
            const key = String(obs.status);
            statusCounts[key] = (statusCounts[key] || 0) + 1;
            timings.push(obs.elapsedMs);
            if (i === 0) { firstBody = obs.body; firstStatus = obs.status; }
            await new Promise(r => setTimeout(r, 25));
        }

        const window = Math.min(5, timings.length);
        const firstAvgMs = timings.length ? Math.round(timings.slice(0, window).reduce((a, b) => a + b, 0) / window) : 0;
        const lastAvgMs = timings.length ? Math.round(timings.slice(-window).reduce((a, b) => a + b, 0) / window) : 0;
        const latencyGrowthMs = lastAvgMs - firstAvgMs;

        const saw429 = (statusCounts['429'] || 0) > 0;
        const authFailures = (statusCounts['401'] || 0) + (statusCounts['403'] || 0);
        const lockoutDetected = authFailures > 0 && (saw429 || authFailures >= Math.ceil(timings.length / 2));
        const delayed = latencyGrowthMs > 200;
        const rateLimited = saw429 || lockoutDetected || delayed;

        let pathname = baseUrl;
        try { pathname = new URL(baseUrl).pathname.toLowerCase(); } catch { /* keep raw */ }
        const sensitiveByPath = /(\/login|\/auth|\/admin|\/api|\/token|\/session|\/graphql|\/metrics|\/actuator|\/debug|\/password|\/account)/.test(pathname);
        const sensitiveByBody = firstStatus === 200 && SENSITIVE_DATA_MARKERS.some(m => firstBody.toLowerCase().includes(m));
        const sensitiveTarget = sensitiveByPath || sensitiveByBody;

        const verdict = saw429
            ? `rate limiting observed: HTTP 429 returned ${statusCounts['429']} time(s)`
            : lockoutDetected
                ? `lockout pattern observed: ${authFailures} authentication failure response(s)`
                : delayed
                    ? `no explicit rejection but the server slowed down by ${latencyGrowthMs}ms across the run`
                    : `no rate limiting observed across ${timings.length} sequential requests`;

        arsenalCore.audit('RATE_LIMIT_TEST', 'web-defensive', 'SUCCESS', {
            baseUrl, requests: count, rateLimited, saw429, lockoutDetected, latencyGrowthMs, sensitiveTarget
        });

        if (!rateLimited && sensitiveTarget) {
            arsenalCore.addFinding({
                title: `No rate limiting observed on sensitive endpoint ${baseUrl}`,
                severity: 'MEDIUM',
                category: 'rate_limit_bypass',
                description:
                    `${count} sequential requests to ${pathname} were all accepted without throttling, HTTP 429 ` +
                    `or lockout, so authentication or business logic endpoints can be brute forced.`,
                evidence: {
                    url: baseUrl, requests: count, statusCounts, firstAvgMs, lastAvgMs,
                    latencyGrowthMs, sensitiveByPath, sensitiveByBody
                },
                remediation:
                    'Apply per-account and per-source rate limiting, add progressive back-off and monitor ' +
                    'repeated authentication failures',
                verified: true
            });
        }

        return {
            rateLimited,
            requests: timings.length,
            statusCounts,
            firstAvgMs,
            lastAvgMs,
            latencyGrowthMs,
            lockoutDetected,
            sensitiveTarget,
            verdict,
            limited: rateLimited,
            bypassable: !rateLimited
        };
    }
}

function findingCategoryFor(type: string): 'misconfiguration' | 'exposed_secret' | 'auth_bypass' {
    switch (type) {
        case 'unauthenticated-sensitive-data':
            return 'exposed_secret';
        case 'sensitive-endpoint-unauthenticated':
            return 'auth_bypass';
        default:
            return 'misconfiguration';
    }
}

function remediationFor(type: string): string {
    switch (type) {
        case 'missing-security-headers':
            return 'Set X-Frame-Options, Content-Security-Policy, Strict-Transport-Security and X-Content-Type-Options on every response';
        case 'permissive-cors':
            return 'Restrict Access-Control-Allow-Origin to trusted origins and never combine it with Access-Control-Allow-Credentials: true';
        case 'verbose-error':
            return 'Disable verbose error pages and stack traces in production and return generic error codes';
        case 'unauthenticated-sensitive-data':
            return 'Require authentication before returning credential-bearing records and never expose secrets in anonymous API responses';
        case 'sensitive-endpoint-unauthenticated':
            return 'Require authentication and authorization for administrative, metric and introspection endpoints';
        default:
            return 'Review the observed response and harden the endpoint accordingly';
    }
}

/* ------------------------------------------------------------------------------------------------
 * WebArsenal facade
 * ---------------------------------------------------------------------------------------------- */

export class WebArsenal {
    scanner: WebScanner;
    sqli: SQLInjectionScanner;
    xss: XSSScanner;
    auth: AuthBypass;
    api: APISecurity;

    constructor(ctx: OperationContext) {
        this.scanner = new WebScanner(ctx);
        this.sqli = new SQLInjectionScanner(ctx);
        this.xss = new XSSScanner(ctx);
        this.auth = new AuthBypass(ctx);
        this.api = new APISecurity(ctx);
        arsenalCore.audit('WEB_ARSENAL_INIT', 'web', 'SUCCESS', { opId: ctx.operationId });
    }
}
export default WebArsenal;
