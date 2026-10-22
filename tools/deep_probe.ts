/**
 * DEEP PROBE: exercises Malware, C2 and Purple with REAL inputs.
 *
 * - Malware: a real PE-like byte buffer is analysed, strings extracted, headers parsed,
 *   entropy computed, YARA rules matched, IOCs extracted.
 * - C2: a REAL HTTP listener is bound, a REAL beacon check-in is made over a socket,
 *   a REAL task is queued and delivered, and the REAL result is reported back.
 * - Purple: detection coverage is computed from the real knowledge base, and gaps are listed.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { arsenalCore, MalwareAnalysisArsenal, C2Arsenal, integratedArsenal } from '../src/neo/arsenal/index.ts';

const ROOT = path.resolve(process.cwd());
let failures = 0;
function assert(label: string, cond: boolean, detail = '') {
    console.log(`${cond ? '[PASS]' : '[FAIL]'} ${label}${detail ? ' :: ' + detail : ''}`);
    if (!cond) failures++;
}

async function main() {
    // ---------------------------------------------------------------- MALWARE
    console.log('=== MALWARE ANALYSIS (real bytes) ===');
    const op = arsenalCore.createOperation('PURPLE', ['malware-lab', '127.0.0.1'], 'lab-target.local', 'DEEP-PROBE');
    console.log('operationId =', op.operationId);

    // Build a realistic PE-ish buffer: MZ header, e_lfanew, real section table, real strings.
    //
    // LAB HYGIENE: every indicator below is inert. The C2 address is an RFC 5737
    // documentation IP (TEST-NET-2) and the host is the RFC 2606 reserved `.example` TLD,
    // exactly like the rest of this repo's fixtures.
    //
    // A fixture that carries a LIVE c2 address is quarantined within milliseconds by the
    // host's on-access scanner on a Windows-mounted drive (/mnt/d): the write appears to
    // succeed, then open() fails with EINVAL and the file is gone. Measured on this host:
    // a PE-shaped file with a live c2 IP was removed in <1s, while the same file with a
    // documentation IP survived. Inert indicators keep every assertion real - the IOC
    // regexes still extract url:/ip:/registry:/file:/email: and the YARA rules still match.
    const strings = [
        'This program cannot be run in DOS mode',
        'kernel32.dll', 'CreateRemoteThread', 'WriteProcessMemory', 'VirtualAllocEx',
        'http://malicious-c2.example/payload.bin',
        'powershell.exe -enc SQBFAFgA',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
        'C:\\Users\\admin\\AppData\\Local\\Temp\\dropper.exe', // path-guard: allow (inert IOC fixture: a sample dropper path the extractor must detect, not a machine dependency)
        '198.51.100.7', 'operator@malicious-c2.example'
    ];

    const PE_OFFSET = 0x80;
    const STRINGS_OFFSET = 0x400;
    const buf = Buffer.alloc(STRINGS_OFFSET + 512);

    // DOS header
    buf.write('MZ', 0, 'latin1');
    buf.writeUInt32LE(PE_OFFSET, 0x3c);

    // PE signature + COFF header
    buf.writeUInt32LE(0x00004550, PE_OFFSET);   // "PE\0\0"
    buf.writeUInt16LE(0x014c, PE_OFFSET + 4);   // machine = i386
    buf.writeUInt16LE(2, PE_OFFSET + 6);         // numberOfSections
    buf.writeUInt16LE(0xE0, PE_OFFSET + 20);     // sizeOfOptionalHeader
    buf.writeUInt16LE(0x010b, PE_OFFSET + 24);   // optional header magic = PE32

    // Section table (2 sections) at PE_OFFSET + 24 + 0xE0
    const secTable = PE_OFFSET + 24 + 0xE0;
    buf.write('.text\0\0\0', secTable);
    buf.writeUInt32LE(0x1000, secTable + 8);     // virtualSize
    buf.writeUInt32LE(0x400, secTable + 16);     // sizeOfRawData
    buf.writeUInt32LE(0x200, secTable + 20);     // pointerToRawData
    buf.write('.data\0\0\0', secTable + 40);
    buf.writeUInt32LE(0x200, secTable + 48);
    buf.writeUInt32LE(0x200, secTable + 56);
    buf.writeUInt32LE(0x600, secTable + 60);

    // Real payloads
    buf.write(strings.join('\0'), STRINGS_OFFSET, 'latin1');

    const samplePath = path.join(ROOT, 'data', 'sandbox_sample.bin');
    fs.mkdirSync(path.dirname(samplePath), { recursive: true });
    fs.writeFileSync(samplePath, buf);

    const sample = {
        id: 'SAMPLE-001', filename: 'dropper.bin',
        hash: { md5: '', sha1: '', sha256: '' },
        size: buf.length, type: 'PE', analyzed: false, filePath: samplePath
    };

    const mal = new MalwareAnalysisArsenal(op);

    // Analyse the sample ON DISK (the real API path). If the host's on-access scanner
    // quarantined the file, fall back to the byte-identical in-memory buffer and say so.
    let staticRes;
    try {
        staticRes = mal.static.analyze(sample);
    } catch (e: any) {
        console.log(`   NOTE: on-disk sample unreadable (${e.code}) - likely quarantined by the host scanner; analysing the byte-identical in-memory buffer`);
        staticRes = mal.static.analyze(sample, buf);
    }
    console.log(`   format=${staticRes.details?.format} entropy=${staticRes.details?.overallEntropy} strings=${staticRes.details?.stringCount} sections=${staticRes.sections.length}`);
    console.log(`   indicators: ${staticRes.indicators.slice(0, 5).join(', ')}`);
    console.log(`   suspicious=${staticRes.suspicious}`);

    assert('malware: format detected as PE', staticRes.details?.format === 'PE', String(staticRes.details?.format));
    assert('malware: real strings extracted (>5)', staticRes.details!.stringCount > 5, `${staticRes.details?.stringCount}`);
    assert('malware: PE sections parsed', staticRes.sections.length === 2, `${staticRes.sections.length}`);
    assert('malware: entropy computed > 0', (staticRes.details?.overallEntropy ?? 0) > 0, String(staticRes.details?.overallEntropy));
    assert('malware: URL IOC extracted', staticRes.indicators.some(i => i.startsWith('url:')), staticRes.indicators.filter(i => i.startsWith('url:')).join(','));
    assert('malware: IP IOC extracted', staticRes.indicators.some(i => i.startsWith('ip:')), staticRes.indicators.filter(i => i.startsWith('ip:')).join(','));
    assert('malware: registry IOC extracted', staticRes.indicators.some(i => i.startsWith('registry:')));
    assert('malware: flagged suspicious', staticRes.suspicious === true);

    const yaraHits = mal.yara.scan(buf);
    console.log(`   yara matches: ${yaraHits.map(m => m.rule).join(', ') || '(none)'}`);
    assert('malware: YARA matched PE rule', yaraHits.some(m => m.rule === 'PE_Windows_Executable'), yaraHits.map(m => m.rule).join(','));
    assert('malware: YARA matched PowerShell rule', yaraHits.some(m => m.rule === 'Suspicious_PowerShell'));

    let det;
    try {
        det = await mal.sandbox.detonate(sample);
    } catch (e: any) {
        console.log(`   NOTE: detonation could not read the on-disk sample (${e.code}) - detonating the byte-identical in-memory buffer`);
        det = await mal.sandbox.detonate(sample, buf);
    }
    console.log(`   detonation verdict=${det.verdict} behaviorScore=${det.dynamic.behaviorScore}`);
    assert('malware: detonation produced real verdict', det.verdict === 'MALICIOUS', det.verdict);
    assert('malware: detonation produced behaviour score > 0', det.dynamic.behaviorScore > 0, String(det.dynamic.behaviorScore));

    // Custody snapshot: the bytes are handed over directly so the vault copy never depends
    // on the host scanner leaving the on-disk sample alone. The restore verifies the hash.
    const snapId = mal.sandbox.createSnapshot(samplePath, buf);
    const snapOk = mal.sandbox.restoreSnapshot(snapId);
    console.log(`   snapshot ${snapId} restored=${snapOk}`);
    assert('malware: snapshot round-trip verified', snapOk === true);

    // ---------------------------------------------------------------- C2
    console.log('\n=== C2 FRAMEWORK (real listener + real beacon) ===');
    const c2 = new C2Arsenal(op);
    const listenerId = await c2.server.startListener(0, 'http');
    const handle = c2.server.getListeners().find(l => l.id === listenerId)!;
    const port = handle.actualPort!;
    console.log(`   listener bound on real port ${port} (bound=${handle.bound})`);
    assert('c2: listener really bound a port', handle.bound === true && port > 0, `port=${port}`);

    const beaconId = 'BCN-TEST-1';
    const checkin = await fetch(`http://127.0.0.1:${port}/beacon?id=${beaconId}&host=lab-host&os=linux&user=analyst`);
    const checkinBody = await checkin.json() as any;
    assert('c2: real HTTP beacon check-in accepted', checkin.status === 200 && checkinBody.status === 'ok', JSON.stringify(checkinBody));

    const beacons = c2.server.getBeacons();
    console.log(`   beacons registered: ${beacons.length} (${beacons.map(b => b.id).join(', ')})`);
    assert('c2: beacon really registered', beacons.length === 1 && beacons[0].id === beaconId);
    assert('c2: beacon captured real metadata', beacons[0].hostname === 'lab-host' && beacons[0].ip.includes('127.0.0.1'),
        `${beacons[0].hostname}/${beacons[0].ip}`);
    assert('c2: beacon captured real user-agent', typeof beacons[0].agent === 'string' && beacons[0].agent.length > 0);

    const task = c2.beacon.taskBeacon(beaconId, 'whoami');
    const poll = await fetch(`http://127.0.0.1:${port}/task?beacon=${beaconId}`);
    const pollBody = await poll.json() as any;
    assert('c2: task really delivered over HTTP', pollBody.tasks?.length === 1 && pollBody.tasks[0].id === task.id, JSON.stringify(pollBody));

    await fetch(`http://127.0.0.1:${port}/result?task=${task.id}&out=root`);
    const done = c2.beacon.getTasks(beaconId).find(t => t.id === task.id)!;
    assert('c2: task result really recorded', done.status === 'COMPLETED' && done.result === 'root', `${done.status}/${done.result}`);

    const stager = c2.delivery.generateStager('http');
    assert('c2: stager is a real runnable script', stager.includes('urllib.request') && stager.includes('/beacon'), `${stager.length} chars`);
    fs.writeFileSync(path.join(ROOT, 'data', 'training_stager.py'), stager);

    const delivery = await c2.delivery.deliver('POST', `http://127.0.0.1:${port}/beacon?id=BCN-DELIVER`);
    assert('c2: payload delivery reports real HTTP status', delivery.success === true && delivery.status === 200, JSON.stringify(delivery));

    c2.server.stopAll();
    await new Promise(r => setTimeout(r, 150));
    const afterStop = await fetch(`http://127.0.0.1:${port}/beacon?id=BCN-AFTER`).catch(e => ({ status: 0 } as any));
    assert('c2: listener really stopped (port refuses)', afterStop.status === 0, `status=${afterStop.status}`);

    // ---------------------------------------------------------------- PURPLE
    console.log('\n=== PURPLE TEAM (real detection validation) ===');
    integratedArsenal.initialize('PURPLE', op);
    const purple = integratedArsenal.purpleTeam!;
    const ex = await purple.runPurpleExercise('Coverage Baseline', ['detect phishing', 'detect script execution']);
    console.log(`   detected=${ex.detected} missed=${ex.missed} coverage=${ex.coverage}% gaps=${ex.gaps.length}`);
    assert('purple: coverage is computed (not hardcoded 80)', typeof ex.coverage === 'number' && ex.coverage !== 80, `${ex.coverage}`);
    assert('purple: detected techniques counted', (ex.detected ?? 0) === 3, String(ex.detected));
    assert('purple: fully-covered baseline yields zero gaps', (ex.gaps?.length ?? 0) === 0, `${ex.gaps?.length}`);
    assert('purple: coverage equals detected/total', ex.coverage === Math.round((ex.detected! / 3) * 100), `${ex.coverage}`);

    // An exercise that includes an uncovered technique MUST produce a real gap and a real finding.
    const gapEx = await purple.runAdversaryEmulation({
        name: 'Uncovered technique probe',
        mitreTactics: ['Exfiltration'],
        mitreTechniques: ['T1041', 'T9999'],
        scenario: 'mixed coverage'
    });
    const gapValidation = await purple.validateDetections(gapEx);
    assert('purple: uncovered technique produces a real gap', gapValidation.missed === 1 && gapValidation.gaps.length === 1, JSON.stringify(gapValidation.gaps));
    assert('purple: mixed coverage computed as 50%', gapValidation.coverage === 50, `${gapValidation.coverage}`);

    // The gap must surface as a real finding in the audit-backed findings store.
    const gapEx2 = await purple.runPurpleExercise('Exercise with uncovered technique', ['emulate T9999'], ['T1566', 'T9999']);
    console.log(`   gap exercise: detected=${gapEx2.detected} missed=${gapEx2.missed} coverage=${gapEx2.coverage}% findings=${gapEx2.findings.length}`);
    assert('purple: exercise with uncovered technique reports 50% coverage', gapEx2.coverage === 50, `${gapEx2.coverage}`);
    assert('purple: exercise gap produced a real finding', gapEx2.findings.length === 1, `${gapEx2.findings.length}`);
    assert('purple: gap finding has a remediation', typeof gapEx2.findings[0]?.remediation === 'string' && gapEx2.findings[0].remediation.length > 0);
    const gapFindings = arsenalCore.getFindings({ category: 'detection_gap' });
    assert('purple: detection-gap findings recorded in core', gapFindings.length >= 1, `${gapFindings.length}`);

    const cv = await purple.continuousValidation();
    console.log(`   continuous validation: ${cv.passed}/${cv.tests} passed, coverage=${cv.coverage}%`);
    assert('purple: continuous validation computed from KB', cv.tests === 9 && cv.passed === 9, `${cv.passed}/${cv.tests}`);

    const missing = await purple.validateDetections({
        id: 'X', name: 'gap test', mitreTactics: ['Unknown'], mitreTechniques: ['T9999'], scenario: 'x', status: 'RUNNING'
    });
    assert('purple: unknown technique flagged as HIGH gap', missing.missed === 1 && missing.gaps[0].severity === 'HIGH', JSON.stringify(missing.gaps[0]));

    // ---------------------------------------------------------------- WEB + DEFENSIVE
    console.log('\n=== WEB ARSENAL (real HTTP crawl) ===');
    const webServer = http.createServer((req, res) => {
        if (req.url === '/login') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html><head><title>Real Lab Login</title></head><body>
                <form action="http://${req.headers.host}/session" method="GET">
                  <input name="username"><input type="password" name="password">
                </form>
                <a href="/dashboard">Dashboard</a>
                <script src="/static/app.js"></script>
            </body></html>`);
        } else if (req.url === '/admin') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><title>Admin</title></html>');
        } else {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<html>not found</html>');
        }
    });
    await new Promise<void>(r => webServer.listen(0, '127.0.0.1', r));
    const webPort = (webServer.address() as { port: number }).port;
    const webUrl = `http://127.0.0.1:${webPort}/login`;

    const { WebArsenal } = await import('../src/neo/arsenal/index.ts');
    const web = new WebArsenal(op);
    const crawl = await web.scanner.crawl({ url: webUrl });
    console.log(`   status=${crawl.status} title="${crawl.title}" links=${crawl.links?.length} forms=${crawl.forms?.length} scripts=${crawl.scripts?.length}`);
    assert('web: real HTTP fetch returned real status', crawl.status === 200, String(crawl.status));
    assert('web: real title parsed from HTML', crawl.title === 'Real Lab Login', crawl.title);
    assert('web: real links extracted', (crawl.links || []).length >= 1, String(crawl.links?.length));
    assert('web: real forms extracted with fields', (crawl.forms || []).length === 1 && crawl.forms[0].fields.length === 2, JSON.stringify(crawl.forms));
    assert('web: script src extracted', (crawl.scripts || []).length === 1, String(crawl.scripts?.length));

    const beforeWeb = arsenalCore.getFindings().length;
    const brute = await web.scanner.directoryBrute({ url: `http://127.0.0.1:${webPort}/` });
    console.log(`   dir brute: reachable=${brute.reachable} tested=${brute.tested} found=${brute.found.length}`);
    assert('web: directory discovery made real requests', brute.reachable === true && brute.tested > 10, `${brute.tested}`);
    assert('web: real sensitive path found', brute.found.some((f: any) => f.path.includes('/admin')), JSON.stringify(brute.found.map((f: any) => f.path)));
    assert('web: sensitive path produced a real finding', arsenalCore.getFindings().length > beforeWeb, `${arsenalCore.getFindings().length - beforeWeb}`);

    const unreachable = await web.scanner.crawl({ url: 'http://127.0.0.1:45399/' });
    assert('web: unreachable target reported honestly', unreachable.reachable === false && !!unreachable.error, JSON.stringify(unreachable.error));

    console.log('\n=== DEFENSIVE ARSENAL (real CIS benchmark) ===');
    const { DefensiveArsenal } = await import('../src/neo/arsenal/index.ts');
    const def = new DefensiveArsenal(op);
    const cis = await def.hardening.runCISBenchmark();
    console.log(`   CIS score=${cis.score} passed=${cis.passed} failed=${cis.failed} findings=${cis.findings.length}`);
    assert('defensive: CIS score computed from real checks (not 85)', cis.score !== 85, String(cis.score));
    assert('defensive: passed+failed equals control count', cis.passed + cis.failed === 6, `${cis.passed}+${cis.failed}`);
    assert('defensive: score matches pass ratio', cis.score === Math.round((cis.passed / (cis.passed + cis.failed)) * 100), `${cis.score}`);
    assert('defensive: findings emitted for failed controls', cis.findings.length === cis.failed, `${cis.findings.length}/${cis.failed}`);

    webServer.close();

    // ---------------------------------------------------------------- SUMMARY
    const findings = arsenalCore.getFindings();
    console.log(`\n[total findings recorded: ${findings.length}]`);
    console.log(`[audit entries: ${arsenalCore.getAuditLog().length}]`);
    assert('findings were emitted by real analysis', findings.length >= 3, `${findings.length}`);
    assert('audit trail grew', arsenalCore.getAuditLog().length > 30, String(arsenalCore.getAuditLog().length));

    fs.rmSync(samplePath, { force: true });
    console.log(`\nDEEP PROBE: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
    process.exit(failures === 0 ? 0 : 1);
}

main();
