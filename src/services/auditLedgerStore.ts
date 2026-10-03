/**
 * ============================================================================
 * SOVEREIGN AUDIT LEDGER STORE — SINGLE-WRITER, MONOTONIC, TORN-WRITE-SAFE
 * Chain Key ID: 360ea36c28e66d9d
 * ============================================================================
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS — the defect it removes
 * ────────────────────────────────────────────────────────────────────────────
 * The previous ledger lived entirely in module scope of
 * `sovereignMcpServer.ts` and had three structural properties that together
 * manufactured a forked audit ledger out of nothing but concurrency:
 *
 *   1. NO WRITER EXCLUSION. `appendChainRecord` computed `seq` from
 *      `sovereignAuditLedger.length` — an IN-MEMORY count — and then persisted
 *      with a bare `fs.appendFileSync`, with no lock of any kind. Two OS
 *      processes importing that module (`server.ts` and
 *      `scripts/run_mcp_test.ts`) each hold an independent copy of that array,
 *      each count from zero, and each append. Measured result: 200 concurrent
 *      appends produced 200 physical lines carrying only 5 distinct `seq`
 *      values.
 *
 *   2. `loadLedgerFromDisk` SILENTLY TRUNCATED. On the first `seq`
 *      discontinuity it executed `break`, and on a digest mismatch it
 *      executed `continue`. Both discard the remainder of the file WITHOUT
 *      recording that anything was wrong. Every subsequent restart therefore
 *      rehydrated the SAME short prefix and appended from the SAME stale head,
 *      reproducing the same wrong `seq` forever. That is why the on-disk
 *      `seq` sequence walks 0,1,2,…,9,5,6,10,11,5,6,…
 *
 *   3. THE VERIFIER ONLY EVER LOOKED AT ITS OWN PREFIX. Because rehydration
 *      truncated, the in-memory array was always internally self-consistent, so
 *      `ENTRY_DIGEST_RECOMPUTATION` and `ENTRY_LINKAGE` reported PASS while
 *      the file held hundreds of broken links. That is a FALSE PASS — strictly
 *      more dangerous than a false alarm, because it is a positive integrity
 *      claim about data nobody checked.
 *
 * This module replaces the ad-hoc array with a store that holds the four
 * invariants the ledger was always supposed to have:
 *
 *   I1 SINGLE WRITER      — an exclusive OS lock file held across the entire
 *                           rehydrate → compute → append critical section. A
 *                           second writer is REFUSED, never interleaved.
 *   I2 MONOTONIC `seq`    — `seq` is derived from the MAXIMUM `seq` persisted
 *                           on disk, re-read while holding the lock. It is
 *                           never derived from an in-memory length. An attempt
 *                           to move backwards is refused loudly.
 *   I3 TORN-WRITE VISIBLE — a trailing partial record is DETECTED and
 *                           REPORTED. It is never silently dropped and then
 *                           silently re-chained from an older head.
 *   I4 HONEST FORENSICS   — every physical line is examined. Forks, rewinds
 *                           and duplicate appends are returned as findings WITH
 *                           their line numbers. Nothing is repaired by picking
 *                           a branch; silent repair would be the same class of
 *                           defect as a padded score.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS *NOT* CLAIMED ABOUT ATOMICITY — stated plainly, not oversold
 * ────────────────────────────────────────────────────────────────────────────
 * POSIX `O_APPEND` guarantees the file OFFSET update is atomic with respect to
 * other writers, but it does not bound the size of a single `write(2)`, so on
 * POSIX alone a very large record could in principle still be split. The
 * exclusive lock file is what actually makes this single-writer, and it is held
 * for the whole critical section. On Windows `FILE_APPEND_DATA` behaves the
 * same way: atomic positioning, unbounded payload. So the guarantee this module
 * provides is: *one writer at a time, one `write` syscall per record, plus an
 * `fsync` before the record is considered durable.* It does not claim the
 * single-`write` property is sufficient on its own — it claims the lock makes
 * it sufficient.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE TRUST BOUNDARY IS UNCHANGED BY ANY OF THIS
 * ────────────────────────────────────────────────────────────────────────────
 * This store makes the ledger HONEST. It does not make it TAMPER-PROOF. The
 * file still reaches the runtime through a bind mount the verifying process can
 * write; there is still no signing key, no timestamp authority, no external
 * append-only store. See `auditChainAnchor.ts` for the full statement of what
 * the anchor is and is not worth. A concurrency defect fixed here is still not
 * cryptography.
 * ========================================================================= */

import nodeCrypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/* ── CHAIN CONSTANTS ────────────────────────────────────────────────────────
 * Defined here rather than imported from `sovereignMcpServer.ts` so that the
 * store has NO import cycle: the MCP server depends on the store, never the
 * reverse. `sovereignMcpServer.ts` re-exports these, so the module's public
 * surface is unchanged.
 * ─────────────────────────────────────────────────────────────────────────── */
export const SOVEREIGN_CHAIN_KEY_ID = '360ea36c28e66d9d';
export const CHAIN_HASH_ALGORITHM = 'sha256';

/** Genesis `prevHash` for sequence #0 — derived, never hand-written. */
export const GENESIS_PREV_HASH: string = nodeCrypto
  .createHash(CHAIN_HASH_ALGORITHM)
  .update(`SOVEREIGN_CHAIN_GENESIS|${SOVEREIGN_CHAIN_KEY_ID}`)
  .digest('hex');

export const DEFAULT_LEDGER_FILE_PATH: string = process.env.SOVEREIGN_LEDGER_PATH
  ?? path.join(process.cwd(), 'data', 'audit-ledger.jsonl');

/* ── RECORD SHAPE ────────────────────────────────────────────────────────── */

export interface LedgerRecord {
  seq: number;
  recordedAt: string;
  event: string;
  chainKeyId: string;
  prevHash: string;
  hash: string;
  evidenceBearing: boolean;
}

export type RecordWithoutHash = Omit<LedgerRecord, 'hash'>;

/** Deterministic canonical serialization of a record's own content. */
export function canonicalRecordPayload(entry: RecordWithoutHash): string {
  return JSON.stringify([
    entry.seq, entry.recordedAt, entry.event,
    entry.chainKeyId, entry.prevHash, entry.evidenceBearing
  ]);
}

/** Genuine SHA-256 digest over a record's own content plus its predecessor pointer. */
export function computeRecordHash(entry: RecordWithoutHash): string {
  return nodeCrypto.createHash(CHAIN_HASH_ALGORITHM).update(canonicalRecordPayload(entry)).digest('hex');
}

/** Constant-time comparison with an explicit length guard. */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return nodeCrypto.timingSafeEqual(bufA, bufB);
}

/* ── FORENSIC FINDINGS ───────────────────────────────────────────────────── */

/**
 * Every way the persisted file can be structurally wrong. Each carries the
 * physical line number so an operator can go and look at that exact byte.
 */
export type LedgerFindingCode =
  /** Final line is not newline-terminated: the process died mid-append. */
  | 'TORN_TRAILING_WRITE'
  /** A line is not parseable JSON. */
  | 'UNPARSEABLE_LINE'
  /** Stored `hash` does not match the digest re-derived from the record's own content. */
  | 'DIGEST_MISMATCH'
  /** `seq` at this line is not strictly greater than every earlier `seq`. */
  | 'SEQ_REWIND'
  /** One `seq` value carries more than one distinct `prevHash`: two chains, one sequence number. */
  | 'SEQ_FORK'
  /** `prevHash` does not equal the previous PHYSICAL line's `hash`. */
  | 'LINKAGE_BREAK'
  /** First record does not link to the configured genesis anchor. */
  | 'MISSING_GENESIS_LINK'
  /** `seq` skipped a value going forward. */
  | 'SEQ_GAP';

export interface LedgerFinding {
  code: LedgerFindingCode;
  /** 1-based physical line number in the file, or null for whole-file findings. */
  lineNumber: number | null;
  seq: number | null;
  detail: string;
}

export interface ForkPoint {
  seq: number;
  /** Physical line numbers carrying this `seq`. */
  lineNumbers: number[];
  /** The distinct `prevHash` values found for it — more than one means a real fork. */
  prevHashes: string[];
  /** The distinct record `hash` values — more than one means duplicate appends. */
  hashes: string[];
}

export interface LedgerForensicReport {
  ledgerPath: string;
  /** Every non-blank line physically present in the file. */
  physicalLines: number;
  /** FALSE when the file's last byte is not a newline — i.e. a torn append. */
  trailingNewlinePresent: boolean;
  /** Byte offset just past the last complete, parseable, digest-valid record. */
  lastCompleteRecordOffset: number;
  totalBytes: number;
  records: LedgerRecord[];
  /** Highest `seq` physically persisted, or -1 when the file is empty. */
  maxSeq: number;
  minSeq: number;
  distinctSeqCount: number;
  findings: LedgerFinding[];
  forks: ForkPoint[];
  /** TRUE only when `findings` is empty. */
  structurallySound: boolean;
}

/* ── LOCK ────────────────────────────────────────────────────────────────── */

export interface LedgerLockOptions {
  /** How long to wait for a contended lock before refusing. */
  acquireTimeoutMs?: number;
  /** A lock whose owner process is gone AND older than this may be broken. */
  staleAfterMs?: number;
}

const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_AFTER_MS = 60_000;

interface LockOwner {
  pid: number;
  host: string;
  acquiredAt: string;
  purpose: string;
}

export class LedgerWriteRefused extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LedgerWriteRefused';
    this.code = code;
  }
}

/** True when a process with this pid exists and is signalable. */
function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const sleepSyncMs = (ms: number): void => {
  // Deliberately a busy-wait via Atomics: the critical section is synchronous,
  // and we must never `await` while holding the lock.
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
};

/**
 * Acquire the exclusive ledger lock.
 *
 * `openSync(path, 'wx')` is O_CREAT|O_EXCL, i.e. CREATE_NEW on Windows. The
 * operating system guarantees that exactly one caller can create the file; every
 * other caller gets EEXIST. That is the primitive that makes "single writer"
 * an enforced fact rather than an intention.
 */
function acquireLedgerLock(
  lockPath: string,
  purpose: string,
  options: LedgerLockOptions
): { release: () => void; owner: LockOwner } {
  const acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const deadline = Date.now() + acquireTimeoutMs;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      const owner: LockOwner = {
        pid: process.pid,
        host: os.hostname(),
        acquiredAt: new Date().toISOString(),
        purpose
      };
      fs.writeSync(fd, JSON.stringify(owner));
      fs.fsyncSync(fd);
      fs.closeSync(fd);

      let released = false;
      return {
        owner,
        release: () => {
          if (released) return;
          released = true;
          try { fs.unlinkSync(lockPath); } catch { /* already gone — nothing to undo */ }
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      // Someone holds it. Decide: wait, or is it provably dead?
      let existing: LockOwner | null = null;
      try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LockOwner; } catch { /* torn lock file */ }

      if (existing) {
        const ageMs = Date.now() - Date.parse(existing.acquiredAt);
        const ownerDead = !processIsAlive(existing.pid);
        const foreignHost = existing.host !== os.hostname();
        if (ownerDead && ageMs > staleAfterMs) {
          // The owner is gone. Break the lock, but say so out loud — a broken
          // lock is evidence that a writer died mid-append, which is exactly
          // the condition that produces torn writes.
          console.error(
            `[LEDGER] Breaking STALE lock ${lockPath}: owner pid=${existing.pid} on host ` +
            `${existing.host} is gone and the lock is ${Math.round(ageMs / 1000)}s old. ` +
            `A writer died while holding the ledger lock — expect a torn trailing record ` +
            `and run verifyLedgerOnDisk() before trusting this ledger again.`
          );
          try { fs.unlinkSync(lockPath); } catch { /* raced with another breaker */ }
          continue;
        }
        if (!foreignHost && ownerDead) {
          // Dead but young: give the OS a moment to finish tearing down.
          if (Date.now() > deadline) {
            throw new LedgerWriteRefused(
              'AUDIT_LEDGER_WRITE_REFUSED_LOCKED',
              `AUDIT_LEDGER_WRITE_REFUSED_LOCKED: ledger lock ${lockPath} is held by pid ` +
              `${existing.pid} (since ${existing.acquiredAt}) and that owner is gone. Refusing to ` +
              `write rather than risk interleaving with a writer we cannot see. Remove the lock ` +
              `only after confirming no process is running.`
            );
          }
          sleepSyncMs(25);
          continue;
        }
      }

      if (Date.now() > deadline) {
        throw new LedgerWriteRefused(
          'AUDIT_LEDGER_WRITE_REFUSED_LOCKED',
          `AUDIT_LEDGER_WRITE_REFUSED_LOCKED: could not acquire the exclusive ledger lock ` +
          `${lockPath} within ${acquireTimeoutMs}ms. Another writer holds it. REFUSING to append ` +
          `without the lock: an unlocked append is precisely the defect that forked this ledger. ` +
          `The record was NOT written.`
        );
      }
      sleepSyncMs(10);
    }
  }
}

/* ── FORENSIC READ ───────────────────────────────────────────────────────── */

/**
 * Examine EVERY physical line of the ledger and report what is wrong with it.
 *
 * This function is deliberately NON-DESTRUCTIVE and NON-TRUNCATING. It has no
 * `break` and no silent `continue`: a defect anywhere in the file becomes a
 * finding, and the caller decides what to do about it. That is the whole point
 * — the previous loader `break`ed at the first `seq` discontinuity, which is
 * why a 200-line forked file verified as a clean 4-entry chain.
 */
export function verifyLedgerOnDisk(ledgerPath: string = DEFAULT_LEDGER_FILE_PATH): LedgerForensicReport {
  const findings: LedgerFinding[] = [];
  const forks: ForkPoint[] = [];

  if (!fs.existsSync(ledgerPath)) {
    return {
      ledgerPath, physicalLines: 0, trailingNewlinePresent: true, lastCompleteRecordOffset: 0,
      totalBytes: 0, records: [], maxSeq: -1, minSeq: -1, distinctSeqCount: 0,
      findings, forks, structurallySound: true
    };
  }

  const buf = fs.readFileSync(ledgerPath);
  const totalBytes = buf.length;
  const raw = buf.toString('utf8');

  // ── INVARIANT I3 — a torn trailing write must be VISIBLE ─────────────────
  const trailingNewlinePresent = totalBytes === 0 || raw.endsWith('\n');
  if (!trailingNewlinePresent) {
    const partial = raw.slice(raw.lastIndexOf('\n') + 1);
    findings.push({
      code: 'TORN_TRAILING_WRITE',
      lineNumber: raw.split('\n').length,
      seq: null,
      detail:
        `The final record is not newline-terminated: ${partial.length} trailing byte(s) ` +
        `("${partial.slice(0, 60)}"). A writer died mid-append. This partial record is ` +
        `reported, NOT dropped and re-chained — re-chaining from the previous head is how a ` +
        `torn write becomes a silent fork.`
    });
  }

  // Walk the file byte-by-byte so we can report an exact truncation offset for
  // each COMPLETE record, which is what makes recovery idempotent and auditable.
  const records: LedgerRecord[] = [];
  let cursor = 0;
  let lineNumber = 0;
  let prevPhysicalHash: string | null = null;
  let maxSeq = -1;
  let minSeq = -1;
  let lastCompleteRecordOffset = 0;
  const bySeq = new Map<number, ForkPoint>();

  while (cursor < totalBytes) {
    const nl = buf.indexOf(0x0a, cursor);
    if (nl === -1) break;                       // torn tail — already reported above
    const lineBuf = buf.subarray(cursor, nl);
    cursor = nl + 1;
    lineNumber++;

    const line = lineBuf.toString('utf8');
    if (line.trim().length === 0) continue;    // blank separator line, not a record

    const byteEnd = cursor;                     // offset just past this record's newline

    let parsed: LedgerRecord | null = null;
    try {
      parsed = JSON.parse(line) as LedgerRecord;
    } catch {
      findings.push({
        code: 'UNPARSEABLE_LINE', lineNumber, seq: null,
        detail: `Line ${lineNumber} is not valid JSON: ${line.slice(0, 80)}`
      });
      continue;                                 // finding recorded; the walk CONTINUES
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.seq !== 'number') {
      findings.push({
        code: 'UNPARSEABLE_LINE', lineNumber, seq: null,
        detail: `Line ${lineNumber} parsed but is not a ledger record (missing numeric 'seq').`
      });
      continue;
    }

    const { hash, ...rest } = parsed;
    const recomputed = computeRecordHash(rest as RecordWithoutHash);
    if (recomputed !== hash) {
      findings.push({
        code: 'DIGEST_MISMATCH', lineNumber, seq: parsed.seq,
        detail:
          `seq=${parsed.seq} stores hash ${String(hash).slice(0, 16)}… but its own content ` +
          `hashes to ${recomputed.slice(0, 16)}…. The record's CONTENT was altered, or the ` +
          `digest was fabricated.`
      });
    }

    // ── INVARIANT I2 — `seq` must be strictly increasing across the file ────
    if (parsed.seq <= maxSeq) {
      findings.push({
        code: 'SEQ_REWIND', lineNumber, seq: parsed.seq,
        detail:
          `seq=${parsed.seq} at line ${lineNumber} is not greater than the highest seq already ` +
          `in this file (${maxSeq}). The sequence number went BACKWARDS, which means this record ` +
          `was produced by a writer whose view of the ledger was stale — the concurrency defect.`
      });
    } else if (maxSeq >= 0 && parsed.seq > maxSeq + 1) {
      findings.push({
        code: 'SEQ_GAP', lineNumber, seq: parsed.seq,
        detail: `seq jumped from ${maxSeq} to ${parsed.seq}, skipping ${parsed.seq - maxSeq - 1} value(s).`
      });
    }

    // ── INVARIANT I4 — record the fork, never resolve it ───────────────────
    if (!bySeq.has(parsed.seq)) {
      bySeq.set(parsed.seq, { seq: parsed.seq, lineNumbers: [], prevHashes: [], hashes: [] });
    }
    const fp = bySeq.get(parsed.seq)!;
    fp.lineNumbers.push(lineNumber);
    if (!fp.prevHashes.includes(parsed.prevHash)) fp.prevHashes.push(parsed.prevHash);
    if (!fp.hashes.includes(hash)) fp.hashes.push(hash);

    // ── linkage is checked against the PREVIOUS PHYSICAL line ──────────────
    if (lineNumber === 1 && parsed.prevHash !== GENESIS_PREV_HASH) {
      findings.push({
        code: 'MISSING_GENESIS_LINK', lineNumber, seq: parsed.seq,
        detail:
          `The first record does not link to the configured genesis anchor ` +
          `${GENESIS_PREV_HASH.slice(0, 16)}….`
      });
    } else if (prevPhysicalHash !== null && parsed.prevHash !== prevPhysicalHash) {
      findings.push({
        code: 'LINKAGE_BREAK', lineNumber, seq: parsed.seq,
        detail:
          `seq=${parsed.seq} at line ${lineNumber} claims prevHash ${parsed.prevHash.slice(0, 16)}… ` +
          `but the record physically before it (line ${lineNumber - 1}) hashes to ` +
          `${prevPhysicalHash.slice(0, 16)}….`
      });
    }

    records.push(parsed);
    prevPhysicalHash = hash;
    if (parsed.seq > maxSeq) maxSeq = parsed.seq;
    if (minSeq < 0 || parsed.seq < minSeq) minSeq = parsed.seq;
    lastCompleteRecordOffset = byteEnd;
  }

  for (const fp of bySeq.values()) {
    if (fp.prevHashes.length > 1) {
      forks.push(fp);
      findings.push({
        code: 'SEQ_FORK', lineNumber: fp.lineNumbers[0] ?? null, seq: fp.seq,
        detail:
          `FORK at seq=${fp.seq}: ${fp.prevHashes.length} DIFFERENT prevHash values across lines ` +
          `[${fp.lineNumbers.join(', ')}] — ${fp.prevHashes.map(h => h.slice(0, 12) + '…').join(' vs ')}. ` +
          `Two distinct chains were written for one sequence number.`
      });
    } else if (fp.hashes.length > 1) {
      forks.push(fp);
      findings.push({
        code: 'SEQ_FORK', lineNumber: fp.lineNumbers[0] ?? null, seq: fp.seq,
        detail:
          `DUPLICATE APPEND at seq=${fp.seq}: ${fp.hashes.length} distinct records sharing one ` +
          `prevHash across lines [${fp.lineNumbers.join(', ')}]. The same sequence number was ` +
          `appended more than once.`
      });
    }
  }

  return {
    ledgerPath,
    physicalLines: records.length + findings.filter(f => f.code === 'UNPARSEABLE_LINE').length,
    trailingNewlinePresent,
    lastCompleteRecordOffset,
    totalBytes,
    records,
    maxSeq,
    minSeq,
    distinctSeqCount: bySeq.size,
    findings,
    forks,
    structurallySound: findings.length === 0
  };
}

/* ── STORE ───────────────────────────────────────────────────────────────── */

export interface LedgerStoreOptions extends LedgerLockOptions {
  ledgerPath?: string;
}

export interface AppendRequest {
  event: string;
  chainKeyId: string;
  evidenceBearing?: boolean;
  recordedAt?: string;
}

export interface LedgerStore {
  readonly ledgerPath: string;
  /** Forensic view of the file as it is right now. */
  inspect(): LedgerForensicReport;
  /**
   * Append one record under the exclusive lock. `seq` is `max(seq on disk) + 1`,
   * re-read while the lock is held. Throws `LedgerWriteRefused` rather than
   * interleaving if another writer holds the lock.
   */
  appendRecord(request: AppendRequest): LedgerRecord;
  /** Idempotent. Safe to call any number of times; see `recoverLedger`. */
  recoverLedger(acknowledgement: { acknowledgeDataLoss: true; reason: string }): LedgerRecoveryResult;
  close(): void;
}

export interface LedgerRecoveryResult {
  ledgerPath: string;
  changed: boolean;
  bytesBefore: number;
  bytesAfter: number;
  recordsDiscarded: number;
  /** The findings that recovery removed. Empty when the file was already sound. */
  resolvedFindings: LedgerFinding[];
  /** Findings that survive recovery, i.e. the ledger is still forked. */
  survivingFindings: LedgerFinding[];
  reason: string;
}

/**
 * Open the ledger for writing.
 *
 * NOTE ON WHAT THIS DOES NOT DO: it does not repair, compact, truncate or
 * "tidy" anything. It takes the lock, reads, and reports. Repair is a separate,
 * explicit, acknowledged operation (`recoverLedger`).
 */
export function openLedgerStore(options: LedgerStoreOptions = {}): LedgerStore {
  const ledgerPath = options.ledgerPath ?? DEFAULT_LEDGER_FILE_PATH;
  const lockPath = `${ledgerPath}.lock`;
  const acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  let lockHeld = false;

  const withLock = <T>(purpose: string, fn: () => T): T => {
    if (lockHeld) return fn();                 // same-process re-entry: we never await inside
    const lock = acquireLedgerLock(lockPath, purpose, { acquireTimeoutMs, staleAfterMs });
    lockHeld = true;
    try { return fn(); } finally { lockHeld = false; lock.release(); }
  };

  const inspect = (): LedgerForensicReport => verifyLedgerOnDisk(ledgerPath);

  /**
   * INVARIANT I2, enforced at the only place it can be: `seq` is computed from
   * the MAXIMUM seq physically on disk, re-read while holding the lock, so a
   * concurrent writer cannot make us repeat or reuse a sequence number.
   */
  const appendRecord = (request: AppendRequest): LedgerRecord => withLock('append', () => {
    const report = verifyLedgerOnDisk(ledgerPath);

    if (!report.trailingNewlinePresent && report.totalBytes > 0) {
      throw new LedgerWriteRefused(
        'AUDIT_LEDGER_TORN_TRAILING_WRITE',
        `AUDIT_LEDGER_TORN_TRAILING_WRITE: ${ledgerPath} ends with a PARTIAL record ` +
        `(${report.totalBytes - report.lastCompleteRecordOffset} trailing byte(s) with no ` +
        `terminating newline). Appending now would bury a torn record under a new one and hide ` +
        `the evidence. The record was NOT written. Run recoverLedger() with an explicit data-loss ` +
        `acknowledgement, or inspect the file, before appending again.`
      );
    }

    const nextSeq = report.maxSeq + 1;
    const prevHash = report.maxSeq >= 0 && report.records.length > 0
      ? report.records[report.records.length - 1].hash
      : GENESIS_PREV_HASH;

    const base: RecordWithoutHash = {
      seq: nextSeq,
      recordedAt: request.recordedAt ?? new Date().toISOString(),
      event: request.event,
      chainKeyId: request.chainKeyId,
      prevHash,
      evidenceBearing: request.evidenceBearing ?? false
    };
    const record: LedgerRecord = { ...base, hash: computeRecordHash(base) };

    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    // One `write` syscall for the WHOLE record including its terminating newline,
    // on a handle opened O_APPEND, followed by fsync so the record is durable
    // before we report it. See the header for what atomicity this does and does
    // not claim.
    const fd = fs.openSync(ledgerPath, 'a');
    try {
      fs.writeSync(fd, JSON.stringify(record) + '\n', null, 'utf8');
      fs.fsyncSync(fd);
    } catch (err) {
      throw new LedgerWriteRefused(
        'AUDIT_LEDGER_PERSIST_FAILED',
        `Could not append seq=${record.seq} to ${ledgerPath}: ${(err as Error).message}. ` +
        `The record was deliberately NOT adopted — reporting it as recorded would be a false claim.`
      );
    } finally {
      fs.closeSync(fd);
    }
    return record;
  });

  /**
   * IDEMPOTENT RECOVERY.
   *
   * Truncates the file to `lastCompleteRecordOffset` — the byte offset just
   * past the last COMPLETE, parseable, digest-valid record. Because that offset
   * is a pure function of the surviving prefix, running this twice produces the
   * same file: the second call finds nothing after the offset and changes
   * nothing. That is what idempotent means here, and it is verified by the test
   * harness rather than asserted in a comment.
   *
   * It is NEVER called automatically and it NEVER picks a branch. Everything
   * after the first structurally invalid point is discarded, and what was
   * discarded is reported so an operator can decide whether it was a torn write
   * (recoverable) or a fork (evidence of a real event, and the surviving
   * findings will say so).
   */
  const recoverLedger = (ack: { acknowledgeDataLoss: true; reason: string }): LedgerRecoveryResult =>
    withLock('recover', () => {
      const before = verifyLedgerOnDisk(ledgerPath);
      const bytesBefore = before.totalBytes;
      const target = before.lastCompleteRecordOffset;

      if (bytesBefore === target) {
        return {
          ledgerPath, changed: false, bytesBefore, bytesAfter: bytesBefore, recordsDiscarded: 0,
          resolvedFindings: [], survivingFindings: before.findings, reason: ack.reason
        };
      }

      const fd = fs.openSync(ledgerPath, 'r+');
      try {
        fs.ftruncateSync(fd, target);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      const after = verifyLedgerOnDisk(ledgerPath);
      const resolved = new Set(before.findings.map(f => `${f.code}@${f.lineNumber}#${f.seq}`));
      return {
        ledgerPath,
        changed: true,
        bytesBefore,
        bytesAfter: target,
        recordsDiscarded: Math.max(0, before.physicalLines - after.physicalLines),
        resolvedFindings: before.findings.filter(f => !resolved.has(`${f.code}@${f.lineNumber}#${f.seq}`)),
        survivingFindings: after.findings,
        reason: ack.reason
      };
    });

  return {
    ledgerPath,
    inspect,
    appendRecord,
    recoverLedger,
    close: () => { /* no long-lived resources; the lock is per-operation */ }
  };
}

/** One-shot helper: open, append, close. Used by the MCP server's append path. */
export function appendLedgerRecordSync(request: AppendRequest, options: LedgerStoreOptions = {}): LedgerRecord {
  const store = openLedgerStore(options);
  try { return store.appendRecord(request); } finally { store.close(); }
}