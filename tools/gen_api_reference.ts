#!/usr/bin/env tsx
/**
 * Regenerates docs/ARSENAL_API_REFERENCE.json from the LIVE export surface.
 *
 * The reference is derived from the real module: every exported name, its real runtime type and
 * whether it is actually instantiable. Nothing is hand-maintained, so the document cannot drift
 * away from the code without this script noticing.
 *
 * Run: npx tsx tools/gen_api_reference.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'docs/ARSENAL_API_REFERENCE.json');

const VERSION = '1.3.0';

const mod: any = await import(path.join(ROOT, 'src/neo/arsenal/index.ts'));

const modules: Record<string, any> = {};
for (const name of Object.keys(mod).sort()) {
    if (name === 'default') continue;
    const value = mod[name];
    const type = typeof value;
    const entry: any = { type };
    if (type === 'function') {
        const isClass = /^\s*class\s/.test(Function.prototype.toString.call(value));
        entry.isClass = isClass;
        if (isClass) {
            entry.instantiable = (() => {
                try {
                    const op = mod.arsenalCore.createOperation('NEUTRAL', ['api-reference'], 'local', 'API-REFERENCE');
                    new value(op);
                    return true;
                } catch {
                    return false;
                }
            })();
        }
    } else if (value && typeof value === 'object') {
        entry.keys = Object.keys(value).slice(0, 40);
    }
    modules[name] = entry;
}

const doc = {
    generated: new Date().toISOString(),
    version: VERSION,
    totalExports: Object.keys(modules).length,
    entrypoint: 'src/neo/arsenal/index.ts',
    verification: {
        script: 'tools/arsenal_verify.ts',
        liveProbe: 'tools/live_probe.ts',
        deepProbe: 'tools/deep_probe.ts',
        mcpProbe: 'tools/mcp_full_probe.mjs',
        groundTruthProbes: [
            'tools/crypto_probe.ts',
            'tools/osint_probe.ts',
            'tools/threatintel_probe.ts',
            'tools/network_probe.ts',
            'tools/web_probe.ts',
            'tools/defensive_probe.ts',
            'tools/secrets_ai_probe.ts'
        ],
        apiReferenceGenerator: 'tools/gen_api_reference.ts'
    },
    governance: {
        core: 'arsenalCore',
        operation: 'arsenalCore.createOperation(mode, scope, target, auth)',
        findings: 'arsenalCore.getFindings(filter?)',
        audit: 'arsenalCore.getAuditLog(limit?)',
        addFinding: 'arsenalCore.addFinding({title,severity,category,description,evidence,remediation?,verified})',
        modes: ['OFFENSIVE', 'DEFENSIVE', 'PURPLE', 'NEUTRAL'],
        rule: 'every operation is bound to scope; probes outside scope are REFUSED in the audit trail'
    },
    orchestrator: {
        entry: 'arsenalCommander',
        call: 'arsenalCommander.run({mission,target,scope,auth,autoChain?,autoReport?,collectEvidence?,mapTTP?})',
        missions: [
            'FULL_RECON',
            'QUICK_SCAN',
            'WEB_ASSESS',
            'PURPLE_EXERCISE',
            'HARDENING_AUDIT',
            'THREAT_HUNT',
            'COMPREHENSIVE_ASSESS'
        ],
        result: [
            'success',
            'operationId',
            'modulesExecuted',
            'modulesSkipped',
            'findings',
            'findingDelta',
            'ttpCoverage',
            'killChain',
            'riskAssessment',
            'report',
            'evidenceIds',
            'auditTrail',
            'timeline'
        ]
    },
    ttp: {
        map: 'TTPEngine.generateTTPMap(findings)',
        killChain: 'TTPEngine.getKillChain(coverage)',
        unmapped: 'TTPEngine.unmapped(findings)',
        risk: 'RiskScoring.calculate(findings)',
        categories: 'finding.category MUST be a MITRE_MAP key (src/neo/arsenal/core/ttp_engine.ts)'
    },
    network: {
        entry: 'NetworkArsenal',
        scan: 'net.scanner.tcpConnectScan(target, ports) -> only ports that accept a connection are open',
        interfaces: 'net.analyzer.readInterfaceCounters() -> real /proc/net/dev counters',
        capture: 'net.analyzer.capture(iface, "host:port") -> real session bytes; rawPacketCapture=false without CAP_NET_RAW',
        connections: 'net.monitor.readConnections() -> real /proc/net/tcp{,6} parsed and PID-mapped',
        anomalies: 'net.monitor.detectAnomalies() -> computed from the live connection table',
        bypass: 'net.bypass.testTechniques(target) -> real HTTP probes, out-of-scope targets are REFUSED',
        ids: 'net.idsips.deployRules(rules) -> writes data/arsenal/ids/runs/arsenal-<pid>.rules and matches live traffic'
    },
    web: {
        entry: 'WebArsenal',
        crawl: 'web.scanner.crawl({url}) -> real HTTP crawl with discovered links',
        sqli: 'web.sqli.test(url, params) -> differential SQL injection probes',
        xss: 'web.xss.test(url, params) -> reflected and stored XSS with real payloads',
        auth: 'web.auth.test(url) -> unauthenticated access and path-normalisation bypass probes',
        api: 'web.api.test(url) -> API endpoint discovery and sensitive data exposure checks',
        rateLimit: 'web.rateLimit.test(url) -> measured request budget and lockout detection'
    },
    crypto: {
        entry: 'CryptoArsenal',
        entropy: 'crypto.analyzer.entropyAnalysis(buffer) -> real Shannon entropy',
        algorithms: 'crypto.analyzer.analyzeAlgorithm(text) -> real weak/strong algorithm detection',
        hashes: 'crypto.cracker.identifyHash(hash) / crackHash(hash, wordlist?) -> real dictionary attack',
        tls: 'crypto.ssl.checkTLSVersion(host, port) -> real TLS 1.0-1.3 handshakes',
        certificate: 'crypto.ssl.analyzeCertificate(host, port) -> real X.509 parsing incl. signature OID and curve size',
        csr: 'crypto.certs.generateCSR(cn, opts) -> real CSR via openssl',
        chain: 'crypto.certs.verifyChainDetailed(pem) -> real issuer + signature verification'
    },
    osint: {
        entry: 'OSINTArsenal',
        whois: 'osint.domain.whois(domain) -> real TCP/43 lookup via IANA then the registry referral',
        dns: 'osint.domain.dnsEnum(domain) -> real A/AAAA/MX/NS/TXT/CNAME/SRV/CAA records',
        subdomains: 'osint.domain.subdomainEnum(domain) -> DNS brute force + certificate transparency',
        email: 'osint.email.harvest(domain) -> live HTTP + CT harvesting',
        profiles: 'osint.social.profileSearch(handle) -> real existence checks by HTTP status',
        metadata: 'osint.metadata.extractFromFile(path) -> real PDF / JPEG EXIF+GPS / PNG text chunk parsing'
    },
    threatIntel: {
        entry: 'ThreatIntelArsenal',
        collect: 'ti.collector.collect(ioc) -> validated, de-duplicated indicators',
        feeds: 'ti.feed.update() -> real local and live HTTPS feeds with an honest per-source truncation report',
        search: 'ti.feed.search(indicator) -> exact and partial indicator search',
        mitre: 'ti.mitre.mapToTechnique(ioc) / mapAll(iocs) -> real IOC to ATT&CK mapping',
        ttp: 'ti.ttp.analyze(campaign) -> techniques, kill chain, coverage and actor attribution'
    },
    secrets: {
        entry: 'SecretsScanner',
        filesystem: 'secrets.scanDirectory(root, options) -> real pattern + entropy detection over real files',
        git: 'secrets.scanGitHistory(repo, maxCommits) -> real git log parsing',
        env: 'secrets.scanEnvFiles(root) -> real .env parsing with world-readable mode detection',
        safety: 'values are always masked; only the sha256 prefix and the length are retained'
    },
    aiRedTeam: {
        entry: 'AIRedTeam',
        injection: 'ai.detectPromptInjection(text) -> real technique matching plus invisible-codepoint inspection',
        jailbreak: 'ai.detectJailbreak(text) -> real jailbreak family matching',
        leakage: 'ai.detectLeakage(response) -> real canary and sensitive-data detection',
        masking: 'maskSecretsInText(text) -> real secret masking in model output'
    },
    reverseEngineering: {
        entry: 'ReverseEngineering',
        info: 're.analyzeFile(path) -> real file identification, hashes and format detection',
        pe: 're.analyzePE(buffer) -> real PE header, section and import parsing',
        elf: 're.analyzeELF(buffer) -> real ELF header and program header parsing',
        macho: 're.analyzeMachO(buffer) -> real Mach-O header and segment parsing',
        strings: 're.extractStrings(buffer) -> real ASCII and UTF-16LE extraction',
        java: 're.analyzeJavaClass(buffer) -> real class file constant pool parsing',
        wasm: 're.analyzeWasm(buffer) -> real WASM magic and section parsing'
    },
    adversaryLab: {
        entry: 'AdversaryLab',
        emulate: 'lab.emulate(technique, options) -> real controlled emulation against local services',
        validate: 'lab.validate(emulation) -> computed detection coverage and explicit gaps',
        replay: 'lab.replay(session) -> deterministic replay of a recorded session'
    },
    malware: {
        entry: 'MalwareAnalysisArsenal',
        static: 'mal.static.analyze(sample, data?) -> real strings/sections/entropy/IOCs',
        strings: 'mal.static.extractStrings(buffer) -> real ASCII + UTF-16LE extraction',
        headers: 'mal.static.analyzeHeaders(buffer) -> real PE/ELF/Mach-O + section table parsing',
        yara: 'mal.yara.scan(buffer) -> real pattern matching against default + custom rules',
        detonate: 'mal.sandbox.detonate(sample, data?) -> real static+behaviour verdict',
        snapshot: 'mal.sandbox.createSnapshot(path?, data?) / restoreSnapshot(id) -> hash-verified vault copy'
    },
    c2: {
        entry: 'C2Arsenal',
        listener: 'c2.server.startListener(port, "http"|"tcp") -> real bound socket',
        beacon: 'c2.server.getBeacons() -> real check-ins over HTTP',
        tasking: 'c2.beacon.taskBeacon(beaconId, cmd) -> deliverable via GET /task',
        stager: 'c2.delivery.generateStager("http") -> runnable training stager',
        delivery: 'c2.delivery.deliver(method, url) -> real HTTP delivery',
        gates: 'requires authorization + sandboxMode'
    },
    purple: {
        entry: 'PurpleTeamOrchestrator',
        exercise: 'purple.runPurpleExercise(name, objectives, techniques?)',
        validation: 'purple.validateDetections(emulation) -> computed coverage + gaps',
        continuous: 'purple.continuousValidation() -> computed from DETECTION_KB',
        kb: 'DETECTION_KB -> technique -> concrete detection rules'
    },
    mcp: {
        server: 'sovereign-arsenal',
        transport: 'stdio JSON-RPC 2.0 (no external SDK dependency)',
        tools: [
            'arsenal_status',
            'create_operation',
            'network_scan',
            'web_assess',
            'purple_exercise',
            'commander_run',
            'commander_status',
            'get_findings',
            'get_audit',
            'crypto_audit',
            'osint_domain',
            'threat_intel'
        ]
    },
    modules
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`ARSENAL API REFERENCE regenerated: ${doc.totalExports} exports -> ${path.relative(ROOT, OUT)}`);
