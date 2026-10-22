/**
 * Contention generator for Gate 9 check [3]: deploys IDS rules continuously, as a SECOND process.
 *
 * WHY: `deployRules` writes its artifact to disk. If that artifact has a single shared name,
 * writeFileSync truncates before it writes, so any concurrent deployer can make a reader observe an
 * empty file. That was measured on this host: 1,289,070 of 1,614,814 reads saw an empty file while
 * another process was writing. The artifact is now per-process, and this generator keeps the
 * contention honest: the probe must still pass while rules are being deployed next to it.
 *
 * Protocol: "ready" when the first deployment is on disk, "total <n>" on shutdown. The parent
 * requires n > 0, so the check cannot pass vacuously if rule deployment silently fails.
 */

import fs from 'fs';
import { arsenalCore, NetworkArsenal } from '../../src/neo/arsenal/index.ts';

const RULE = 'alert tcp any any -> any 80 (msg:"plaintext web traffic"; sid:1000001; rev:1;)';

const context = arsenalCore.createOperation('DEFENSIVE', ['127.0.0.1'], '127.0.0.1', 'GATE9-CONTENTION');
const network = new NetworkArsenal(context);

let active = true;
let total = 0;
let ready = false;

process.on('SIGTERM', () => {
    active = false;
});
process.on('SIGINT', () => {
    active = false;
});

while (active) {
    await network.idsips.deployRules([RULE]);
    total += 1;
    if (!ready) {
        ready = true;
        fs.writeSync(1, 'ready\n');
    }
    await new Promise(resolve => setTimeout(resolve, 50));
}

// Synchronous, because an async write on a pipe can be lost when the process exits.
fs.writeSync(1, `total ${total}\n`);
process.exitCode = 0;
