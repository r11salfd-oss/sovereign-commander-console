/**
 * ============================================================================
 * SOVEREIGN AUDIT CHAIN ANCHOR — TRUST-BOUNDARY VERIFICATION
 * Chain Key ID: 360ea36c28e66d9d
 * ============================================================================
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ────────────────────────────────────────────────────────────────────────────
 * `sovereignMcpServer.ts` recomputes every ledger digest from stored content and
 * re-derives every `prevHash` linkage. That is genuine recomputation, but it is
 * NOT tamper-evidence, because of one fact about this deployment:
 *
 *   THE VERIFIER AND THE VERIFIED DATA SHARE A TRUST BOUNDARY.
 *
 * Proven from the deployment artifacts in this repository:
 *   - `Dockerfile` runner stage copies ONLY `dist/`, `public/` and `package*.json`
 *     into the runtime image. The source tree, `.git/` and `config/` are absent at
 *     runtime (`.dockerignore` also excludes the `.git` tree).
 *   - The audit ledger reaches the runtime ONLY through the `data/` bind mount,
 *     which is writable by the uid-1000 process that performs verification.
 *   - There is no signing key, no git remote, no RFC-3161 timestamp authority and
 *     no external append-only store configured anywhere in this repository.
 *
 * CONSEQUENCE — stated bluntly, because it is the whole point of this file:
 *   Any anchor the running container can READ, it can also WRITE. An anchor
 *   stored in the bind mount therefore sits INSIDE the attacker's write reach.
 *   An attacker who can execute code in the container can rewrite the entries,
 *   rewrite their hashes consistently, rewrite the anchor, and recompute the
 *   anchor's own checksum — because the checksum key is the same code they run.
 *   Recomputation then still passes. Such an anchor provides ZERO protection
 *   against a determined attacker. It provides real protection against
 *   ACCIDENTAL corruption: truncation, partial writes, disk corruption, a stray
 *   editor, a bad migration.
 *
 * That is defence-in-depth. It is not cryptography. It is not an HSM. It is not
 * RFC 3161. Anyone describing an unsigned local anchor as "tamper-proof" is
 * selling a number, not a guarantee.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE DESIGN THAT ACTUALLY CLOSES THE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────
 * A DETACHED SIGNATURE made by a private key that is held OUTSIDE the
 * container, verified against a PUBLIC KEY PINNED AT BUILD TIME (baked into the
 * image, not bind-mounted):
 *   - the anchor file itself may live in the writable bind mount and still be
 *     worthless to an attacker, because they cannot forge a signature over a
 *     modified genesis without the private key;
 *   - this is the standard asymmetric seal and it genuinely stops the
 *     container-level attacker.
 * It does NOT stop the host operator, who controls both the container and any
 * key material they generated. No in-repo design can: an operator who owns the
 * machine owns the root of trust.
 *
 * As of this revision NO key is provisioned, so the signature path is unreachable
 * and every anchor resolves to an explicitly WEAK assurance class. The verifier
 * reports that weakness rather than hiding it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT CLAIMED
 * ────────────────────────────────────────────────────────────────────────────
 *   1. `sealedAt` is INFORMATIONAL ONLY. A timestamp written by the sealing
 *      process proves nothing about when anything happened and is not an
 *      authority. No RFC-3161 token, no countersignature, no trusted third
 *      party is involved.
 *   2. The anchor's `checksum` detects CORRUPTION of the anchor document. It is
 *      NOT an authenticity proof — the key material is the verifier's own code,
 *      which the attacker can modify. Never present it as a signature.
 *   3. This module NEVER returns a pass verdict on its own. It returns a
 *      structured, falsifiable result; the caller decides what to assert, and
 *      the caller is required to assert only what `assurance` justifies.
 * ========================================================================= */

import nodeCrypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/* ── ANCHOR LOCATION ────────────────────────────────────────────────────────
 * Default sits beside the ledger in the bind-mounted `data/` directory, i.e.
 * deliberately INSIDE the write reach of the process being verified. That is
 * called out at every use site on purpose: the default is the weak placement,
 * so nobody can mistake it for the strong one.
 * ─────────────────────────────────────────────────────────────────────────── */
export const ANCHOR_FILE_PATH = process.env.SOVEREIGN_CHAIN_ANCHOR_PATH
  ?? path.join(process.cwd(), 'data', 'audit-chain-anchor.json');

/** Pinned public key. Inline PEM via env, or a path baked into the image. */
export const ANCHOR_PUBLIC_KEY_PEM = process.env.SOVEREIGN_CHAIN_ANCHOR_PUBLIC_KEY ?? null;
export const ANCHOR_PUBLIC_KEY_PATH = process.env.SOVEREIGN_CHAIN_ANCHOR_PUBLIC_KEY_PATH ?? null;

/** Schema tag. A document without the exact expected tag is rejected as corrupt. */
export const ANCHOR_SCHEMA = 'sovereign.audit-chain-anchor/v1';

export const ANCHOR_CHECKSUM_ALGORITHM = 'sha256';

/**
 * Signature algorithms this verifier will accept. Deliberately tiny. Anything
 * not listed is REJECTED rather than passed through, because an unrecognised
 * algorithm string that is silently ignored is how signature checks get bypassed.
 */
export type AnchorSignatureAlg = 'RSA-SHA256' | 'Ed25519';

/* ── ANCHOR DOCUMENT ──────────────────────────────────────────────────────── */

export interface ChainAnchorSealFields {
  schema: typeof ANCHOR_SCHEMA;
  chainKeyId: string;
  /** `prevHash` of entry #0 — derived from the Chain Key ID, hence PUBLIC. */
  genesisPrevHash: string;
  /** Number of entries the seal covers. */
  entryCount: number;
  /** `integrityHash` / `hash` of the LAST entry — the value that actually binds. */
  headHash: string;
  /** Informational only. Not an authority. See note 1 in the header. */
  sealedAt: string;
  /** Free text. Never parsed, never trusted. */
  sealNote: string;
}

export interface ChainAnchorSignature {
  alg: AnchorSignatureAlg;
  /** SHA-256 over the SubjectPublicKeyInfo DER. Binds anchor to a specific key. */
  publicKeyId: string;
  /** Base64 detached signature over the ASCII bytes of `checksum`. */
  value: string;
}

export interface ChainAnchorDocument extends ChainAnchorSealFields {
  /** SHA-256 over the canonical serialization of the seal fields. Corruption guard. */
  checksum: string;
  signature?: ChainAnchorSignature;
}

/* ── RESULT TYPES ─────────────────────────────────────────────────────────── */

/**
 * How much the anchor is actually worth. This is the field a reviewer must read
 * before believing anything else in the report.
 */
export type AnchorAssurance =
  /** No anchor document found. Nothing is attested. */
  | 'NO_ANCHOR'
  /** Anchor present but malformed, truncated, or self-checksum inconsistent. */
  | 'ANCHOR_CORRUPT'
  /**
   * The anchor was structurally sound but was NEVER EVALUATED, because the chain
   * failed recomputation first or held no entries. Reported explicitly so a
   * reader is never told the anchor is corrupt when the fault was upstream of it.
   */
  | 'NOT_EVALUATED_CHAIN_PRECONDITION_FAILED'
  /** Anchor well-formed and self-consistent, unsigned, inside attacker write reach. */
  | 'LOCAL_UNSIGNED_ASSERTION'
  /** Signature present but no pinned key is provisioned to check it against. */
  | 'SIGNATURE_UNPINNED_NO_TRUST_ROOT'
  /** A signature is present and FAILED cryptographic verification. */
  | 'SIGNATURE_INVALID'
  /** Signature verified against a pinned key baked in outside the write reach. */
  | 'PINNED_KEY_SIGNATURE_VERIFIED';

export type AnchorVerdict =
  /** No anchor, or an anchor that cannot be trusted as evidence. */
  | 'ABSENT'
  /** Anchor structurally unusable. */
  | 'CORRUPT'
  /** Anchor is trustworthy AND the recomputed chain matches it. */
  | 'MATCHED'
  /** Anchor is trustworthy AND the recomputed chain does NOT match it. */
  | 'MISMATCH';

/** Where the anchor sits relative to the attacker being modelled. */
export type AnchorTrustBoundary =
  /** No anchor at all. */
  | 'NONE'
  /** In the bind mount: writable by the process being verified. NO tamper-evidence. */
  | 'WITHIN_ATTACKER_WRITE_REACH'
  /** Signature anchored to a key the container cannot reach. Real assurance. */
  | 'OUTSIDE_ATTACKER_WRITE_REACH';

export interface AnchorVerificationResult {
  verdict: AnchorVerdict;
  assurance: AnchorAssurance;
  trustBoundary: AnchorTrustBoundary;
  /**
   * TRUE only when `assurance === 'PINNED_KEY_SIGNATURE_VERIFIED'` AND
   * `verdict === 'MATCHED'`. This is the ONLY boolean that means "an external
   * party attested to this exact chain and the attestation verified".
   */
  cryptographicallyAnchored: boolean;
  /** Entries whose recomputed digest differed from their stored digest. */
  digestFailures: number;
  /** Entries whose `prevHash` did not match their predecessor. */
  linkageFailures: number;
  anchorPath: string;
  anchorPresent: boolean;
  expectedHead: string | null;
  expectedEntryCount: number;
  detail: string;
}

/* ── MINIMAL ENTRY SHAPE ─────────────────────────────────────────────────────
 * Declared structurally rather than imported from `sovereignMcpServer` so this
 * module has no import cycle and so the verifier below stays a PURE function
 * that a test harness can drive directly with synthetic entries.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface RecomputableChainEntry {
  seq: number;
  recordedAt: string;
  event: string;
  chainKeyId: string;
  prevHash: string;
  hash: string;
  evidenceBearing: boolean;
}

/** Re-derives an entry's digest from its own content. Never trusts a stored one. */
export type ChainEntryHasher = (entry: Omit<RecomputableChainEntry, 'hash'>) => string;

/* ── CHECKSUM ────────────────────────────────────────────────────────────── */

/**
 * Deterministic serialization of the sealed fields. Field order is fixed and
 * explicit rather than derived from `Object.keys`, so a refactor cannot silently
 * change what a previously-sealed anchor covers.
 */
export function canonicalAnchorPayload(fields: ChainAnchorSealFields): string {
  return JSON.stringify([
    fields.schema,
    fields.chainKeyId,
    fields.genesisPrevHash,
    fields.entryCount,
    fields.headHash,
    fields.sealedAt,
    fields.sealNote
  ]);
}

/** Corruption guard over the seal fields. NOT an authenticity proof — see note 2. */
export function computeAnchorChecksum(fields: ChainAnchorSealFields): string {
  return nodeCrypto.createHash(ANCHOR_CHECKSUM_ALGORITHM)
    .update(canonicalAnchorPayload(fields), 'utf8')
    .digest('hex');
}

function sha256Hex(value: string): string {
  return nodeCrypto.createHash(ANCHOR_CHECKSUM_ALGORITHM).update(value, 'utf8').digest('hex');
}

/** Constant-time comparison with an explicit length guard (`timingSafeEqual` throws otherwise). */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return nodeCrypto.timingSafeEqual(bufA, bufB);
}

/* ── SIGNATURE VERIFICATION ───────────────────────────────────────────────── */

/** SHA-256 over a key's SubjectPublicKeyInfo DER — the key's stable identity. */
export function publicKeyId(publicKeyPem: string): string {
  const key = nodeCrypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: 'spki', format: 'der' }) as Buffer;
  return sha256Hex(spki.toString('binary'));
}

/**
 * Verify a detached signature over the anchor checksum.
 *
 * The signed message is the ASCII of the checksum string, not the whole
 * document — the checksum already commits to every sealed field, so signing it
 * transitively signs the seal without duplicating the payload.
 *
 * Returns a discriminated result rather than a bare boolean so a caller can
 * report WHY verification failed instead of collapsing "no key" and "bad
 * signature" into the same false.
 */
export type SignatureCheck =
  | { outcome: 'VERIFIED'; keyId: string }
  | { outcome: 'INVALID'; reason: string }
  | { outcome: 'NO_SIGNATURE_PRESENT' }
  | { outcome: 'NO_TRUST_ROOT'; reason: string }
  | { outcome: 'UNSUPPORTED_ALGORITHM'; alg: string };

export function verifyDetachedSignature(
  doc: ChainAnchorDocument,
  pinnedPublicKeyPem: string | null
): SignatureCheck {
  const sig = doc.signature;
  if (!sig || typeof sig.value !== 'string' || sig.value.length === 0) {
    return { outcome: 'NO_SIGNATURE_PRESENT' };
  }
  if (sig.alg !== 'RSA-SHA256' && sig.alg !== 'Ed25519') {
    // Reject, never ignore. An ignored algorithm field is a bypass.
    return { outcome: 'UNSUPPORTED_ALGORITHM', alg: String(sig.alg) };
  }
  if (!pinnedPublicKeyPem) {
    return {
      outcome: 'NO_TRUST_ROOT',
      reason: 'A signature is present but no public key is pinned for verification. An unpinned key would be read from attacker-writable storage, which proves nothing.'
    };
  }

  let expectedKeyId: string;
  let publicKey: nodeCrypto.KeyObject;
  try {
    publicKey = nodeCrypto.createPublicKey(pinnedPublicKeyPem);
    expectedKeyId = publicKeyId(pinnedPublicKeyPem);
  } catch (err) {
    return { outcome: 'INVALID', reason: `Pinned public key is unusable: ${(err as Error).message}` };
  }

  // Key-substitution guard: the anchor must have been sealed by THIS key.
  if (sig.publicKeyId && !constantTimeEquals(sig.publicKeyId, expectedKeyId)) {
    return {
      outcome: 'INVALID',
      reason: 'Signature publicKeyId does not match the pinned key. The anchor was sealed by a different key.'
    };
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(sig.value, 'base64');
  } catch (err) {
    return { outcome: 'INVALID', reason: `Signature is not valid base64: ${(err as Error).message}` };
  }
  if (signature.length === 0) {
    return { outcome: 'INVALID', reason: 'Signature decoded to zero bytes.' };
  }

  const message = Buffer.from(doc.checksum, 'ascii');
  try {
    const ok = sig.alg === 'Ed25519'
      ? nodeCrypto.verify(null, message, publicKey, signature)
      : nodeCrypto.verify('RSA-SHA256', message, publicKey, signature);
    return ok ? { outcome: 'VERIFIED', keyId: expectedKeyId } : { outcome: 'INVALID', reason: 'Cryptographic verification returned false.' };
  } catch (err) {
    return { outcome: 'INVALID', reason: `Verification threw: ${(err as Error).message}` };
  }
}

/* ── PURE CORE ────────────────────────────────────────────────────────────── */

export interface AnchorVerificationInput {
  entries: RecomputableChainEntry[];
  /** `prevHash` entry #0 must point at. */
  genesisPrevHash: string;
  expectedChainKeyId: string;
  /** Digest re-derivation function supplied by the caller (keeps this pure). */
  hasher: ChainEntryHasher;
  anchor: ChainAnchorDocument | null;
  pinnedPublicKeyPem: string | null;
  /** Reported in the result for operator diagnostics. */
  anchorPath?: string;
}

function result(partial: Partial<AnchorVerificationResult> & Pick<AnchorVerificationResult, 'verdict' | 'assurance' | 'trustBoundary' | 'cryptographicallyAnchored' | 'detail'>): AnchorVerificationResult {
  return {
    digestFailures: 0,
    linkageFailures: 0,
    anchorPath: ANCHOR_FILE_PATH,
    anchorPresent: partial.anchorPresent ?? false,
    expectedHead: null,
    expectedEntryCount: 0,
    ...partial
  };
}

/**
 * The whole mechanism, as ONE PURE FUNCTION so it can be driven by a test
 * harness with synthetic entries and no filesystem and no network.
 *
 * Order of operations is load-bearing: the chain is recomputed FIRST and the
 * anchor is consulted SECOND. Recomputation is the part that always works; the
 * anchor is the part that may be absent, forged, or stale. Checking the anchor
 * first would let a missing anchor mask a broken chain.
 */
export function verifyChainAgainstAnchor(input: AnchorVerificationInput): AnchorVerificationResult {
  const {
    entries, genesisPrevHash, expectedChainKeyId, hasher, anchor, pinnedPublicKeyPem
  } = input;
  const anchorPath = input.anchorPath ?? ANCHOR_FILE_PATH;

  // ── STEP 1 — recompute the chain from its own content ──────────────────────
  let digestFailures = 0;
  let linkageFailures = 0;
  let headHash: string | null = null;

  if (entries.length > 0) {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const { hash, ...rest } = entry;
      if (hasher(rest as Omit<RecomputableChainEntry, 'hash'>) !== hash) digestFailures++;
      const expectedPrev = i === 0 ? genesisPrevHash : entries[i - 1].hash;
      if (entry.prevHash !== expectedPrev) linkageFailures++;
    }
    headHash = entries[entries.length - 1].hash;
  }

  const base = {
    anchorPath,
    anchorPresent: anchor !== null,
    expectedHead: headHash,
    expectedEntryCount: entries.length
  };

  // ── STEP 2 — no anchor at all ─────────────────────────────────────────────
  if (anchor === null) {
    const chainState = entries.length === 0
      ? 'the ledger is empty'
      : `${entries.length - digestFailures}/${entries.length} entries recomputed`;
    return result({
      ...base,
      verdict: 'ABSENT',
      assurance: 'NO_ANCHOR',
      trustBoundary: 'NONE',
      cryptographicallyAnchored: false,
      digestFailures,
      linkageFailures,
      detail:
        `No anchor document at ${anchorPath}. Local recomputation state: ${chainState}` +
        `${digestFailures ? `, ${digestFailures} digest mismatch(es)` : ''}` +
        `${linkageFailures ? `, ${linkageFailures} broken link(s)` : ''}. ` +
        `Recomputation alone is NOT tamper-evidence: an attacker who can write the ledger can rewrite the hashes too. ` +
        `No external attestation exists, so nothing outside this process's write reach has ever confirmed this chain.`
    });
  }

  // ── STEP 3 — structural integrity of the anchor itself ─────────────────────
  // A corrupted anchor must be DETECTED, not trusted. Checking the schema and
  // the self-checksum before comparing any value is what makes a truncated or
  // hand-edited anchor produce a negative instead of a silent mismatch (or worse,
  // a silent match).
  const sealFields: ChainAnchorSealFields = {
    schema: anchor.schema,
    chainKeyId: anchor.chainKeyId,
    genesisPrevHash: anchor.genesisPrevHash,
    entryCount: anchor.entryCount,
    headHash: anchor.headHash,
    sealedAt: anchor.sealedAt,
    sealNote: anchor.sealNote
  };

  if (anchor.schema !== ANCHOR_SCHEMA) {
    return result({
      ...base,
      verdict: 'CORRUPT',
      assurance: 'ANCHOR_CORRUPT',
      trustBoundary: 'WITHIN_ATTACKER_WRITE_REACH',
      cryptographicallyAnchored: false,
      digestFailures,
      linkageFailures,
      detail: `Anchor schema is '${String(anchor.schema)}', expected '${ANCHOR_SCHEMA}'. The document is not a Sovereign anchor and was not used as evidence.`
    });
  }

  if (typeof anchor.checksum !== 'string' || anchor.checksum.length === 0) {
    return result({
      ...base,
      verdict: 'CORRUPT',
      assurance: 'ANCHOR_CORRUPT',
      trustBoundary: 'WITHIN_ATTACKER_WRITE_REACH',
      cryptographicallyAnchored: false,
      digestFailures,
      linkageFailures,
      detail: 'Anchor carries no checksum. An anchor that cannot prove its own integrity was not trusted.'
    });
  }

  const recomputedAnchorChecksum = computeAnchorChecksum(sealFields);
  if (!constantTimeEquals(recomputedAnchorChecksum, anchor.checksum)) {
    return result({
      ...base,
      verdict: 'CORRUPT',
      assurance: 'ANCHOR_CORRUPT',
      trustBoundary: 'WITHIN_ATTACKER_WRITE_REACH',
      cryptographicallyAnchored: false,
      digestFailures,
      linkageFailures,
      detail:
        `Anchor self-checksum mismatch: stored ${anchor.checksum.slice(0, 16)}…, ` +
        `recomputed ${recomputedAnchorChecksum.slice(0, 16)}…. The anchor document was altered or corrupted after sealing and is NOT trusted. ` +
        `This guard detects corruption only — the checksum key is this same codebase, so it is not an authenticity proof.`
    });
  }

  // ── STEP 4 — chain integrity, before any anchor comparison ─────────────────
  if (digestFailures > 0 || linkageFailures > 0) {
    return result({
      ...base,
      verdict: 'MISMATCH',
      assurance: 'NOT_EVALUATED_CHAIN_PRECONDITION_FAILED',
      trustBoundary: 'NONE',
      cryptographicallyAnchored: false,
      digestFailures,
      linkageFailures,
      detail:
        `Chain recomputation FAILED before the anchor was consulted: ${digestFailures} digest mismatch(es), ` +
        `${linkageFailures} broken link(s). The anchor was not evaluated against a broken chain — the fault is in the ledger itself.`
    });
  }

  if (entries.length === 0) {
    return result({
      ...base,
      verdict: 'MISMATCH',
      assurance: 'NOT_EVALUATED_CHAIN_PRECONDITION_FAILED',
      trustBoundary: 'NONE',
      cryptographicallyAnchored: false,
      digestFailures,
      linkageFailures,
      detail: `The ledger is empty but an anchor covering ${anchor.entryCount} entr(ies) exists. An empty chain can never satisfy a seal, and an empty chain is never reported as intact. The anchor's trust class was not determined because there was nothing to compare it against.`
    });
  }

  // ── STEP 5 — trust classification of the anchor (signature first) ─────────
  const signature = verifyDetachedSignature(anchor, pinnedPublicKeyPem);

  let assurance: AnchorAssurance;
  let trustBoundary: AnchorTrustBoundary;
  let signatureNote: string;

  switch (signature.outcome) {
    case 'VERIFIED':
      assurance = 'PINNED_KEY_SIGNATURE_VERIFIED';
      trustBoundary = 'OUTSIDE_ATTACKER_WRITE_REACH';
      signatureNote = `Detached ${anchor.signature?.alg} signature verified against a pinned public key (keyId ${signature.keyId.slice(0, 16)}…). The signing key is not reachable from the container, so this anchor cannot be forged by anyone who merely has code execution in it.`;
      break;
    case 'INVALID':
      // A present-but-invalid signature is a hard tamper signal, not a weak state.
      return result({
        ...base,
        verdict: 'MISMATCH',
        assurance: 'SIGNATURE_INVALID',
        trustBoundary: 'WITHIN_ATTACKER_WRITE_REACH',
        cryptographicallyAnchored: false,
        digestFailures,
        linkageFailures,
        detail: `Anchor signature FAILED verification: ${signature.reason}. The document claims an external seal it cannot produce, and is rejected.`
      });
    case 'UNSUPPORTED_ALGORITHM':
      return result({
        ...base,
        verdict: 'CORRUPT',
        assurance: 'ANCHOR_CORRUPT',
        trustBoundary: 'WITHIN_ATTACKER_WRITE_REACH',
        cryptographicallyAnchored: false,
        digestFailures,
        linkageFailures,
        detail: `Anchor declares unsupported signature algorithm '${signature.alg}'. Rejected rather than ignored — an unrecognised algorithm field that is skipped is a bypass.`
      });
    case 'NO_TRUST_ROOT':
      assurance = 'SIGNATURE_UNPINNED_NO_TRUST_ROOT';
      trustBoundary = 'WITHIN_ATTACKER_WRITE_REACH';
      signatureNote = `A signature is present but there is NO pinned public key: ${signature.reason} The signature is therefore reported as UNVERIFIED and earns nothing.`;
      break;
    case 'NO_SIGNATURE_PRESENT':
    default:
      assurance = 'LOCAL_UNSIGNED_ASSERTION';
      trustBoundary = 'WITHIN_ATTACKER_WRITE_REACH';
      signatureNote =
        'The anchor is an UNSIGNED local file assertion. It lives in the same bind mount as the ledger it covers, ' +
        'which the process being verified can write. Anyone able to execute code in the container can rewrite the ' +
        'entries, the hashes, the anchor and this checksum consistently, and verification would still pass. ' +
        'This anchor detects ACCIDENTAL corruption only — it is defence-in-depth, not tamper-evidence.';
      break;
  }

  const anchorIsAuthentic = assurance === 'PINNED_KEY_SIGNATURE_VERIFIED';

  // ── STEP 6 — does the seal actually describe THIS chain? ───────────────────
  const mismatches: string[] = [];
  if (anchor.chainKeyId !== expectedChainKeyId) {
    mismatches.push(`chainKeyId '${anchor.chainKeyId}' ≠ configured '${expectedChainKeyId}'`);
  }
  if (anchor.entryCount !== entries.length) {
    mismatches.push(`entryCount ${anchor.entryCount} ≠ recomputed ${entries.length}`);
  }
  if (!constantTimeEquals(anchor.headHash, headHash ?? '')) {
    mismatches.push(`headHash ${anchor.headHash.slice(0, 16)}… ≠ recomputed ${(headHash ?? '').slice(0, 16)}…`);
  }
  if (!constantTimeEquals(anchor.genesisPrevHash, genesisPrevHash)) {
    mismatches.push(`genesisPrevHash ${anchor.genesisPrevHash.slice(0, 16)}… ≠ configured ${genesisPrevHash.slice(0, 16)}…`);
  }

  if (mismatches.length > 0) {
    return result({
      ...base,
      verdict: 'MISMATCH',
      assurance,
      trustBoundary,
      cryptographicallyAnchored: false,
      digestFailures,
      linkageFailures,
      detail:
        `ANCHOR MISMATCH — the sealed chain does not describe the recomputed chain: ${mismatches.join('; ')}. ` +
        `This is the tamper-evidence signal: entries were added, removed, reordered or rewritten after sealing.`
    });
  }

  const evidenceNote = anchorIsAuthentic
    ? 'The seal is cryptographically bound to a key outside this container, so a rewrite of the ledger alone can no longer produce a MATCHED verdict.'
    : 'The seal MATCHES the recomputed chain, but because the anchor is unsigned and co-located with the ledger this MATCH proves only that nothing has changed BY ACCIDENT. It does not prove the ledger has not been rewritten by anyone with write access to this host or container.';

  return result({
    ...base,
    verdict: 'MATCHED',
    assurance,
    trustBoundary,
    cryptographicallyAnchored: anchorIsAuthentic,
    digestFailures,
    linkageFailures,
    detail:
      `Anchor ${anchorPath} matches the recomputed chain: ${entries.length} entries, head ${(headHash ?? '').slice(0, 16)}…. ` +
      `${signatureNote} ${evidenceNote}`
  });
}

/* ── FILESYSTEM PLUMBING ──────────────────────────────────────────────────── */

/** Load the pinned public key. NEVER falls back to a key beside the anchor. */
export function loadPinnedPublicKey(): string | null {
  if (ANCHOR_PUBLIC_KEY_PEM && ANCHOR_PUBLIC_KEY_PEM.trim().length > 0) return ANCHOR_PUBLIC_KEY_PEM;
  if (ANCHOR_PUBLIC_KEY_PATH) {
    try {
      const pem = fs.readFileSync(ANCHOR_PUBLIC_KEY_PATH, 'utf8');
      return pem.trim().length > 0 ? pem : null;
    } catch (err) {
      console.error(`[ANCHOR] Pinned public key at ${ANCHOR_PUBLIC_KEY_PATH} could not be read: ${(err as Error).message}. The anchor will be treated as having no trust root.`);
      return null;
    }
  }
  return null;
}

/**
 * Read the anchor document. A missing file is a normal state (ABSENT), not an
 * error. A malformed file returns null and the caller reports CORRUPT — we never
 * silently substitute a default anchor.
 */
export function loadAnchorDocument(anchorPath: string = ANCHOR_FILE_PATH): ChainAnchorDocument | null {
  if (!fs.existsSync(anchorPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(anchorPath, 'utf8')) as ChainAnchorDocument;
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.error(`[ANCHOR] ${anchorPath} is not valid JSON: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Build a correctly sealed anchor. Exported so an operator tool can produce one,
 * and so the negative-test harness can mint synthetic anchors.
 *
 * A signing key is OPTIONAL and, when supplied, produces a real detached
 * signature. In this repository no signing key is configured, so anchors minted
 * by default are UNSIGNED and will resolve to `LOCAL_UNSIGNED_ASSERTION` — by
 * design, and never to a pass.
 */
export function createAnchorDocument(
  fields: Omit<ChainAnchorSealFields, 'schema'>,
  signingPrivateKeyPem: string | null = null
): ChainAnchorDocument {
  const sealFields: ChainAnchorSealFields = { schema: ANCHOR_SCHEMA, ...fields };
  const checksum = computeAnchorChecksum(sealFields);
  const doc: ChainAnchorDocument = { ...sealFields, checksum };
  if (signingPrivateKeyPem) {
    const alg: AnchorSignatureAlg = signingPrivateKeyPem.includes('BEGIN PRIVATE KEY')
      && !signingPrivateKeyPem.includes('BEGIN RSA PRIVATE KEY') && !signingPrivateKeyPem.includes('BEGIN EC PRIVATE KEY')
      ? 'Ed25519'
      : 'RSA-SHA256';
    const key = nodeCrypto.createPrivateKey(signingPrivateKeyPem);
    const message = Buffer.from(checksum, 'ascii');
    const signature = alg === 'Ed25519'
      ? nodeCrypto.sign(null, message, key)
      : nodeCrypto.sign('RSA-SHA256', message, key);
    doc.signature = {
      alg,
      publicKeyId: publicKeyId(nodeCrypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString()),
      value: signature.toString('base64')
    };
  }
  return doc;
}

/** One-call convenience wrapper used by `verifySovereignChain`. */
export function verifyChainAgainstAnchorOnDisk(
  entries: RecomputableChainEntry[],
  genesisPrevHash: string,
  expectedChainKeyId: string,
  hasher: ChainEntryHasher
): AnchorVerificationResult {
  return verifyChainAgainstAnchor({
    entries,
    genesisPrevHash,
    expectedChainKeyId,
    hasher,
    anchor: loadAnchorDocument(),
    pinnedPublicKeyPem: loadPinnedPublicKey()
  });
}
