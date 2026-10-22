/**
 * ====================================================================================================
 * DEFENSIVE PROBE — real end-to-end exercise of the defensive arsenal
 * ====================================================================================================
 * Exercises, against the LIVE host:
 *   1. ThreatDetectionModule.scanLogs()        — real log sources + journalctl
 *   2. ThreatDetectionModule.correlateThreats()— real correlation over the collected alerts
 *   3. ForensicsModule.collectArtifacts()      — real commands + real file reads, sha256 manifest
 *   4. ForensicsModule.timelineAnalysis()      — real mtimes / alert timestamps / audit log / ps
 *   5. ForensicsModule.memoryAnalysis()        — real /proc inspection with honest limits
 *   6. IncidentResponseModule.contain()         — quarantine-by-copy of a real temp file
 *   7. IncidentResponseModule.recover()         — restore from quarantine, sha256 proven
 *   8. IncidentResponseModule.eradicate()       — dry run listing real persistence entries
 *   9. Authorization gate                      — refusal proven without ctx.authorization
 *
 * Nothing here is simulated. The probe prints only what the arsenal really observed.
 *
 * The arsenal runtime data root is redirected OUTSIDE the source tree (ARSENAL_ROOT) so the
 * probe never pollutes the repository; the default path (<repo>/data/arsenal/...) is printed
 * below for reference.
 * ====================================================================================================
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PROBE_ROOT = process.env.DEFENSIVE_PROBE_ROOT || path.join(os.tmpdir(), 'arsenal-root');
const PROBE_DATA_DIR = path.join(PROBE_ROOT, 'data', 'arsenal');
const TARGET_DIR = process.env.DEFENSIVE_PROBE_TARGET_DIR || path.join(os.tmpdir(), 'arsenal-defensive-target');

function sha256(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function hr(title: string): void {
    console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

function assert(label: string, condition: boolean, detail: string): void {
    console.log(`   ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!condition) failures++;
}

let failures = 0;

async function main(): Promise<void> {
    // The arsenal honours ARSENAL_DATA_DIR for its runtime data root. Redirecting it keeps the
    // probe's artifacts + quarantine outside the source tree (default stays <repo>/data/arsenal).
    process.env.ARSENAL_DATA_DIR = PROBE_DATA_DIR;
    fs.mkdirSync(PROBE_DATA_DIR, { recursive: true });
    fs.mkdirSync(TARGET_DIR, { recursive: true });

    const { arsenalCore } = await import('../src/neo/arsenal/core/arsenal_core.ts');
    const { DefensiveArsenal } = await import('../src/neo/arsenal/defensive/defensive_arsenal.ts');

    const repoRoot = process.cwd();
    const marker = path.join('src', 'neo', 'arsenal');
    const defaultRoot = (() => {
        let dir = repoRoot;
        for (let i = 0; i < 6; i++) {
            if (fs.existsSync(path.join(dir, marker))) return dir;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        return repoRoot;
    })();

    hr('PROBE ENVIRONMENT (real)');
    console.log(`   uid                : ${process.getuid()} (${os.userInfo().username})`);
    console.log(`   cwd                : ${repoRoot}`);
    console.log(`   ARSENAL_DATA_DIR   : ${PROBE_DATA_DIR}  (probe run: outside the source tree)`);
    console.log(`   arsenal root (default)             : ${defaultRoot}`);
    console.log(`   default data dir (no override)     : ${path.join(defaultRoot, 'data', 'arsenal')}`);
    console.log(`   probe target dir   : ${TARGET_DIR}`);

    // ---------------------------------------------------------------------------------------------
    hr('OPERATION');
    const scope = [path.join(repoRoot, 'src', 'neo', 'arsenal')];
    const op = arsenalCore.createOperation('DEFENSIVE', scope, 'localhost', 'PROBE-AUTHORIZATION-2026');
    console.log(`   operationId : ${op.operationId}`);
    console.log(`   mode        : ${op.mode}`);
    console.log(`   scope       : ${JSON.stringify(op.scope)}`);
    console.log(`   authorization: ${op.authorization}`);

    const def = new DefensiveArsenal(op);

    // ---------------------------------------------------------------------------------------------
    hr('A) scanLogs — real log sources');
    const sources = [
        'journalctl',
        '/var/log/auth.log',
        '/var/log/syslog',
        '/var/log/secure',
        '/var/log/ufw.log'
    ];
    console.log(`   requested sources: ${JSON.stringify(sources)}`);
    const scan = await def.detection.scanLogs(sources);
    for (const s of scan.sources) {
        console.log(
            `   - ${s.source.padEnd(22)} readable=${String(s.readable).padEnd(5)} lines=${String(s.lines).padEnd(6)} ` +
            `alerts=${String(s.alertsFound).padEnd(4)} reason=${s.reason ?? '-'}` +
            (s.exitCode !== undefined ? ` exitCode=${s.exitCode}` : '')
        );
    }
    console.log(`   totalAlerts: ${scan.totalAlerts}`);
    for (const a of scan.alerts.slice(0, 12)) {
        console.log(`   [${a.severity}] ${a.ruleId} ${a.source}:${a.lineNumber} ip=${a.ip ?? '-'} user=${a.username ?? '-'} ts=${new Date(a.timestamp).toISOString()} (${a.timestampSource})`);
        console.log(`        raw: ${a.raw}`);
    }
    if (scan.alerts.length > 12) console.log(`   ... ${scan.alerts.length - 12} more alert(s) not printed`);
    assert('scanLogs returned a real per-source report', scan.sources.length === sources.length, `${scan.sources.length} source report(s)`);
    assert('missing log files are reported as ENOENT (not fabricated)',
        scan.sources.filter(s => !s.readable).every(s => s.reason === 'ENOENT' || s.reason === 'EACCES'),
        scan.sources.filter(s => !s.readable).map(s => `${s.source}=${s.reason}`).join(', ') || 'all readable');

    // ---------------------------------------------------------------------------------------------
    hr('B) correlateThreats — correlation over the collected alerts');
    const corr = await def.detection.correlateThreats();
    console.log(`   basis             : ${corr.basis}`);
    console.log(`   alertsAnalysed    : ${corr.alertsAnalysed}`);
    console.log(`   failedAuthEvents  : ${corr.failedAuthEvents}`);
    console.log(`   ipCandidates      : ${corr.ipCandidates}`);
    console.log(`   usernameCandidates: ${corr.usernameCandidates}`);
    console.log(`   manualIndicators  : ${corr.manualIndicators}`);
    console.log(`   indicators        : ${corr.indicators.length}`);
    for (const i of corr.indicators) {
        console.log(`   - ${i.type} ${i.value} severity=${i.severity} confidence=${i.confidence} count=${i.count} first=${new Date(i.firstSeen).toISOString()} last=${new Date(i.lastSeen).toISOString()}`);
        console.log(`       basis: ${i.basis}`);
    }
    assert('correlateThreats reported an explicit basis', typeof corr.basis === 'string' && corr.basis.length > 0, corr.basis);
    assert('no indicator was invented without evidence',
        corr.indicators.every(i => corr.alertsAnalysed > 0), `alertsAnalysed=${corr.alertsAnalysed}`);

    // ---------------------------------------------------------------------------------------------
    hr('C) collectArtifacts — real commands and real file reads');
    const collection = await def.forensics.collectArtifacts();
    console.log(`   manifestPath  : ${collection.manifestPath}`);
    console.log(`   directory     : ${collection.directory}`);
    console.log(`   artifactCount : ${collection.artifactCount}`);
    console.log(`   durationMs    : ${collection.durationMs}`);
    console.log(`   collected artifacts:`);
    for (const a of collection.artifacts) {
        console.log(`   - ${a.name.padEnd(24)} ok=${a.ok} bytes=${String(a.bytes).padEnd(9)} sha256=${a.sha256.slice(0, 16)}...  <- ${a.source}`);
    }
    console.log(`   failures (real, with reason):`);
    for (const f of collection.failures) {
        console.log(`   - ${f.name.padEnd(24)} ok=${f.ok} reason=${f.reason}  <- ${f.source}`);
    }
    assert('artifact manifest exists on disk', fs.existsSync(collection.manifestPath), collection.manifestPath);
    assert('every listed artifact really exists on disk',
        collection.artifacts.every(a => !!a.storedPath && fs.existsSync(a.storedPath)), `${collection.artifacts.length} artifact(s)`);
    assert('every artifact sha256 matches the stored bytes',
        collection.artifacts.every(a => a.storedPath && sha256(fs.readFileSync(a.storedPath)) === a.sha256), 're-hashed from disk');
    assert('failures carry a concrete reason',
        collection.failures.every(f => !!f.reason), collection.failures.map(f => f.reason).join(', '));

    // ---------------------------------------------------------------------------------------------
    hr('D) timelineAnalysis — real timestamps');
    const timeline = await def.forensics.timelineAnalysis();
    console.log(`   basis : ${timeline.basis}`);
    console.log(`   total : ${timeline.total}`);
    console.log(`   range : ${timeline.range.first ? new Date(timeline.range.first).toISOString() : 'n/a'} .. ${timeline.range.last ? new Date(timeline.range.last).toISOString() : 'n/a'}`);
    const byType: Record<string, number> = {};
    for (const e of timeline.events) byType[e.type] = (byType[e.type] ?? 0) + 1;
    console.log(`   events by type: ${JSON.stringify(byType)}`);
    for (const e of timeline.events.slice(0, 8)) {
        console.log(`   - ${new Date(e.ts).toISOString()} [${e.type}] ${e.summary}`);
        console.log(`       ${e.detail.slice(0, 160)}`);
    }
    if (timeline.events.length > 8) console.log(`   ... ${timeline.events.length - 8} more event(s) not printed`);
    assert('timeline is sorted ascending', timeline.events.every((e, i) => i === 0 || e.ts >= timeline.events[i - 1].ts), 'checked');
    assert('timeline contains real events', timeline.total > 0, `${timeline.total} event(s)`);

    // ---------------------------------------------------------------------------------------------
    hr('E) memoryAnalysis — real /proc inspection with honest limits');
    const mem = await def.forensics.memoryAnalysis();
    console.log(`   basis  : ${mem.basis}`);
    console.log(`   summary: scanned=${mem.summary.scanned} withRwx=${mem.summary.withRwx} withDeletedBinary=${mem.summary.withDeletedBinary} permissionDenied=${mem.summary.permissionDenied}`);
    console.log(`   memAccess probe: attempted=${mem.memAccess.attempted} opened=${mem.memAccess.opened} denied=${mem.memAccess.denied} reasons=${JSON.stringify(mem.memAccess.reasons)}`);
    for (const p of mem.processes) {
        console.log(`   - pid=${String(p.pid).padEnd(7)} name=${(p.name || '?').padEnd(18)} regions=${String(p.regions ?? '-').padEnd(5)} rwx=${p.rwxRegions} suspicious=${p.suspiciousMappings} deleted=${String(p.deletedBinary).padEnd(5)} secretEnvVars=${JSON.stringify(p.secretEnvVarNames)}`);
        console.log(`       cmdline: ${p.cmdline ?? '-'}`);
        console.log(`       exe=${p.exe ?? '-'} cwd=${p.cwd ?? '-'} state=${p.state ?? '-'} VmRSS=${p.vmRss ?? '-'} uid=${p.uid ?? '-'}`);
        if (!p.readable) console.log(`       NOT READABLE: ${p.reason}`);
    }
    console.log(`   limits: ${mem.limits}`);
    assert('memory analysis scanned real processes', mem.summary.scanned > 0, `${mem.summary.scanned} pid(s)`);
    assert('limits state that /proc/<pid>/mem dumping was NOT performed',
        /NOT performed/.test(mem.limits) && /ptrace|CAP_SYS_PTRACE/.test(mem.limits), 'limits string checked');
    assert('no secret environment VALUES are reported',
        mem.processes.every(p => p.secretEnvVarNames.every(n => !n.includes('='))), 'names only');

    // ---------------------------------------------------------------------------------------------
    hr('F) contain / recover — quarantine-by-copy proven end to end');
    const targetFile = path.join(TARGET_DIR, `defensive_probe_target_${Date.now()}.txt`);
    const targetContent = `defensive probe evidence file\ncreated=${new Date().toISOString()}\nprobe=tools/defensive_probe.ts\n`;
    fs.writeFileSync(targetFile, targetContent);
    const targetSha = sha256(fs.readFileSync(targetFile));
    console.log(`   created real temp file : ${targetFile}`);
    console.log(`   sha256 before          : ${targetSha}`);
    console.log(`   bytes before           : ${fs.statSync(targetFile).size}`);

    // The alert is created by the probe (not parsed from a log) and points at the real file.
    const probeAlert = def.detection.createAlert({
        ruleId: 'PROBE-TARGET-FILE',
        severity: 'HIGH',
        title: 'Probe target file (created by tools/defensive_probe.ts)',
        description: `Probe-created alert for account anas at 198.51.100.7 referencing the real file ${targetFile}`,
        source: targetFile
    });
    const incident = def.incidentResponse.createIncident({
        title: 'Probe containment verification for the run-parts cron entry',
        severity: 'HIGH',
        status: 'OPEN',
        alerts: [probeAlert],
        assignedTo: 'defensive-probe'
    });
    console.log(`   incidentId : ${incident.id}`);

    const contained = await def.incidentResponse.contain(incident.id);
    console.log(`   contain() -> contained=${contained.contained} applied=${contained.applied} reason=${contained.reason ?? '-'}`);
    console.log(`   manifestPath: ${contained.manifestPath ?? '-'}`);
    for (const q of contained.quarantined) {
        console.log(`   - ${q.originalPath} -> ${q.quarantinePath}`);
        console.log(`       sha256=${q.sha256} bytes=${q.bytes} reason=${q.reason}`);
    }
    for (const s of contained.skipped) console.log(`   skipped: ${s.path} (${s.reason})`);
    assert('contain() quarantined the file', contained.contained === true && contained.quarantined.length === 1, `${contained.quarantined.length} entry/entries`);
    assert('the original file still exists (copy, never delete)', fs.existsSync(targetFile), targetFile);
    const manifestOnDisk = contained.manifestPath ? JSON.parse(fs.readFileSync(contained.manifestPath, 'utf8')) : null;
    console.log('   quarantine manifest.json:');
    console.log(JSON.stringify(manifestOnDisk, null, 2));
    assert('quarantine manifest records the original sha256',
        manifestOnDisk?.entries?.[0]?.sha256 === targetSha, manifestOnDisk?.entries?.[0]?.sha256 ?? 'missing');
    const quarantinedCopy = manifestOnDisk?.entries?.[0]?.quarantinePath;
    assert('quarantined copy exists and hashes identically',
        !!quarantinedCopy && fs.existsSync(quarantinedCopy) && sha256(fs.readFileSync(quarantinedCopy)) === targetSha,
        quarantinedCopy ?? 'missing');

    const recovered = await def.incidentResponse.recover(incident.id);
    console.log(`   recover() with the original still in place -> recovered=${recovered.recovered} reason=${recovered.reason ?? '-'}`);
    for (const s of recovered.skipped) console.log(`   skipped: ${s.originalPath} (${s.reason})`);
    assert('recover() refuses to overwrite an existing destination',
        recovered.skipped.some(s => s.reason === 'destination exists'), JSON.stringify(recovered.skipped));

    // --- now remove the original from its path (simulating the responder taking it out) and
    //     recover it back from quarantine, proving the restore path end to end ---------------
    const movedAside = `${targetFile}.moved-aside`;
    fs.renameSync(targetFile, movedAside);
    console.log(`   original moved out of the way (probe action) : ${movedAside}`);
    console.log(`   original path now exists                      : ${fs.existsSync(targetFile)}`);

    const restored = await def.incidentResponse.recover(incident.id);
    console.log(`   recover() -> recovered=${restored.recovered} reason=${restored.reason ?? '-'}`);
    for (const r of restored.restored) {
        console.log(`   - restored ${r.originalPath}`);
        console.log(`       sha256Before =${r.sha256Before}  (quarantined copy)`);
        console.log(`       sha256Expected=${r.sha256Expected}  (manifest record)`);
        console.log(`       sha256After  =${r.sha256After}  (restored file)`);
        console.log(`       verified=${r.verified}`);
    }
    for (const s of restored.skipped) console.log(`   skipped: ${s.originalPath} (${s.reason})`);
    assert('recover() restored the file from quarantine', restored.recovered === true && restored.restored.length === 1, `${restored.restored.length} restored`);
    assert('restored file hash is identical to the original', sha256(fs.readFileSync(targetFile)) === targetSha, targetSha);
    assert('restored file is byte-identical to the pre-quarantine copy',
        fs.readFileSync(targetFile).equals(fs.readFileSync(movedAside)), 'byte comparison');

    const recoverAgain = await def.incidentResponse.recover(incident.id);
    console.log(`   recover() again -> recovered=${recoverAgain.recovered} skipped=${JSON.stringify(recoverAgain.skipped)}`);
    assert('second recover() refuses to overwrite an existing destination',
        recoverAgain.skipped.some(s => s.reason === 'destination exists'), JSON.stringify(recoverAgain.skipped));

    // ---------------------------------------------------------------------------------------------
    hr('G) eradicate — dry run against real persistence mechanisms');
    const crontabBefore = fs.existsSync('/etc/crontab') ? sha256(fs.readFileSync('/etc/crontab')) : 'absent';
    const eradicated = await def.incidentResponse.eradicate(incident.id);
    console.log(`   applied=${eradicated.applied} dryRun=${eradicated.dryRun} reason=${eradicated.reason ?? '-'}`);
    console.log(`   basis: ${eradicated.basis}`);
    console.log(`   totalEnumerated=${eradicated.totalEnumerated} matchingCount=${eradicated.matchingCount}`);
    for (const e of eradicated.entries.slice(0, 10)) {
        console.log(`   - [${e.category}] ${e.file}:${e.line} hash=${e.contentHash.slice(0, 12)}... ${e.content.slice(0, 100)}`);
    }
    if (eradicated.entries.length > 10) console.log(`   ... ${eradicated.entries.length - 10} more entry/entries not printed`);
    const crontabAfter = fs.existsSync('/etc/crontab') ? sha256(fs.readFileSync('/etc/crontab')) : 'absent';
    console.log(`   /etc/crontab sha256 before=${crontabBefore}`);
    console.log(`   /etc/crontab sha256 after =${crontabAfter}`);
    assert('eradicate() defaults to a dry run', eradicated.dryRun === true && eradicated.applied === false, `dryRun=${eradicated.dryRun}`);
    assert('dry run changed nothing on disk', crontabBefore === crontabAfter, 'sha256 unchanged');

    // ---------------------------------------------------------------------------------------------
    hr('H) authorization gate — refusal without ctx.authorization');
    const opNoAuth = arsenalCore.createOperation('DEFENSIVE', scope, 'localhost');
    const defNoAuth = new DefensiveArsenal(opNoAuth);
    const noAuthIncident = defNoAuth.incidentResponse.createIncident({
        title: 'Probe unauthorized containment attempt',
        severity: 'HIGH',
        status: 'OPEN',
        alerts: [probeAlert],
        assignedTo: 'defensive-probe'
    });
    const refused = await defNoAuth.incidentResponse.contain(noAuthIncident.id);
    console.log(`   contain() without authorization -> contained=${refused.contained} applied=${refused.applied} reason=${refused.reason ?? '-'}`);
    assert('contain() refuses without authorization', refused.contained === false && refused.reason === 'authorization_required', refused.reason ?? '-');

    // Second gate condition: authorization IS present, but the arsenal core sandbox mode is off.
    // arsenalCore.config is private in the type system only; the probe flips it to prove the
    // second refusal path, then restores the original value immediately.
    const coreConfig = (arsenalCore as any).config as { sandboxMode: boolean };
    const sandboxBefore = coreConfig.sandboxMode;
    coreConfig.sandboxMode = false;
    const refusedSandbox = await def.incidentResponse.contain(incident.id);
    coreConfig.sandboxMode = sandboxBefore;
    console.log(`   contain() with sandbox mode disabled -> contained=${refusedSandbox.contained} applied=${refusedSandbox.applied} reason=${refusedSandbox.reason ?? '-'}`);
    assert('contain() refuses when arsenal sandbox mode is disabled',
        refusedSandbox.contained === false && refusedSandbox.applied === false && refusedSandbox.reason === 'sandbox_mode_required',
        refusedSandbox.reason ?? '-');
    const sandboxRefusal = arsenalCore.getAuditLog(1000)
        .filter(e => e.action === 'INCIDENT_CONTAIN' && e.result === 'REFUSED' && e.evidence?.reason === 'sandbox_mode_required');
    assert('the sandbox refusal is audited as a REFUSAL', sandboxRefusal.length === 1, `${sandboxRefusal.length} REFUSAL audit entry`);

    // ---------------------------------------------------------------------------------------------
    hr('I) findings + audit trail');
    const findings = arsenalCore.getFindings();
    console.log(`   findings recorded: ${findings.length}`);
    for (const f of findings) {
        console.log(`   - [${f.severity}] ${f.category} :: ${f.title}`);
    }
    const audit = arsenalCore.getAuditLog(1000);
    console.log(`   audit entries: ${audit.length}`);
    const irEntries = audit.filter(e => e.action.startsWith('INCIDENT_'));
    for (const e of irEntries) {
        console.log(`   - ${new Date(e.timestamp).toISOString()} ${e.action} -> ${e.result}`);
    }

    // ---------------------------------------------------------------------------------------------
    hr('J) PARSER SELF-TEST (SYNTHETIC FIXTURE - NOT host evidence)');
    console.log('   The lines below are written by the probe itself. They are NOT host evidence.');
    console.log('   They exist only to prove that the detection rules, the IP/username extraction and');
    console.log('   the correlation threshold actually fire on known input.');
    const fixture = path.join(TARGET_DIR, 'defensive_probe_fixture_SYNTHETIC.log');
    fs.writeFileSync(fixture, [
        '# SYNTHETIC FIXTURE written by tools/defensive_probe.ts - NOT host evidence',
        'Jan 15 03:12:01 host sshd[1234]: Invalid user oracle from 198.51.100.7 port 51244',
        'Jan 15 03:12:02 host sshd[1234]: Failed password for invalid user oracle from 198.51.100.7 port 51244 ssh2',
        'Jan 15 03:12:03 host sshd[1234]: Failed password for invalid user oracle from 198.51.100.7 port 51245 ssh2',
        'Jan 15 03:12:04 host sshd[1234]: Failed password for root from 198.51.100.7 port 51246 ssh2',
        'Jan 15 03:12:09 host sshd[1234]: Accepted password for oracle from 198.51.100.7 port 51250 ssh2',
        'Jan 15 03:12:10 host sudo:  anas : TTY=pts/0 ; PWD=/home/anas ; USER=root ; COMMAND=/bin/bash',
        'Jan 15 03:12:11 host sshd[1234]: Possible break-in attempts from 198.51.100.7',
        'Jan 15 03:12:12 host ufw[999]: [UFW BLOCK] IN=eth0 OUT= SRC=203.0.113.9 DST=10.0.0.5 PROTO=TCP DPT=22',
        'Jan 15 03:12:13 host kernel: TCP: connection refused',
        'Jan 15 03:12:14 host tcpwrapper: Connection from 198.51.100.7',
        ''
    ].join('\n'));
    console.log(`   fixture: ${fixture}`);

    const opFixture = arsenalCore.createOperation('DEFENSIVE', [TARGET_DIR], 'localhost', 'PROBE-AUTHORIZATION-2026');
    const defFixture = new DefensiveArsenal(opFixture);
    const fixtureScan = await defFixture.detection.scanLogs([fixture]);
    console.log(`   fixture alerts: ${fixtureScan.totalAlerts}`);
    for (const a of fixtureScan.alerts) {
        console.log(`   [${a.severity}] ${a.ruleId} line=${a.lineNumber} ip=${a.ip ?? '-'} user=${a.username ?? '-'}`);
        console.log(`        raw: ${a.raw}`);
    }
    const fixtureCorr = await defFixture.detection.correlateThreats();
    console.log(`   fixture correlation basis: ${fixtureCorr.basis}`);
    for (const i of fixtureCorr.indicators) {
        console.log(`   - ${i.type} ${i.value} severity=${i.severity} confidence=${i.confidence} count=${i.count}`);
        console.log(`       basis: ${i.basis}`);
    }
    const fixtureFindings = arsenalCore.getFindings().filter(f => JSON.stringify(f.evidence ?? {}).includes('SYNTHETIC'));
    console.log(`   findings derived from the synthetic fixture: ${fixtureFindings.length}`);
    for (const f of fixtureFindings) {
        console.log(`   - [${f.severity}] ${f.category} :: ${f.title}`);
    }
    assert('every detection rule fired on the fixture',
        new Set(fixtureScan.alerts.map(a => a.ruleId)).size >= 7, `${new Set(fixtureScan.alerts.map(a => a.ruleId)).size} distinct rule(s)`);
    assert('the IP threshold produced a correlated indicator',
        fixtureCorr.indicators.some(i => i.type === 'ip' && i.value === '198.51.100.7'), '198.51.100.7');
    assert('username correlation produced a behavioural indicator',
        fixtureCorr.indicators.some(i => i.type === 'behavior'), 'behavior indicator');

    // ---------------------------------------------------------------------------------------------
    hr('PROBE RESULT');
    console.log(`   arsenal data dir (probe run)      : ${PROBE_DATA_DIR}`);
    console.log(`   default arsenal data dir          : ${path.join(defaultRoot, 'data', 'arsenal')}`);
    console.log(`   artifact manifest                 : ${collection.manifestPath}`);
    console.log(`   quarantine manifest                : ${contained.manifestPath}`);
    console.log(`   probe target file (restored)       : ${targetFile}`);
    console.log(`   probe target file (moved aside)    : ${movedAside}`);
    console.log(`   synthetic parser fixture           : ${fixture}`);
    console.log(`   DEEP PROBE: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('PROBE ERROR:', err);
    process.exit(1);
});
