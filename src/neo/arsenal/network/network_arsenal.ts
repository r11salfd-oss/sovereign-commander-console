/**
 * ====================================================================================================
 * NETWORK ARSENAL - OFFENSIVE/DEFENSIVE NETWORK OPERATIONS
 *
 * The TCP/UDP scanning core performs real socket probes. Everything that used to return an empty
 * array now works against real system state:
 *   - live interface counters read from /proc/net/dev
 *   - the real connection table parsed from /proc/net/tcp and /proc/net/tcp6, mapped to PIDs
 *   - a real IDS rule engine that evaluates deployed rules against that live traffic
 *   - real HTTP-level firewall-bypass probes (TRACE, Host/XFF manipulation, plaintext fallback)
 *
 * Where the host forbids raw packet capture (no CAP_NET_RAW) the limitation is stated explicitly
 * instead of being papered over with synthetic packets.
 * ====================================================================================================
 */

import fs from 'fs';
import net from 'net';
import dgram from 'dgram';
import path from 'path';
import { arsenalCore, OperationContext } from '../core/arsenal_core';

export interface PortScanResult {
    port: number;
    protocol: 'tcp' | 'udp';
    state: 'open' | 'closed' | 'filtered' | 'open|filtered';
    service?: string;
    version?: string;
}

/** Well-known service names, used to enrich confirmed-open ports. */
const SERVICE_MAP: Record<number, string> = {
    21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 80: 'http',
    110: 'pop3', 143: 'imap', 443: 'https', 445: 'smb', 3306: 'mysql',
    3389: 'rdp', 5432: 'postgresql', 6379: 'redis', 8080: 'http-proxy',
    8443: 'https-alt', 27017: 'mongodb', 4444: 'meterpreter', 1337: 'elite',
    31337: 'backdoor-orifice', 5555: 'adb', 6667: 'irc'
};

export interface NetworkInterface {
    name: string;
    ip: string;
    mac: string;
    up: boolean;
}

/** Real connection entry read from the kernel's TCP tables. */
export interface ConnectionEntry {
    protocol: 'tcp' | 'tcp6';
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remotePort: number;
    state: string;
    inode: number;
    process?: string;
    pid?: number;
}

const TCP_STATES: Record<string, string> = {
    '01': 'ESTABLISHED', '02': 'SYN_SENT', '03': 'SYN_RECV', '04': 'FIN_WAIT1',
    '05': 'FIN_WAIT2', '06': 'TIME_WAIT', '07': 'CLOSE', '08': 'CLOSE_WAIT',
    '09': 'LAST_ACK', '0A': 'LISTEN', '0B': 'CLOSING', '0C': 'NEW_SYN_RECV'
};

/** Decode a /proc/net/tcp address field (little-endian hex IPv4 + hex port). */
function decodeIPv4Hex(hex: string): string {
    const b = hex.match(/../g) || [];
    if (b.length < 4) return hex;
    return `${parseInt(b[3], 16)}.${parseInt(b[2], 16)}.${parseInt(b[1], 16)}.${parseInt(b[0], 16)}`;
}

/**
 * Decode a /proc/net/tcp6 address field.
 * The kernel prints each 32-bit word in host-integer form, so the byte pairs inside each word
 * must be reversed to recover network byte order. Each word is four network bytes = two hextets.
 */
function decodeIPv6Hex(hex: string): string {
    if (hex.length !== 32) return hex;
    const words: string[] = [];
    for (let i = 0; i < 4; i++) {
        const b = (hex.substr(i * 8, 8).match(/../g) || []);
        if (b.length < 4) return hex;
        words.push(b[3] + b[2] + b[1] + b[0]);
    }
    const hextets: string[] = [];
    for (const w of words) {
        hextets.push(w.slice(0, 4));
        hextets.push(w.slice(4));
    }
    return hextets.join(':').replace(/(^|:)(0{1,3})(:|$)/g, '$1$2$3');
}

export class PortScanner {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('PORT_SCANNER_INIT', 'network-scanner', 'SUCCESS', {});
    }

    /**
     * Raw SYN scanning requires elevated socket privileges, so this is implemented as a
     * TCP connect probe and labelled honestly in the audit trail. No result is ever invented.
     */
    async synScan(target: string, ports: number[]): Promise<PortScanResult[]> {
        arsenalCore.audit('SYN_SCAN', 'network-scanner', 'ATTEMPT', {
            target, ports: ports.length, technique: 'TCP_CONNECT_FALLBACK',
            note: 'Raw SYN requires CAP_NET_RAW; falling back to connect probe'
        });
        return this.tcpConnectScan(target, ports);
    }

    /**
     * Real TCP connect scan. Every port is actually probed over a socket.
     * - connect success        -> open
     * - ECONNREFUSED           -> closed
     * - timeout / unreachable  -> filtered
     */
    async tcpConnectScan(target: string, ports: number[], timeoutMs: number = 700): Promise<PortScanResult[]> {
        arsenalCore.audit('TCP_CONNECT_SCAN', 'network-scanner', 'ATTEMPT', {
            target, ports: ports.length, timeoutMs
        });
        const results = await Promise.all(ports.map(p => this.probeTcp(target, p, timeoutMs)));
        const open = results.filter(r => r.state === 'open');
        arsenalCore.audit('TCP_CONNECT_SCAN_RESULT', 'network-scanner', 'SUCCESS', {
            target, scanned: results.length, open: open.length,
            closed: results.filter(r => r.state === 'closed').length,
            filtered: results.filter(r => r.state === 'filtered').length
        });
        this.recordOpenPortFindings(target, open);
        return results;
    }

    private probeTcp(host: string, port: number, timeoutMs: number): Promise<PortScanResult> {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let settled = false;
            const finish = (state: PortScanResult['state']) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve({ port, protocol: 'tcp', state, service: state === 'open' ? SERVICE_MAP[port] : undefined });
            };
            socket.setTimeout(timeoutMs);
            socket.once('connect', () => finish('open'));
            socket.once('timeout', () => finish('filtered'));
            socket.once('error', (err: any) => {
                finish(err?.code === 'ECONNREFUSED' ? 'closed' : 'filtered');
            });
            try {
                socket.connect(port, host);
            } catch {
                finish('filtered');
            }
        });
    }

    /** Real UDP probe: a closed port answers with ICMP port unreachable (ECONNREFUSED). */
    async udpScan(target: string, ports: number[], timeoutMs: number = 700): Promise<PortScanResult[]> {
        arsenalCore.audit('UDP_SCAN', 'network-scanner', 'ATTEMPT', { target, ports: ports.length });
        const results = await Promise.all(ports.map(p => this.probeUdp(target, p, timeoutMs)));
        arsenalCore.audit('UDP_SCAN_RESULT', 'network-scanner', 'SUCCESS', {
            target, scanned: results.length,
            openFiltered: results.filter(r => r.state === 'open|filtered').length
        });
        return results;
    }

    private probeUdp(host: string, port: number, timeoutMs: number): Promise<PortScanResult> {
        return new Promise((resolve) => {
            const socket = dgram.createSocket('udp4');
            let settled = false;
            const finish = (state: PortScanResult['state']) => {
                if (settled) return;
                settled = true;
                try { socket.close(); } catch { /* already closed */ }
                resolve({ port, protocol: 'udp', state, service: state === 'open|filtered' ? SERVICE_MAP[port] : undefined });
            };
            const timer = setTimeout(() => finish('open|filtered'), timeoutMs);
            socket.on('error', (err: any) => {
                clearTimeout(timer);
                finish(err?.code === 'ECONNREFUSED' ? 'closed' : 'open|filtered');
            });
            try {
                socket.send(Buffer.from('arsenal-probe'), port, host, (err) => {
                    if (err) { clearTimeout(timer); finish('closed'); }
                });
            } catch {
                clearTimeout(timer);
                finish('open|filtered');
            }
        });
    }

    /** Confirmed open ports become real findings so the TTP/risk pipeline has genuine data. */
    private recordOpenPortFindings(target: string, open: PortScanResult[]): void {
        for (const r of open) {
            arsenalCore.addFinding({
                title: `Open TCP port ${r.port} on ${target}`,
                severity: r.port < 1024 ? 'MEDIUM' : 'LOW',
                category: 'open_port',
                description: `TCP port ${r.port} accepted a connection on ${target}` +
                             (r.service ? ` (service: ${r.service})` : ''),
                evidence: { target, port: r.port, service: r.service, state: r.state },
                remediation: 'Restrict the port to required sources or disable the service if unused',
                verified: true
            });
        }
    }

    /** Real local interface inventory parsed from the kernel's device tables. */
    listInterfaces(): NetworkInterface[] {
        const out: NetworkInterface[] = [];
        try {
            const ifaddrs = fs.readFileSync('/proc/net/if_inet6', 'utf8').trim();
            for (const line of ifaddrs.split('\n')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 6) continue;
                out.push({ name: parts[5], ip: decodeIPv6Hex(parts[0]), mac: '', up: true });
            }
        } catch { /* ipv6 table unavailable */ }
        try {
            const devs = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
            for (const line of devs) {
                const [name, rest] = line.split(':');
                if (!name) continue;
                const parts = rest.trim().split(/\s+/);
                const existing = out.find(i => i.name === name.trim());
                const rx = Number(parts[0] || 0), tx = Number(parts[8] || 0);
                if (existing) {
                    existing.ip = existing.ip || '';
                    existing.up = rx > 0 || tx > 0 || name.trim() === 'lo';
                } else {
                    out.push({ name: name.trim(), ip: '', mac: '', up: rx > 0 || tx > 0 });
                }
            }
        } catch { /* device table unavailable */ }
        try {
            const links = fs.readFileSync('/sys/class/net', 'utf8');
            void links;
        } catch { /* ignore */ }
        return out;
    }
}

export interface InterfaceCounters {
    interface: string;
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    rxErrors: number;
    txErrors: number;
    rxDropped: number;
    txDropped: number;
}

export interface CapturedSession {
    host: string;
    port: number;
    bytesReceived: number;
    bytesSent: number;
    banner: string;
    elapsedMs: number;
    error?: string;
}

export class PacketAnalyzer {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('PACKET_ANALYZER_INIT', 'network-analyzer', 'SUCCESS', {});
    }

    /** Read the real per-interface counters from /proc/net/dev. */
    readInterfaceCounters(interfaceName?: string): InterfaceCounters[] {
        const out: InterfaceCounters[] = [];
        let text = '';
        try {
            text = fs.readFileSync('/proc/net/dev', 'utf8');
        } catch {
            return out;
        }
        for (const line of text.split('\n').slice(2)) {
            const idx = line.indexOf(':');
            if (idx < 0) continue;
            const name = line.slice(0, idx).trim();
            if (interfaceName && name !== interfaceName) continue;
            const p = line.slice(idx + 1).trim().split(/\s+/).map(Number);
            if (p.length < 16) continue;
            out.push({
                interface: name,
                rxBytes: p[0], rxPackets: p[1], rxErrors: p[2], rxDropped: p[3],
                txBytes: p[8], txPackets: p[9], txErrors: p[10], txDropped: p[11]
            });
        }
        return out;
    }

    /** Open a REAL session and record the REAL bytes exchanged (banner grab). */
    private grabSession(host: string, port: number, timeoutMs = 3000): Promise<CapturedSession> {
        return new Promise((resolve) => {
            const started = Date.now();
            const socket = new net.Socket();
            let received = Buffer.alloc(0);
            let sent = 0;
            let settled = false;
            const finish = (error?: string) => {
                if (settled) return;
                settled = true;
                try { socket.destroy(); } catch { /* ignore */ }
                resolve({
                    host, port,
                    bytesReceived: received.length,
                    bytesSent: sent,
                    banner: received.subarray(0, 256).toString('latin1').replace(/[^\x20-\x7e\r\n]/g, '.'),
                    elapsedMs: Date.now() - started,
                    error
                });
            };
            socket.setTimeout(timeoutMs);
            socket.once('timeout', () => finish('timeout'));
            socket.once('error', (err: any) => finish(`${err?.code || 'ERROR'}: ${err?.message}`));
            socket.on('data', (chunk: Buffer) => {
                received = Buffer.concat([received, chunk]);
                if (received.length > 4096) finish();
            });
            try {
                socket.connect(port, host, () => {
                    // Minimal HTTP request so web services actually answer.
                    const request = `HEAD / HTTP/1.0\r\nHost: ${host}\r\nUser-Agent: sovereign-arsenal/1.3\r\n\r\n`;
                    sent = Buffer.byteLength(request, 'latin1');
                    socket.write(request, 'latin1');
                    setTimeout(() => finish(), 600);
                });
            } catch (err: any) {
                finish(err?.message);
            }
        });
    }

    /**
     * Capture real traffic evidence. Raw packet capture requires CAP_NET_RAW which this host does
     * not grant, so the analyzer records what IS observable: live interface counters and the real
     * bytes exchanged with a target service.
     */
    async capture(interfaceName: string, filter: string = ''): Promise<{
        rawPacketCapture: boolean;
        reason?: string;
        interface: string;
        countersBefore: InterfaceCounters[];
        countersAfter: InterfaceCounters[];
        delta: { rxBytes: number; txBytes: number; rxPackets: number; txPackets: number } | null;
        sessions: CapturedSession[];
        packets: any[];
        count: number;
        duration: number;
    }> {
        const started = Date.now();
        arsenalCore.audit('PACKET_CAPTURE', 'network-analyzer', 'ATTEMPT', { interfaceName, filter });

        const countersBefore = this.readInterfaceCounters(interfaceName);
        const sessions: CapturedSession[] = [];

        // "host:port" filter -> real session capture.
        const m = /^([^:\s]+):(\d{1,5})$/.exec(filter.trim());
        if (m) {
            const host = m[1];
            const port = Number(m[2]);
            if (this.ctx.scope.some(s => s === host || s.includes(host)) || this.ctx.mode === 'NEUTRAL') {
                sessions.push(await this.grabSession(host, port));
            } else {
                arsenalCore.audit('PACKET_CAPTURE', 'network-analyzer', 'REFUSED', { reason: 'target outside operation scope', host });
            }
        }

        await new Promise(r => setTimeout(r, 250));
        const countersAfter = this.readInterfaceCounters(interfaceName);

        let delta: { rxBytes: number; txBytes: number; rxPackets: number; txPackets: number } | null = null;
        const before = countersBefore[0], after = countersAfter[0];
        if (before && after) {
            delta = {
                rxBytes: after.rxBytes - before.rxBytes,
                txBytes: after.txBytes - before.txBytes,
                rxPackets: after.rxPackets - before.rxPackets,
                txPackets: after.txPackets - before.txPackets
            };
        }

        const canCaptureRaw = (() => {
            try {
                fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8');
                // CAP_NET_RAW check via the effective capability set of this process.
                const status = fs.readFileSync('/proc/self/status', 'utf8');
                const cap = /CapEff:\s*([0-9a-f]+)/.exec(status);
                if (!cap) return false;
                const eff = BigInt('0x' + cap[1]);
                const CAP_NET_RAW = 13n;
                return (eff & (1n << CAP_NET_RAW)) !== 0n;
            } catch { return false; }
        })();

        const duration = Date.now() - started;
        arsenalCore.audit('PACKET_CAPTURE', 'network-analyzer', 'SUCCESS', {
            interfaceName, sessions: sessions.length, rawPacketCapture: canCaptureRaw, duration
        });

        return {
            rawPacketCapture: canCaptureRaw,
            reason: canCaptureRaw ? undefined : 'CAP_NET_RAW is not granted to this process; live interface counters and real session bytes were captured instead of synthetic packets',
            interface: interfaceName,
            countersBefore,
            countersAfter,
            delta,
            sessions,
            packets: [],
            count: sessions.reduce((s, x) => s + x.bytesReceived, 0),
            duration
        };
    }

    /**
     * Real protocol analysis over captured sessions (or raw byte buffers).
     * Classification is driven by the actual first bytes of each flow.
     */
    async analyzeProtocol(packets: any[]): Promise<{
        protocols: Record<string, number>;
        classified: { host: string; port: number; protocol: string; bytes: number; banner: string; mismatch: boolean; expected?: string }[];
        anomalies: string[];
        totalBytes: number;
    }> {
        const protocols: Record<string, number> = {};
        const classified: { host: string; port: number; protocol: string; bytes: number; banner: string; mismatch: boolean; expected?: string }[] = [];
        const anomalies: string[] = [];
        let totalBytes = 0;

        for (const p of packets || []) {
            let host = 'unknown', port = 0, bytes = 0, banner = '';
            if (p && typeof p === 'object' && 'host' in p) {
                host = p.host; port = p.port; bytes = p.bytesReceived ?? 0; banner = p.banner ?? '';
            } else if (Buffer.isBuffer(p)) {
                bytes = p.length; banner = p.subarray(0, 256).toString('latin1').replace(/[^\x20-\x7e\r\n]/g, '.');
            } else if (typeof p === 'string') {
                banner = p; bytes = p.length;
            }
            totalBytes += bytes;

            const proto = this.classify(banner);
            protocols[proto] = (protocols[proto] || 0) + 1;
            const expected = SERVICE_MAP[port];
            let mismatch = false;
            if (expected === 'https' && proto !== 'tls') { mismatch = true; anomalies.push(`port ${port} expected TLS but the service answered ${proto}`); }
            if (expected === 'ssh' && proto !== 'ssh') { mismatch = true; anomalies.push(`port ${port} expected SSH but the service answered ${proto}`); }
            if (expected === 'http' && proto !== 'http') { mismatch = true; anomalies.push(`port ${port} expected HTTP but the service answered ${proto}`); }
            if (proto === 'telnet' || proto === 'ftp') anomalies.push(`cleartext protocol ${proto} observed on ${host}:${port}`);
            if (proto === 'unknown' && bytes > 0) anomalies.push(`unrecognised banner on ${host}:${port}: ${banner.slice(0, 60)}`);
            classified.push({ host, port, protocol: proto, bytes, banner: banner.slice(0, 120), mismatch, expected });
        }

        arsenalCore.audit('PROTOCOL_ANALYSIS', 'network-analyzer', 'SUCCESS', {
            count: classified.length, totalBytes, anomalies: anomalies.length
        });
        return { protocols, classified, anomalies, totalBytes };
    }

    /** Classify a flow by its real leading bytes. */
    private classify(banner: string): string {
        if (!banner) return 'unknown';
        if (/^HTTP\/\d\.\d/i.test(banner)) return 'http';
        if (/^SSH-/.test(banner)) return 'ssh';
        if (/^\x16\x03|^\x16\x02/.test(banner) || banner.startsWith('')) return 'tls';
        if (/^220[- ]|^220 /i.test(banner)) return 'smtp';
        if (/^220[- ].*FTP|^220 /i.test(banner) && /FTP/i.test(banner)) return 'ftp';
        if (/^SSH|^421|^530/.test(banner) && /SSH/i.test(banner)) return 'ssh';
        if (/^\+PONG|^PONG/i.test(banner)) return 'irc';
        if (/^HTTP/.test(banner)) return 'http';
        if (/^[A-Za-z0-9+/=]{40,}/.test(banner)) return 'binary';
        return 'unknown';
    }
}

export class NetworkMonitor {
    private ctx: OperationContext;
    private monitoring = false;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('NETWORK_MONITOR_INIT', 'network-monitor', 'SUCCESS', {});
    }

    startMonitoring(): void {
        this.monitoring = true;
        arsenalCore.audit('MONITORING_START', 'network-monitor', 'SUCCESS', {});
    }

    stopMonitoring(): void {
        this.monitoring = false;
        arsenalCore.audit('MONITORING_STOP', 'network-monitor', 'SUCCESS', {});
    }

    isMonitoring(): boolean { return this.monitoring; }

    /** Parse the real kernel connection tables. */
    readConnections(): ConnectionEntry[] {
        const out: ConnectionEntry[] = [];
        const parse = (file: string, proto: 'tcp' | 'tcp6') => {
            let text = '';
            try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
            for (const line of text.split('\n').slice(1)) {
                const f = line.trim().split(/\s+/);
                if (f.length < 10) continue;
                // /proc/net/tcp columns: sl local_address rem_address st tx:rx tr:when retrnsmt uid timeout inode
                const localRaw = f[1], remRaw = f[2], st = f[3], inodeRaw = f[9];
                const [localHex, localPortHex] = localRaw.split(':');
                const [remHex, remPortHex] = remRaw.split(':');
                const localPort = parseInt(localPortHex, 16);
                const remotePort = parseInt(remPortHex, 16);
                if (!Number.isFinite(localPort) || !Number.isFinite(remotePort)) continue;
                out.push({
                    protocol: proto,
                    localAddress: proto === 'tcp' ? decodeIPv4Hex(localHex) : decodeIPv6Hex(localHex),
                    localPort,
                    remoteAddress: proto === 'tcp' ? decodeIPv4Hex(remHex) : decodeIPv6Hex(remHex),
                    remotePort,
                    state: TCP_STATES[st] || st,
                    inode: Number(inodeRaw)
                });
            }
        };
        parse('/proc/net/tcp', 'tcp');
        parse('/proc/net/tcp6', 'tcp6');

        // Map socket inodes to the owning process by walking /proc/<pid>/fd.
        const inodeMap = this.mapInodesToProcesses(new Set(out.map(c => c.inode)));
        for (const c of out) {
            const owner = inodeMap.get(c.inode);
            if (owner) { c.process = owner.process; c.pid = owner.pid; }
        }
        return out;
    }

    private mapInodesToProcesses(inodes: Set<number>): Map<number, { pid: number; process: string }> {
        const map = new Map<number, { pid: number; process: string }>();
        if (inodes.size === 0) return map;
        let pids: string[] = [];
        try { pids = fs.readdirSync('/proc').filter(p => /^\d+$/.test(p)); } catch { return map; }
        for (const pid of pids) {
            let fds: string[] = [];
            try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
            let comm = '';
            try { comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { comm = 'unknown'; }
            for (const fd of fds) {
                let link = '';
                try { link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
                const m = /^socket:\[(\d+)\]$/.exec(link);
                if (m) {
                    const inode = Number(m[1]);
                    if (inodes.has(inode) && !map.has(inode)) map.set(inode, { pid: Number(pid), process: comm });
                }
            }
        }
        return map;
    }

    /** The real connection table of this host. */
    async getConnections(): Promise<ConnectionEntry[]> {
        const conns = this.readConnections();
        arsenalCore.audit('NETWORK_MONITOR_CONNECTIONS', 'network-monitor', 'SUCCESS', {
            total: conns.length,
            established: conns.filter(c => c.state === 'ESTABLISHED').length,
            listening: conns.filter(c => c.state === 'LISTEN').length
        });
        return conns;
    }

    /**
     * Real anomaly detection over the live connection table. Every anomaly carries the
     * connection(s) that produced it.
     */
    async detectAnomalies(): Promise<{
        anomalies: { type: string; severity: string; detail: string; evidence: any }[];
        analyzed: number;
    }> {
        const conns = await this.getConnections();
        const established = conns.filter(c => c.state === 'ESTABLISHED');
        const synRecv = conns.filter(c => c.state === 'SYN_RECV' || c.state === 'NEW_SYN_RECV');
        const anomalies: { type: string; severity: string; detail: string; evidence: any }[] = [];

        // 1) Many half-open connections from one peer = possible scan / SYN flood.
        const byPeer = new Map<string, ConnectionEntry[]>();
        for (const c of synRecv) {
            const k = c.remoteAddress;
            (byPeer.get(k) || byPeer.set(k, []).get(k)!).push(c);
        }
        for (const [peer, list] of byPeer) {
            if (list.length >= 5) {
                anomalies.push({
                    type: 'connection_flood',
                    severity: list.length >= 20 ? 'CRITICAL' : 'HIGH',
                    detail: `${list.length} half-open connections from ${peer}`,
                    evidence: list.slice(0, 10)
                });
            }
        }

        // 2) Established connections to well-known backdoor / proxy ports.
        const BACKDOOR_PORTS = [4444, 1337, 31337, 5555, 6666, 6667, 1080, 3128, 8888];
        for (const c of established) {
            if (BACKDOOR_PORTS.includes(c.remotePort)) {
                anomalies.push({
                    type: 'suspicious_remote_port',
                    severity: 'HIGH',
                    detail: `connection to ${c.remoteAddress}:${c.remotePort} (${SERVICE_MAP[c.remotePort] || 'known tooling port'})`,
                    evidence: c
                });
            }
        }

        // 3) Plaintext remote services (no TLS) carrying traffic.
        for (const c of established) {
            if (c.remotePort === 21 || c.remotePort === 23 || c.remotePort === 25) {
                anomalies.push({
                    type: 'cleartext_protocol',
                    severity: 'MEDIUM',
                    detail: `cleartext ${SERVICE_MAP[c.remotePort]} session to ${c.remoteAddress}:${c.remotePort}`,
                    evidence: c
                });
            }
        }

        // 4) One peer holding a very large number of sessions.
        const estByPeer = new Map<string, ConnectionEntry[]>();
        for (const c of established) {
            (estByPeer.get(c.remoteAddress) || estByPeer.set(c.remoteAddress, []).get(c.remoteAddress)!).push(c);
        }
        for (const [peer, list] of estByPeer) {
            if (list.length >= 15) {
                anomalies.push({
                    type: 'peer_connection_concentration',
                    severity: 'MEDIUM',
                    detail: `${list.length} established sessions to a single peer ${peer}`,
                    evidence: list.slice(0, 10)
                });
            }
        }

        // 5) Listening on a high port that maps to a known exploit surface.
        for (const c of conns.filter(x => x.state === 'LISTEN')) {
            if (c.localPort === 6379 || c.localPort === 27017 || c.localPort === 3306 || c.localPort === 5432) {
                anomalies.push({
                    type: 'database_exposed',
                    severity: 'HIGH',
                    detail: `database service listening on ${c.localAddress}:${c.localPort}`,
                    evidence: c
                });
            }
        }

        arsenalCore.audit('NETWORK_ANOMALY_DETECTION', 'network-monitor', 'SUCCESS', {
            analyzed: conns.length, anomalies: anomalies.length
        });

        if (anomalies.length > 0) {
            arsenalCore.addFinding({
                title: `Network anomaly detected: ${anomalies[0].type}`,
                severity: anomalies.some(a => a.severity === 'CRITICAL') ? 'CRITICAL'
                        : anomalies.some(a => a.severity === 'HIGH') ? 'HIGH' : 'MEDIUM',
                category: 'misconfiguration',
                description: anomalies.map(a => a.detail).join('; ').slice(0, 900),
                evidence: { anomalies: anomalies.slice(0, 5) },
                remediation: 'Review the listed connections, terminate unauthorised sessions and restrict exposed services',
                verified: true
            });
        }

        return { anomalies, analyzed: conns.length };
    }
}

export class FirewallBypass {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('FIREWALL_BYPASS_INIT', 'network-offensive', 'ATTEMPT', { opId: ctx.operationId });
    }

    private inScope(host: string): boolean {
        return this.ctx.scope.some(s => s === host || s.includes(host)) || this.ctx.mode === 'NEUTRAL';
    }

    /** Issue a real HTTP request and return the real status + body prefix. */
    private httpProbe(host: string, port: number, options: {
        path?: string; method?: string; headers?: Record<string, string>; timeoutMs?: number;
    } = {}): Promise<{ ok: boolean; status?: number; headers?: Record<string, string>; body?: string; bytes?: number; error?: string; elapsedMs: number }> {
        const started = Date.now();
        const timeout = options.timeoutMs ?? 6000;
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let response = Buffer.alloc(0);
            let settled = false;
            const finish = (res: Partial<{ status: number; headers: Record<string, string>; body: string; bytes: number; error: string }>) => {
                if (settled) return;
                settled = true;
                try { socket.destroy(); } catch { /* ignore */ }
                const text = response.toString('latin1');
                const [head, ...rest] = text.split('\r\n\r\n');
                const lines = head.split('\r\n');
                const statusLine = lines[0] || '';
                const status = parseInt(statusLine.split(/\s+/)[1] || '', 10);
                const headers: Record<string, string> = {};
                for (const l of lines.slice(1)) {
                    const i = l.indexOf(':');
                    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
                }
                resolve({
                    ok: Number.isFinite(status),
                    status: Number.isFinite(status) ? status : undefined,
                    headers,
                    body: rest.join('\r\n\r\n').slice(0, 2048),
                    bytes: response.length,
                    elapsedMs: Date.now() - started,
                    ...res
                });
            };
            socket.setTimeout(timeout);
            socket.once('timeout', () => finish({ error: 'timeout' }));
            socket.once('error', (err: any) => finish({ error: `${err?.code || 'ERROR'}: ${err?.message}` }));
            socket.on('data', (c: Buffer) => {
                response = Buffer.concat([response, c]);
                if (response.length > 64 * 1024) finish({});
            });
            try {
                socket.connect(port, host, () => {
                    const method = options.method || 'GET';
                    const path = options.path || '/';
                    const extra = Object.entries(options.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\r\n');
                    socket.write(`${method} ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: sovereign-arsenal/1.3\r\nConnection: close\r\n${extra}\r\n\r\n`);
                });
            } catch (err: any) {
                finish({ error: err?.message });
            }
        });
    }

    /**
     * Real firewall / access-control bypass probes. Each technique produces real evidence.
     */
    async testTechniques(target: string): Promise<{
        target: string;
        techniques: { technique: string; severity: string; bypassed: boolean; detail: string; evidence: any }[];
        bypassed: number;
        tested: number;
    }> {
        arsenalCore.audit('FIREWALL_BYPASS_TEST', 'network-offensive', 'ATTEMPT', { target });
        const techniques: { technique: string; severity: string; bypassed: boolean; detail: string; evidence: any }[] = [];

        if (!this.inScope(target)) {
            arsenalCore.audit('FIREWALL_BYPASS_TEST', 'network-offensive', 'REFUSED', { reason: 'target outside operation scope', target });
            return { target, techniques, bypassed: 0, tested: 0 };
        }

        const host = target.replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0];

        // 1) Plaintext HTTP fallback.
        const http = await this.httpProbe(host, 80, { path: '/' });
        const https = await this.httpProbe(host, 443, { path: '/', timeoutMs: 5000 });
        if (http.ok && https.ok) {
            techniques.push({
                technique: 'plaintext_downgrade',
                severity: 'MEDIUM',
                bypassed: true,
                detail: 'the service answers on both 80 (cleartext) and 443 (TLS)',
                evidence: { http: http.status, https: https.status }
            });
        } else if (http.ok && !https.ok) {
            techniques.push({
                technique: 'cleartext_only',
                severity: 'LOW',
                bypassed: true,
                detail: 'the service is reachable over cleartext HTTP only',
                evidence: { http: http.status, https: https.error ?? 'unreachable' }
            });
        }

        // 2) TRACE method.
        const trace = await this.httpProbe(host, 80, { method: 'TRACE', path: '/' });
        if (trace.ok && trace.status !== 405 && trace.status !== 501) {
            techniques.push({
                technique: 'http_trace_enabled',
                severity: 'MEDIUM',
                bypassed: true,
                detail: `TRACE is accepted (HTTP ${trace.status}) and can be used for request smuggling`,
                evidence: { status: trace.status, headers: trace.headers }
            });
        }

        // 3) Host header / X-Forwarded-For access-control manipulation.
        const baseline = await this.httpProbe(host, 80, { path: '/admin' });
        const spoofed = await this.httpProbe(host, 80, {
            path: '/admin',
            headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Original-URL': '/admin', 'X-Rewrite-URL': '/admin' }
        });
        if (baseline.ok && spoofed.ok && spoofed.status !== baseline.status && spoofed.status < 400 && baseline.status >= 400) {
            techniques.push({
                technique: 'ip_spoofing_header_bypass',
                severity: 'HIGH',
                bypassed: true,
                detail: `forwarding headers changed the response from HTTP ${baseline.status} to HTTP ${spoofed.status}`,
                evidence: { baseline: baseline.status, spoofed: spoofed.status, headers: spoofed.headers }
            });
        }

        // 4) Direct IP access to a name-based vhost.
        const vhost = await this.httpProbe(host, 80, { path: '/', headers: { Host: 'localhost' } });
        if (vhost.ok && http.ok && vhost.status === 200 && http.status !== 200) {
            techniques.push({
                technique: 'vhost_confusion',
                severity: 'MEDIUM',
                bypassed: true,
                detail: `a different Host header returned HTTP ${vhost.status} where the canonical host returned HTTP ${http.status}`,
                evidence: { canonical: http.status, spoofedHost: vhost.status }
            });
        }

        // 5) Path traversal style normalisation bypass.
        const traversal = await this.httpProbe(host, 80, { path: '/admin/..;/admin' });
        if (traversal.ok && traversal.status === 200 && baseline.ok && baseline.status === 403) {
            techniques.push({
                technique: 'path_normalisation_bypass',
                severity: 'HIGH',
                bypassed: true,
                detail: 'a path-normalisation variant reached a protected resource',
                evidence: { protectedStatus: baseline.status, bypassStatus: traversal.status }
            });
        }

        const bypassed = techniques.filter(t => t.bypassed).length;
        arsenalCore.audit('FIREWALL_BYPASS_TEST', 'network-offensive', 'SUCCESS', {
            target, tested: techniques.length, bypassed
        });

        if (bypassed > 0) {
            arsenalCore.addFinding({
                title: `Firewall / access-control bypass found on ${target}`,
                severity: techniques.some(t => t.severity === 'HIGH') ? 'HIGH' : 'MEDIUM',
                category: 'auth_bypass',
                description: techniques.map(t => `${t.technique}: ${t.detail}`).join('; '),
                evidence: { techniques },
                remediation: 'Enforce TLS, disable TRACE, ignore client-supplied forwarding headers and normalise paths before authorisation',
                verified: true
            });
        }

        return { target, techniques, bypassed, tested: techniques.length };
    }
}

export interface IDSRule {
    id: string;
    description: string;
    severity: string;
    match: { remotePort?: number; localPort?: number; remoteAddress?: string; process?: string; state?: string };
}

export class IDSIPS {
    private ctx: OperationContext;
    private rules: IDSRule[] = [];
    private ruleFile?: string;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('IDS_IPS_INIT', 'network-defensive', 'SUCCESS', {});
    }

    /** Parse a real rule file (Suricata-like `alert tcp any any -> any any (msg:"..."; sid:N; ...)`) */
    parseRules(text: string): IDSRule[] {
        const out: IDSRule[] = [];
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const msg = /msg\s*:\s*"([^"]*)"/.exec(line);
            const sid = /sid\s*:\s*(\d+)/.exec(line);
            const sev = /severity\s*:\s*"?(\w+)"?/.exec(line);
            const rport = /rport\s*:\s*(\d+)/.exec(line);
            const lport = /lport\s*:\s*(\d+)/.exec(line);
            const daddr = /daddr\s*:\s*"?([\d.]+)"?/.exec(line);
            const dport = /dport\s*:\s*"?(\d+)"?/.exec(line);
            // Rule header form: "alert tcp any any -> any 80" carries the destination port.
            const hdr = /->\s+(\S+)\s+(\S+)/.exec(line);
            const hdrAddr = hdr && hdr[1] !== 'any' && hdr[1] !== '$HOME_NET' ? hdr[1] : undefined;
            const hdrPort = hdr && /^\d+$/.test(hdr[2]) ? Number(hdr[2]) : undefined;
            if (!msg && !sid && !rport && !hdr) continue;
            out.push({
                id: sid ? `SID-${sid[1]}` : `RULE-${out.length + 1}`,
                description: msg ? msg[1] : (line.slice(0, 120)),
                severity: sev ? sev[1] : 'MEDIUM',
                match: {
                    remotePort: rport ? Number(rport[1]) : (dport ? Number(dport[1]) : hdrPort),
                    localPort: lport ? Number(lport[1]) : undefined,
                    remoteAddress: daddr ? daddr[1] : hdrAddr
                }
            });
        }
        return out;
    }

    /**
     * Deploy rules as a real artifact on disk and evaluate them against the LIVE traffic.
     * The returned count is the number of rules that actually matched real traffic.
     */
    async deployRules(rules: string[]): Promise<{ deployed: number; matched: number; ruleFile: string; rules: IDSRule[] }> {
        arsenalCore.audit('IDS_RULES_DEPLOY', 'network-defensive', 'ATTEMPT', { count: rules.length });

        const parsed: IDSRule[] = [];
        for (const r of rules) {
            if (r.includes('msg:') || r.includes('sid:')) parsed.push(...this.parseRules(r));
            else parsed.push({
                id: `RULE-${parsed.length + 1}`,
                description: r,
                severity: 'MEDIUM',
                match: {}
            });
        }
        this.rules = parsed;

        // Write the rule set to disk as a real, inspectable artifact.
        let ruleFile = '';
        try {
            const dir = path.join(process.env.ARSENAL_ROOT || process.cwd(), 'data/arsenal/ids');
            fs.mkdirSync(dir, { recursive: true });
            ruleFile = path.join(dir, 'arsenal.rules');
            fs.writeFileSync(ruleFile, parsed.map((r, i) => {
                const sid = /(\d+)/.exec(r.id)?.[1] ?? String(1000 + i);
                const local = r.match.localPort ?? 'any';
                const remoteAddr = r.match.remoteAddress ?? 'any';
                const remote = r.match.remotePort ?? 'any';
                return `alert tcp any ${local} -> ${remoteAddr} ${remote} (msg:"${r.description}"; sid:${sid}; severity:${r.severity};)`;
            }).join('\n') + '\n', 'utf8');
            this.ruleFile = ruleFile;
        } catch (err: any) {
            arsenalCore.audit('IDS_RULES_DEPLOY', 'network-defensive', 'PARTIAL', { reason: `rule file could not be written: ${err?.message}` });
        }

        const conns = await new NetworkMonitor(this.ctx).getConnections();
        let matched = 0;
        for (const rule of parsed) {
            const hit = conns.find(c =>
                (!rule.match.remotePort || c.remotePort === rule.match.remotePort) &&
                (!rule.match.localPort || c.localPort === rule.match.localPort) &&
                (!rule.match.remoteAddress || c.remoteAddress === rule.match.remoteAddress) &&
                (!rule.match.state || c.state === rule.match.state)
            );
            if (hit) matched++;
        }

        arsenalCore.audit('IDS_RULES_DEPLOY', 'network-defensive', 'SUCCESS', {
            rules: parsed.length, matched, ruleFile
        });
        return { deployed: parsed.length, matched, ruleFile, rules: parsed };
    }

    /** Evaluate the deployed rules against real live traffic and return the real alerts. */
    async analyzeAlerts(): Promise<{ alerts: { ruleId: string; description: string; severity: string; connection: ConnectionEntry; evidence: string }[]; analyzed: number; ruleFile?: string }> {
        const conns = await new NetworkMonitor(this.ctx).getConnections();
        const alerts: { ruleId: string; description: string; severity: string; connection: ConnectionEntry; evidence: string }[] = [];

        for (const rule of this.rules) {
            for (const c of conns) {
                const portMatch = !rule.match.remotePort || c.remotePort === rule.match.remotePort;
                const localMatch = !rule.match.localPort || c.localPort === rule.match.localPort;
                const addrMatch = !rule.match.remoteAddress || c.remoteAddress === rule.match.remoteAddress;
                const stateMatch = !rule.match.state || c.state === rule.match.state;
                if (portMatch && localMatch && addrMatch && stateMatch) {
                    alerts.push({
                        ruleId: rule.id,
                        description: rule.description,
                        severity: rule.severity,
                        connection: c,
                        evidence: `${c.state} ${c.localAddress}:${c.localPort} -> ${c.remoteAddress}:${c.remotePort}` +
                                  (c.process ? ` (pid ${c.pid} ${c.process})` : '')
                    });
                }
            }
        }

        arsenalCore.audit('IDS_ALERT_ANALYSIS', 'network-defensive', 'SUCCESS', {
            rules: this.rules.length, connections: conns.length, alerts: alerts.length
        });

        if (alerts.length > 0) {
            arsenalCore.addFinding({
                title: `IDS rule match on live traffic (${alerts.length} alert(s))`,
                severity: alerts.some(a => /critical/i.test(a.severity)) ? 'CRITICAL'
                        : alerts.some(a => /high/i.test(a.severity)) ? 'HIGH' : 'MEDIUM',
                category: 'misconfiguration',
                description: alerts.slice(0, 5).map(a => `${a.ruleId}: ${a.evidence}`).join('; '),
                evidence: { alerts: alerts.slice(0, 10), ruleFile: this.ruleFile },
                remediation: 'Review the matched traffic and apply the corresponding firewall policy',
                verified: true
            });
        }

        return { alerts, analyzed: conns.length, ruleFile: this.ruleFile };
    }

    getRules(): IDSRule[] { return [...this.rules]; }
}

export class NetworkArsenal {
    scanner: PortScanner;
    analyzer: PacketAnalyzer;
    monitor: NetworkMonitor;
    bypass: FirewallBypass;
    idsips: IDSIPS;

    constructor(ctx: OperationContext) {
        this.scanner = new PortScanner(ctx);
        this.analyzer = new PacketAnalyzer(ctx);
        this.monitor = new NetworkMonitor(ctx);
        this.bypass = new FirewallBypass(ctx);
        this.idsips = new IDSIPS(ctx);
        arsenalCore.audit('NETWORK_ARSENAL_INIT', 'network', 'SUCCESS', { opId: ctx.operationId });
    }
}
export default NetworkArsenal;
