/**
 * ====================================================================================================
 * WEB ARSENAL - LIVE PROBE HARNESS
 * ====================================================================================================
 * Starts a LOCAL, deliberately vulnerable HTTP server on 127.0.0.1 (ephemeral port) and drives the
 * real arsenal code against it. Everything printed here is the observed result of a real request.
 *
 * The local server emulates a classic vulnerable application:
 *   /           -> reflects ?q= verbatim (reflected XSS surface) + guestbook form (stored XSS surface)
 *   /search     -> naive SQL query handling (error based, boolean based, SLEEP based)
 *   /blind      -> boolean oracle only: different row counts, never leaks an error
 *   /slow       -> blind SQL endpoint: no error text, no boolean oracle, only SLEEP timing
 *   /app.js     -> DOM sink fed by location.hash
 *   /admin      -> 401 protected
 *   /admin/..;/admin -> 200 (deliberate path normalisation flaw, exercises the bypass detector)
 *   /.env       -> 200 with credential-like values
 *   /.git/config-> 200 with repository configuration
 *   /api/v1/users -> 200 with credential bearing records + permissive CORS
 *   /metrics, /graphql -> 200 without authentication
 *   TRACE       -> 200 (deliberately misconfigured so the TRACE check has a real positive)
 * ====================================================================================================
 */

import http from 'http';
import { arsenalCore } from '../src/neo/arsenal/core/arsenal_core';
import { WebArsenal } from '../src/neo/arsenal/web/web_arsenal';

/* ------------------------------------------------------------------ local target server ----- */

interface StoredComment { author: string; comment: string; }

const storedComments: StoredComment[] = [];

function htmlEscape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const APP_JS = `function render() {
  var raw = location.hash.replace('#', '');
  document.getElementById('out').innerHTML = raw;
}
window.addEventListener('hashchange', render);
window.addEventListener('message', function (event) {
  document.getElementById('msg').innerHTML = event.data;
});
`;

const server = http.createServer((req, res) => {
    const rawUrl = req.url || '/';
    // Raw path parsing: the path is taken verbatim (no URL normalisation) so that
    // normalisation bypass attempts such as "//admin" are routed exactly as received.
    const qIndex = rawUrl.indexOf('?');
    const path = qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl;
    const query = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '';
    const q = new URLSearchParams(query).get('q') || '';

    const send = (status: number, body: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
        res.end(body);
    };

    if (req.method === 'TRACE') {
        // Deliberately misconfigured: TRACE is echoed back to the client.
        send(200, 'TRACE / HTTP/1.1\r\nhost: ' + (req.headers.host || '') + '\r\n\r\n', { 'Content-Type': 'message/http' });
        return;
    }
    if (req.method === 'OPTIONS') {
        send(200, '', { Allow: 'GET, POST, OPTIONS, TRACE' });
        return;
    }

    if (path === '/') {
        const latest = storedComments.length > 0 ? storedComments[storedComments.length - 1] : null;
        send(200, `<!DOCTYPE html>
<html><head><title>Arsenal Lab</title><script src="/app.js"></script></head>
<body>
<h1>Arsenal Lab</h1>
<div id="out"></div><div id="msg"></div>
<p>Search: ${q}</p>
<ul><li><a href="/api/v1/users">users</a></li><li><a href="/metrics">metrics</a></li><li><a href="/graphql">graphql</a></li></ul>
<form action="/comment" method="post">
  <input type="text" name="author" value="">
  <input type="text" name="comment" value="">
  <button type="submit">Post</button>
</form>
${latest ? `<div class="comment"><span>${latest.author}</span><span>${latest.comment}</span></div>` : ''}
</body></html>`);
        return;
    }

    if (path === '/app.js') {
        send(200, APP_JS, { 'Content-Type': 'application/javascript' });
        return;
    }

    if (path === '/comment' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            const params = new URLSearchParams(body);
            storedComments.push({
                author: params.get('author') || '',
                comment: params.get('comment') || ''
            });
            res.writeHead(302, { Location: '/' });
            res.end();
        });
        return;
    }

    if (path === '/comment') {
        send(200, storedComments.map(c => `<div>${c.author}: ${c.comment}</div>`).join(''));
        return;
    }

    if (path === '/search') {
        const sleepMatch = /SLEEP\((\d+)\)|pg_sleep\((\d+)\)/i.exec(q);
        if (sleepMatch) {
            const seconds = Number(sleepMatch[1] || sleepMatch[2] || 0);
            setTimeout(() => send(200, `<p>query: ${q}</p><ul><li>id=1 name=alpha</li></ul>`), seconds * 1000);
            return;
        }
        const truthy = /OR\s+'1'\s*=\s*'1/i.test(q)
            || /AND\s+'1'\s*=\s*'1/i.test(q)
            || /AND\s+1\s*=\s*1\b/i.test(q)
            || /UNION\s+SELECT/i.test(q);
        const falsy = /AND\s+'1'\s*=\s*'2/i.test(q)
            || /AND\s+1\s*=\s*2\b/i.test(q);
        if (truthy) {
            send(200, `<p>query: ${q}</p><ul><li>id=1 name=alpha</li><li>id=2 name=beta</li></ul>`);
            return;
        }
        if (falsy) {
            send(200, `<p>query: ${q}</p><ul><li>No matching records</li></ul>`);
            return;
        }
        if (q.includes("'")) {
            send(500, `<p>query: ${q}</p><h1>You have an error in your SQL syntax</h1>
<pre>Warning: mysql_fetch_array(): supplied argument is not a valid MySQL result resource</pre>`);
            return;
        }
        send(200, `<p>query: ${q}</p><ul><li>id=1 name=alpha</li></ul>`);
        return;
    }

    if (path === '/blind') {
        const truthy = /OR\s+'1'\s*=\s*'1/i.test(q)
            || /AND\s+'1'\s*=\s*'1/i.test(q)
            || /AND\s+1\s*=\s*1\b/i.test(q);
        const falsy = /AND\s+'1'\s*=\s*'2/i.test(q)
            || /AND\s+1\s*=\s*2\b/i.test(q);
        if (truthy) {
            send(200, '<ul><li>id=1 name=alpha</li><li>id=2 name=beta</li></ul>');
            return;
        }
        if (falsy) {
            send(200, '<ul><li>No matching records</li></ul>');
            return;
        }
        send(200, '<ul><li>id=1 name=alpha</li></ul>');
        return;
    }

    if (path === '/slow') {
        const sleepMatch = /SLEEP\((\d+)\)|pg_sleep\((\d+)\)/i.exec(q);
        const respond = () => send(200, '<ul><li>id=1 name=alpha</li></ul>');
        if (sleepMatch) {
            const seconds = Number(sleepMatch[1] || sleepMatch[2] || 0);
            setTimeout(respond, seconds * 1000);
            return;
        }
        respond();
        return;
    }

    if (path === '/admin') {
        send(401, '<h1>401 Unauthorized</h1>', { 'WWW-Authenticate': 'Basic realm="admin"' });
        return;
    }

    // DELIBERATELY misconfigured fixture: a Tomcat-style path normalisation flaw where the
    // protected admin area is reachable through a ";/" path segment. It exists so the bypass
    // detector can be exercised against a real observation instead of only its negative branch.
    if (path === '/admin/..;/admin') {
        send(200, '<h1>Admin panel (reached through a path normalisation bypass)</h1>');
        return;
    }

    if (path === '/wp-admin/') {
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
    }

    if (path === '/login') {
        send(200, '<h1>Login</h1><form method="post"><input name="username"><input name="password" type="password"></form>');
        return;
    }

    if (path === '/.env') {
        send(200, 'APP_ENV=production\nDATABASE_URL=mysql://root:sup3rs3cret@127.0.0.1/app\nAPI_KEY=ak_live_9f2b7c1d\n');
        return;
    }

    if (path === '/.git/config') {
        send(200, '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://user:token@git.internal.example/app.git\n');
        return;
    }

    if (path === '/api/v1/users') {
        send(200, JSON.stringify({
            users: [
                { id: 1, email: 'admin@lab.local', password: '5f4dcc3b5aa765d61d8327deb882cf99', token: 'eyJhbGciOi' },
                { id: 2, email: 'user@lab.local', password: 'e10adc3949ba59abbe56e057f20f883e', token: 'eyJhbGciOi' }
            ]
        }), {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': 'true'
        });
        return;
    }

    if (path === '/metrics') {
        send(200, 'http_requests_total 1024\nprocess_resident_memory_bytes 4096\n', { 'Content-Type': 'text/plain' });
        return;
    }

    if (path === '/graphql') {
        send(200, '{"data":{"__schema":{"queryType":{"name":"Query"}}}}', { 'Content-Type': 'application/json' });
        return;
    }

    if (path === '/robots.txt') {
        send(200, 'User-agent: *\nDisallow: /admin\n');
        return;
    }

    send(404, '<h1>404 Not Found</h1>');
});

await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const BASE = `http://127.0.0.1:${port}`;

console.log('=============================================================');
console.log(' SOVEREIGN ARSENAL - WEB PROBE (live, local target)');
console.log('=============================================================');
console.log(`local target           : ${BASE}`);
console.log(`node                   : ${process.version}`);
console.log('');

/* ------------------------------------------------------------------ arsenal operation ------- */

const ctx = arsenalCore.createOperation('PURPLE', ['127.0.0.1'], BASE, 'AUTH');
console.log(`operation id           : ${ctx.operationId}`);
console.log(`operation scope        : ${ctx.scope.join(', ')}`);
console.log('');

const web = new WebArsenal(ctx);

/* ------------------------------------------------------------------ 0. scope gate ----------- */

console.log('--- [0] SCOPE GATE (target outside operation scope) -------------------');
const refusal = await web.sqli.testParameter('http://192.0.2.1/index?q=1', 'q');
console.log(JSON.stringify(refusal, null, 2));
console.log('');

/* ------------------------------------------------------------------ 1. SQL injection --------- */

console.log('--- [1] SQL INJECTION - /search?q= (error / boolean) ------------------');
const sqliError = await web.sqli.testParameter(`${BASE}/search`, 'q');
console.log(JSON.stringify(sqliError, null, 2));
console.log('');

console.log('--- [1b] SQL INJECTION - /blind?q= (boolean oracle, no error text) ------');
const sqliBoolean = await web.sqli.testParameter(`${BASE}/blind`, 'q');
console.log(JSON.stringify(sqliBoolean, null, 2));
console.log('');

console.log('--- [1c] SQL INJECTION - /slow?q= (blind, time based) ----------------');
const sqliTime = await web.sqli.testParameter(`${BASE}/slow`, 'q');
console.log(JSON.stringify(sqliTime, null, 2));
console.log('');

/* ------------------------------------------------------------------ 2. XSS reflected --------- */

console.log('--- [2] REFLECTED XSS - /?q= ------------------------------------------');
const xssReflected = await web.xss.testReflected(`${BASE}/?q=baseline`);
console.log(JSON.stringify(xssReflected, null, 2));
console.log('');

/* ------------------------------------------------------------------ 3. XSS stored ------------- */

console.log('--- [3] STORED XSS - / (guestbook form) -------------------------------');
const xssStored = await web.xss.testStored(`${BASE}/`);
console.log(JSON.stringify(xssStored, null, 2));
console.log('');

/* ------------------------------------------------------------------ 4. DOM XSS (static) -------- */

console.log('--- [4] DOM XSS - static analysis -------------------------------------');
const xssDom = await web.xss.testDOM(`${BASE}/`);
console.log(JSON.stringify(xssDom, null, 2));
console.log('');

/* ------------------------------------------------------------------ 5. Auth bypass ------------- */

console.log('--- [5] AUTH BYPASS / EXPOSURE ----------------------------------------');
const auth = await web.auth.testBypass({ url: BASE });
console.log(JSON.stringify(auth, null, 2));
console.log('');

/* ------------------------------------------------------------------ 6. API scan ---------------- */

console.log('--- [6] API SECURITY SCAN --------------------------------------------');
const api = await web.api.scanEndpoints(BASE);
console.log(JSON.stringify(api, null, 2));
console.log('');

/* ------------------------------------------------------------------ 7. Rate limiting ----------- */

console.log('--- [7] RATE LIMIT MEASUREMENT - /login -------------------------------');
const rate = await web.api.testRateLimiting(`${BASE}/login`, 30);
console.log(JSON.stringify(rate, null, 2));
console.log('');

/* ------------------------------------------------------------------ 8. crawl + brute ---------- */

console.log('--- [8] CRAWL + DIRECTORY BRUTE FORCE (existing functionality regression) -');
const crawl = await web.scanner.crawl({ url: BASE });
console.log(JSON.stringify({
    reachable: crawl.reachable,
    status: crawl.status,
    title: crawl.title,
    links: crawl.links,
    forms: crawl.forms,
    scripts: crawl.scripts
}, null, 2));
const brute = await web.scanner.directoryBrute({ url: BASE });
console.log(JSON.stringify({ reachable: brute.reachable, tested: brute.tested, found: brute.found }, null, 2));
console.log('');

/* ------------------------------------------------------------------ findings ----------------- */

console.log('--- [9] FINDINGS RECORDED BY THE ARSENAL ------------------------------');
const findings = arsenalCore.getFindings();
for (const f of findings) {
    console.log(`[${f.severity}] (${f.category}) verified=${f.verified} ${f.title}`);
}
console.log('');
console.log(`total findings         : ${findings.length}`);
console.log(`audit trail entries    : ${arsenalCore.getAuditLog(1000).length}`);
console.log('');

server.close();
process.exit(0);
