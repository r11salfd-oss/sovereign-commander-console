/**
 * Loopback load generator for Gate 9 check [3].
 *
 * WHY A SEPARATE PROCESS: the guard runs the probe with execSync, which blocks the parent's
 * event loop. A load generator living in the parent would therefore be frozen for exactly the
 * window it is supposed to load - the test would measure an idle host and call it contention.
 * A child process keeps its own event loop, so the flood is genuinely concurrent with the probe.
 *
 * The listener and the clients both live here, on 127.0.0.1, so the traffic is real loopback
 * bytes: it moves the same /proc/net/dev counters the probe asserts on. No privileges needed.
 *
 * Protocol (deliberately tiny, because the parent cannot read the pipe while execSync blocks):
 *   stdout "ready <port>"   once, when the listener is accepting
 *   stdout "total <count>"  once, on shutdown
 * Nothing else is written, so the pipe can never fill and stall the flood.
 */

import fs from 'fs';
import net from 'net';

const WORKERS = Math.max(1, Number(process.env.LOAD_WORKERS ?? 4));
const SERVER_OPTIONS = { host: '127.0.0.1', port: 0 };

const server = net.createServer(socket => {
    // The client closes after reading; a reset must never crash the generator.
    socket.on('error', () => {});
    socket.end('ok');
});

let active = true;
let total = 0;
const workers = [];

function nextConnection(port, resolve) {
    if (!active) {
        resolve();
        return;
    }
    const socket = net.connect(port, '127.0.0.1');
    // resume() is what makes 'close' fire: without it the readable side never consumes the
    // server's FIN, the socket stays half-open and the worker never returns - the exact bug
    // this file was rewritten to eliminate.
    socket.resume();
    socket.once('connect', () => socket.end());
    socket.once('error', () => {});
    socket.once('close', () => {
        total += 1;
        nextConnection(port, resolve);
    });
}

server.on('error', err => {
    process.stderr.write(`loopback_load: ${err.message}\n`);
    process.exit(1);
});

server.listen(SERVER_OPTIONS, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    fs.writeSync(1, `ready ${port}\n`);
    for (let i = 0; i < WORKERS; i += 1) {
        workers.push(new Promise(resolve => nextConnection(port, resolve)));
    }
});

function shutdown() {
    if (!active) return;
    active = false;
    const finish = () => {
        server.close(() => {
            fs.writeSync(1, `total ${total}\n`);
            process.exitCode = 0;
        });
        // A socket stuck in the kernel must not keep the generator alive.
        setTimeout(() => process.exit(0), 1_000).unref();
    };
    Promise.all(workers).then(finish, finish);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
