/**
 * ============================================================================
 * SOVEREIGN MODEL CONTEXT PROTOCOL (MCP) SERVER & TOOL DEVELOPER ENGINE
 * Standard: Model Context Protocol (MCP) JSON-RPC 2.0 Specification
 * Primitives: Tools, Resources, Prompts, Sampling, Sandboxed Stdio/HTTP Transports
 * Chain Key ID: 360ea36c28e66d9d
 * ============================================================================
 */

import nodeCrypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { sovereignAgentMemoryInstance } from './agentMemoryEngine';
import { sovereignKernelInstance } from '../os/kernelEngine';
import {
  verifyChainAgainstAnchorOnDisk,
  type AnchorVerificationResult
} from './auditChainAnchor';
import {
  openLedgerStore,
  verifyLedgerOnDisk,
  LedgerWriteRefused,
  GENESIS_PREV_HASH as STORE_GENESIS_PREV_HASH,
  computeRecordHash,
  canonicalRecordPayload,
  DEFAULT_LEDGER_FILE_PATH,
  type LedgerRecord,
  type LedgerForensicReport,
  type LedgerFinding
} from './auditLedgerStore';

/* ── PERSISTENT LEDGER PATH ─────────────────────────────────────────────────
 * Default: <project-root>/data/audit-ledger.jsonl
 * Override with env SOVEREIGN_LEDGER_PATH for alternative mount points.
 * The `data/` directory is created on first write if absent.
 * The file format is newline-delimited JSON — one SovereignChainEntry per line.
 *
 * The path now comes from `auditLedgerStore.ts` so that the append path and the
 * verification path cannot disagree about which file they are talking about.
 * That disagreement is not hypothetical: two independent resolutions of this
 * constant, in two processes, is two ledgers.
 * ─────────────────────────────────────────────────────────────────────────── */
export const LEDGER_FILE_PATH = DEFAULT_LEDGER_FILE_PATH;


export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (args: Record<string, any>) => Promise<{ content: Array<{ type: 'text' | 'image' | 'resource'; text?: string; data?: string; mimeType?: string }> }>;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  readHandler: () => Promise<string>;
}

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
  templateHandler: (args: Record<string, any>) => string;
}

/* ============================================================================
 * 0. CRYPTOGRAPHIC AUDIT CHAIN — REAL IMPLEMENTATION (Chain Key 360ea36c28e66d9d)
 * ============================================================================
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FORENSIC FINDING THIS BLOCK REPLACES (A6)
 * ────────────────────────────────────────────────────────────────────────────
 * The previous revision of `sovereign_verify_chain` was a tautology:
 *
 *     const isValid = chainKeyId === '360ea36c28e66d9d';
 *
 * i.e. a string literal compared against the same string literal. It performed
 * no SHA-256, read no ledger, verified no linkage — yet it surfaced to the
 * orchestrator as `rpcSelfTest.chainVerified: true` and supplied 30 of the 30
 * points in the published framework health score.
 *
 * FORENSIC AUDIT OF THIS REPOSITORY (what chain data actually exists):
 *   - `grep -r "prevHash" --include=*.ts` -> ZERO matches anywhere in the tree.
 *     A forward-linked chain REQUIRES a `prevHash` pointer on every entry. There
 *     is not one, therefore no genuine chain structure exists here today.
 *   - `server.ts:171-175` declares `auditChainStatus = { status: 'INTACT', ... }`
 *     as a hardcoded literal that is never recomputed — it is a constant, not a
 *     verification result.
 *   - `server.ts:299-304` (`GET /api/audit`) returns three hardcoded literal
 *     blocks with hardcoded hashes and no linkage between them.
 *   - `src/os/kernelEngine.ts:466-502` holds `signedModules` with bare
 *     `sha256Hash` strings and no source content to re-hash, so they are
 *     unverifiable claims rather than evidence.
 *
 * CONCLUSION: fabricating a chain to make this tool report INTACT would be a
 * lie dressed as cryptography. Instead:
 *   (a) a REAL, tamper-evident append-only ledger of chain-verification records
 *       is maintained by this module, with genuine SHA-256 digests and genuine
 *       `prevHash` linkage;
 *   (b) verification RECOMPUTES every digest from each entry's own content and
 *       RE-DERIVES every linkage, it never trusts a stored digest;
 *   (c) the caller-supplied Chain Key ID is bound to the configured one via
 *       `crypto.timingSafeEqual` over SHA-256 digests, with a length guard;
 *   (d) if the ledger holds no entries, the result is an explicit
 *       UNVERIFIED_* negative. An empty chain is never reported as intact.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRUST BOUNDARY — added by CHAIN-ARCHITECT (the limit of (a)…(d))
 * ────────────────────────────────────────────────────────────────────────────
 * (a)…(d) above are all LOCAL: they recompute from data held in the same trust
 * boundary as the verifier. In this deployment the ledger reaches the runtime
 * container solely via the `data/` bind mount, which is writable by the uid-1000
 * process doing the verifying. So recomputation catches corruption and naive
 * edits, but an attacker with code execution in the container can rewrite the
 * entries AND their hashes consistently and still pass.
 *
 * `SEAL_INTACT_VERIFIED` is therefore gated on a FOURTH condition that none of
 * (a)…(d) can supply: a detached signature over the exact chain on disk,
 * verified against a public key pinned OUTSIDE the container. That check lives
 * in `auditChainAnchor.ts`, which classifies an anchor by what it is actually
 * worth — an unsigned co-located anchor is reported as `LOCAL_UNSIGNED_ASSERTION`
 * and earns NOTHING, because calling that "INTACT" would be the original lie
 * wearing a different hat.
 *
 * No key is provisioned, so today the anchor resolves to `NO_ANCHOR`, the status
 * is `UNVERIFIED_ANCHOR_ABSENT`, `ok` is false, and the 30 health points stay at
 * zero. That is the correct measurement for this deployment, not a bug to route
 * around.
 * ========================================================================= */

/** The Chain Key ID this process is configured with. */
export const SOVEREIGN_CHAIN_KEY_ID = '360ea36c28e66d9d';

/** Hash algorithm used for every digest below. Real algorithm, never a stub. */
export const CHAIN_HASH_ALGORITHM = 'sha256';

/**
 * Genesis anchor: the `prevHash` of sequence #0, derived deterministically from
 * the configured Chain Key ID so the first entry is genuinely bound to the key.
 * It is NOT a random or hand-written constant.
 *
 * ASSERTED AGAINST THE STORE'S INDEPENDENT DERIVATION rather than recomputed
 * here a second time. Two derivations of a value both code paths depend on are
 * two chances to disagree, and a silent disagreement would look exactly like a
 * genesis-link tamper finding on a completely untampered ledger.
 */
export const GENESIS_PREV_HASH: string = (() => {
  if (STORE_GENESIS_PREV_HASH === nodeCrypto
    .createHash(CHAIN_HASH_ALGORITHM)
    .update(`SOVEREIGN_CHAIN_GENESIS|${SOVEREIGN_CHAIN_KEY_ID}`)
    .digest('hex')) {
    return STORE_GENESIS_PREV_HASH;
  }
  throw new Error(
    'AUDIT_LEDGER_GENESIS_MISMATCH: the genesis anchor derived here differs from the one ' +
    'derived in auditLedgerStore.ts. The ledger write path and the ledger verify path would be ' +
    'verifying against different genesis values. Refusing to start.'
  );
})();

/**
 * The ledger record shape. Now sourced from `auditLedgerStore.ts` so the writer
 * and the verifier cannot drift apart on what a record IS — a drift there is
 * silent data loss, not a compile error.
 */
export type SovereignChainEntry = LedgerRecord;

/* ── PERSISTENT LEDGER — LOAD FROM DISK ─────────────────────────────────────
 * Reads the JSONL ledger file at startup and validates that:
 *   1. Every line is parseable JSON with the required fields.
 *   2. Every entry's stored `hash` matches what `computeChainEntryHash` derives
 *      from its own content (no stored digest is trusted).
 *   3. Sequential `seq` values are contiguous starting from 0.
 * Entries that fail validation are dropped and a warning is emitted so that a
 * corrupted tail does not silence an otherwise intact ledger.
 * An empty or absent file is a valid starting state (genesis).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LEDGER-INTEGRITY: THE PARAGRAPH ABOVE DESCRIBES THE DEFECT, NOT THE FIX.
 * ───────────────────────────────────────────────────────────────────────────
 * "Entries that fail validation are dropped … so that a corrupted tail does not
 * silence an otherwise intact ledger" was the stated intent and it is precisely
 * what made the ledger lie. The old implementation:
 *
 *     catch { console.warn(...); continue; }              // unparseable  -> DROP
 *     if (recomputed !== hash) { console.warn(...); continue; }  // bad digest -> DROP
 *     if (entry.seq !== loaded.length) { console.warn(...); break; } // gap -> STOP
 *
 * Every one of those discards the remainder of the file and records NOTHING
 * beyond a console warning that no caller ever reads. Measured consequence on
 * the real `data/audit-ledger.jsonl`: the file holds 42 records and this
 * function returned 5 of them, then `verifySovereignChain` reported
 * `ENTRY_LINKAGE … 5/5 entries link to their predecessor; 0 broken link(s)`.
 * A 42-record forked file had been certified as a clean 5-record chain.
 *
 * The corrected behaviour is: load the file WHOLE, keep every record, and hand
 * the defects to `verifySovereignChain` as findings that FAIL a check and name
 * their line numbers. Silently dropping the evidence of a fork is not
 * "defence in depth" — it is the defect.
 * ───────────────────────────────────────────────────────────────────────────
 */
function loadLedgerFromDisk(): LedgerForensicReport {
  const report = verifyLedgerOnDisk(LEDGER_FILE_PATH);
  if (report.findings.length > 0) {
    console.error(
      `[LEDGER] STRUCTURAL DEFECT in ${LEDGER_FILE_PATH}: ${report.findings.length} finding(s) ` +
      `across ${report.physicalLines} physical record(s). All ${report.records.length} parsed ` +
      `record(s) are being retained — nothing is dropped and nothing is truncated — so the ` +
      `defect is REPORTED rather than hidden. First findings:\n` +
      report.findings.slice(0, 6).map(f => `    - [${f.code}] line=${f.lineNumber} ${f.detail}`).join('\n') +
      (report.findings.length > 6 ? `\n    … and ${report.findings.length - 6} more.` : '')
    );
  }
  if (report.records.length > 0) {
    console.log(`[LEDGER] Loaded ${report.records.length} record(s) (max seq ${report.maxSeq}) from ${LEDGER_FILE_PATH}`);
  }
  return report;
}

/**
 * Append-only audit ledger. Initialised from disk at module load time.
 *
 * This is the hydrated VIEW the verifier checks. It is deliberately NOT the
 * source of truth for `seq` — see `appendChainRecord`. If a writer appends
 * after this module loaded, the file is authoritative and `seq` comes from
 * there; this array is refreshed by `refreshLedgerFromDisk()` at verification
 * time so that what the verifier checks is what is actually on disk.
 */
let sovereignAuditLedger: SovereignChainEntry[] = loadLedgerFromDisk().records;

/**
 * Re-read the ledger from disk. Verification MUST run against what is persisted,
 * not against whatever this process happened to load at start-up — otherwise a
 * writer that appended after we booted is invisible to us and the verifier
 * certifies a prefix of the file. Cheap: one read, and it is the same read the
 * forensic pass performs.
 */
function refreshLedgerFromDisk(): LedgerForensicReport {
  const report = loadLedgerFromDisk();
  sovereignAuditLedger = report.records;
  return report;
}

export type ChainCheckId =
  | 'CHAIN_KEY_BINDING'
  | 'SEALED_EVIDENCE_PRESENT'
  | 'GENESIS_ANCHOR_LINKAGE'
  | 'EXTERNAL_ANCHOR_ATTESTATION'
  | 'ENTRY_DIGEST_RECOMPUTATION'
  | 'ENTRY_LINKAGE'
  /**
   * LEDGER-INTEGRITY. A structural examination of the ledger FILE ITSELF:
   * every physical line accounted for, no `seq` rewind, no fork, no duplicate
   * append, no torn trailing write.
   *
   * This check exists because the two checks above it are not sufficient, and
   * the failure was measured rather than imagined. Both of them operate on the
   * hydrated array, and the old loader silently truncated that array at the
   * first anomaly — so on a 200-record file with 195 backward `seq` steps they
   * both reported PASS over the 4 records they had bothered to load. A check
   * that cannot observe the file cannot certify the file.
   */
  | 'LEDGER_FILE_INTEGRITY';

export interface ChainCheckResult {
  id: ChainCheckId;
  passed: boolean;
  detail: string;
}

export interface ChainVerificationReport {
  /** Preserved key: server.ts gates on `status`, and runners gate on `ok`. */
  ok: boolean;
  /** Preserved key. */
  verifiedChainKey: string;
  /** Preserved key. Only 'SEAL_INTACT_VERIFIED' counts as a pass. */
  status: string;
  /** Preserved key. */
  timestamp: string;
  verified: boolean;
  algorithm: typeof CHAIN_HASH_ALGORITHM;
  reason: string | null;
  checks: ChainCheckResult[];
  /**
   * The external-attestation dimension, reported separately from `ok`/`verified`
   * so a reader can see WHAT KIND of anchor was involved rather than inferring
   * it from a bare pass/fail. `cryptographicallyAnchored` is the only field in
   * this report that may be quoted as "an external party attested to this
   * chain"; everything else is local recomputation.
   *
   * `null` ONLY on the two pre-ledger early returns (wrong Chain Key ID, empty
   * ledger), where no anchor evaluation was attempted at all.
   */
  anchor: AnchorVerificationResult | null;
  ledger: {
    entries: number;
    verifiedEntries: number;
    evidenceBearingEntries: number;
    firstSeq: number | null;
    lastSeq: number | null;
    genesisAnchor: string;
    terminalHash: string | null;
  };
}

/** Deterministic canonical serialization of an entry's own content. */
function canonicalEntryPayload(entry: Omit<SovereignChainEntry, 'hash'>): string {
  const local = JSON.stringify([entry.seq, entry.recordedAt, entry.event, entry.chainKeyId, entry.prevHash, entry.evidenceBearing]);
  // LEDGER-INTEGRITY: this function is no longer on the hashing path —
  // `computeChainEntryHash` delegates to the store — so it would normally be
  // dead code. It is KEPT and turned into a live cross-check instead of being
  // deleted, because a canonicalization that silently drifts between the copy
  // a future maintainer reads and the copy the writer actually uses produces
  // digest mismatches on a perfectly untampered ledger, and the resulting
  // TAMPERED_REJECTED would be indistinguishable from a real attack.
  if (local !== canonicalRecordPayload(entry)) {
    throw new Error(
      'AUDIT_LEDGER_CANONICALIZATION_MISMATCH: the record serialization used here differs from ' +
      'the one in auditLedgerStore.ts. Every digest in the ledger would be computed over ' +
      'different bytes than the writer used. Refusing to verify rather than report a ' +
      'tamper finding that is actually a code-drift bug.'
    );
  }
  return local;
}

/**
 * Genuine SHA-256 digest over an entry's own content plus its predecessor pointer.
 *
 * Delegated to `auditLedgerStore.computeRecordHash` so the digest the WRITER
 * computes and the digest the VERIFIER recomputes are literally the same
 * function. They were two separate copies of the same expression before; that
 * is a latent defect, not a redundancy.
 */
export function computeChainEntryHash(entry: Omit<SovereignChainEntry, 'hash'>): string {
  // Invoked for its drift guard, not for its return value — see the comment on
  // `canonicalEntryPayload`. Costs one JSON.stringify per verified record.
  canonicalEntryPayload(entry);
  return computeRecordHash(entry);
}

/**
 * Constant-time string comparison with an explicit length guard.
 * `crypto.timingSafeEqual` throws on a length mismatch, so the guard must come
 * first; comparing SHA-256 hex digests guarantees equal 32-byte lengths.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return nodeCrypto.timingSafeEqual(bufA, bufB);
}

function sha256Hex(value: string): string {
  return nodeCrypto.createHash(CHAIN_HASH_ALGORITHM).update(value, 'utf8').digest('hex');
}

/**
 * Append a genuinely computed, genuinely linked ledger record.
 *
 * @param event           Audit event label.
 * @param chainKeyId      Chain Key ID this record is bound to.
 * @param evidenceBearing MUST be true only for records sealed by an independent
 *                        evidence producer. Defaults to false so that a
 *                        verification stamp cannot vouch for itself.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LEDGER-INTEGRITY: WHY `seq` NO LONGER COMES FROM AN IN-MEMORY LENGTH
 * ───────────────────────────────────────────────────────────────────────────
 * The previous body computed
 *
 *     const prevHash = ledger[len-1]?.hash ?? GENESIS;
 *     const seq      = ledger.length;
 *
 * from a process-local array, then persisted with a bare `fs.appendFileSync`.
 * `server.ts` and `scripts/run_mcp_test.ts` are separate `tsx` processes that
 * both import this module and both append to the same file. Each had its own
 * array, each counted from its own zero, and nothing excluded the other from
 * writing. Harness result: 200 appends by 8 concurrent processes produced 200
 * physical lines carrying 5 distinct `seq` values and 195 backward steps.
 *
 * `seq` and `prevHash` are now derived INSIDE the store, from the maximum `seq`
 * and the last record physically on disk, re-read while the store holds an
 * exclusive `O_CREAT|O_EXCL` lock file. Two invariants are restored:
 *   I1 a second writer is refused, never interleaved;
 *   I2 `seq` strictly increases across restarts because it is never derived
 *      from a length that a rehydrate may have truncated.
 *
 * The "PERSIST FIRST, THEN ADOPT" ordering below is PRESERVED — it was correct
 * and the comment explaining why is still true. What changed is only where the
 * numbers come from.
 * ───────────────────────────────────────────────────────────────────────────
 */
export function appendChainRecord(event: string, chainKeyId: string, evidenceBearing = false): SovereignChainEntry {
  const store = openLedgerStore({ ledgerPath: LEDGER_FILE_PATH });
  let entry: SovereignChainEntry;
  try {
    entry = store.appendRecord({ event, chainKeyId, evidenceBearing });
  } catch (err) {
    const detail = err instanceof LedgerWriteRefused ? `${err.code}: ${err.message}` : (err as Error).message;
    console.error(
      `[LEDGER] REFUSING TO ADOPT an entry for '${event}': persistence to ${LEDGER_FILE_PATH} failed (${detail}). ` +
      `The entry was NOT added to the in-memory ledger, so no caller can be told it was recorded.`
    );
    throw new Error(
      `AUDIT_LEDGER_PERSIST_FAILED: could not append a '${event}' record to ${LEDGER_FILE_PATH} (${detail}). ` +
      `The record was deliberately NOT adopted — reporting it as recorded would be a false claim.`
    );
  } finally {
    store.close();
  }

  // Adopt only what is durable. The store has already re-read the file, so this
  // keeps the hydrated view in step with disk rather than assuming it.
  refreshLedgerFromDisk();
  return entry;
}

/**
 * REAL verification. Every claim below is re-derived from stored content; no
 * stored digest is trusted, and no verdict is asserted without evidence.
 *
 * @param chainKeyId Chain Key ID supplied by the caller.
 */
export function verifySovereignChain(chainKeyId: string): ChainVerificationReport {
  const timestamp = new Date().toISOString();
  const supplied = typeof chainKeyId === 'string' ? chainKeyId : String(chainKeyId);

  // ── LEDGER-INTEGRITY: verify what is ON DISK, not what we loaded at boot ──
  // A writer that appended after this module was imported would otherwise be
  // invisible here, and the verifier would certify a prefix of the ledger.
  const ledgerReport = refreshLedgerFromDisk();
  const fileFindings: LedgerFinding[] = ledgerReport.findings;
  const forks: LedgerFinding[] = fileFindings.filter(f => f.code === 'SEQ_FORK');
  const rewinds = fileFindings.filter(f => f.code === 'SEQ_REWIND');
  const torn = fileFindings.filter(f => f.code === 'TORN_TRAILING_WRITE');
  const unparseable = fileFindings.filter(f => f.code === 'UNPARSEABLE_LINE');

  const checks: ChainCheckResult[] = [];

  // ── CHECK 1: Chain Key binding (real, constant-time, digest-comparered) ──
  const keyBound = constantTimeEquals(sha256Hex(supplied), sha256Hex(SOVEREIGN_CHAIN_KEY_ID));
  checks.push({
    id: 'CHAIN_KEY_BINDING',
    passed: keyBound,
    detail: keyBound
      ? 'Caller-supplied Chain Key ID is digest-identical to the configured Chain Key ID (constant-time comparison of SHA-256 digests).'
      : 'Caller-supplied Chain Key ID does not match the configured Chain Key ID. Rejected.'
  });

  if (!keyBound) {
    return {
      ok: false,
      verifiedChainKey: supplied,
      status: 'CHAIN_KEY_MISMATCH_REJECTED',
      timestamp,
      verified: false,
      algorithm: CHAIN_HASH_ALGORITHM,
      reason: 'The supplied Chain Key ID is not the configured Chain Key ID for this process.',
      checks,
      anchor: null,
      ledger: {
        entries: sovereignAuditLedger.length,
        verifiedEntries: 0,
        evidenceBearingEntries: 0,
        firstSeq: sovereignAuditLedger.length ? sovereignAuditLedger[0].seq : null,
        lastSeq: sovereignAuditLedger.length ? sovereignAuditLedger[sovereignAuditLedger.length - 1].seq : null,
        genesisAnchor: GENESIS_PREV_HASH,
        terminalHash: sovereignAuditLedger.length ? sovereignAuditLedger[sovereignAuditLedger.length - 1].hash : null
      }
    };
  }

  // ── CHECK 2 (LEDGER-INTEGRITY): the ledger FILE must be structurally whole ─
  // Runs over every physical line, before and independently of the two
  // hydrated-array checks below. It FAILS on any fork, rewind, duplicate append,
  // torn trailing write or unparseable line, and it names them with line
  // numbers. It never repairs: choosing which branch of a fork is "the real
  // chain" is a judgement this code has no standing to make silently.
  checks.push({
    id: 'LEDGER_FILE_INTEGRITY',
    passed: fileFindings.length === 0,
    detail:
      `${ledgerReport.physicalLines} physical record(s) examined in ${LEDGER_FILE_PATH}; ` +
      `${ledgerReport.distinctSeqCount} distinct seq value(s); max seq ${ledgerReport.maxSeq}; ` +
      `trailing newline ${ledgerReport.trailingNewlinePresent ? 'present' : 'MISSING (torn write)'}. ` +
      `${fileFindings.length} structural finding(s)` +
      (fileFindings.length
        ? `: ${forks.length} fork/duplicate, ${rewinds.length} seq rewind, ${torn.length} torn trailing write, ` +
          `${unparseable.length} unparseable, ` +
          `${fileFindings.length - forks.length - rewinds.length - torn.length - unparseable.length} other. ` +
          `First finding — [${fileFindings[0].code}] line=${fileFindings[0].lineNumber}: ${fileFindings[0].detail}`
        : ' — every seq strictly increases, every record links to its physical predecessor, and the file is whole.')
  });

  // ── CHECK 3: the ledger must actually contain evidence ──
  if (sovereignAuditLedger.length === 0) {
    checks.push({
      id: 'SEALED_EVIDENCE_PRESENT',
      passed: false,
      detail: 'Ledger holds zero entries. An empty chain proves nothing about integrity and MUST NOT be reported as intact.'
    });
    return {
      ok: false,
      verifiedChainKey: supplied,
      status: 'UNVERIFIED_EMPTY_LEDGER',
      timestamp,
      verified: false,
      algorithm: CHAIN_HASH_ALGORITHM,
      reason:
        'No cryptographic ledger data exists to verify. This repository stores no forward-linked hash chain (zero `prevHash` fields anywhere in the tree), and server.ts:171-175 holds `auditChainStatus` as a hardcoded literal rather than a recomputed result. Reporting INTACT here would be fabrication, so an explicit UNVERIFIED negative is returned instead.',
      checks,
      anchor: null,
      ledger: {
        entries: 0,
        verifiedEntries: 0,
        evidenceBearingEntries: 0,
        firstSeq: null,
        lastSeq: null,
        genesisAnchor: GENESIS_PREV_HASH,
        terminalHash: null
      }
    };
  }

  // ── CHECK 3: independent, evidence-bearing records must exist ──
  // A ledger made only of this module's own verification stamps can verify its
  // own arithmetic forever while proving nothing about the audit history it is
  // supposed to attest to. Such a ledger is structurally incapable of earning
  // SEAL_INTACT_VERIFIED.
  const evidenceEntries = sovereignAuditLedger.filter(e => e.evidenceBearing);
  checks.push({
    id: 'SEALED_EVIDENCE_PRESENT',
    passed: evidenceEntries.length > 0,
    detail: `${evidenceEntries.length} evidence-bearing record(s) sealed by an independent producer; ${sovereignAuditLedger.length - evidenceEntries.length} self-issued verification stamp(s) present (not admissible as evidence).`
  });

  // ── CHECK 4: recompute every entry digest from its own content ──
  let digestFailures = 0;
  for (const entry of sovereignAuditLedger) {
    const { hash, ...rest } = entry;
    if (computeChainEntryHash(rest) !== hash) digestFailures++;
  }
  checks.push({
    id: 'ENTRY_DIGEST_RECOMPUTATION',
    passed: digestFailures === 0,
    detail: `${sovereignAuditLedger.length - digestFailures}/${sovereignAuditLedger.length} entries recomputed to their stored SHA-256 digest; ${digestFailures} mismatch(es).`
  });

  // ── CHECK 5: linkage to the previous entry / to the genesis anchor ──
  let linkageFailures = 0;
  for (let i = 0; i < sovereignAuditLedger.length; i++) {
    const entry = sovereignAuditLedger[i];
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : sovereignAuditLedger[i - 1].hash;
    if (entry.prevHash !== expectedPrev) linkageFailures++;
  }
  checks.push({
    id: 'ENTRY_LINKAGE',
    passed: linkageFailures === 0,
    detail: `${sovereignAuditLedger.length - linkageFailures}/${sovereignAuditLedger.length} entries link to their predecessor; entry #0 links to the genesis anchor ${GENESIS_PREV_HASH.slice(0, 16)}…; ${linkageFailures} broken link(s).`
  });

  const verifiedEntries = sovereignAuditLedger.length - digestFailures;

  // ────────────────────────────────────────────────────────────────────────────
  // CHECK 6: EXTERNAL ANCHOR ATTESTATION — the trust-boundary dimension
  // ────────────────────────────────────────────────────────────────────────────
  // Everything above this line is LOCAL RECOMPUTATION. It is genuine — digests
  // are re-derived from content and linkages are re-walked — but it operates
  // entirely inside one trust boundary. The ledger arrives in the runtime
  // container ONLY through the `data/` bind mount (see the Dockerfile: the runner
  // stage copies just `dist/`, `public/` and `package*.json`, and `.dockerignore`
  // excludes the `.git` tree), and that mount is writable by the very uid-1000 process
  // performing the verification. Anyone who can execute code in the container can
  // therefore rewrite entries, hashes, and any co-located anchor consistently, and
  // every check above would still pass.
  //
  // So a pass REQUIRES an anchor that somebody outside that reach signed. The
  // anchor result is classified, not booleanised, because "the anchor file
  // matched" and "a key the container cannot reach signed this chain" are
  // completely different claims and must never be collapsed into one `true`.
  const anchor = verifyChainAgainstAnchorOnDisk(
    sovereignAuditLedger,
    GENESIS_PREV_HASH,
    SOVEREIGN_CHAIN_KEY_ID,
    computeChainEntryHash as (entry: Omit<SovereignChainEntry, 'hash'>) => string
  );
  checks.push({
    id: 'EXTERNAL_ANCHOR_ATTESTATION',
    passed: anchor.cryptographicallyAnchored,
    detail:
      `anchor=${anchor.assurance}, verdict=${anchor.verdict}, trustBoundary=${anchor.trustBoundary}. ` +
      anchor.detail
  });

  const noEvidence = evidenceEntries.length === 0;
  const chainArithmeticFailed = digestFailures > 0 || linkageFailures > 0;

  /**
   * LEDGER-INTEGRITY: a structural defect in the FILE outranks the arithmetic
   * verdict, because the arithmetic verdict is computed over the hydrated array
   * and the hydrated array is only meaningful if the file is whole.
   *
   * STATUS CHOICE — DELIBERATE, AND THE CONSTRAINT IS EXTERNAL.
   * `scripts/run_mcp_test.ts` allow-lists exactly five status strings
   * (`SEAL_INTACT_VERIFIED`, `UNVERIFIED_EMPTY_LEDGER`,
   * `UNVERIFIED_NO_SEALED_EVIDENCE`, `CHAIN_KEY_MISMATCH_REJECTED`,
   * `TAMPERED_REJECTED`) and that file is outside this task's edit scope.
   * Inventing a new status string would have silently broken a consumer I am
   * forbidden to fix. `TAMPERED_REJECTED` is reused instead, and it is the
   * accurate word: the ledger does not verify and is REJECTED. What caused the
   * divergence — a concurrent writer, a torn append, or a deliberate edit —
   * is NOT decidable from inside this trust boundary, so the reason string says
   * so explicitly rather than letting `TAMPERED_REJECTED` imply an attacker.
   * Claiming a specific cause we cannot establish is the same defect as padding
   * a score.
   */
  const ledgerFileDefective = fileFindings.length > 0;
  // The anchor is only "trustworthy" when it is authentic AND it matched. An
  // unsigned local anchor that matches is explicitly NOT trustworthy evidence —
  // see `LOCAL_UNSIGNED_ASSERTION` in auditChainAnchor.ts.
  const anchorTrustworthy = anchor.cryptographicallyAnchored && anchor.verdict === 'MATCHED';

  // ── VERDICT PRECEDENCE ─────────────────────────────────────────────────────
  // Order matters. A broken chain outranks an anchor story, and a missing
  // independent evidence producer outranks everything, because that is the
  // condition that made the original tautology look like a pass.
  let status: string;
  let reason: string;

  if (ledgerFileDefective || chainArithmeticFailed) {
    status = 'TAMPERED_REJECTED';
    const causes: string[] = [];
    if (ledgerFileDefective) {
      causes.push(
        `the ledger FILE is structurally defective — ${fileFindings.length} finding(s) over ` +
        `${ledgerReport.physicalLines} physical record(s) at ${LEDGER_FILE_PATH}: ` +
        `${forks.length} fork/duplicate-append, ${rewinds.length} seq rewind ` +
        `(a seq that moved backwards), ${torn.length} torn trailing write, ` +
        `${unparseable.length} unparseable line(s)`
      );
      if (forks.length > 0) {
        causes.push(
          `fork points: ${ledgerReport.forks.slice(0, 5).map(f => `seq=${f.seq} at lines [${f.lineNumbers.join(',')}]`).join('; ')}` +
          (ledgerReport.forks.length > 5 ? ` … and ${ledgerReport.forks.length - 5} more` : '')
        );
        causes.push(
          `the file was NOT repaired and no branch was selected: two or more chains exist for the ` +
          `same sequence number, and choosing between them is not decidable from inside this ` +
          `trust boundary`
        );
      } else {
        // Stated explicitly rather than left to inference: with no fork in the
        // file, this is NOT a concurrency fork, and saying "two or more chains
        // exist" would be a false statement in the operator-facing reason.
        causes.push(
          `no fork is present in this file — the defect is not a second writer competing for a ` +
          `sequence number, and nothing was repaired or normalised`
        );
      }
    }
    if (chainArithmeticFailed) {
      causes.push(`${digestFailures} digest mismatch(es) and ${linkageFailures} broken link(s) detected by recomputation`);
    }
    causes.push(
      `CAUSE NOT ESTABLISHED: a concurrent second writer, a torn append interrupted by a crash, ` +
      `and a deliberate edit all produce this signature. No external attestation exists to ` +
      `distinguish them, so this verdict asserts ONLY that the ledger does not verify — ` +
      `it does not assert that an adversary did this.`
    );
    reason = causes.join(' ');
  } else if (noEvidence) {
    status = 'UNVERIFIED_NO_SEALED_EVIDENCE';
    reason =
      'Chain arithmetic is internally consistent, but the ledger contains no evidence-bearing records: every entry is a verification stamp this module issued about itself. No independent producer (governance proposal, kernel audit commit, HITL decision) is wired into this ledger yet, so there is no audit history to attest to. Reporting INTACT would be a self-attested signature — returning UNVERIFIED instead. ' +
      `Anchor state for completeness: ${anchor.detail}`;
  } else if (anchor.verdict === 'MISMATCH') {
    // This is the one genuinely damning state: the seal is here, it is intact,
    // and the chain no longer matches it. That is real evidence of a rewrite.
    status = anchor.cryptographicallyAnchored ? 'TAMPERED_ANCHOR_MISMATCH' : 'UNVERIFIED_ANCHOR_MISMATCH';
    reason =
      `The seal describes a different chain than the one on disk. ${anchor.detail} ` +
      'A MATCHED-equivalent result is impossible until the ledger is restored to the sealed state or re-sealed by an authority outside this container.';
  } else if (anchor.assurance === 'ANCHOR_CORRUPT') {
    status = 'UNVERIFIED_ANCHOR_CORRUPT';
    reason = `An anchor document exists but cannot be trusted. ${anchor.detail}`;
  } else if (anchor.assurance === 'SIGNATURE_UNPINNED_NO_TRUST_ROOT') {
    status = 'UNVERIFIED_ANCHOR_UNPINNED';
    reason = `An anchor exists and matches, but it cannot be attributed to a key. ${anchor.detail}`;
  } else if (anchor.assurance === 'LOCAL_UNSIGNED_ASSERTION') {
    status = 'UNVERIFIED_ANCHOR_UNSIGNED';
    reason =
      `An anchor exists and matches the recomputed chain, but it is an UNSIGNED file co-located with the ledger it covers. ${anchor.detail} ` +
      'This is defence-in-depth against accidental corruption, NOT tamper-evidence. INTACT is withheld because a determined attacker with write access to this host can forge it.';
  } else if (!anchorTrustworthy) {
    // Defensive ordering: the pass branch below is gated on the explicit boolean,
    // not on "none of the other branches matched". If a new assurance class is
    // ever added it must clear this gate, it cannot fall through into a pass.
    status = anchor.verdict === 'MATCHED' ? 'UNVERIFIED_ANCHOR_UNTRUSTED' : 'UNVERIFIED_ANCHOR_ABSENT';
    reason = `No anchor outside this container's write reach has attested to the chain. ${anchor.detail}`;
  } else {
    // Reachable only when: independent evidence exists, every digest and link
    // recomputes, and a detached signature from a key OUTSIDE the container's
    // write reach verifies over the exact chain on disk. Every one of those is
    // measured, none is assumed.
    status = 'SEAL_INTACT_VERIFIED';
    reason = null;
  }

  const intact = status === 'SEAL_INTACT_VERIFIED';

  return {
    ok: intact,
    verifiedChainKey: supplied,
    status,
    timestamp,
    verified: intact,
    algorithm: CHAIN_HASH_ALGORITHM,
    reason,
    checks,
    anchor,
    ledger: {
      entries: sovereignAuditLedger.length,
      verifiedEntries,
      evidenceBearingEntries: evidenceEntries.length,
      firstSeq: sovereignAuditLedger[0].seq,
      lastSeq: sovereignAuditLedger[sovereignAuditLedger.length - 1].seq,
      genesisAnchor: GENESIS_PREV_HASH,
      terminalHash: sovereignAuditLedger[sovereignAuditLedger.length - 1].hash
    }
  };
}

/**
 * Production-Grade Sovereign MCP Server
 */
export class SovereignMcpServer {
  public readonly serverInfo = {
    name: 'sovereign-commander-mcp-server',
    version: '2.4.0',
    protocolVersion: '2024-11-05'
  };

  private tools: Map<string, McpToolDefinition> = new Map();
  private resources: Map<string, McpResourceDefinition> = new Map();
  private prompts: Map<string, McpPromptDefinition> = new Map();

  constructor() {
    this.registerSovereignCoreTools();
    this.registerSovereignResources();
    this.registerSovereignPrompts();
  }

  // =========================================================================
  // 1. TOOL REGISTRATION & MANAGEMENT
  // =========================================================================

  public registerTool(tool: McpToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  public registerResource(resource: McpResourceDefinition) {
    this.resources.set(resource.uri, resource);
  }

  public registerPrompt(prompt: McpPromptDefinition) {
    this.prompts.set(prompt.name, prompt);
  }

  public getToolsList() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
  }

  public getResourcesList() {
    return Array.from(this.resources.values()).map(r => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType
    }));
  }

  public getPromptsList() {
    return Array.from(this.prompts.values()).map(p => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments || []
    }));
  }

  // =========================================================================
  // 2. JSON-RPC 2.0 PROTOCOL DISPATCHER
  // =========================================================================

  public async handleJsonRpcMessage(request: McpJsonRpcRequest): Promise<McpJsonRpcResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        // Initialize handshake
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: this.serverInfo.protocolVersion,
              capabilities: {
                tools: {},
                resources: {},
                prompts: {}
              },
              serverInfo: this.serverInfo
            }
          };

        // Tools
        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: { tools: this.getToolsList() }
          };

        case 'tools/call': {
          const toolName = params?.name;
          const toolArgs = params?.arguments || {};
          const tool = this.tools.get(toolName);

          if (!tool) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Method or Tool not found: '${toolName}'`
              }
            };
          }

          // Validate required inputs
          if (tool.inputSchema.required) {
            for (const req of tool.inputSchema.required) {
              if (toolArgs[req] === undefined || toolArgs[req] === null) {
                return {
                  jsonrpc: '2.0',
                  id,
                  error: {
                    code: -32602,
                    message: `Invalid params: Missing required parameter '${req}' for tool '${toolName}'`
                  }
                };
              }
            }
          }

          const output = await tool.handler(toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: output
          };
        }

        // Resources
        case 'resources/list':
          return {
            jsonrpc: '2.0',
            id,
            result: { resources: this.getResourcesList() }
          };

        case 'resources/read': {
          const uri = params?.uri;
          const resource = this.resources.get(uri);

          if (!resource) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: `Resource not found: '${uri}'`
              }
            };
          }

          const content = await resource.readHandler();
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: resource.mimeType,
                  text: content
                }
              ]
            }
          };
        }

        // Prompts
        case 'prompts/list':
          return {
            jsonrpc: '2.0',
            id,
            result: { prompts: this.getPromptsList() }
          };

        case 'prompts/get': {
          const promptName = params?.name;
          const promptArgs = params?.arguments || {};
          const prompt = this.prompts.get(promptName);

          if (!prompt) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Prompt template not found: '${promptName}'`
              }
            };
          }

          const rendered = prompt.templateHandler(promptArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              description: prompt.description,
              messages: [
                {
                  role: 'user',
                  content: { type: 'text', text: rendered }
                }
              ]
            }
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Unknown MCP method: '${method}'`
            }
          };
      }
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: `Internal MCP Server Error: ${err.message || String(err)}`
        }
      };
    }
  }

  // =========================================================================
  // 3. SOVEREIGN CORE TOOLS DEFINITION
  // =========================================================================

  private registerSovereignCoreTools() {
    // 1. Kernel Telemetry & Microkernel State
    this.registerTool({
      name: 'sovereign_kernel_query',
      description: 'Queries microkernel Ring-0 subsystem status, page tables, and RTOS process metrics',
      inputSchema: {
        type: 'object',
        properties: {
          subsystem: {
            type: 'string',
            description: 'Subsystem to inspect: cpu, memory, processes, page_tables, syscalls',
            enum: ['cpu', 'memory', 'processes', 'page_tables', 'syscalls']
          }
        },
        required: ['subsystem']
      },
      handler: async ({ subsystem }) => {
        let payload: any = {};

        if (subsystem === 'processes') payload = sovereignKernelInstance.processList;
        else if (subsystem === 'syscalls') payload = sovereignKernelInstance.syscallTable;
        else if (subsystem === 'cpu') payload = sovereignKernelInstance.cpuRegisters;
        else if (subsystem === 'memory') payload = { acpiTables: sovereignKernelInstance.acpiTables, uptimeTicks: sovereignKernelInstance.uptimeTicks };
        else payload = {
          bootStage: sovereignKernelInstance.bootStage,
          activeProcesses: sovereignKernelInstance.processList.length,
          ringBufferLength: sovereignKernelInstance.ringBufferLog.length
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, subsystem, data: payload }, null, 2)
            }
          ]
        };
      }
    });

    // 2. Cognitive Memory Search (CoALA)
    this.registerTool({
      name: 'sovereign_memory_recall',
      description: 'Performs unified CoALA cognitive memory search across Semantic facts, Episodic events, and Procedural runbooks',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Semantic search query text' },
          sessionId: { type: 'string', description: 'Active working memory session ID' }
        },
        required: ['query', 'sessionId']
      },
      handler: async ({ query, sessionId }) => {
        const context = sovereignAgentMemoryInstance.prepareUnifiedContext(sessionId, query);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, recalledContext: context }, null, 2)
            }
          ]
        };
      }
    });

    // 3. Cryptographic Chain Verification
    //
    // TRUTH NOTE: this tool now performs REAL work. The previous revision was
    //   `const isValid = chainKeyId === '360ea36c28e66d9d';`
    // — a literal compared to itself, with no hashing and no ledger read. It is
    // replaced by `verifySovereignChain()`, which recomputes SHA-256 digests over
    // real ledger content, re-derives prevHash linkage, and binds the caller's
    // Chain Key ID via crypto.timingSafeEqual. When no ledger data exists the
    // result is an explicit UNVERIFIED_* negative — never a fabricated INTACT.
    //
    // TRUST BOUNDARY (added): recomputation alone is not tamper-evidence. The
    // ledger reaches the runtime container only through the `data/` bind mount,
    // which the verifying process itself can write. A pass therefore additionally
    // requires an external anchor whose detached signature verifies against a
    // public key pinned outside the container — see `auditChainAnchor.ts`, whose
    // header states the model in full. With no key provisioned this tool reports
    // `UNVERIFIED_ANCHOR_ABSENT` and `ok:false`, which is the correct answer for
    // this deployment rather than a defect to be worked around.
    //
    // Every invocation is itself appended to the append-only ledger AFTER
    // verification completes, so the ledger grows from zero and each subsequent
    // verification has genuine evidence to verify.
    this.registerTool({
      name: 'sovereign_verify_chain',
      description:
        'Verifies the SHA-256 forward-linked audit ledger by recomputing each entry digest and each prevHash linkage, and binds the Chain Key ID via constant-time comparison. Reports the external-anchor state explicitly, distinguishing an unsigned local anchor (accidental-corruption detection only) from a signature verified against a pinned key outside the container (genuine tamper-evidence). Returns an explicit UNVERIFIED_* negative whenever no such attestation exists; it never reports INTACT without verified evidence.',
      inputSchema: {
        type: 'object',
        properties: {
          chainKeyId: { type: 'string', description: 'Mandatory Sovereign Chain Key ID' }
        },
        required: ['chainKeyId']
      },
      handler: async ({ chainKeyId }) => {
        const report = verifySovereignChain(chainKeyId);
        // Genuinely append the verification record — hashed and linked, like every
        // other record. This is what gives a later call something real to verify.
        const recorded = appendChainRecord('SOVEREIGN_CHAIN_VERIFIED', report.verifiedChainKey);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...report,
                recordedEntry: { seq: recorded.seq, hash: recorded.hash, prevHash: recorded.prevHash }
              }, null, 2)
            }
          ]
        };
      }
    });

    // 4. Human-In-The-Loop Proposal Tool
    this.registerTool({
      name: 'sovereign_hitl_propose',
      description: 'Generates a formal cryptographic proposal for a sensitive action requiring Commander authorization',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action type, e.g. PURGE_CACHE, RESTART_KERNEL, MIGRATE_SCHEMA' },
          target: { type: 'string', description: 'Resource or component identifier' },
          justification: { type: 'string', description: 'Operational reason for the action' }
        },
        required: ['action', 'target', 'justification']
      },
      handler: async ({ action, target, justification }) => {
        const proposal = {
          proposalId: `mcp_prop_${Date.now().toString(36)}`,
          action,
          target,
          justification,
          status: 'PENDING_COMMANDER_SIGN_OFF',
          chainKey: '360ea36c28e66d9d',
          createdAt: new Date().toISOString()
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, proposal }, null, 2)
            }
          ]
        };
      }
    });
  }

  // =========================================================================
  // 4. SOVEREIGN RESOURCES DEFINITION
  // =========================================================================

  private registerSovereignResources() {
    this.registerResource({
      uri: 'sovereign://telemetry/live',
      name: 'Live System Telemetry',
      description: 'Real-time telemetry metrics, memory allocation, and system uptime',
      mimeType: 'application/json',
      readHandler: async () => {
        return JSON.stringify({
          status: 'ONLINE',
          // `status` above describes ONLY this in-process MCP resource endpoint
          // answering the request. It is NOT a claim about any external Servers
          // Center asset and NOT a chain-integrity claim.
          statusScope: 'THIS_IN_PROCESS_RESOURCE_ENDPOINT_ONLY',
          chainKey: '360ea36c28e66d9d',
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version
        });
      }
    });

    this.registerResource({
      uri: 'sovereign://audit/chain',
      name: 'Sovereign Audit Chain State',
      description:
        'Live state of the real SHA-256 forward-linked audit ledger: entry count, recomputed digests, prevHash linkage, and the full external-anchor classification (assurance class, trust boundary, verdict). Exposes the honest terminal verdict without asserting integrity that was never measured.',
      mimeType: 'application/json',
      readHandler: async () => {
        const report = verifySovereignChain(SOVEREIGN_CHAIN_KEY_ID);
        return JSON.stringify({
          ok: report.ok,
          status: report.status,
          verified: report.verified,
          algorithm: report.algorithm,
          reason: report.reason,
          checks: report.checks,
          anchor: report.anchor,
          ledger: report.ledger,
          readAt: new Date().toISOString()
        }, null, 2);
      }
    });

    this.registerResource({
      uri: 'sovereign://security/zero-trust-policy',
      name: 'Zero-Trust Security Invariants',
      description: 'Immutable system security invariants and protected paths',
      mimeType: 'text/markdown',
      readHandler: async () => {
        const policy = sovereignAgentMemoryInstance.getSemanticMemory('system_invariants', 'zero_trust_policy');
        return policy ? JSON.stringify(policy.facts, null, 2) : 'Default Zero-Trust Invariant Active';
      }
    });
  }

  // =========================================================================
  // 5. SOVEREIGN PROMPTS DEFINITION
  // =========================================================================

  private registerSovereignPrompts() {
    this.registerPrompt({
      name: 'sovereign-commander-briefing',
      description: 'Generates an authoritative, military-grade Arabic executive briefing for the Supreme Sovereign Commander',
      arguments: [
        { name: 'topic', description: 'Primary briefing topic', required: true },
        { name: 'urgency', description: 'Urgency level (routine, elevated, critical)', required: false }
      ],
      templateHandler: ({ topic, urgency = 'elevated' }) => {
        return `أيها القائد السيادي الأعلى،
بناءً على الصلاحيات الممنوحة بموجب مفتاح السلسلة 360ea36c28e66d9d:
نحيط سيادتكم علماً بتقرير الموجز التنفيذي العاجل حول [${topic}] بمستوى أولوية [${urgency.toUpperCase()}].
يرجى مراجعة المعطيات الهندسية المرفقة واتخاذ التوجيهات العملياتية اللازمة بدقة وانضباط عاليين.`;
      }
    });
  }
}

// Global Singleton Instance
export const globalSovereignMcpServer = new SovereignMcpServer();
