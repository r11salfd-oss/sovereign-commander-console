/**
 * Sovereign Telemetry Truth Verifier
 * Chain Key ID: 360ea36c28e66d9d
 *
 * PURPOSE
 * -------
 * This is not a test that the system is UP. It is a test that the system is
 * HONEST. Every assertion below is NEGATIVE: it fails when the payload makes a
 * claim its own contents do not support.
 *
 * A conventional suite asserts positive expectations ("7/7 online", "score 70").
 * Those expectations rot the moment the system improves, and worse, they are
 * satisfiable by fabrication: a hardcoded 70 passes whether or not anything was
 * measured. This verifier instead recomputes every published number from the
 * payload's own components and compares. A padded score, a padded denominator, a
 * contradiction between two fields, or an unexplained negative all fail.
 *
 * THE DESIGN RULE: a check that cannot fail is a defect. Each assertion below
 * names the specific forgery it is designed to catch, so a future edit that
 * softens one is visible as a loss of coverage rather than as tidying.
 *
 * USAGE
 *   npx tsx scripts/verify_telemetry_truth.ts
 *   npx tsx scripts/verify_telemetry_truth.ts --url http://127.0.0.1:3000
 *   npx tsx scripts/verify_telemetry_truth.ts --payload ./captured.json --json
 *
 *   --payload <file>  verify a captured JSON payload instead of fetching one.
 *                     Used by the fixture-rewriter regression proof: it lets a
 *                     deliberately corrupted payload be tested WITHOUT touching
 *                     the live server.
 *   --url <base>      override the console base URL (default http://127.0.0.1:3000).
 *   --json            emit a machine-readable verdict object.
 *
 * EXIT CODES
 *   0  every invariant held (or a check was legitimately vacuous and said so)
 *   1  at least one invariant was VIOLATED
 *   2  the payload could not be obtained — an unverifiable instrument is not a pass
 */

import * as fs from 'fs';
import * as path from 'path';

const CHAIN_KEY_ID = '360ea36c28e66d9d';
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';

// ── RESULT MODEL ─────────────────────────────────────────────────────────────
type Severity = 'VIOLATION' | 'VACUOUS' | 'INFO';

interface Check {
  id: string;
  /** What forgery this specific check exists to catch. */
  catches: string;
  passed: boolean;
  severity: Severity;
  observed: string;
  expected: string;
  detail?: string;
}

const checks: Check[] = [];

function record(
  id: string,
  catches: string,
  passed: boolean,
  observed: string,
  expected: string,
  detail?: string
): void {
  checks.push({
    id,
    catches,
    passed,
    severity: passed ? 'INFO' : 'VIOLATION',
    observed,
    expected,
    detail,
  });
}

/**
 * Record a check that could not actually be exercised by this payload.
 *
 * This exists to stop the harness from lying about its own coverage. A check that
 * silently passes because the relevant data was absent is worse than no check at
 * all: it manufactures confidence. It is reported as VACUOUS, never as INFO-pass,
 * and it is surfaced in the summary so a reader can see what went untested.
 */
function recordVacuous(id: string, catches: string, reason: string): void {
  checks.push({
    id,
    catches,
    passed: true,
    severity: 'VACUOUS',
    observed: 'NOT EXERCISED',
    expected: reason,
    detail: reason,
  });
}

// ── PAYLOAD TYPES (structural only; the payload is untrusted) ────────────────
interface AnyRecord {
  [key: string]: unknown;
}

function asRecord(v: unknown): AnyRecord | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : null;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK GROUP 1 — healthScore INTERNAL CONSISTENCY
// Recomputed from the payload's own components. This is the core anti-padding
// check: the published score must equal what its own numbers imply.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The scoring contract, mirrored from server.ts:1070-1076.
 *
 * scoreNumeric = round( mcpRatio*40 + lspRatio*30 + (chainVerified ? 30 : 0) )
 * where lspRatio = lsp.ready / lsp.measurableTotal
 *
 * It is re-implemented here deliberately rather than imported. If it were
 * imported, a change to the scoring function would change both sides at once and
 * the check would become a tautology. An independent re-implementation is the
 * only thing that makes this an actual test.
 *
 * THE DENOMINATOR IS `lsp.measurableTotal`. It is NOT `lsp.total`.
 * `server.ts` publishes both, and binding this function to the wrong one is not
 * a cosmetic bug — it is how this harness came to accuse an honest console of a
 * +15 lie. `lsp.total` is the SIZE of `servers[]` and carries no scoring
 * meaning; `lsp.measurableTotal` is the count of entries categorised
 * `language-server`. One name per number.
 */
type RecomputeResult =
  | { kind: 'scored'; value: number }
  | { kind: 'hidden-lsp-denominator'; detail: string }
  | { kind: 'components-absent'; detail: string };

function recomputeHealthScore(p: AnyRecord): RecomputeResult {
  const mcp = asRecord(p.mcp);
  const lsp = asRecord(p.lsp);
  const selfTest = mcp ? asRecord(mcp.rpcSelfTest) : null;
  if (!mcp || !lsp) {
    return {
      kind: 'components-absent',
      detail: 'no mcp/lsp block present in this payload shape',
    };
  }

  const mcpOnline = num(mcp.online);
  const mcpTotal = num(mcp.total);
  const lspReady = num(lsp.ready);

  // A score whose denominator is not published is not verifiable, and a score
  // that cannot be verified must never be published as a number. So an absent,
  // non-finite or negative `measurableTotal` is a VIOLATION — never a vacuous
  // skip. Under the previous contract a payload could opt out of the single
  // most important check in this file by deleting one field, which is the exact
  // hiding place an honesty harness must close.
  const lspMeasurableTotal = num(lsp.measurableTotal);
  if (lspMeasurableTotal === null) {
    return {
      kind: 'hidden-lsp-denominator',
      detail:
        typeof lsp.measurableTotal === 'undefined'
          ? 'lsp.measurableTotal is absent'
          : `lsp.measurableTotal=${JSON.stringify(lsp.measurableTotal)} is not a finite number`,
    };
  }
  if (lspMeasurableTotal < 0) {
    return {
      kind: 'hidden-lsp-denominator',
      detail: `lsp.measurableTotal=${lspMeasurableTotal} is negative — a denominator cannot be negative`,
    };
  }

  if (mcpOnline === null || mcpTotal === null || lspReady === null) {
    return {
      kind: 'components-absent',
      detail: 'mcp.online, mcp.total or lsp.ready is absent or non-numeric',
    };
  }

  // A subsystem with nothing inventoried scores ZERO, never a full score.
  // Absence of a measurement must never earn credit.
  const coverage = (measured: number, expected: number): number =>
    expected > 0 ? measured / expected : 0;

  const chainVerified = selfTest ? selfTest.chainVerified === true : false;

  return {
    kind: 'scored',
    value: Math.round(
      coverage(mcpOnline, mcpTotal) * 40 +
        coverage(lspReady, lspMeasurableTotal) * 30 +
        (chainVerified ? 30 : 0)
    ),
  };
}

function checkHealthScore(payload: AnyRecord): void {
  const basis = asRecord(payload.healthScoreBasis);

  // 1a. If a NUMERIC score is presented, it must equal the recomputation.
  //     Catches: a hand-tuned or optimistic score published beside honest
  //     components. This is the single most important check in the file.
  const publishedNumeric = num(payload.healthScoreNumeric);
  const recomputed = recomputeHealthScore(payload);

  if (publishedNumeric === null) {
    if (str(payload.healthScore) === 'UNVERIFIABLE') {
      record(
        'score_absent_or_unverifiable',
        'a score published where no component was measured',
        true,
        'healthScore=UNVERIFIABLE, healthScoreNumeric=null',
        'no number without evidence'
      );
    } else {
      recordVacuous(
        'score_absent_or_unverifiable',
        'a score published where no component was measured',
        'no healthScore field present in this payload shape'
      );
    }
  } else if (recomputed.kind !== 'scored') {
    if (recomputed.kind === 'hidden-lsp-denominator') {
      // A HIDDEN DENOMINATOR IS A VIOLATION, NOT A VACUOUS CHECK.
      //
      // The tempting shortcut — record this as `recordVacuous` — would hand every
      // future payload a one-key escape from the strongest check in this file:
      // publish a number, delete the field that proves it. A score whose
      // denominator is withheld asserts a conclusion no observer can check, and
      // that is the forgery this harness exists to name.
      record(
        'health_score_internal_consistency',
        'a score published whose own denominator is withheld, so it cannot be recomputed',
        false,
        `healthScoreNumeric=${publishedNumeric}`,
        'a recomputation over a PUBLISHED, finite, non-negative lsp.measurableTotal',
        `HIDDEN DENOMINATOR: ${recomputed.detail}. A numeric score was published but the field needed to verify it was not. An unverifiable score must not be published as a number.`
      );
    } else {
      recordVacuous(
        'health_score_internal_consistency',
        'a padded or hand-tuned score beside honest components',
        `components required to recompute (mcp.online/total, lsp.ready, lsp.measurableTotal) are absent — ${recomputed.detail}`
      );
    }
  } else {
    const delta = publishedNumeric - recomputed.value;
    record(
      'health_score_internal_consistency',
      'a padded or hand-tuned score published beside honest components',
      delta === 0,
      `healthScoreNumeric=${publishedNumeric}`,
      `${recomputed.value} (recomputed: mcpRatio*40 + lspRatio*30 + chain*30, lspRatio = lsp.ready/lsp.measurableTotal)`,
      delta !== 0
        ? `MISMATCH by ${delta > 0 ? '+' : ''}${delta}. The published score does not follow from its own components.`
        : undefined
    );
  }

  // 1b. The string rendering must agree with the number it wraps.
  //     Catches: `healthScore: "70/100"` displayed while the numeric field says
  //     something else — a display that is not the value.
  const scoreText = str(payload.healthScore);
  if (scoreText && publishedNumeric !== null) {
    const m = scoreText.match(/^(-?\d+)\s*\/\s*(\d+)$/);
    if (m) {
      record(
        'health_score_string_matches_numeric',
        'a display string that disagrees with the value it renders',
        Number(m[1]) === publishedNumeric,
        `healthScore="${scoreText}"`,
        `healthScoreNumeric=${publishedNumeric}`,
        Number(m[1]) !== publishedNumeric
          ? `The rendered score ${scoreText} does not match healthScoreNumeric=${publishedNumeric}. A user reads the string, not the field.`
          : undefined
      );
    } else {
      recordVacuous(
        'health_score_string_matches_numeric',
        'a display string that disagrees with the value it renders',
        `healthScore="${scoreText}" is a verdict, not a numeric rendering`
      );
    }
  } else {
    recordVacuous(
      'health_score_string_matches_numeric',
      'a display string that disagrees with the value it renders',
      'no numeric score published to cross-check'
    );
  }

  // 1c. A score requires a stated basis. Without it the number is unfalsifiable.
  if (publishedNumeric !== null) {
    if (!basis) {
      record(
        'health_score_has_basis',
        'an unfalsifiable score published with no derivation',
        false,
        'healthScoreBasis absent',
        'a basis object explaining which source produced each component'
      );
    } else {
      const hasSources =
        str(basis.mcpSource) !== null && str(basis.lspSource) !== null && str(basis.chainSource) !== null;
      record(
        'health_score_has_basis',
        'an unfalsifiable score published with no derivation',
        hasSources,
        `mcpSource=${String(basis.mcpSource)} lspSource=${String(basis.lspSource)} chainSource=${String(basis.chainSource)}`,
        'all three component sources named'
      );
    }
  } else {
    recordVacuous(
      'health_score_has_basis',
      'an unfalsifiable score published with no derivation',
      'no numeric score published'
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK GROUP 2 — CHAIN VERDICT COHERENCE
// Catches a payload that says UNVERIFIED in one field and INTACT-like in another.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decide whether a string ASSERTS integrity, or merely DISCUSSES it.
 *
 * This distinction is load-bearing and was found the hard way: the first run of
 * this harness reported a CONTRADICTION against a payload that was in fact
 * perfectly honest, because the explanatory `reason` field contained the sentence
 *
 *   "Reporting INTACT would be a self-attested signature - returning UNVERIFIED instead."
 *
 * That is a field arguing AGAINST INTACT. Flagging it would be exactly the wrong
 * behaviour for an honesty harness: a verifier that fails correct output teaches
 * its operator to disable it, and a disabled verifier protects nothing.
 *
 * So an intact-like string is treated as an ASSERTION only when it is a bare
 * status token — short, no sentence punctuation. Long-form prose that names the
 * word in order to disclaim it is recorded as INFO and never as a violation.
 */
function assertsIntact(value: string): boolean {
  const v = value.trim();
  if (!/INTACT/i.test(v)) return false;
  if (v.length > 80) return false;
  if (/[.;]/.test(v)) return false;
  if (v.split(/\s+/).length > 4) return false;
  return true;
}

function collectChainSignals(p: AnyRecord): {
  claims: { value: string; path: string }[];
  prose: { value: string; path: string }[];
} {
  const claims: { value: string; path: string }[] = [];
  const prose: { value: string; path: string }[] = [];
  const walk = (node: unknown, keyPath: string, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${keyPath}[${i}]`, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(node as AnyRecord)) {
      const p2 = `${keyPath}.${k}`;
      if (typeof v === 'string' && /(INTACT|VERIFIED|SEALED)/i.test(v)) {
        (assertsIntact(v) ? claims : prose).push({ value: v, path: p2 });
      }
      if (v !== null && typeof v === 'object') walk(v, p2, depth + 1);
    }
  };
  walk(p, '$', 0);
  return { claims, prose };
}

function checkChainCoherence(payload: AnyRecord): void {
  const basis = asRecord(payload.healthScoreBasis);
  const mcp = asRecord(payload.mcp);
  const selfTest = mcp ? asRecord(mcp.rpcSelfTest) : null;

  const chainStatus = str(selfTest ? selfTest.chainStatus : null);
  const chainVerified = selfTest ? selfTest.chainVerified === true : null;
  const basisChainSource = basis ? str(basis.chainSource) : null;
  const claimsUnverified = /^UNVERIFIED_/i.test(chainStatus);

  // `TAMPERED_REJECTED` is a NEGATIVE verdict, not a positive one. It did not
  // exist when this verifier was written; the ledger-integrity fix introduced it
  // when verification began examining the whole file instead of only its
  // rehydrated prefix. Left unclassified it fell into the positive branch below,
  // which then demanded it carry NO reason — i.e. the harness required a tamper
  // verdict to be unexplained. That is precisely backwards: a NEGATIVE verdict
  // is the one that most needs to say why.
  //
  // Classifying it correctly relaxes nothing. It moves the status under the
  // contradiction and boolean-consistency checks, and adds the obligation to
  // explain itself.
  const isNegativeVerdict =
    claimsUnverified || /^TAMPERED_/i.test(chainStatus) || /REJECTED/i.test(chainStatus);

  if (!chainStatus) {
    recordVacuous(
      'chain_verdict_declared',
      'a chain verdict that is never stated at all',
      'no rpcSelfTest.chainStatus in this payload'
    );
  } else {
    record(
      'chain_verdict_declared',
      'a chain verdict that is never stated at all',
      true,
      `status=${chainStatus}`,
      'an explicit verdict string'
    );

    // 2z. A bare `ok` is the most-read field in the payload and the least
    // qualified. It once meant "the JSON-RPC round-trip worked" — so a TAMPERED
    // chain shipped with `ok: true` beside `chainVerified: false`, and any
    // consumer reading `ok` concluded the system was sound. A field named `ok`
    // must mean what a reader takes it to mean.
    //
    // The transport result belongs in its own field (`transportOk`). If a payload
    // publishes `ok:true` beside any negative verdict, it is contradicting
    // itself, whatever it meant `ok` to mean internally.
    const selfTestOk = selfTest ? selfTest.ok === true : null;
    if (selfTestOk !== null) {
      record(
        'self_test_ok_agrees_with_chain_verdict',
        'an `ok:true` published beside a chain verdict that is not a verified one',
        !isNegativeVerdict || selfTestOk === false,
        `ok=${String(selfTestOk)}, chainVerified=${String(chainVerified)}, status=${chainStatus}`,
        'ok=false whenever the chain verdict is negative',
        selfTestOk === true && isNegativeVerdict
          ? `CONTRADICTION: rpcSelfTest.ok is true while the chain is reported ${chainStatus}. A reader of \`ok\` is told the system is fine; a reader of the status is told the ledger does not verify.`
          : undefined
      );
    }

    // 2a. THE CONTRADICTION CHECK.
    // If the verdict is an UNVERIFIED_* form, nothing anywhere in the payload may
    // simultaneously claim INTACT. Two fields disagreeing about the same fact is
    // the signature of a fabricated positive: someone kept the old green field
    // and added an honest field beside it.
    const claimsUnverified = /^UNVERIFIED_/i.test(chainStatus);


    // A negative verdict must justify itself. A tamper or an unproven chain
    // reported without a reason is unfalsifiable: the reader cannot tell a
    // detected attack from a parsing fault from an empty ledger.
    record(
      'negative_verdict_has_a_reason',
      'a negative verdict (UNVERIFIED_* / TAMPERED_*) published without saying why',
      !isNegativeVerdict || (str(selfTest ? selfTest.chainVerifiedReason : null) ?? '') !== '',
      `status=${chainStatus}, reason=${
        str(selfTest ? selfTest.chainVerifiedReason : null) === null ? 'ABSENT' : 'present'
      }`,
      isNegativeVerdict
        ? 'a non-empty reason string'
        : 'n/a — status is not a negative verdict'
    );

    if (claimsUnverified || /^TAMPERED_/i.test(chainStatus)) {
      const signals = collectChainSignals(payload);
      const contradictions = signals.claims.filter(
        (s) => s.path !== '$.mcp.rpcSelfTest.chainStatus'
      );

      // Prose that NAMES the word to disclaim it is reported for transparency and
      // is never a violation. See `assertsIntact` for why this split exists.
      if (signals.prose.length > 0) {
        record(
          'intact_prose_is_disclaimer_not_claim',
          'an explanatory field mentioning INTACT in order to reject it',
          true,
          `${signals.prose.length} prose field(s) discuss INTACT`,
          'prose is never counted as an assertion'
        );
      }
      record(
        'no_intact_claim_alongside_unverified',
        'a payload claiming UNVERIFIED in one field and INTACT in another',
        contradictions.length === 0,
        contradictions.length === 0
          ? `no INTACT assertion found while status=${chainStatus}`
          : contradictions.map((c) => `${c.path}="${c.value}"`).join(', '),
        'zero INTACT-like claims anywhere in the payload',
        contradictions.length > 0
          ? `CONTRADICTION: the chain is reported ${chainStatus} while ${contradictions.length} field(s) still assert INTACT. An operator reading either field gets a different answer.`
          : undefined
      );

      // 2b. A boolean `chainVerified:true` beside an UNVERIFIED_* status is the
      // same forgery in the most dangerous shape: a boolean reads as a fact.
      if (chainVerified !== null) {
        record(
          'chain_verified_flag_consistent',
          'a boolean "verified: true" published beside an UNVERIFIED_* status',
          chainVerified === false,
          `chainVerified=${String(chainVerified)}`,
          `false (status is ${chainStatus})`
        );
      }

      // 2c. The basis must not claim CHAIN_VERIFIED while the status is UNVERIFIED.
      if (basisChainSource !== null) {
        record(
          'chain_basis_consistent',
          'a basis claiming CHAIN_VERIFIED beside an UNVERIFIED_* status',
          basisChainSource !== 'CHAIN_VERIFIED',
          `healthScoreBasis.chainSource=${basisChainSource}`,
          `not CHAIN_VERIFIED (status is ${chainStatus})`
        );
      }
    } else {
      // A positive verdict is the strongest claim available; it must not apologise.
      const selfTestReason = str(selfTest ? selfTest.chainVerifiedReason : null);
      record(
        'positive_verdict_has_no_apology',
        'a positive verdict that simultaneously carries a "not proven" reason',
        selfTestReason === null,
        selfTestReason ? `reason="${selfTestReason}"` : 'no reason field',
        'a positive verdict states no "not proven" caveat',
        selfTestReason
          ? `status=${chainStatus} but a reason field is still populated: the two disagree.`
          : undefined
      );

      record(
        'chain_verified_flag_consistent',
        'a boolean "verified" flag that disagrees with the status string',
        chainVerified === true,
        `chainVerified=${String(chainVerified)}`,
        'true (status is a positive verdict)',
        chainVerified === true ? undefined : 'status claims success while the boolean does not'
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK GROUP 3 — LSP DENOMINATOR AND LIST INTEGRITY
//
// Three fields, three distinct claims, three checks. The ambiguity that broke
// this verifier — `lsp.total` meaning "scoring denominator" while `servers[]`
// held six entries — is the reason each is now pinned separately:
//
//   lsp.measurableTotal  = the SCORING DENOMINATOR (entries categorised
//                          `language-server`). Must equal that count.
//   lsp.total            = the SIZE of servers[]. Must equal servers.length.
//   entries[].scoreable  = per-entry participation flag. Must equal
//                          (category === 'language-server').
//
// A denominator larger than the scored set deflates the score; smaller inflates
// it. Both are lies in opposite directions, so neither can be tolerated as an
// approximation.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every entry must declare BOTH a `category` and a boolean `scoreable`, and the
 * two must agree: `scoreable === (category === 'language-server')`.
 *
 * This exists because the denominator is only as trustworthy as the per-entry
 * flags that justify it. A console that can mark an entry scoreable while its
 * own category excludes it — or that omits either field entirely — has made the
 * denominator unauditable, and `lsp_scoring_denominator_is_language_servers`
 * would then be validating a number against a list it cannot fully read.
 */
function checkScoreableFlags(servers: unknown[]): void {
  const offenders: string[] = [];
  let checked = 0;

  for (const entry of servers) {
    const rec = asRecord(entry);
    if (!rec) {
      offenders.push('(a servers[] entry is not an object)');
      continue;
    }
    const id = String(rec.id ?? '(no id)');
    const category = str(rec.category);
    if (category === null) {
      offenders.push(`${id}: no category declared`);
      continue;
    }
    if (typeof rec.scoreable !== 'boolean') {
      offenders.push(`${id}: no boolean scoreable flag (category="${category}")`);
      continue;
    }
    checked += 1;
    const shouldBeScoreable = category === 'language-server';
    if (rec.scoreable !== shouldBeScoreable) {
      offenders.push(`${id}: category="${category}" but scoreable=${rec.scoreable}`);
    }
  }

  record(
    'lsp_scoreable_flag_agrees_with_category',
    'an entry marked scoreable while its own category excludes it, or an entry missing either field',
    offenders.length === 0,
    offenders.length === 0
      ? `${checked}/${servers.length} entries: scoreable === (category === 'language-server')`
      : offenders.join(', '),
    'every entry carries a category and a boolean scoreable equal to (category === "language-server")',
    offenders.length > 0
      ? `Per-entry scoring flags contradict their own categories or were withheld: ${offenders.join('; ')}. ` +
        `A denominator that cannot be audited from the entries is an assertion, not a measurement.`
      : undefined
  );
}

function checkLspDenominator(payload: AnyRecord): void {
  const lsp = asRecord(payload.lsp);
  if (!lsp) {
    const noBlock = 'no lsp block in this payload';
    recordVacuous(
      'lsp_total_denominator_unpadded',
      'a scoring denominator inflated with entries that are not language servers',
      noBlock
    );
    recordVacuous(
      'lsp_scoring_denominator_is_language_servers',
      'a scoring denominator padded with non-language-server entries',
      noBlock
    );
    recordVacuous('lsp_total_matches_list_size', 'a total that disagrees with its own array', noBlock);
    recordVacuous(
      'lsp_scoreable_flag_agrees_with_category',
      'an entry marked scoreable while its own category excludes it',
      noBlock
    );
    return;
  }

  const total = num(lsp.total);
  const measurableTotal = num(lsp.measurableTotal);
  const servers = asArray(lsp.servers);

  const categories = servers.map((s) => {
    const rec = asRecord(s);
    return rec ? str(rec.category) : null;
  });
  const classified = categories.filter((c): c is string => c !== null);
  const languageServers = classified.filter((c) => c === 'language-server').length;

  // 3a. `total` IS THE SIZE OF THE LIST. It must agree with `servers[]`.
  //
  //     This check did not exist before. It exists because the defect class it
  //     catches is not hypothetical: `total` once carried the scoring
  //     denominator while `servers[]` held six entries, so one name meant two
  //     numbers and this harness filed a false accusation against an honest
  //     console. A `total` that disagrees with its own array is that same
  //     ambiguity, and it must be caught by name rather than discovered by
  //     accident. A non-numeric `total` is treated as a failure, not a skip:
  //     the array is right there, so there is nothing to excuse.
  record(
    'lsp_total_matches_list_size',
    'a `total` that disagrees with the array it is supposed to count',
    total === servers.length,
    total === null
      ? `lsp.total=${JSON.stringify(lsp.total)} (not a finite number), servers.length=${servers.length}`
      : `lsp.total=${total}, servers.length=${servers.length}`,
    `${servers.length}`,
    total !== servers.length
      ? `lsp.total=${total === null ? JSON.stringify(lsp.total) : total} does not equal the ${servers.length} entries actually listed in servers[]. ` +
        `One field must carry one number: if this is the scoring denominator it must equal the language-server count, and if it is the list size it must equal ${servers.length}.`
      : undefined
  );

  if (servers.length === 0) {
    // Nothing inventoried. Both denominators must be 0 — a nonzero value here
    // would count servers that do not exist.
    record(
      'lsp_total_denominator_unpadded',
      'a nonzero denominator for an empty inventory',
      total === 0 && measurableTotal === 0,
      `lsp.total=${total ?? '(non-numeric)'}, lsp.measurableTotal=${measurableTotal ?? '(non-numeric)'}, servers.length=0`,
      'both 0',
      total !== 0 || measurableTotal !== 0
        ? `servers[] is empty but lsp.total=${total ?? '(non-numeric)'} / lsp.measurableTotal=${measurableTotal ?? '(non-numeric)'} — the denominator counts servers that do not exist.`
        : undefined
    );
    recordVacuous(
      'lsp_scoring_denominator_is_language_servers',
      'a scoring denominator padded with non-language-server entries',
      'no LSP entries to categorise'
    );
    recordVacuous(
      'lsp_scoreable_flag_agrees_with_category',
      'an entry marked scoreable while its own category excludes it',
      'no LSP entries to inspect'
    );
    return;
  }

  // Entries exist. Every one of them must declare its category and its scoring
  // flag, whether or not any `category` survived serialisation.
  checkScoreableFlags(servers);

  if (classified.length === 0) {
    recordVacuous(
      'lsp_scoring_denominator_is_language_servers',
      'a scoring denominator padded with non-language-server entries',
      'no LSP entry declares a `category` field in this payload shape'
    );
    // The denominator still has to agree with the list it claims to describe.
    record(
      'lsp_total_denominator_unpadded',
      'a scoring denominator that disagrees with the entry list',
      measurableTotal === servers.length,
      `lsp.measurableTotal=${measurableTotal ?? '(non-numeric)'}, servers.length=${servers.length}`,
      `${servers.length}`,
      measurableTotal !== servers.length
        ? `lsp.measurableTotal=${measurableTotal ?? '(non-numeric)'} does not match the ${servers.length} listed entries.`
        : undefined
    );
    return;
  }

  // 3b. The SCORING DENOMINATOR is `measurableTotal`, and it must equal the count
  //     of entries ACTUALLY categorised `language-server`. Anything else is
  //     padding: entries that can never answer an LSP handshake.
  record(
    'lsp_scoring_denominator_is_language_servers',
    'a scoring denominator padded with non-language-server entries',
    measurableTotal === languageServers,
    `lsp.measurableTotal=${measurableTotal ?? '(non-numeric)'}, entries categorised language-server=${languageServers} of ${servers.length}`,
    `${languageServers}`,
    measurableTotal !== languageServers
      ? `lsp.measurableTotal=${measurableTotal ?? '(non-numeric)'} but only ${languageServers} of ${servers.length} entries are categorised "language-server". ` +
        `The excluded ${servers.length - languageServers} cannot answer an LSP handshake, so counting them inflates the denominator and deflates the ratio.`
      : undefined
  );

  // 3c. The declared/excluded counts must travel with the denominator, or the
  //     exclusion is invisible and unauditable.
  const nonLangTotal = num(lsp.nonLanguageServerTotal);
  const actualNonLang = servers.length - languageServers;
  if (nonLangTotal === null) {
    recordVacuous(
      'lsp_excluded_count_published',
      'a silently narrowed denominator with no published exclusion count',
      'lsp.nonLanguageServerTotal absent'
    );
  } else {
    record(
      'lsp_excluded_count_published',
      'a silently narrowed denominator with no published exclusion count',
      nonLangTotal === actualNonLang,
      `nonLanguageServerTotal=${nonLangTotal}`,
      `${actualNonLang}`,
      nonLangTotal !== actualNonLang
        ? `nonLanguageServerTotal=${nonLangTotal} but ${actualNonLang} entries are non-language-server.`
        : undefined
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK GROUP 4 — PER-ENTRY REASONING AND THREE-STATE DISCIPLINE
// Catches a non-ONLINE state presented without explanation, and the
// substitution of UNVERIFIABLE for a measured ONLINE/OFFLINE.
// ═══════════════════════════════════════════════════════════════════════════

const KNOWN_STATES = new Set(['ONLINE', 'OFFLINE', 'UNVERIFIABLE']);

function checkEntries(payload: AnyRecord, blockName: 'mcp' | 'lsp'): void {
  const block = asRecord(payload[blockName]);
  if (!block) {
    recordVacuous(
      `${blockName}_entry_states_declared`,
      'a server state invented outside the three-state model',
      `no ${blockName} block`
    );
    return;
  }
  const servers = asArray(block.servers);
  if (servers.length === 0) {
    recordVacuous(
      `${blockName}_entry_states_declared`,
      'a server state invented outside the three-state model',
      `${blockName}.servers is empty`
    );
    return;
  }

  const unknownStates: string[] = [];
  const missingReason: string[] = [];
  const unverifiedAsFact: string[] = [];
  const overclaimedHealth: string[] = [];

  for (const entry of servers) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const id = String(rec.id ?? '(no id)');
    const status = str(rec.status);

    if (!status) {
      unknownStates.push(`${id}: (no status)`);
      continue;
    }
    if (!KNOWN_STATES.has(status)) {
      unknownStates.push(`${id}: "${status}"`);
    }

    // 4a. Any non-ONLINE state must carry a reason. An operator must never see
    //     an unexplained "not online".
    if (status !== 'ONLINE') {
      const reason = str(rec.reason) || str(rec.statusReason) || str(rec.reasonText);
      if (!reason) missingReason.push(`${id} (${status})`);
    }

    // 4b. UNVERIFIABLE means "we could not look". It must never be dressed as a
    //     measured ONLINE or OFFLINE, and must never imply health.
    if (status === 'UNVERIFIABLE' && (rec.isHealthy === true || rec.isAvailable === true)) {
      unverifiedAsFact.push(`${id}: UNVERIFIABLE with isHealthy=${String(rec.isHealthy)}`);
    }

    // 4c. isHealthy must never contradict the reported state.
    if (typeof rec.isHealthy === 'boolean') {
      if (rec.isHealthy === true && status !== 'ONLINE') {
        overclaimedHealth.push(`${id}: isHealthy=true but status=${status}`);
      }
    }
  }

  record(
    `${blockName}_entry_states_declared`,
    'a server state invented outside the three-state model',
    unknownStates.length === 0,
    unknownStates.length === 0
      ? `${servers.length} entries, all states within ONLINE/OFFLINE/UNVERIFIABLE`
      : unknownStates.join(', '),
    'only ONLINE, OFFLINE, UNVERIFIABLE',
    unknownStates.length > 0 ? `Unrecognised state(s): ${unknownStates.join('; ')}` : undefined
  );

  record(
    `${blockName}_non_online_has_reason`,
    'a non-ONLINE server presented with no explanation',
    missingReason.length === 0,
    missingReason.length === 0
      ? `${servers.length} entries checked`
      : missingReason.join(', '),
    'every non-ONLINE entry carries a reason',
    missingReason.length > 0
      ? `These entries are not ONLINE but state no reason: ${missingReason.join('; ')}`
      : undefined
  );

  record(
    `${blockName}_unverifiable_never_claimed_online`,
    'an UNVERIFIABLE result dressed up as health or as measured OFFLINE',
    unverifiedAsFact.length === 0,
    unverifiedAsFact.length === 0 ? 'no UNVERIFIABLE entry claims health' : unverifiedAsFact.join(', '),
    'UNVERIFIABLE implies no health claim',
    unverifiedAsFact.length > 0 ? unverifiedAsFact.join('; ') : undefined
  );

  record(
    `${blockName}_health_flag_matches_state`,
    'an isHealthy flag contradicting the entry\'s own reported state',
    overclaimedHealth.length === 0,
    overclaimedHealth.length === 0 ? 'no contradiction' : overclaimedHealth.join(', '),
    'isHealthy=true only when status=ONLINE',
    overclaimedHealth.length > 0 ? overclaimedHealth.join('; ') : undefined
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK GROUP 5 — DISPLAY-NAME TRUTH
// typescript, eslint and dotnet are NOT language servers. A name that implies
// otherwise is a false capability claim regardless of how the data is labelled.
// ═══════════════════════════════════════════════════════════════════════════

const NON_LANGUAGE_SERVER_IDS = ['typescript', 'eslint', 'dotnet'];

/**
 * A name asserts "language server" if it contains that phrase WITHOUT a negation.
 * The registry's corrected labels deliberately contain the phrase in negated form
 * ("TypeScript Compiler Toolchain (not a language server)"), so a naive substring
 * test would flag the honest labels too — and a harness that cries wolf on correct
 * output gets switched off, which is worse than having none.
 */
function impliesLanguageServer(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.includes('language server')) return false;
  const negations = ['not a language server', 'no c# language server', 'non-language-server'];
  return !negations.some((g) => n.includes(g));
}

function checkDisplayNames(payload: AnyRecord): void {
  const lsp = asRecord(payload.lsp);
  const servers = lsp ? asArray(lsp.servers) : [];
  const relevant = servers
    .map(asRecord)
    .filter((r): r is AnyRecord => r !== null)
    .filter((r) => NON_LANGUAGE_SERVER_IDS.includes(String(r.id)));

  if (relevant.length === 0) {
    recordVacuous(
      'non_language_servers_not_labelled_as_such',
      'a compiler/linter/SDK presented to the operator as a language server',
      'no typescript/eslint/dotnet entries present in this payload'
    );
    return;
  }

  const offenders: string[] = [];
  for (const entry of relevant) {
    const id = String(entry.id);
    const name = str(entry.name);
    if (name && impliesLanguageServer(name)) {
      offenders.push(`${id}: name="${name}"`);
    }
  }

  record(
    'non_language_servers_not_labelled_as_such',
    'a compiler/linter/SDK presented to the operator as a language server',
    offenders.length === 0,
    offenders.length === 0
      ? `${relevant.length} entries checked, none implies a language server`
      : offenders.join(', '),
    'no display name for typescript/eslint/dotnet implies an LSP endpoint',
    offenders.length > 0
      ? `These entries are not language servers but their display names claim otherwise: ${offenders.join('; ')}`
      : undefined
  );

  // 5b. An entry declaring a non-language-server category must also say so in
  //     its own metadata, not merely in a denominator calculation.
  const silent = relevant
    .map(asRecord)
    .filter((r): r is AnyRecord => r !== null)
    .filter((r) => {
      const cat = str(r.category);
      return cat !== null && cat !== 'language-server' && (str(r.categoryJustification) === null);
    })
    .map((r) => String(r.id));

  record(
    'non_language_server_category_justified',
    'an entry excluded from the denominator with no published justification',
    silent.length === 0,
    silent.length === 0 ? 'every excluded entry states why' : silent.join(', '),
    'a categoryJustification on every non-language-server entry',
    silent.length > 0
      ? `Excluded from the scoring denominator without justification: ${silent.join(', ')}. An exclusion the operator cannot read is indistinguishable from a quiet score adjustment.`
      : undefined
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK GROUP 6 — THREE-STATE MODEL (versions and agent status)
// A null version must come with a reason; an INACTIVE agent must come with one.
// ═══════════════════════════════════════════════════════════════════════════

function checkThreeStateModel(payload: AnyRecord): void {
  // 6a. nodeRuntime.version === null requires versionUnavailableReason.
  const sc = asRecord(payload.serversCenter);
  const nodeRuntime = sc ? asRecord(sc.nodeRuntime) : null;
  if (!nodeRuntime || !('version' in nodeRuntime)) {
    recordVacuous(
      'null_version_has_reason',
      'an unavailable version silently rendered as blank',
      'no nodeRuntime.version in this payload'
    );
  } else if (nodeRuntime.version === null) {
    const reason = str(nodeRuntime.versionUnavailableReason);
    record(
      'null_version_has_reason',
      'an unavailable version silently rendered as blank',
      reason !== null,
      reason ? 'versionUnavailableReason present' : 'no versionUnavailableReason',
      'versionUnavailableReason when version is null',
      reason === null
        ? 'nodeRuntime.version is null with no explanation. An operator sees an empty field and cannot tell "absent" from "not probed".'
        : undefined
    );
  } else {
    record(
      'null_version_has_reason',
      'an unavailable version silently rendered as blank',
      true,
      `version=${String(nodeRuntime.version)}`,
      'n/a — a version is present'
    );
  }

  // 6b. Every INACTIVE agent must carry a statusReason.
  const agents = asRecord(payload.agents);
  const roster = agents ? asArray(agents.roster) : [];
  if (roster.length === 0) {
    recordVacuous(
      'inactive_agent_has_status_reason',
      'an agent shown as inactive with no stated cause',
      'no agent roster in this payload'
    );
  } else {
    const unexplained = roster
      .map(asRecord)
      .filter((r): r is AnyRecord => r !== null)
      .filter((r) => str(r.status) === 'INACTIVE')
      .filter((r) => str(r.statusReason) === null)
      .map((r) => String(r.id ?? '(no id)'));

    record(
      'inactive_agent_has_status_reason',
      'an agent shown as inactive with no stated cause',
      unexplained.length === 0,
      unexplained.length === 0 ? `${roster.length} roster entries checked` : unexplained.join(', '),
      'every INACTIVE agent carries a statusReason',
      unexplained.length > 0
        ? `These agents are INACTIVE with no stated reason: ${unexplained.join(', ')}`
        : undefined
    );

    // 6c. `active` count must equal the roster's own ACTIVE statuses.
    const declaredActive = num(agents ? agents.active : null);
    const actualActive = roster
      .map(asRecord)
      .filter((r): r is AnyRecord => r !== null)
      .filter((r) => str(r.status) === 'ACTIVE').length;

    if (declaredActive === null) {
      recordVacuous(
        'agent_active_count_consistent',
        'an agent active-count that disagrees with the roster',
        'agents.active absent'
      );
    } else {
      record(
        'agent_active_count_consistent',
        'an agent active-count that disagrees with the roster',
        declaredActive === actualActive,
        `agents.active=${declaredActive}`,
        `${actualActive} (counted from roster statuses)`,
        declaredActive !== actualActive
          ? `agents.active=${declaredActive} but ${actualActive} roster entries have status ACTIVE.`
          : undefined
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK GROUP 7 — CHAIN KEY AND MEASUREMENT PROVENANCE
// ═══════════════════════════════════════════════════════════════════════════

function checkProvenance(payload: AnyRecord): void {
  const key = str(payload.chainKey);
  record(
    'chain_key_published',
    'a payload attributed to the wrong chain key',
    key === CHAIN_KEY_ID,
    key ?? '(absent)',
    CHAIN_KEY_ID,
    key !== CHAIN_KEY_ID ? `chainKey=${key} does not match the sovereign chain key.` : undefined
  );

  // A subsystem claiming ONLINE must say how that was determined.
  for (const blockName of ['mcp', 'lsp'] as const) {
    const block = asRecord(payload[blockName]);
    if (!block) {
      recordVacuous(
        `${blockName}_measurement_provenance`,
        'an ONLINE claim with no stated measurement source',
        `no ${blockName} block`
      );
      continue;
    }
    const source = str(block.measurementSource);
    const reachabilityVerified = block.reachabilityVerified;
    record(
      `${blockName}_measurement_provenance`,
      'an ONLINE claim with no stated measurement source',
      source !== null && reachabilityVerified !== undefined,
      `measurementSource=${source ?? '(absent)'} reachabilityVerified=${String(reachabilityVerified)}`,
      'a named measurement source and an explicit reachability flag',
      source === null
        ? `${blockName} reports counts with no measurementSource.`
        : undefined
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════════════════

function evaluate(payload: AnyRecord): Check[] {
  checks.length = 0;
  checkHealthScore(payload);
  checkChainCoherence(payload);
  checkLspDenominator(payload);
  checkEntries(payload, 'mcp');
  checkEntries(payload, 'lsp');
  checkDisplayNames(payload);
  checkThreeStateModel(payload);
  checkProvenance(payload);
  return checks;
}

function printTable(source: string): void {
  const violations = checks.filter((c) => c.severity === 'VIOLATION');
  const vacuous = checks.filter((c) => c.severity === 'VACUOUS');

  console.log('='.repeat(96));
  console.log('👑 SOVEREIGN TELEMETRY TRUTH VERIFIER');
  console.log(`🔐 Chain Key ID: ${CHAIN_KEY_ID}`);
  console.log('='.repeat(96));
  console.log(`📡 Source: ${source}`);
  console.log('-'.repeat(96));
  console.log(
    `${violations.length === 0 ? '✅' : '❌'} ${'STATUS'.padEnd(8)} | ${'CHECK'.padEnd(42)} | OBSERVED`
  );
  console.log('-'.repeat(96));

  for (const c of checks) {
    const mark = c.severity === 'VIOLATION' ? '❌ FAIL' : c.severity === 'VACUOUS' ? '⚠️  N/A ' : '✅ PASS';
    const observed = c.observed.length > 44 ? c.observed.slice(0, 41) + '...' : c.observed;
    console.log(`${mark.padEnd(8)} | ${c.id.padEnd(42)} | ${observed}`);
    if (c.severity === 'VIOLATION' && c.detail) {
      console.log(`${' '.repeat(8)} | ${' '.repeat(42)} | ↳ ${c.detail}`);
    }
    if (c.severity === 'VACUOUS') {
      console.log(`${' '.repeat(8)} | ${' '.repeat(42)} | ↳ not exercised: ${c.detail ?? c.expected}`);
    }
  }

  console.log('-'.repeat(96));
  console.log(
    `Checks: ${checks.length} total | ✅ ${checks.length - violations.length - vacuous.length} passed | ` +
      `⚠️  ${vacuous.length} not exercised | ❌ ${violations.length} VIOLATED`
  );
  if (vacuous.length > 0) {
    console.log(
      '⚠️  Not-exercised checks did NOT verify anything. They are reported so a reader can see the gaps in coverage.'
    );
  }
  console.log('='.repeat(96));

  if (violations.length === 0) {
    console.log('✅ NO MISREPORTING DETECTED. Every published number is internally consistent with its components.');
  } else {
    console.log(`❌ ${violations.length} MISREPORTING VIOLATION(S) DETECTED:`);
    violations.forEach((c, i) => {
      console.log(`   ${i + 1}. [${c.id}] ${c.detail ?? c.observed}`);
      console.log(`      catches: ${c.catches}`);
      console.log(`      observed: ${c.observed}`);
      console.log(`      expected: ${c.expected}`);
    });
  }
}

interface Args {
  url: string;
  payloadFile: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { url: DEFAULT_BASE_URL, payloadFile: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) {
      i += 1;
      args.url = argv[i].replace(/\/+$/, '');
    } else if (a.startsWith('--url=')) {
      args.url = a.slice(6).replace(/\/+$/, '');
    } else if (a === '--payload' && argv[i + 1]) {
      i += 1;
      args.payloadFile = argv[i];
    } else if (a.startsWith('--payload=')) {
      args.payloadFile = a.slice(10);
    }
    else if (a === '--json') args.json = true;
  }
  return args;
}

async function fetchPayload(base: string): Promise<AnyRecord> {
  // Generous budget: /api/agents/framework performs REAL stdio and LSP handshakes
  // and takes ~20s on this host. A timeout here would be a false accusation.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120_000);
  try {
    const res = await fetch(`${base}/api/agents/framework`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from /api/agents/framework`);
    return (await res.json()) as AnyRecord;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  let payload: AnyRecord;
  let source: string;

  if (args.payloadFile) {
    const abs = path.resolve(args.payloadFile);
    try {
      payload = JSON.parse(fs.readFileSync(abs, 'utf-8')) as AnyRecord;
      source = `captured payload ${abs}`;
    } catch (err) {
      console.error(`❌ Cannot read payload file ${abs}: ${(err as Error).message}`);
      console.error('   An unreadable payload is an unverified claim, not a pass.');
      return 2;
    }
  } else {
    try {
      payload = await fetchPayload(args.url);
      source = `${args.url}/api/agents/framework`;
    } catch (err) {
      console.error(`❌ Cannot obtain payload from ${args.url}: ${(err as Error).message}`);
      console.error('   The instrument could not read the system. It therefore proves nothing.');
      return 2;
    }
  }

  evaluate(payload);

  const violations = checks.filter((c) => c.severity === 'VIOLATION');

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          chainKeyId: CHAIN_KEY_ID,
          source,
          ok: violations.length === 0,
          total: checks.length,
          passed: checks.filter((c) => c.severity === 'INFO').length,
          vacuous: checks.filter((c) => c.severity === 'VACUOUS').length,
          violated: violations.length,
          checks,
        },
        null,
        2
      )
    );
  } else {
    printTable(source);
  }

  if (violations.length > 0) {
    if (!args.json) console.log('\n🚫 VERDICT: THE CONSOLE IS MISREPORTING. Exit 1.');
    return 1;
  }
  if (!args.json) console.log('\n🚁 VERDICT: HONEST. Exit 0.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[TRUTH_VERIFIER_FATAL]', err);
    process.exit(2);
  });