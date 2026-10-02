/**
 * ============================================================================
 * SOVEREIGN SERVERS CENTER PANEL (MCP & LSP UNIFIED CONTROL)
 * Location: E:\Servers-Center (Device Canonical Servers Hub)
 * Standard: Model Context Protocol (6+1 Servers) & Language Server Protocol (6 Servers)
 * Chain Key ID: 360ea36c28e66d9d
 * ============================================================================
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UI TRUTH CONTRACT (UI-TRUTH-ENGINEER, Chain Key 360ea36c28e66d9d)
 * ────────────────────────────────────────────────────────────────────────────
 * This panel renders ONLY what `serversCenterRegistry` actually measured.
 *
 * That registry performs a FILE-SYSTEM EXISTENCE PROBE: it spawns nothing and
 * performs no MCP/LSP handshake, therefore it cannot prove reachability for any
 * entry, and it never emits `ONLINE`. The panel is consequently built around a
 * THREE-state model instead of the old two-state binary:
 *
 *   ONLINE        a transport handshake completed   (never emitted today)
 *   OFFLINE       a real probe measured a negative  (never emitted today)
 *   UNVERIFIABLE  no conclusion was possible       (the current resting state)
 *
 * A bare status badge is NOT honest reporting — it hides WHY. Every row
 * therefore carries, at minimum: the verdict, what was measured
 * (`measurement`), why (`verdictReason` + the registry's own sentence), when
 * (`lastProbedAt`, rendered as relative freshness) and how (`probeMethod`).
 *
 * Two further rules enforced here:
 *   - A fetch failure and a `total === 0` are rendered as EXPLICIT states.
 *     Neither may masquerade as "there are zero servers".
 *   - No fabricated defaults: no placeholder version strings, no clamping, no
 *     division that can reach the DOM as `NaN`.
 * ============================================================================
 */

import React, { useState, useEffect, useId } from 'react';
import { 
  Server, 
  Cpu, 
  Layers, 
  Terminal, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Code2, 
  ShieldCheck, 
  Sparkles,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  FileCode,
  Box,
  CircleX,
  CircleQuestionMark,
  Clock,
  EyeOff,
  FolderSearch,
  Microscope,
  TriangleAlert,
  Unplug
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ServersCenterOverview } from '../services/serversCenterRegistry';
import type {
  LspServerInfo,
  McpServerInfo,
  ProbeMeasurement,
  ProbeReasonCode,
  ReachabilityVerdict
} from '../services/serversCenterRegistry';

/* ===========================================================================
 * 1. THREE-STATE VERDICT TREATMENT
 * =========================================================================== */

/**
 * Visual contract for the three-state verdict.
 *
 * ── WHY 'UNVERIFIABLE' IS AMBER AND DELIBERATELY *NOT* RED ───────────────────
 * `OFFLINE` is a MEASURED NEGATIVE: a real transport was attempted and it
 * proved the target is not serving. `UNVERIFIABLE` is an ABSENCE OF EVIDENCE:
 * the probe could not be attempted, or it ran without a handshake and could not
 * conclude.
 *
 * Painting both in the same red would tell the operator two different epistemic
 * states are one thing — which is precisely the lie the registry just removed.
 * An operator who has learned "red means broken" will go debug the wrong
 * subsystem the first time the manifest is unmounted in Docker. Amber also
 * refuses the GREEN end, because the absence of a handshake is not proof of
 * service: painting it green would reinstate the original fabrication in a
 * friendlier colour.
 *
 * Colour is therefore never the only carrier of meaning: every badge pairs the
 * palette with a distinct ICON and an explicit Arabic label, so the three
 * states remain distinguishable in greyscale and for colour-blind operators
 * (WCAG 1.4.1 Use of Colour).
 */
interface VerdictVisual {
  icon: LucideIcon;
  /** Explicit, non-colour-dependent label. */
  label: string;
  badge: string;
  iconColor: string;
}

const VERDICT_VISUAL: Record<ReachabilityVerdict, VerdictVisual> = {
  ONLINE: {
    icon: CheckCircle2,
    label: 'متصل ومؤكد',
    badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/70',
    iconColor: 'text-emerald-400'
  },
  OFFLINE: {
    icon: CircleX,
    label: 'غير متصل (مُقاس)',
    badge: 'bg-rose-950/80 text-rose-300 border-rose-700/70',
    iconColor: 'text-rose-400'
  },
  UNVERIFIABLE: {
    icon: CircleQuestionMark,
    label: 'غير قابل للتحقق',
    badge: 'bg-amber-950/80 text-amber-300 border-amber-700/70',
    iconColor: 'text-amber-400'
  }
};

/**
 * Normalized verdict. The wire union still carries dead legacy literals
 * ('STANDBY' | 'MISSING' | 'READY' | 'SYSTEM_PINNED') purely so that consumers
 * owned by other agents keep compiling. They are never emitted by the current
 * registry. We normalize WITHOUT `as`, WITHOUT `any` and WITHOUT `@ts-ignore`.
 */
type WireVerdict = McpServerInfo['status'] | LspServerInfo['status'];

interface NormalizedVerdict {
  verdict: ReachabilityVerdict;
  /** The literal exactly as it arrived on the wire — never hidden from the operator. */
  wireValue: string;
  /** True when a legacy literal that this release cannot produce showed up. */
  legacyLiteral: boolean;
}

function normalizeVerdict(wire: WireVerdict): NormalizedVerdict {
  switch (wire) {
    case 'ONLINE':
    case 'OFFLINE':
    case 'UNVERIFIABLE':
      return { verdict: wire, wireValue: wire, legacyLiteral: false };
    // Legacy literals degrade to UNVERIFIABLE, which is the only truthful
    // reading: this registry performs no handshake, so it cannot support
    // "standby", "missing", "ready" or "system pinned" as any health claim.
    case 'STANDBY':
    case 'MISSING':
    case 'READY':
    case 'SYSTEM_PINNED':
      return { verdict: 'UNVERIFIABLE', wireValue: wire, legacyLiteral: true };
    default: {
      // Exhaustiveness guard. If the backend ever widens the union, this stops
      // compiling rather than silently rendering the wrong state.
      const unrecognised: never = wire;
      return { verdict: 'UNVERIFIABLE', wireValue: String(unrecognised), legacyLiteral: true };
    }
  }
}

/* ===========================================================================
 * 2. WHAT WAS MEASURED — plain-language labels for every machine code
 * =========================================================================== */

/**
 * Short Arabic label per machine reason code. The registry's own English
 * `verdictReasonText` sentence is rendered alongside this as the authoritative
 * wording; these labels exist so the operator can triage without reading prose.
 */
const REASON_LABEL: Record<ProbeReasonCode, string> = {
  RPC_HANDSHAKE_NOT_IMPLEMENTED: 'مصافحة البروتوكول غير منفَّذة — لا يمكن إثبات الوصول',
  PATH_ABSENT: 'المسار المطلوب غير موجود على هذا المضيف',
  TARGET_NOT_A_FILE: 'المسار موجود لكنه ليس ملفاً تنفيذياً (مجلد مثلاً)',
  TARGET_NOT_EXECUTABLE: 'الملف موجود وغير قابل للتنفيذ',
  ACCESS_DENIED: 'مرفوض بالصلاحيات',
  DISCOVERY_FAILED: 'فشل جرد الأصول — لم يُفحص أي شيء',
  ASSET_DIRECTORY_EXISTENCE_ONLY: 'وجود المجلد فقط',
  SOURCE_DECLARED_ONLY: 'مصدر معلَن في البيان فقط',
  TRANSPORT_REFUSED: 'رفض الاتصال من طرف النقل',
  TRANSPORT_TIMEOUT: 'انتهت مهلة النقل'
};

/**
 * What the probe ACTUALLY measured. `FILE_EXISTENCE_ONLY` is the strongest claim
 * this registry is entitled to make and is always spelled out, so no consumer
 * can read a health verdict into a path check.
 */
const MEASUREMENT_LABEL: Record<ProbeMeasurement, string> = {
  FILE_EXISTENCE_ONLY: 'ما قِيسه الفحص: وجود المسار على القرص فقط — الوصول (reachability) لم يُختبر إطلاقاً',
  NOT_PROBED: 'ما قِيسه الفحص: لا شيء — لم يُجرَ أي فحص على هذا المدخل'
};

/** LSP `healthCheck` states the exact secret the old `isHealthy` was measuring. */
const HEALTH_CHECK_LABEL: Record<LspServerInfo['healthCheck'], string> = {
  DIRECTORY_EXISTENCE_ONLY: 'فحص الصحة = وجود المجلد فقط (بلا فحص LSP)',
  SOURCE_DECLARED_ONLY: 'فحص الصحة = حزمة مصدر معلَنة في البيان فقط',
  NOT_PROBED: 'فحص الصحة = لم يُفحص'
};

const KNOWN_PROBE_METHOD_LABEL: Record<string, string> = {
  FILESYSTEM_EXISTENCE_PROBE:
    'فحص نظام الملفات: إحصاء المسارات فقط، بلا تشغيل عملية وبلا مصافحة MCP/LSP'
};

function describeProbeMethod(method: string): string {
  // `Record<string, string>` indexing yields `string`; compare explicitly so a
  // future, unknown probe method is surfaced instead of silently mislabelled.
  const known = Object.prototype.hasOwnProperty.call(KNOWN_PROBE_METHOD_LABEL, method)
    ? KNOWN_PROBE_METHOD_LABEL[method]
    : undefined;
  return known ?? `طريقة فحص غير معرَّفة في هذه الواجهة: ${method}`;
}

const ROOT_SOURCE_LABEL: Record<ServersCenterOverview['envOverrides']['resolvedRootSource'], string> = {
  SERVERS_CENTER_ROOT: 'من متغيّر البيئة SERVERS_CENTER_ROOT',
  SERVERS_CENTER_PATH: 'من متغيّر البيئة القديم SERVERS_CENTER_PATH',
  DEFAULT: 'من القيمة الافتراضية E:\\Servers-Center'
};

/* ===========================================================================
 * 3. HONEST FORMATTING HELPERS — no NaN, no clamping, no invented values
 * =========================================================================== */

interface ProbeAge {
  label: string;
  /** Full, unambiguous timestamp for the tooltip / accessible name. */
  title: string;
  /** True only when the stamp lies in the future (clock skew between host and browser). */
  skewed: boolean;
}

/**
 * Render measurement freshness as a relative age ("12s ago").
 *
 * Honesty rules, deliberately:
 *   - an absent / unparsable stamp renders as an explicit "unreadable", NEVER
 *     as "0s ago" (which would assert a measurement that did not happen);
 *   - a stamp in the future is flagged as skew rather than silently clamped to
 *     zero, because "just probed" is not a fact we can assert about a clock we
 *     do not control.
 */
function formatProbeAge(iso: string, nowMs: number): ProbeAge {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return {
      label: 'وقت الفحص غير قابل للقراءة',
      title: `طابع زمني غير صالح في الحمولة: "${String(iso)}"`,
      skewed: false
    };
  }
  const title = new Date(parsed).toLocaleString();
  const deltaMs = nowMs - parsed;
  if (deltaMs < -1000) {
    return {
      label: 'طابع زمني في المستقبل',
      title: `${title} — الطابع أقدم من ساعة المتصفح؛ مؤشر على تجاوز clocks الخادم/المتصفح`,
      skewed: true
    };
  }
  const totalSeconds = Math.floor(deltaMs / 1000);
  if (totalSeconds < 1) return { label: 'قبل أقل من ثانية', title, skewed: false };
  if (totalSeconds < 60) return { label: `قبل ${totalSeconds} ثانية`, title, skewed: false };
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return { label: `قبل ${minutes} دقيقة`, title, skewed: false };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `قبل ${hours} ساعة`, title, skewed: false };
  const days = Math.floor(hours / 24);
  return { label: `قبل ${days} يوم`, title, skewed: false };
}

/**
 * Guarded coverage ratio.
 *
 * `total === 0` is a LEGITIMATE measurement here (discovery failed, or the
 * manifest enumerated nothing — which is the normal Docker case). A raw `x / 0`
 * yields NaN, and `NaN%` rendered into the DOM reads as a corrupt reading
 * rather than as "nothing was measured". Returning `null` lets the caller print
 * an explicit em-dash instead. We never substitute 0% either: a 0% claim would
 * assert "measured, and none passed", which is precisely the absence of
 * evidence we refuse to report.
 */
function measuredPercent(part: number, whole: number): string | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  const ratio = part / whole;
  if (!Number.isFinite(ratio)) return null;
  return `${Math.round(ratio * 100)}%`;
}

/** Derive a human message from an unknown throwable without leaking `any`. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    const serialized = JSON.stringify(err);
    return serialized === undefined ? 'خطأ غير معروف' : serialized;
  } catch {
    return 'خطأ غير معروف';
  }
}

/**
 * Wire-format guard. The `STANDBY`/`READY` → `UNVERIFIABLE` migration is a
 * BREAKING change to the payload. A browser tab talking to an un-migrated
 * backend would otherwise render `undefined` / a green "READY" badge with no
 * measurement beside it. We detect that explicitly and refuse to display it.
 *
 * Note: this is a runtime sanity check, not a type assertion — no `as` and no
 * `any` is introduced here.
 */
function assertHonestyEnvelope(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('استجابة غير صالحة: الحمولة ليست كائن JSON.');
  }
  const requiredTopLevel = [
    'centerPath',
    'probeMethod',
    'lastProbedAt',
    'availabilityReason',
    'mcpSummary',
    'lspSummary',
    'nodeRuntime'
  ];
  const missingTopLevel = requiredTopLevel.filter(k => !(k in payload));
  if (missingTopLevel.length > 0) {
    throw new Error(
      `حمولة قديمة/غير مطابقة للإصدار: الحقول [${missingTopLevel.join(', ')}] مفقودة. ` +
      'الإصدار المطلوب يصدر تقييماً ثلاثياً (ONLINE/OFFLINE/UNVERIFIABLE) مع غلاف صدق.'
    );
  }
  // `in`-narrowing (no `as`): after this check `payload` is typed as
  // `object & Record<'probeMethod', unknown>`.
  if (!('probeMethod' in payload)) {
    throw new Error('حمولة بلا حقل probeMethod — لا يمكن عرض أساس القياس.');
  }
  const probe = payload.probeMethod;
  if (typeof probe !== 'string' || probe.length === 0) {
    throw new Error(`طريقة فحص غير صالحة: ${String(probe)}.`);
  }
}

/* ===========================================================================
 * 4. PRESENTATIONAL SUB-COMPONENTS
 * =========================================================================== */

interface ProbeEvidenceRow {
  label: string;
  value: string;
  /** Render the value left-to-right (machine codes, paths, sentences). */
  ltr?: boolean;
}

/** Verdict badge — colour + ICON + explicit label (never colour alone). */
function VerdictBadge({ normalized }: { normalized: NormalizedVerdict }) {
  const visual = VERDICT_VISUAL[normalized.verdict];
  const Icon = visual.icon;
  return (
    <span
      className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border flex items-center gap-1 shrink-0 ${visual.badge}`}
      title={`الحرف المُرسَل على السلك: ${normalized.wireValue}`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      <span>{visual.label}</span>
    </span>
  );
}

/** Three-state count breakdown. Counts, not a percentage, when n === 0. */
function VerdictBreakdown({
  online,
  offline,
  unverified
}: {
  online: number;
  offline: number;
  unverified: number;
}) {
  return (
    <ul className="mt-2 space-y-1 text-[10px] font-mono" aria-label="توزيع الأحكام المقاسة">
      <li className="flex items-center gap-1.5">
        <CheckCircle2 className="w-3 h-3 text-emerald-400" aria-hidden="true" />
        <span className="text-emerald-300">متصل ومؤكد:</span>
        <span className="text-slate-200 font-bold">{online}</span>
      </li>
      <li className="flex items-center gap-1.5">
        <CircleX className="w-3 h-3 text-rose-400" aria-hidden="true" />
        <span className="text-rose-300">غير متصل (مُقاس):</span>
        <span className="text-slate-200 font-bold">{offline}</span>
      </li>
      <li className="flex items-center gap-1.5">
        <CircleQuestionMark className="w-3 h-3 text-amber-400" aria-hidden="true" />
        <span className="text-amber-300">غير قابل للتحقق:</span>
        <span className="text-slate-200 font-bold">{unverified}</span>
      </li>
    </ul>
  );
}

/**
 * The measurement footprint of a single entry.
 *
 * The first two lines are ALWAYS visible — the "what was measured" and "when"
 * facts are not optional disclosure, they are the point of the panel. The
 * disclosure button only reveals the longer evidence (why, how, full stamp).
 * It is a real `<button>` with `aria-expanded` / `aria-controls` and a
 * per-server accessible name, so it is keyboard-reachable and unambiguous when
 * several cards render the identical visible label.
 */
function ProbeEvidence({
  subject,
  normalized,
  measurement,
  reasonCode,
  reasonText,
  reachabilityVerified,
  probeMethod,
  lastProbedAt,
  nowMs,
  extraRows
}: {
  subject: string;
  normalized: NormalizedVerdict;
  measurement: ProbeMeasurement;
  reasonCode: ProbeReasonCode;
  reasonText: string;
  reachabilityVerified: boolean;
  probeMethod: string;
  lastProbedAt: string;
  nowMs: number;
  extraRows?: ProbeEvidenceRow[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const age = formatProbeAge(lastProbedAt, nowMs);
  const reasonLabel = REASON_LABEL[reasonCode];

  return (
    <div className="mt-2 rounded-lg border border-slate-800/70 bg-slate-950/70 p-2 space-y-1.5">
      {/* Always-visible honesty statement: WHAT was measured. */}
      <div className="flex items-start gap-1.5 text-[10px] font-mono leading-relaxed">
        <Microscope className="w-3 h-3 mt-px shrink-0 text-amber-400" aria-hidden="true" />
        <span className="text-amber-200/90">{MEASUREMENT_LABEL[measurement]}</span>
      </div>

      {/* Always-visible freshness: the reading's age, not a claim about the service. */}
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
        <span
          className={`flex items-center gap-1 ${age.skewed ? 'text-amber-300' : 'text-slate-400'}`}
          title={age.title}
        >
          <Clock className="w-3 h-3 text-slate-500" aria-hidden="true" />
          <span>آخر فحص: {age.label}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(prev => !prev)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`دليل القياس التفصيلي لحالة ${subject}`}
          className="flex items-center gap-1 text-cyan-300 hover:text-cyan-200 border border-cyan-900/60 rounded px-1.5 py-0.5 transition cursor-pointer"
        >
          <span>دليل القياس</span>
          <ChevronDown
            className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {open && (
        <div id={panelId} className="space-y-1.5 pt-1.5 border-t border-slate-800/70 text-[10px] font-mono">
          <div className="flex items-start gap-1.5">
            <CircleQuestionMark className="w-3 h-3 mt-px shrink-0 text-amber-400" aria-hidden="true" />
            <div className="space-y-0.5">
              <div className="text-amber-200/90">{reasonLabel}</div>
              <div className="text-slate-500" dir="ltr">{reasonCode}</div>
            </div>
          </div>

          <p className="text-slate-300 leading-relaxed" dir="ltr">{reasonText}</p>

          <dl className="grid grid-cols-1 gap-y-1 pt-1 border-t border-slate-800/70">
            <div className="flex items-start gap-1.5">
              <dt className="text-slate-500 shrink-0">الحرف على السلك:</dt>
              <dd className="text-slate-300" dir="ltr">{normalized.wireValue}</dd>
            </div>
            <div className="flex items-start gap-1.5">
              <dt className="text-slate-500 shrink-0">الوصول مُتحقَّق منه:</dt>
              <dd className={reachabilityVerified ? 'text-emerald-300' : 'text-amber-300'} dir="ltr">
                {reachabilityVerified ? 'نعم' : 'لا — لا يوجد دليل على وصول الخدمة'}
              </dd>
            </div>
            <div className="flex items-start gap-1.5">
              <dt className="text-slate-500 shrink-0">طريقة الفحص:</dt>
              <dd className="text-slate-300" dir="ltr">{probeMethod}</dd>
            </div>
            <div className="flex items-start gap-1.5">
              <dt className="text-slate-500 shrink-0">ماذا يعني ذلك:</dt>
              <dd className="text-slate-300">{describeProbeMethod(probeMethod)}</dd>
            </div>
            <div className="flex items-start gap-1.5">
              <dt className="text-slate-500 shrink-0">طابع الفحص الخام:</dt>
              <dd className="text-slate-300 break-all" dir="ltr">{lastProbedAt}</dd>
            </div>
            {(extraRows ?? []).map(row => (
              <div key={row.label} className="flex items-start gap-1.5">
                <dt className="text-slate-500 shrink-0">{row.label}</dt>
                <dd className="text-slate-300 break-all" dir={row.ltr === false ? undefined : 'ltr'}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          {normalized.legacyLiteral && (
            <p className="text-amber-300 border-t border-slate-800/70 pt-1.5 leading-relaxed">
              تنبيه: الحمولة حملت رمزاً قديماً غير مُنتَج من هذا الإصدار
              (<span dir="ltr">{normalized.wireValue}</span>)، وقد عُرض كـ
              «غير قابل للتحقق». لا يمكن عرضه كحالة صحية دون مصافحة اختبارية.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Discovery-gap banner.
 *
 * A silently empty list reads as "no servers exist", which is a different and
 * stronger claim than "we could not enumerate the inventory". When discovery
 * failed, or when entries from the canonical catalog were not enumerated, we
 * say so, and we name them.
 */
function DiscoveryGapBanner({
  title,
  total,
  expectedCount,
  discovered,
  discoveryFailed,
  discoveryReason,
  missing
}: {
  title: string;
  total: number;
  expectedCount: number;
  discovered: boolean;
  discoveryFailed: boolean;
  discoveryReason: string | null;
  missing: string[];
}) {
  const coverage = measuredPercent(total, expectedCount);
  return (
    <div
      className="p-3.5 rounded-xl border border-amber-700/60 bg-amber-950/20 text-[11px] font-mono space-y-1.5"
      role="note"
    >
      <div className="flex items-center gap-1.5 text-amber-300 font-bold">
        <FolderSearch className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{title}</span>
      </div>
      <p className="text-slate-300 leading-relaxed">
        {discoveryFailed
          ? 'تعذّر جرد الأصول، لذلك الجرد المُبلغ عنه أدناه ليس دليلاً على وجود خوادم ولا على غيابها.'
          : 'اكتمل الجرد، لكن كتالوج المشروع المرجعي يتضمّن مدخلات لم تظهر في الحمولة.'}
      </p>
      <ul className="list-disc pr-4 space-y-0.5 text-slate-400">
        <li>
          <span className="text-slate-500">المكتشف فعلياً (total):</span>{' '}
          <span className="text-slate-200 font-bold">{total}</span>
          {' — '}العدد الحقيقي المُقاس، وليس حصة من كتالوج.
        </li>
        <li>
          <span className="text-slate-500">المتوقع في الكتالوج المرجعي (expectedCount):</span>{' '}
          <span className="text-slate-200 font-bold">{expectedCount}</span>
          {' — '}
          {coverage === null
            ? 'لا يمكن حساب نسبة التغطية لأن المقام صفر؛ نعرض عدّاً خاماً بدل نسبة مفترضة.'
            : `نسبة التغطية: ${coverage}`}
        </li>
        <li>
          <span className="text-slate-500">غير موجود في الاكتشاف:</span>{' '}
          <span className="text-slate-200">
            {missing.length > 0 ? missing.join('، ') : 'لا شيء — كل مدخلات الكتالوج ظهرت.'}
          </span>
        </li>
        <li>
          <span className="text-slate-500">حالة الجرد:</span>{' '}
          <span className="text-slate-200">{discovered ? 'مكتمل' : 'غير مكتمل'}</span>
        </li>
        <li>
          <span className="text-slate-500">سبب الجرد:</span>{' '}
          <span className="text-slate-200">{discoveryReason ?? 'لم يُبلَّغ عن سبب من الخادم.'}</span>
        </li>
      </ul>
    </div>
  );
}

/**
 * Explicit empty state. Reached when discovery enumerated nothing. It must
 * never read as "there are zero servers" — the difference is the whole point.
 *
 * When the list is empty this component SUPERSEDES `DiscoveryGapBanner` (which
 * only renders alongside a non-empty list), because two adjacent amber blocks
 * repeating the same numbers is noise, not disclosure. It therefore carries the
 * full disclosure itself: discovery status, measured total, catalog expectation,
 * guarded coverage ratio, named gaps and the registry's own reason string.
 */
function EmptyInventoryNotice({
  title,
  total,
  expectedCount,
  discovered,
  discoveryReason,
  missing
}: {
  title: string;
  total: number;
  expectedCount: number;
  discovered: boolean;
  discoveryReason: string | null;
  missing: string[];
}) {
  const coverage = measuredPercent(total, expectedCount);
  return (
    <div
      className="p-4 rounded-xl border border-amber-700/60 bg-amber-950/20 text-[11px] font-mono space-y-1.5"
      role="note"
    >
      <div className="flex items-center gap-1.5 text-amber-300 font-bold">
        <EyeOff className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{title}</span>
      </div>
      <p className="text-slate-300 leading-relaxed">
        قائمة فارغة ليست دليلاً على «لا توجد خوادم». لا توجد مدخلات مُكتشَفة لعرضها، وهذا ما نعرفه بالضبط:
      </p>
      <ul className="list-disc pr-4 space-y-0.5 text-slate-400">
        <li>
          <span className="text-slate-500">المكتشف فعلياً (total):</span>{' '}
          <span className="text-slate-200 font-bold">{total}</span>
          {' — '}العدد الحقيقي المُقاس، وليس حصة من كتالوج.
        </li>
        <li>
          <span className="text-slate-500">المتوقع في الكتالوج المرجعي (expectedCount):</span>{' '}
          <span className="text-slate-200 font-bold">{expectedCount}</span>
          {' — '}
          {coverage === null
            ? 'لا يمكن حساب نسبة التغطية لأن المقام صفر؛ نعرض عدّاً خاماً بدل نسبة مفترضة.'
            : `نسبة التغطية: ${coverage}`}
        </li>
        <li>
          <span className="text-slate-500">الناقص عن الاكتشاف:</span>{' '}
          <span className="text-slate-200">
            {missing.length > 0 ? missing.join('، ') : '—'}
          </span>
        </li>
        <li>
          <span className="text-slate-500">حالة الجرد:</span>{' '}
          <span className="text-slate-200">{discovered ? 'مكتمل' : 'غير مكتمل — لم تُعدّ مدخلات'}</span>
        </li>
        <li>
          <span className="text-slate-500">سبب تعذّر الجرد:</span>{' '}
          <span className="text-slate-200">{discoveryReason ?? 'لم يُبلَّغ عن سبب من الخادم.'}</span>
        </li>
      </ul>
    </div>
  );
}

export default function ServersCenterPanel() {
  const [overview, setOverview] = useState<ServersCenterOverview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSubTab, setSelectedSubTab] = useState<'mcp' | 'lsp' | 'all'>('all');
  const [testResult, setTestResult] = useState<{ [id: string]: string }>({});
  // Live clock for the freshness readouts. Ticks once per second so an operator
  // can see at a glance whether a reading is seconds old or minutes stale.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const fetchOverview = async () => {
    try {
      setRefreshing(true);
      const res = await fetch('/api/servers-center/overview');
      const data = await res.json();
      assertHonestyEnvelope(data);
      setOverview(data);
      setLoadError(null);
    } catch (err: unknown) {
      // A failed fetch must be reported as a failed fetch. Leaving the panel
      // blank (or rendering "0 servers") would be a lie of omission.
      const message = describeError(err);
      console.error('[ServersCenterPanel] Fetch error:', err);
      setLoadError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleTestMcp = async (serverId: string) => {
    setTestResult(prev => ({ ...prev, [serverId]: 'جاري الفحص...' }));
    try {
      if (serverId === 'sovereign-commander') {
        const res = await fetch('/api/mcp/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
              name: 'sovereign_verify_chain',
              arguments: { chainKeyId: '360ea36c28e66d9d' }
            }
          })
        });
        const data = await res.json();
        const text = data.result?.content?.[0]?.text || JSON.stringify(data);
        setTestResult(prev => ({ ...prev, [serverId]: `✅ استجابة فورية: ${text.slice(0, 100)}` }));
      } else {
        const res = await fetch('/api/mcp/status');
        const data = await res.json();
        // Honest reporting: report the field the endpoint actually returned.
        // The previous revision printed "Status: Active" as a fallback and
        // prefixed it with a green check, which asserted a registration that was
        // never measured. This endpoint describes the sovereign MCP gateway, not
        // this specific server, so it is labelled as such.
        const reportedStatus =
          typeof data?.status === 'string' && data.status.length > 0 ? data.status : 'لم يُبلَّغ عن حالة';
        setTestResult(
          prev => ({
            ...prev,
            [serverId]: `استعلام عام: status=${reportedStatus} — يخص بوابة MCP السيادية فقط، ولا يُثبت حالة هذا الخادم ولا يصلاحيته.`
          })
        );
      }
    } catch (e: unknown) {
      setTestResult(prev => ({ ...prev, [serverId]: `❌ خطأ في الاتصال: ${describeError(e)}` }));
    }
  };

  if (loading && !overview) {
    return (
      <div className="p-8 text-center text-slate-400 bg-slate-900/60 rounded-xl border border-slate-800 animate-pulse">
        <Server className="w-8 h-8 mx-auto mb-2 text-cyan-400 animate-spin" />
        <p className="text-xs font-mono">جاري استدعاء وفحص سجلات سجل المركز الموحد على القرص...</p>
      </div>
    );
  }

  if (!overview) {
    // Explicit failure state. Not a blank panel, and definitely not "0 servers".
    return (
      <div
        className="p-5 rounded-xl border border-rose-800/70 bg-rose-950/20 text-xs font-mono space-y-2"
        role="alert"
      >
        <div className="flex items-center gap-2 text-rose-300 font-bold">
          <TriangleAlert className="w-4 h-4" aria-hidden="true" />
          <span>تعذّر قياس مركز الخوادم — لا تُعرض أي حالة</span>
        </div>
        <p className="text-slate-300 leading-relaxed">
          لم يصل رد من <span dir="ltr">/api/servers-center/overview</span>. الرفق أدناه هو سبب
          الرفض كما ورد حرفياً؛ لم يُستبدل بأي حالة افتراضية.
        </p>
        <pre className="p-2.5 rounded-lg bg-black/50 border border-rose-900/60 text-rose-200 whitespace-pre-wrap break-all" dir="ltr">
          {loadError ?? 'لم يُبلَّغ عن سبب.'}
        </pre>
        <button
          type="button"
          onClick={fetchOverview}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg text-xs font-mono transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>إعادة محاولة القياس</span>
        </button>
      </div>
    );
  }

  const mcpList = overview.mcpSummary.servers || [];
  const lspList = overview.lspSummary.servers || [];
  const mcpMissing = overview.mcpSummary.missingFromDiscovery || [];
  const lspMissing = overview.lspSummary.missingFromDiscovery || [];
  const mcpHasGap = overview.mcpSummary.discoveryFailed || mcpMissing.length > 0;
  const lspHasGap = overview.lspSummary.discoveryFailed || lspMissing.length > 0;
  const overviewAge = formatProbeAge(overview.lastProbedAt, nowMs);
  const nodeVersion = overview.nodeRuntime.version;
  const envOverrides = overview.envOverrides;
  const activeEnvKeys = (
    [
      ['SERVERS_CENTER_ROOT', envOverrides.SERVERS_CENTER_ROOT],
      ['SERVERS_CENTER_PATH', envOverrides.SERVERS_CENTER_PATH],
      ['SERVERS_CENTER_MANIFEST', envOverrides.SERVERS_CENTER_MANIFEST],
      ['SERVERS_CENTER_NODE', envOverrides.SERVERS_CENTER_NODE]
    ] as const
  ).filter(([, value]) => typeof value === 'string' && value.length > 0);

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Telemetry Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-[#0c1322] border border-cyan-500/30 rounded-2xl p-5 shadow-[0_0_25px_rgba(6,182,212,0.15)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono uppercase tracking-wider mb-1">
              <Server className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              {/* Resolved root, not a hardcoded drive letter: inside Docker the
                  default E:\Servers-Center is usually NOT what is probed. */}
              <span className="truncate" title={overview.centerPath}>
                Device Canonical Hub: {overview.centerPath}
              </span>
              <span className="bg-cyan-950/80 text-cyan-300 border border-cyan-700/50 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                Chain Key: 360ea36c28e66d9d
              </span>
            </div>
            <h2 className="text-xl font-bold font-sans text-white flex items-center gap-2">
              مركز الخوادم الموحد (MCP &amp; LSP Central Matrix)
              <Sparkles className="w-4 h-4 text-yellow-400" aria-hidden="true" />
            </h2>
            <p className="text-xs text-slate-400 font-mono mt-1">
              الجذر المقروء فعلياً من الخادم: <span dir="ltr">{overview.centerPath}</span>. خوادم
              بروتوكول السياق (MCP) وخوادم لغات البرمجة (LSP) مُدرجة أدناه بالحكم المقاس فقط.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchOverview}
              disabled={refreshing}
              aria-busy={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg text-xs font-mono transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>تحديث الفحص الميداني</span>
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-800 text-xs font-mono">
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
              <span>خوادم الـ MCP المكتشفة فعلياً</span>
            </div>
            <div className="text-lg font-bold text-cyan-300 flex items-center gap-2">
              <span>{overview.mcpSummary.total} خوادم</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              <span className="text-slate-400">الكتالوج المرجعي:</span>{' '}
              <span dir="ltr">{overview.mcpSummary.expectedCount}</span>
              {' — '}
              <span className="text-slate-400">الناقص:</span>{' '}
              <span dir="ltr">{mcpMissing.length}</span>
            </div>
            <VerdictBreakdown
              online={overview.mcpSummary.onlineCount}
              offline={overview.mcpSummary.offlineCount}
              unverified={overview.mcpSummary.unverifiedCount}
            />
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
              <span>خوادم الـ LSP المكتشفة فعلياً</span>
            </div>
            <div className="text-lg font-bold text-indigo-300 flex items-center gap-2">
              <span>{overview.lspSummary.total} خوادم</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              <span className="text-slate-400">الكتالوج المرجعي:</span>{' '}
              <span dir="ltr">{overview.lspSummary.expectedCount}</span>
              {' — '}
              <span className="text-slate-400">الناقص:</span>{' '}
              <span dir="ltr">{lspMissing.length}</span>
            </div>
            <VerdictBreakdown
              online={0}
              offline={overview.lspSummary.offlineCount}
              unverified={overview.lspSummary.unverifiedCount}
            />
            {/* readyCount counts isHealthy === true, and isHealthy is only true
                after a real LSP handshake — which does not exist yet. Showing it
                as a bare "N جاهز" is therefore a permanent 0 wearing the costume
                of a health metric. */}
            <div className="mt-1.5 text-[10px] font-mono text-amber-300 flex items-start gap-1">
              <CircleQuestionMark className="w-3 h-3 mt-px shrink-0" aria-hidden="true" />
              <span>
                readyCount = <span dir="ltr">{overview.lspSummary.readyCount}</span> — صفر لأن
                <span dir="ltr"> isHealthy </span>
                يُشتق من فحص LSP حقيقي لم يُنفَّذ بعد، لا من وجود مجلد.
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              <span>بيئة التشغيل المحمولة (Runtime)</span>
            </div>
            {nodeVersion === null ? (
              <>
                <div className="text-sm font-bold text-amber-300 flex items-center gap-1.5">
                  <EyeOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>إصدار Node.js: غير متاح (لم يُقَس)</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                  {overview.nodeRuntime.versionUnavailableReason ??
                    'لم يُبلَّغ عن سبب من الخادم.'}
                </p>
              </>
            ) : (
              <>
                <div className="text-sm font-bold text-emerald-300 truncate" title={overview.nodeRuntime.path}>
                  Node.js <span dir="ltr">{nodeVersion}</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                  المصدر: <span dir="ltr">manifest.runtime.node_version</span> — رقم مقروء من البيان،
                  لا رقم مُستنتَج ولا قيمة افتراضية.
                </p>
              </>
            )}
            <div className="mt-1.5 text-[10px] font-mono text-slate-500">
              <span className="text-slate-400">مسار الملف:</span>{' '}
              <span className="break-all" dir="ltr">{overview.nodeRuntime.path}</span>
              <span className="text-slate-400"> — موجود:</span>{' '}
              <span dir="ltr">{overview.nodeRuntime.exists ? 'نعم' : 'لا'}</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              <span>مسار المركز على القرص (قياس وجود)</span>
            </div>
            {/* Amber, not emerald, even when present: `isAvailable` is a TWO-PATH
                existence check and carries no service claim whatsoever. Painting
                it green would reintroduce exactly the confusion the backend
                honesty layer removed. */}
            <div
              className={`text-sm font-bold flex items-center gap-1.5 ${
                overview.isAvailable ? 'text-amber-300' : 'text-rose-300'
              }`}
            >
              {overview.isAvailable ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{overview.isAvailable ? 'الجذر والبيان موجودان' : 'الجذر أو البيان غائب'}</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
              {overview.availabilityReason}
            </p>
            <div className="mt-1.5 text-[10px] font-mono text-slate-500 break-all" dir="ltr">
              {ROOT_SOURCE_LABEL[envOverrides.resolvedRootSource]}
            </div>
          </div>
        </div>
      </div>

      {/* ── Measurement envelope: the panel states its own limits ── */}
      <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-4 text-[11px] font-mono space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-amber-300 font-bold">
            <Microscope className="w-3.5 h-3.5" aria-hidden="true" />
            <span>أساس القياس في هذه اللوحة</span>
          </span>
          <span className="px-1.5 py-0.5 rounded border border-amber-800/60 bg-amber-950/60 text-amber-200" dir="ltr">
            {overview.probeMethod}
          </span>
          <span className="px-1.5 py-0.5 rounded border border-amber-800/60 bg-amber-950/60 text-amber-200">
            {describeProbeMethod(overview.probeMethod)}
          </span>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-1 text-slate-300 list-disc pr-4 leading-relaxed">
          <li>
            <span className="text-slate-500">تأكيد الوصول:</span>{' '}
            <span className={overview.reachabilityVerified ? 'text-emerald-300' : 'text-amber-300'}>
              {overview.reachabilityVerified ? 'نعم' : 'لا — لم يُتحقق من وصول أي خادم'}
            </span>
          </li>
          <li>
            <span className="text-slate-500">قياس التوفّر:</span>{' '}
            <span dir="ltr">{overview.availabilityMeasurement}</span>{' '}
            <span className="text-slate-500">(فحص مسار فقط)</span>
          </li>
          <li>
            <span className="text-slate-500">وقت القياس:</span>{' '}
            <span className={overviewAge.skewed ? 'text-amber-300' : 'text-slate-200'} title={overviewAge.title}>
              {overviewAge.label}
            </span>
            <span className="text-slate-500"> (</span>
            <span className="break-all" dir="ltr">{overview.lastProbedAt}</span>
            <span className="text-slate-500">)</span>
          </li>
          <li>
            <span className="text-slate-500">تجاوزات البيئة الفعّالة:</span>{' '}
            {activeEnvKeys.length > 0 ? (
              activeEnvKeys.map(([key, value], idx) => (
                <span key={key} className="text-slate-200 break-all" dir="ltr">
                  {idx > 0 ? ' • ' : ''}
                  {key}={value}
                </span>
              ))
            ) : (
              <span className="text-slate-200">لا شيء — يُستخدم الجذر الافتراضي</span>
            )}
          </li>
        </ul>
        <p className="text-slate-400 leading-relaxed border-t border-amber-800/40 pt-2">
          لا يُصنَّف أي مدخل كـ «متصل» في هذا الإصدار، لأن تنفيذ المصافحة غير مُفعَّل. الحالة
          «غير قابل للتحقق» ليست حالة مُختارة افتراضياً، بل نتيجة قياس صادق: فحص وجود المسار
          على القرص ينجح، والوصول غير مُختبَر.
        </p>
      </div>

      {/* Sub Filter Tabs */}
      <div className="flex items-center gap-2 pb-1 border-b border-slate-800 text-xs font-mono">
        <button
          onClick={() => setSelectedSubTab('all')}
          className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
            selectedSubTab === 'all'
              ? 'bg-slate-800 text-white font-bold border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          كافة الخوادم المكتشفة ({mcpList.length + lspList.length})
        </button>
        <button
          onClick={() => setSelectedSubTab('mcp')}
          className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
            selectedSubTab === 'mcp'
              ? 'bg-cyan-950/80 text-cyan-300 font-bold border border-cyan-700/60'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Box className="w-3.5 h-3.5" aria-hidden="true" />
          {/* Count comes from the measured payload, not from a hardcoded "6". */}
          <span>خوادم الـ MCP المكتشفة ({mcpList.length} من {overview.mcpSummary.expectedCount})</span>
        </button>
        <button
          onClick={() => setSelectedSubTab('lsp')}
          className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
            selectedSubTab === 'lsp'
              ? 'bg-indigo-950/80 text-indigo-300 font-bold border border-indigo-700/60'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>خوادم الـ LSP المكتشفة ({lspList.length} من {overview.lspSummary.expectedCount})</span>
        </button>
      </div>

      {/* Section 1: Model Context Protocol (MCP) Servers */}
      {(selectedSubTab === 'all' || selectedSubTab === 'mcp') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold font-sans text-cyan-400 flex items-center gap-2">
              <Box className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              خوادم بروتوكول سياق النماذج (Model Context Protocol Servers)
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              بروتوكول JSON-RPC 2.0 القياسي للأدوات والموارد
            </span>
          </div>

          {mcpHasGap && mcpList.length > 0 && (
            <DiscoveryGapBanner
              title="فجوة في جرد خوادم MCP"
              total={overview.mcpSummary.total}
              expectedCount={overview.mcpSummary.expectedCount}
              discovered={overview.mcpSummary.discovered}
              discoveryFailed={overview.mcpSummary.discoveryFailed}
              discoveryReason={overview.mcpSummary.discoveryReason}
              missing={mcpMissing}
            />
          )}

          {mcpList.length === 0 && (
            <EmptyInventoryNotice
              title="لم يُكتشف أي خادم MCP"
              total={overview.mcpSummary.total}
              expectedCount={overview.mcpSummary.expectedCount}
              discovered={overview.mcpSummary.discovered}
              discoveryReason={overview.mcpSummary.discoveryReason}
              missing={mcpMissing}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {mcpList.map((srv) => {
              const normalized = normalizeVerdict(srv.status);
              return (
              <div
                key={srv.id}
                className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/50 transition flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-white font-bold text-sm flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
                        <span className="truncate">{srv.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-400/80 block mt-0.5 break-all">
                        ID: {srv.id} • v{srv.version}
                      </span>
                    </div>

                    <VerdictBadge normalized={normalized} />
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 mb-3">
                    {srv.description}
                  </p>

                  <div className="text-[11px] font-mono text-slate-500 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 mb-2 truncate" title={srv.fullPath}>
                    <span className="text-slate-400">المسار: </span>
                    <span dir="ltr">{srv.entry}</span>
                  </div>

                  {/* Core honesty row: what was measured, when, and the full evidence. */}
                  <ProbeEvidence
                    subject={srv.name}
                    normalized={normalized}
                    measurement={srv.measurement}
                    reasonCode={srv.verdictReason}
                    reasonText={srv.verdictReasonText}
                    reachabilityVerified={srv.reachabilityVerified}
                    probeMethod={srv.probeMethod}
                    lastProbedAt={srv.lastProbedAt}
                    nowMs={nowMs}
                    extraRows={[
                      { label: 'الملف موجود على القرص:', value: srv.existsOnDisk ? 'نعم' : 'لا', ltr: false },
                      { label: 'isHealthy (مشتق من مصافحة حقيقية):', value: String(srv.isHealthy), ltr: false },
                      { label: 'المسار الكامل:', value: srv.fullPath }
                    ]}
                  />

                  {srv.tools && srv.tools.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono text-slate-400">الأدوات البرمجية المعلن عنها:</div>
                      <div className="flex flex-wrap gap-1">
                        {srv.tools.slice(0, 4).map((t, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-800/40 px-1.5 py-0.5 rounded"
                          >
                            {t}
                          </span>
                        ))}
                        {srv.tools.length > 4 && (
                          <span className="text-[10px] font-mono text-slate-500 px-1">
                            +{srv.tools.length - 4} المزيد
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleTestMcp(srv.id)}
                    aria-label={`استعلام عام عن حالة MCP — لا يخص ${srv.name} تحديداً`}
                    title="هذا الزر لا يفحص هذا الخادم: الاستعلام عن حالة بوابة MCP السيادية فقط، ولا يُثبت وصول هذا المدخل."
                    className="text-[11px] font-mono px-2.5 py-1 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/50 rounded transition cursor-pointer flex items-center gap-1"
                  >
                    <span>استعلام عام عن MCP</span>
                    <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  </button>

                  {testResult[srv.id] && (
                    <span className="text-[10px] font-mono text-slate-300 truncate max-w-[220px]" title={testResult[srv.id]}>
                      {testResult[srv.id]}
                    </span>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 2: Language Server Protocol (LSP) Servers */}
      {(selectedSubTab === 'all' || selectedSubTab === 'lsp') && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold font-sans text-indigo-400 flex items-center gap-2">
              <Code2 className="w-4 h-4 text-indigo-400" aria-hidden="true" />
              خوادم بروتوكول لغات البرمجة (Language Server Protocol)
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              ذكاء الكود، التشخيص التلقائي والتحليل السكوني الموحد
            </span>
          </div>

          {lspHasGap && lspList.length > 0 && (
            <DiscoveryGapBanner
              title="فجوة في جرد خوادم LSP"
              total={overview.lspSummary.total}
              expectedCount={overview.lspSummary.expectedCount}
              discovered={overview.lspSummary.discovered}
              discoveryFailed={overview.lspSummary.discoveryFailed}
              discoveryReason={overview.lspSummary.discoveryReason}
              missing={lspMissing}
            />
          )}

          {lspList.length === 0 && (
            <EmptyInventoryNotice
              title="لم يُكتشف أي خادم LSP"
              total={overview.lspSummary.total}
              expectedCount={overview.lspSummary.expectedCount}
              discovered={overview.lspSummary.discovered}
              discoveryReason={overview.lspSummary.discoveryReason}
              missing={lspMissing}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {lspList.map((srv) => {
              const normalized = normalizeVerdict(srv.status);
              return (
              <div
                key={srv.id}
                className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 transition flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-white font-bold text-sm flex items-center gap-1.5">
                        <FileCode className="w-3.5 h-3.5 text-indigo-400 shrink-0" aria-hidden="true" />
                        <span className="truncate">{srv.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-indigo-400/80 block mt-0.5 break-all">
                        اللغة: {srv.language} • v{srv.version}
                      </span>
                    </div>

                    <VerdictBadge normalized={normalized} />
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 mb-3">
                    {srv.description}
                  </p>

                  <div className="text-[11px] font-mono text-slate-500 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 truncate" title={srv.fullPath || srv.source || srv.note}>
                    <span className="text-slate-400">نقطة الدخول: </span>
                    <span dir="ltr">{srv.entry || srv.source || srv.note || 'System Package'}</span>
                  </div>

                  <ProbeEvidence
                    subject={srv.name}
                    normalized={normalized}
                    measurement={srv.measurement}
                    reasonCode={srv.verdictReason}
                    reasonText={srv.verdictReasonText}
                    reachabilityVerified={srv.reachabilityVerified}
                    probeMethod={srv.probeMethod}
                    lastProbedAt={srv.lastProbedAt}
                    nowMs={nowMs}
                    extraRows={[
                      { label: 'ما قِيِس فعلاً باسم فحص الصحة:', value: HEALTH_CHECK_LABEL[srv.healthCheck], ltr: false },
                      {
                        label: 'الأصل موجود على القرص:',
                        value:
                          srv.assetExistsOnDisk === null
                            ? 'لم يُفحص (غير معلوم)'
                            : srv.assetExistsOnDisk
                              ? 'نعم'
                              : 'لا',
                        ltr: false
                      },
                      { label: 'isHealthy:', value: String(srv.isHealthy), ltr: false },
                      { label: 'مصدر مُعلَن:', value: srv.source ?? 'غير مُعلَن في البيان' }
                    ]}
                  />
                </div>

                {/* Replaces the previous unconditional «جاهز للاستدعاء عبر المحررات»
                    with a green check, which asserted a readiness that was never
                    probed. The declaration of a package manager is now shown as
                    exactly that — a declaration. */}
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400 gap-2">
                  <span className="flex items-start gap-1 text-amber-300">
                    <CircleQuestionMark className="w-3 h-3 mt-px shrink-0" aria-hidden="true" />
                    <span>لم يُختبر استدعاؤه عبر المحررات — لا فحص LSP منفَّذ.</span>
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {srv.source ? 'مصدر معلَن (غير مُختبَر)' : 'بلا مصدر معلَن'}
                  </span>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}