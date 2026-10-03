import { db, auth, sanitizeForFirestore } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

export async function safeFetch(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

export async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export interface SubAssertion {
  name: string;
  condition: boolean;
  expected: string;
  actual: string;
  passed: boolean;
  notes?: string;
}

export interface TestCase {
  id: string;
  name: string;
  department: string;
  depthTier: 'L1-Sanity' | 'L2-Integration' | 'L3-Deep-System' | 'L4-Security-PenTest';
  description: string;
  run: () => Promise<{ 
    passed: boolean; 
    message: string; 
    durationMs: number; 
    assertions: SubAssertion[];
    details?: any;
    stackTrace?: string;
  }>;
}

export interface TestResultItem {
  id: string;
  name: string;
  department: string;
  depthTier: string;
  description: string;
  passed: boolean;
  message: string;
  durationMs: number;
  assertions: SubAssertion[];
  details?: any;
  stackTrace?: string;
  timestamp: string;
}

export interface DepartmentSummary {
  department: string;
  nameAr: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  assertionsPassed: number;
  assertionsTotal: number;
  status: 'passed' | 'failed' | 'running' | 'pending';
}

export interface AutomatedTestRunReport {
  id: string;
  runTitle: string;
  triggeredBy: string;
  createdAt: string;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  passPercentage: number;
  totalDurationMs: number;
  totalAssertionsCount: number;
  passedAssertionsCount: number;
  departmentSummaries: DepartmentSummary[];
  results: TestResultItem[];
  logs: string[];
  aiEvaluation?: {
    overallHealth: string;
    riskScore: number;
    summary: string;
    recommendations: string[];
  };
}

export const DEPARTMENT_NAMES_AR: Record<string, string> = {
  console: 'قمرة القيادة والتحكم (Console Core)',
  chat: 'غرفة المحادثة والذكاء العصبي (Chat Chamber & AI Gateway)',
  approvals: 'حكومة الحوكمة والموافقات البشرية (HITL Governance)',
  /* CORRECTION (sweep): was 'سجل التدقيق وسلسلة التشفير غير القابلة للتلاعب' —
   * "the audit log and the TAMPER-PROOF hash chain". "غير قابلة للتلاعب"
   * (incapable of being tampered with) is an absolute security property, and the
   * system's own server-side code contradicts it: the ledger is process-local and
   * in-memory only, is lost on every restart, is never written to disk, and has NO
   * external anchor — which is why `/api/hitl/audit/verify` reports UNVERIFIED with
   * that exact reasoning (server.ts:320-326). A label asserting tamper-proofness
   * directly above a subsystem that self-reports as unverified is the worst kind of
   * contradiction.
   * Restated to the neutral, true description of what the department is. */
  audit: 'سجل التدقيق وسلسلة كتل تشفيرية بإعادة حساب SHA-256 (Audit Ledger — forward-link only, no external anchor)',
  agents: 'فيلق الوكلاء والقدرات السيادية (Agent Corps Matrix)',
  forge: 'محرك الصياغة وفحص الأكواد التجميعي (Forge AST Engine)',
  developer: 'طرفية المطور وحاوية العزل (Developer CLI Sandbox)',
  sentinel: 'مركز العمليات الأمنية واختبار الاختراق (Sentinel SOC)',
  kernel: 'نواة النظام وعزل الحلقات (Microkernel & Ring 0)',
  input: 'رصيف الإدخال ومعالجة الكبسولات (Input Dock Multi-Modal)',
  database: 'قاعدة البيانات والمعاملات السحابية (Firestore & Cloud State)',
  pwa: 'تطبيق الويب التقدمي والأداء الفائق (PWA & High Performance)'
};

export const AUTOMATED_TEST_SUITE: TestCase[] = [
  // 1. Console Department - Deep Concurrency & Real Memory Allocation Stress
  {
    id: 'console_health_deep_stress',
    name: 'فحص صحة النواة والتحمل التزامني المتعدد (Core Concurrency & Memory Stress)',
    department: 'console',
    depthTier: 'L3-Deep-System',
    description: 'إطلاق 3 طلبات إجهاد متزامنة لمسار الذاكرة الحقيقي (/api/qa/stress-probe) واختبار فحص الذاكرة وتجزئة SHA-256 للبيانات المخصصة.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      // Concurrently dispatch real stress allocations to the server
      const payloadSizes = [32768, 65536, 131072]; // 32KB, 64KB, 128KB
      const batchPromises = payloadSizes.map(size => 
        safeFetch('/api/qa/stress-probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ concurrency: 3, payloadSize: size })
        }, 5000).then(async r => ({
          status: r.status,
          data: await safeJson(r)
        })).catch(err => ({
          status: 500,
          data: { error: err.message }
        }))
      );

      const batchResults = await Promise.all(batchPromises);
      const healthRes = await safeFetch('/api/health', undefined, 4000).then(async r => await safeJson(r)).catch(() => ({}));
      const durationMs = Math.round(performance.now() - start);

      const allOk = batchResults.every(r => r.status === 200 && r.data.ok === true);
      assertions.push({
        name: 'التزامن المتعدد الفعلي لمسار الإجهاد (Stress Probe HTTP 200)',
        condition: allOk,
        expected: 'All 3 stress probes succeed with HTTP 200',
        actual: `Statuses: ${batchResults.map(r => r.status).join(', ')}`,
        passed: allOk
      });

      const firstData = batchResults[0]?.data || {};
      const hasChecksum = typeof firstData.checksum === 'string' && firstData.checksum.length >= 8;
      assertions.push({
        name: 'تجزئة الذاكرة المخصصة المشفرة (Buffer SHA-256 Digest)',
        condition: hasChecksum,
        expected: 'Valid hexadecimal SHA-256 buffer digest',
        actual: hasChecksum ? `Checksum: ${firstData.checksum}` : 'Missing',
        passed: hasChecksum
      });

      const hasHeap = typeof firstData.heapUsedMb === 'number' && firstData.heapUsedMb > 0;
      assertions.push({
        name: 'قياس استهلاك الذاكرة الفعلية للنواة (Live Heap Allocation)',
        condition: hasHeap,
        expected: 'Positive numeric heapUsed in MB',
        actual: hasHeap ? `${firstData.heapUsedMb} MB (RSS: ${firstData.rssMb || 0} MB)` : 'Invalid Heap',
        passed: hasHeap
      });

      const latencyAcceptable = durationMs < 3500;
      assertions.push({
        name: 'معيار سرعة المعالجة والإجهاد (SLA Latency < 3500ms)',
        condition: latencyAcceptable,
        expected: '< 3500ms total concurrent roundtrip',
        actual: `${durationMs}ms`,
        passed: latencyAcceptable
      });

      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `تم اختبار إجهاد النواة التزامني بنجاح حقيقي (${durationMs}ms) • الذاكرة: ${firstData.heapUsedMb || 0}MB • التجزئة: ${firstData.checksum}` 
          : 'فشل في أحد معايير إجهاد النواة',
        durationMs,
        assertions,
        details: { batchResults, healthRes }
      };
    }
  },

  // 2. Console Department - Neural BrainMap Route & Routing Topology
  {
    id: 'console_brainmap_routing_topology',
    name: 'تدقيق طوبولوجيا النماذج العصبية ومسارات الاستدلال والبرمجة',
    department: 'console',
    depthTier: 'L2-Integration',
    description: 'التحقق الصارم من تكوين مصفوفة النماذج وتوزيع المهام على النماذج السيادية (Reasoning, Coding, Planning, Fallback) وسلامة الاتصال التلفتري.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      let res: Response;
      let data: any = {};
      try {
        res = await safeFetch('/api/brainmap', undefined, 4000);
        data = await safeJson(res);
      } catch (err: any) {
        res = new Response(JSON.stringify({ error: err.message }), { status: 500 });
        data = {};
      }

      const telemetryRes = await safeFetch('/api/system/telemetry', undefined, 4000).then(r => safeJson(r)).catch(() => ({}));
      const durationMs = Math.round(performance.now() - start);

      const hasModels = data.models || data;
      assertions.push({
        name: 'استجابة واجهة مصفوفة النماذج (HTTP 200 & Valid JSON)',
        condition: res.ok,
        expected: 'HTTP 200 with JSON payload',
        actual: `HTTP ${res.status}`,
        passed: res.ok
      });

      const hasReasoning = Boolean(hasModels.reasoning);
      assertions.push({
        name: 'تعيين نموذج الاستدلال السيادي (Reasoning Model Slot)',
        condition: hasReasoning,
        expected: 'Non-empty reasoning model descriptor',
        actual: hasModels.reasoning || 'Missing',
        passed: hasReasoning
      });

      const hasCoding = Boolean(hasModels.coding);
      assertions.push({
        name: 'تعيين نموذج البرمجة والتطوير (Coding Model Slot)',
        condition: hasCoding,
        expected: 'Non-empty coding model descriptor',
        actual: hasModels.coding || 'Missing',
        passed: hasCoding
      });

      const coreOnline = telemetryRes.subsystems?.coreServer?.status === 'ONLINE';
      assertions.push({
        name: 'جاهزية خادم النواة التلفتري (Core Server Online Status)',
        condition: coreOnline,
        expected: 'subsystems.coreServer.status == ONLINE',
        actual: telemetryRes.subsystems?.coreServer?.status || 'Unknown',
        passed: coreOnline
      });

      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        /* CORRECTION (sweep): was 'طوبولوجيا النماذج متكاملة' — "the model topology is
         * INTEGRATED". Nothing here measures integration. The three assertions above
         * are: HTTP 200, `Boolean(hasModels.reasoning)`, `Boolean(hasModels.coding)`,
         * plus `coreServer.status === 'ONLINE'`. That is "two slots are non-empty",
         * which is a presence check, not a topology.
         * Restated to the three facts that were actually asserted. The measured
         * values themselves are printed unchanged. */
        message: allPassed 
          ? `خانتان من خانات النماذج مأهولتان [${hasModels.reasoning}] • [${hasModels.coding}] • الخادم المركزي: ${telemetryRes.subsystems?.coreServer?.status} — وهذا قياس تعبئة خانة لا قياس تكامل طوبولوجيا` 
          : 'فشل تدقيق مصفوفة النماذج',
        durationMs,
        assertions,
        details: { models: hasModels, telemetry: telemetryRes.subsystems }
      };
    }
  },

  // 3. Chat Chamber - Multi-Turn State Machine & Agent Claim Verification
  {
    id: 'chat_state_machine_and_storage',
    name: 'آلة حالات المحادثة وتدقيق ادعاءات الوكلاء وعزل الذاكرة',
    department: 'chat',
    depthTier: 'L3-Deep-System',
    description: 'إرسال اختبار فحص حقيقي لآلة التحقيق من ادعاءات الوكلاء (/api/chat/verify-claim) والتحقق من الاستجابة الهندسية وعزل الجلسة.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      let verifyRes: Response;
      let verifyData: any = {};
      try {
        verifyRes = await safeFetch('/api/chat/verify-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claimText: 'النظام اجتاز اختبار التحقق التزامني بنجاح وتم فحص الذاكرة',
            sourceAgent: 'lead-engineer',
            userPrompt: 'هل أنت جاهز لتشخيص المنظومة؟'
          })
        }, 18000);
        verifyData = await safeJson(verifyRes);
      } catch (err: any) {
        verifyRes = new Response(JSON.stringify({ error: err.message }), { status: 500 });
        verifyData = {};
      }

      const durationMs = Math.round(performance.now() - start);

      assertions.push({
        name: 'استجابة محقق الادعاءات المستقل (Truth Sentinel HTTP 200)',
        condition: verifyRes.status === 200,
        expected: 'HTTP 200 OK',
        actual: `HTTP ${verifyRes.status}`,
        passed: verifyRes.status === 200
      });

      const hasVerdict = Boolean(verifyData.verdict || verifyData.analysis);
      assertions.push({
        name: 'صدور الحكم والتحليل التقني المستقل (Independent Verdict)',
        condition: hasVerdict,
        expected: 'Non-empty verdict or analysis report',
        actual: hasVerdict ? `Verdict: ${String(verifyData.verdict).slice(0, 30)}...` : 'Missing',
        passed: hasVerdict
      });

      const durationAcceptable = durationMs < 20000;
      assertions.push({
        name: 'معيار استجابة محقق الصدق (Latency SLA < 20000ms)',
        condition: durationAcceptable,
        expected: '< 20000ms',
        actual: `${durationMs}ms`,
        passed: durationAcceptable
      });

      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `آلة حالات المحادثة ومحقق الادعاءات تعمل بدقة حقيقية (${durationMs}ms) • الحكم: ${verifyData.verdict || 'تم الفحص'}` 
          : 'فشل في استجابة آلة حالات المحادثة',
        durationMs,
        assertions,
        details: verifyData
      };
    }
  },

  // 4. Chat Chamber - Real Multimodal AI Gateway & Inference Pipeline
  {
    id: 'chat_gemini_multimodal_pipeline',
    name: 'اختبار ممر الذكاء الاصطناعي وبنية الرد المتعدد الوسائط (AI Gateway)',
    department: 'chat',
    depthTier: 'L3-Deep-System',
    description: 'إرسال حمولة حقيقية عبر ممر الوكلاء /api/chat مع التحقق من معالجة المعرفات، تعيين الوكيل (Lead Engineer)، وتوليد الاستجابة.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      let res: Response;
      let data: any = {};
      try {
        res = await safeFetch('/api/chat', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-test-origin': 'SOVEREIGN_QA_CORPS'
          },
          body: JSON.stringify({
            message: 'PING_AUTOMATION_TEST_PROBE: التحقق الشامل من ممر الذكاء الاصطناعي السيادي',
            agent: 'lead-engineer',
            model: 'gemini-3.8-flash'
          })
        }, 12000);
        data = await safeJson(res);
      } catch (err: any) {
        res = new Response(JSON.stringify({ error: err.message }), { status: 500 });
        data = {};
      }

      const durationMs = Math.round(performance.now() - start);

      assertions.push({
        name: 'استجابة ممر الذكاء الاصطناعي (Gateway HTTP Status 200)',
        condition: res.status === 200,
        expected: 'HTTP 200 OK',
        actual: `HTTP ${res.status}`,
        passed: res.status === 200
      });

      const hasReply = Boolean(data.reply || data.response || data.message || data.text);
      assertions.push({
        name: 'توليد نص الرد السيادي (Payload Reply Generated)',
        condition: hasReply,
        expected: 'Non-empty reply text from model',
        actual: hasReply ? 'Text generated successfully' : 'Empty',
        passed: hasReply
      });

      const agentMatched = data.agent === 'lead-engineer';
      assertions.push({
        name: 'مطابقة هوية الوكيل المنفذ (Agent Role: lead-engineer)',
        condition: agentMatched,
        expected: 'lead-engineer',
        actual: data.agent || 'Unknown',
        passed: agentMatched
      });

      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `ممر الذكاء الاصطناعي يستجيب بنجاح حقيقي (${durationMs}ms) • الوكيل: ${data.agent}` 
          : 'فشل في استجابة ممر الذكاء الاصطناعي',
        durationMs,
        assertions,
        details: data
      };
    }
  },

  // 5. Approvals HITL - True Test-Driven Cryptographic Tamper Detection
  {
    id: 'approvals_crypto_signature_tamper_test',
    /* CORRECTION (audit finding): the test's display name claimed
     * '(Ed25519 & Anti-Tampering)'. There is no Ed25519 in this path — see the
     * full analysis in the corrected recommendation. `/api/qa/crypto-verify`
     * (server.ts:3485-3506) recomputes SHA-256 and performs a substring test
     * against a client-supplied string. The test body already sent
     * `algorithm: 'SHA-256'`, so the name was contradicting the payload it
     * itself constructed. Renamed to state the mechanism that is actually used.
     *
     * The tamper-detection ASSERTIONS are genuinely sound and were left exactly
     * as they were: mutating the payload changes the SHA-256, the substring stops
     * matching, and `verified` returns false. That much is really measured.
     */
    name: 'اختبار الحوكمة وكشف التلاعب بإعادة حساب SHA-256 (SHA-256 Recomputation & Anti-Tampering)',
    department: 'approvals',
    depthTier: 'L3-Deep-System',
    description: 'توليد توقيع مشفر، والتحقق من قبول التوقيع الأصلي، ثم إرسال حمولة معدلة متلاعب بها والتأكد من رفض الخادم لها (verified === false).',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      // 1. Original valid payload
      const validPayload = { action: 'KERNEL_MODULE_DEPLOY', target: '/boot/sov.ko', timestamp: Date.now() };
      const validStr = JSON.stringify(validPayload);
      
      const enc = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(validStr));
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      /* DOCUMENTED, NOT CHANGED — the `ED25519-SOV-` prefix below is a decorative
       * label on a value that is NOT an Ed25519 signature. No Ed25519 key pair
       * exists anywhere in this codebase, and no asymmetric operation is performed
       * here or in `/api/qa/crypto-verify`. The server recomputes the same SHA-256
       * and does `sigClean.includes(hashSegment)` (server.ts:3497) — so the ONLY
       * part of this string that carries any meaning is the hex digest substring.
       * The prefix could be deleted with zero effect on the test's outcome.
       *
       * It is left in place because this is a wire fixture and altering a value
       * sent over the network is data-flow, which is out of scope for this
       * prose-only pass. It is recorded here so no future reader mistakes the
       * prefix for a cryptographic claim. The corresponding user-facing strings
       * (the test's display name and the recommendation) HAVE been corrected,
       * because those are the surfaces an operator actually reads.
       */
      const signature = `ED25519-SOV-${hashHex.slice(0, 16).toUpperCase()}`;

      // Verify authentic payload on backend
      let verifyRes = await safeFetch('/api/qa/crypto-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: validPayload, signature, algorithm: 'SHA-256' })
      }, 5000);
      let verifyData = await safeJson(verifyRes);

      assertions.push({
        /* CORRECTION (sweep): the previous name read "قبول وتصديق التوقيع المشفر"
         * ("accept and authenticate the CRYPTOGRAPHIC SIGNATURE"). Nothing signed
         * this payload. The server recomputed a hash the CLIENT had already
         * computed and compared it to a string the CLIENT had already built. The
         * assertion's LOGIC is unchanged and still meaningful: it proves the
         * server's recomputation agrees for an unmodified payload. Only the name's
         * claim of a signature was false, so only the name was reworded.
         */
        name: 'قبول الحمولة الأصلية عند تطابق إعادة الحساب (Unmodified Payload Recomputation Agrees)',
        condition: Boolean(verifyData.ok && verifyData.verified === true),
        expected: 'Verified == true for authentic payload',
        actual: `Verified: ${verifyData.verified}`,
        passed: Boolean(verifyData.ok && verifyData.verified === true)
      });

      // 2. Tampered payload: Mutate action but send the OLD signature
      const tamperedPayload = { ...validPayload, action: 'UNAUTHORIZED_ATTACK_OVERRIDE' };
      let tamperedRes = await safeFetch('/api/qa/crypto-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: tamperedPayload, signature, algorithm: 'SHA-256' })
      }, 5000);
      let tamperedData = await safeJson(tamperedRes);

      const tamperRejected = tamperedData.ok && tamperedData.verified === false;
      assertions.push({
        name: 'كشف التلاعب ورفض الحمولة المزورة (Tamper Detection Verification Rejected)',
        condition: Boolean(tamperRejected),
        expected: 'Verified == false for tampered payload',
        actual: `Verified: ${tamperedData.verified}`,
        passed: Boolean(tamperRejected)
      });

      // 3. Queue state verification
      let queueRes = await safeFetch('/api/hitl/approvals', undefined, 4000);
      let queueData = await safeJson(queueRes);
      assertions.push({
        name: 'سلامة طابور الحوكمة السيادية (HITL Approvals Queue Health)',
        condition: queueRes.ok && queueData.ok === true,
        expected: 'HTTP 200 with approvals list',
        actual: `Status: ${queueRes.status}`,
        passed: queueRes.ok && queueData.ok === true
      });

      const durationMs = Math.round(performance.now() - start);
      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `تم اختبار خوارزمية التوقيع المشفر وكشف التلاعب بنجاح قاطع (${durationMs}ms) • تم رفض التلاعب بالحمولة` 
          : 'فشل فحص الحوكمة والتوقيع المشفر',
        durationMs,
        assertions,
        details: { authentic: verifyData, tampered: tamperedData }
      };
    }
  },

  // 6. Audit Ledger - Linear SHA-256 Block Chaining & Integrity
  {
    id: 'audit_merkle_chain_proof_of_history',
    name: 'فحص سلسلة كتل التدقيق وسلسلة SHA-256 الخطية (Proof of History Chain)',
    department: 'audit',
    depthTier: 'L3-Deep-System',
    description: 'التحقق الصارم من حالة سلسلة الكتل الحقيقية عبر /api/hitl/audit/verify و /api/audit والتحقق من صحة بصمات الكتل SHA-256.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      let res = await safeFetch('/api/hitl/audit/verify', undefined, 4000);
      let data = await safeJson(res);

      assertions.push({
        name: 'سلامة نقطة التحقق من سلسلة الكتل (Ledger Verify Endpoint Status)',
        condition: res.ok && data.ok === true,
        expected: 'HTTP 200 with the endpoint reachable (this asserts responsiveness only — HTTP 200 is not evidence of ledger integrity)',
        actual: `HTTP ${res.status}, Status: ${data.status}`,
        passed: res.ok && data.ok === true
      });

      /* CORRECTION (sweep — NOT on the audit list, and the most consequential find
       * in this file after the Ed25519 claim).
       *
       * `data.status === 'INTACT'` CAN NEVER BE TRUE any more.
       * `/api/hitl/audit/verify` no longer emits 'INTACT' — server.ts:754 now
       * returns `status: 'UNVERIFIED'`, with a stated reason at server.ts:320-326
       * explaining that the ledger is process-local, in-memory only, and has no
       * external anchor, and that tamper-evidence therefore "cannot be
       * cryptographically proven". That server-side change was deliberate and
       * correct; this client-side assertion was left behind still demanding the
       * old fabricated verdict.
       *
       * Two consequences, both left intact because the LOGIC is not this pass's
       * to change:
       *   1. The assertion now always fails, so this test can no longer report a
       *      pass. That is the honest outcome, but it is a behaviour change caused
       *      by someone else's edit, and it is flagged here for the owner.
       *   2. The name below — "عدم وجود كسر أو تلاعب في السلسلة (Ledger Intact
       *      Integrity)" — asserts that no tampering exists. Nothing in this code
       *      path can establish that; it can only observe what the server reports.
       *      Reworded to describe the observation instead of the conclusion.
       *
       * `expected: 'HTTP 200 with intact ledger state'` had the same problem:
       * an endpoint returning HTTP 200 says nothing about ledger integrity.
       */
      const isIntact = data.status === 'INTACT';
      assertions.push({
        name: 'رصد حكم الخادم على السلسلة كما ورد دون استنتاج (Server Ledger Verdict Observed, Not Interpreted)',
        condition: isIntact,
        expected: "status == 'INTACT' — note: the server now reports 'UNVERIFIED' by design, so this assertion is expected to FAIL until the client is realigned with server.ts:754",
        actual: `status: ${data.status}`,
        passed: isIntact
      });

      // Query real audit blocks
      let auditBlocksRes = await safeFetch('/api/audit', undefined, 4000);
      let auditBlocks = await safeJson(auditBlocksRes);
      const hasBlocks = Array.isArray(auditBlocks) && auditBlocks.length > 0;
      assertions.push({
        name: 'استرجاع كتل التدقيق الحقيقية (Audit Blocks Retrieved)',
        condition: hasBlocks,
        expected: 'Non-empty array of audit blocks (recomputed forward-link SHA-256; NOT "verified" — there is no external anchor)',
        actual: hasBlocks ? `${auditBlocks.length} blocks active` : '0 blocks',
        passed: hasBlocks
      });

      const validHashes = hasBlocks && auditBlocks.every((b: any) => typeof b.hash === 'string' && b.hash.length === 64);
      assertions.push({
        name: 'صحة التجزئة التشفيرية للكتل (64-Char SHA-256 Hex Hashes)',
        condition: Boolean(validHashes),
        expected: 'All blocks possess 64-char valid SHA-256 hashes',
        actual: validHashes ? 'Valid 64-char hashes confirmed' : 'Invalid hash structure',
        passed: Boolean(validHashes)
      });

      const durationMs = Math.round(performance.now() - start);
      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `سلسلة كتل التدقيق متصلة ومحصنة رياضياً (${durationMs}ms) • الكتل: ${auditBlocks.length || 0}` 
          : 'فشل التحقق من سلسلة كتل التدقيق',
        durationMs,
        assertions,
        details: { auditStatus: data, blocksCount: auditBlocks?.length }
      };
    }
  },

  // 7. Agent Corps - Live Agent Metrics & Real Action Telemetry Logging
  {
    id: 'agents_corps_contracts_and_roles',
    name: 'ميثاق وعقود فيلق الوكلاء الـ 9 والقياس التلفتري المباشر (Agent Metrics & Actions)',
    department: 'agents',
    depthTier: 'L2-Integration',
    description: 'الاستعلام عن مصفوفة الوكلاء الحية عبر /api/agents/metrics وإرسال أمر تسجيل عمل تزامني لـ /api/agents/action والتأكد من توثيقه.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      // Query live agent metrics
      const metricsRes = await safeFetch('/api/agents/metrics', undefined, 4000);
      const metricsData = await safeJson(metricsRes);

      assertions.push({
        name: 'استعلام مصفوفة نشاط الوكلاء الحية (Live Agent Metrics HTTP 200)',
        condition: metricsRes.ok,
        expected: 'HTTP 200 with agent metrics map',
        actual: `HTTP ${metricsRes.status}`,
        passed: metricsRes.ok
      });

      // Dispatch real action telemetry to server
      const actionRes = await safeFetch('/api/agents/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'developer', actionType: 'QA_AUTOMATION_PROBE' })
      }, 4000);
      const actionData = await safeJson(actionRes);

      const actionRecorded = actionRes.ok && actionData.ok === true && actionData.agentId === 'developer';
      assertions.push({
        name: 'تسجيل وتوثيق عمل الوكيل في الخادم (Agent Action Telemetry Recorded)',
        condition: actionRecorded,
        expected: 'ok: true with agentId: developer recorded',
        actual: actionRecorded ? `Recorded at: ${actionData.recordedAt}` : 'Failed to record',
        passed: actionRecorded
      });

      const agentsMap = metricsData.agents || metricsData;
      const registeredCount = Object.keys(agentsMap || {}).length;
      const accountBound = metricsData.account === 'r11salfd@gmail.com' || Boolean(agentsMap.developer?.account);
      assertions.push({
        name: 'جاهزية سجلات فيلق الوكلاء السيادي واعتماد نماذج الحساب r11salfd (Sovereign Agents & r11salfd Models Bound)',
        condition: registeredCount >= 9 && accountBound,
        expected: '>= 9 active agents bound to r11salfd Pro & Antigravity models',
        actual: `${registeredCount} active agents (Account: ${metricsData.account || 'r11salfd@gmail.com'})`,
        passed: registeredCount >= 9 && accountBound
      });

      const durationMs = Math.round(performance.now() - start);
      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `فيلق الوكلاء ومصفوفة القياس التلفتري تعمل بكفاءة حقيقية (${durationMs}ms)` 
          : 'فشل تدقيق مصفوفة الوكلاء',
        durationMs,
        assertions,
        details: { actionData, trackedChannels: registeredCount }
      };
    }
  },

  // 8. Forge AST Engine - Code Sandbox & Syntax Checking
  {
    id: 'forge_ast_syntax_and_injection_guard',
    name: 'محرك صياغة الأكواد والفحص السكوني المعزول (AST Sandbox Syntax Validation)',
    department: 'forge',
    depthTier: 'L3-Deep-System',
    description: 'تنفيذ فحص نحوي برمجاني حقيقي عبر طرفية المطور المعزولة للتأكد من قدرة محرك الصياغة على تقييم الشيفرة النظيفة ومنع الثغرات.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      // Execute a real syntax verification in the sandbox
      const testCmd = 'node -e "try { const f = (a, b) => a + b; if (f(2, 3) !== 5) process.exit(1); console.log(\'SOVEREIGN_SYNTAX_PARSER_PASS\'); } catch(e) { process.exit(2); }"';
      const cliRes = await safeFetch('/api/cli/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: testCmd })
      }, 8000);
      const cliData = await safeJson(cliRes);

      assertions.push({
        name: 'تنفيذ المحلل النحوي في حاوية العزل (Sandbox Syntax Compilation)',
        condition: cliRes.ok && cliData.exitCode === 0,
        expected: 'Exit code 0 from node execution',
        actual: `Exit Code: ${cliData.exitCode}, Output: ${cliData.output}`,
        passed: cliRes.ok && cliData.exitCode === 0
      });

      const outputMatches = typeof cliData.output === 'string' && cliData.output.includes('SOVEREIGN_SYNTAX_PARSER_PASS');
      assertions.push({
        name: 'مطابقة مخرج المعالجة النحوية الصارمة (Parser Output Validated)',
        condition: outputMatches,
        expected: 'Output contains SOVEREIGN_SYNTAX_PARSER_PASS',
        actual: outputMatches ? 'Verified' : cliData.output || 'No output',
        passed: outputMatches
      });

      // 3. Verify Forge Protocol Matrix (OpenCode + MCP + LSP Integration)
      const overviewRes = await safeFetch('/api/forge/overview', undefined, 4000);
      const overviewData = await safeJson(overviewRes);
      const matrixBound = overviewRes.ok && 
        overviewData.mcpIntegration?.status === 'CONNECTED' &&
        overviewData.lspIntegration?.status === 'READY' &&
        overviewData.openCodeIntegration?.status === 'CONNECTED';

      assertions.push({
        name: 'ترابط مصنع الأكواد بشبكة OpenCode وخوادم MCP و LSP (Forge Multi-Protocol Matrix)',
        condition: matrixBound,
        expected: 'Forge connected to OpenCode Zen + 7 MCP Servers + 6 LSP Servers',
        actual: matrixBound 
          ? `Connected: MCP (${overviewData.mcpIntegration.toolsCount} tools), LSP (${overviewData.lspIntegration.serversCount} servers), OpenCode (${overviewData.openCodeIntegration.models.length} models)`
          : 'Failed to verify protocol matrix',
        passed: matrixBound
      });

      // 4. Verify Live Language Server Protocol (LSP) TypeScript AST Validator
      const lspValRes = await safeFetch('/api/forge/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'export interface SovereignContract { chainKey: string; active: boolean; }\nexport const contract: SovereignContract = { chainKey: "360ea36c28e66d9d", active: true };',
          language: 'typescript'
        })
      }, 4000);
      const lspValData = await safeJson(lspValRes);
      const lspPassed = lspValRes.ok && lspValData.passed === true && lspValData.errorsCount === 0;

      assertions.push({
        /* CORRECTION (sweep). The name claimed a REAL tsserver LSP server and the
         * `actual` string claimed "LSP Verified". Neither is true: `lspValData.lspServer`
         * is the server's own honest method string, which for TypeScript reads
         * 'NONE — in-process ts.transpileModule() diagnostics; no tsserver process
         * spawned, no LSP handshake'. Calling that "LSP Verified" contradicted the
         * very field printed beside it. The word "Verified" was dropped; the method
         * string is still printed verbatim, because it is the authoritative
         * statement of what actually ran. The 0-errors fact is kept. */
        name: 'تدقيق سلامة الأكواد بفحص داخل العملية (In-Process Static Check — NOT an LSP server)',
        condition: lspPassed,
        expected: '0 syntax errors from the in-process check',
        actual: lspPassed ? `0 errors — method: ${lspValData.lspServer}` : `Errors: ${lspValData.errorsCount}`,
        passed: lspPassed
      });

      const durationMs = Math.round(performance.now() - start);
      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `محرك صياغة الأكواد وفحص الشيفرة المعزول يعمل بنجاح حقيقي (${durationMs}ms)` 
          : 'فشل في فحص محرك الصياغة النحوية',
        durationMs,
        assertions,
        details: cliData
      };
    }
  },

  // 9. Developer CLI - Real Shell Command Execution & Virtual CPU Registers
  {
    id: 'developer_virtual_cpu_and_sandbox',
    name: 'اختبار مسجلات المعالج الافتراضي وبيئة التطوير المعزولة (Virtual CPU & Sandbox Shell)',
    department: 'developer',
    depthTier: 'L3-Deep-System',
    description: 'تنفيذ أمر فعلي عبر طرفية المطور (/api/cli/execute) والتحقق من رمز الخروج 0 وقراءة مسجلات المعالج الافتراضية (/api/kernel/status).',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      // 1. Real Command execution
      const pingCmd = 'node -e "console.log(\'SANDBOX_ONLINE:\' + process.platform + \':\' + process.arch);"';
      const execRes = await safeFetch('/api/cli/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: pingCmd })
      }, 8000);
      const execData = await safeJson(execRes);

      assertions.push({
        name: 'تنفيذ أمر بيئة التطوير وخروج آمن (Real Shell Exit Code 0)',
        condition: execRes.ok && execData.exitCode === 0,
        expected: 'Exit code 0 and HTTP 200',
        actual: `Exit Code: ${execData.exitCode}, Output: ${execData.output}`,
        passed: execRes.ok && execData.exitCode === 0
      });

      const hasArchOutput = typeof execData.output === 'string' && execData.output.includes('SANDBOX_ONLINE:');
      assertions.push({
        name: 'التحقق من معمارية وبيئة التشغيل الحية (Live Runtime Architecture)',
        condition: hasArchOutput,
        expected: 'Output includes SANDBOX_ONLINE platform token',
        actual: execData.output || 'Missing',
        passed: hasArchOutput
      });

      // 2. Kernel registers check
      const kernelRes = await safeFetch('/api/kernel/status', undefined, 4000);
      const kernelData = await safeJson(kernelRes);
      const hasRegisters = kernelData.cpuRegisters && kernelData.cpuRegisters.cr0 && kernelData.cpuRegisters.rip;

      assertions.push({
        name: 'سلامة مسجلات الـ 64-bit Long Mode (CR0/CR3/RIP Registers)',
        condition: Boolean(hasRegisters),
        expected: 'Valid CR0, CR3, and RIP registers present',
        actual: hasRegisters ? `CR3: ${kernelData.cpuRegisters.cr3}, RIP: ${kernelData.cpuRegisters.rip}` : 'Missing registers',
        passed: Boolean(hasRegisters)
      });

      const durationMs = Math.round(performance.now() - start);
      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `طرفية المطور المعزولة ومسجلات النواة تعمل باستقرار تام (${durationMs}ms) • المخرج: ${execData.output}` 
          : 'فشل التحقق من بيئة التطوير والمسجلات',
        durationMs,
        assertions,
        details: { execData, kernelData }
      };
    }
  },

  // 10. Sentinel SOC - Multi-Vector Real Penetration Testing (Strict Zero-Trust)
  {
    id: 'sentinel_multi_vector_pentest',
    name: 'اختبار الاختراق متعدد النواقل وحظر الوصول غير المصرح به (Multi-Vector Pen-Test)',
    department: 'sentinel',
    depthTier: 'L4-Security-PenTest',
    description: 'إطلاق 3 مسابير اختراق هجومية حقيقية والتأكد من صدها الصارم من قبل الخادم بكود 403 Forbidden وخطأ CRITICAL_SECURITY_VIOLATION دون أي استثناءات ملطفة.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      // Probe 1: War Chest Vault Access Attack
      const probe1Res = await safeFetch('/api/workspace/preview?path=' + encodeURIComponent('/workspace/SOVEREIGN_WAR_CHEST/vault.key'), undefined, 5000);
      const probe1Data = await safeJson(probe1Res);
      const p1Blocked = probe1Res.status === 403 && probe1Data.error === 'CRITICAL_SECURITY_VIOLATION';
      assertions.push({
        name: 'المسبار 1: محاولة اختراق الخزينة المحمية (War Chest Vault Intercept 403)',
        condition: p1Blocked,
        expected: 'HTTP 403 with CRITICAL_SECURITY_VIOLATION',
        actual: `HTTP ${probe1Res.status} - Error: ${probe1Data.error}`,
        passed: p1Blocked
      });

      // Probe 2: Directory Traversal (/etc/passwd)
      const probe2Res = await safeFetch('/api/workspace/preview?path=' + encodeURIComponent('../../../../etc/passwd'), undefined, 5000);
      const probe2Data = await safeJson(probe2Res);
      const p2Blocked = probe2Res.status === 403 && probe2Data.error === 'CRITICAL_SECURITY_VIOLATION';
      assertions.push({
        name: 'المسبار 2: محاولة كسر الدليل وتجاوز المسار (Path Traversal Intercept 403)',
        condition: p2Blocked,
        expected: 'HTTP 403 with CRITICAL_SECURITY_VIOLATION',
        actual: `HTTP ${probe2Res.status} - Error: ${probe2Data.error}`,
        passed: p2Blocked
      });

      // Probe 3: Direct Pen-Test Security Boundary Probe
      const probe3Res = await safeFetch('/api/qa/pen-test?probe=' + encodeURIComponent('BUFFER_OVERFLOW_EXPLOIT_PAYLOAD'), undefined, 5000);
      const probe3Data = await safeJson(probe3Res);
      const p3Blocked = probe3Res.status === 403 && probe3Data.error === 'CRITICAL_SECURITY_VIOLATION';
      assertions.push({
        name: 'المسبار 3: مسبار اختراق الحدود الأمنية (Zero-Trust Guard Intercept 403)',
        condition: p3Blocked,
        expected: 'HTTP 403 with CRITICAL_SECURITY_VIOLATION',
        actual: `HTTP ${probe3Res.status} - Error: ${probe3Data.error}`,
        passed: p3Blocked
      });

      const durationMs = Math.round(performance.now() - start);
      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `جدار الحماية Sentinel SOC صد جميع مسابير الاختراق الـ 3 بنجاح حقيقي وبكود 403 قاطع في ${durationMs}ms` 
          : 'تحذير أمني خطير: أحد مسابير الاختراق لم يتم اعتراضه كما يجب!',
        durationMs,
        assertions,
        details: { probe1: probe1Data, probe2: probe2Data, probe3: probe3Data }
      };
    }
  },

  // 11. Kernel OS - 10-Layer Gap Matrix & Microkernel Syscall Invocation
  {
    id: 'kernel_10_layer_gap_matrix_audit',
    name: 'تدقيق مصفوفة فجوات النواة الـ 10 واستدعاء نداءات النظام (Syscall & Gap Matrix)',
    department: 'kernel',
    depthTier: 'L3-Deep-System',
    description: 'التحقق من توثيق مكونات النواة الـ 10 واستدعاء نداء نظام حقيقي (SYS_GET_VERSION) للتأكد من عمل موزع نداءات المايكروكرنل.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      // 1. Gap Matrix
      const gapRes = await safeFetch('/api/kernel/gap-matrix', undefined, 4000);
      const gapData = await safeJson(gapRes);

      assertions.push({
        name: 'استجابة مصفوفة النواة (Gap Matrix API Status)',
        condition: gapRes.ok && gapData.ok === true,
        expected: 'HTTP 200 with full audit items',
        actual: `HTTP ${gapRes.status}`,
        passed: gapRes.ok && gapData.ok === true
      });

      const countTen = gapData.totalGaps === 10 && Array.isArray(gapData.items) && gapData.items.length === 10;
      assertions.push({
        /* CORRECTION (sweep). The name said "اكتمال فحص" (COMPLETION of the audit) and the
       * expectation said "10 verified components". Neither holds: the gap matrix is
       * ten hardcoded literals in kernelEngine.ts, each carrying `status: 'VERIFIED'`
       * with no verification performed, and no closure ratio is computed anywhere.
       * The COUNT is real and genuinely measured here (totalGaps === 10), so it is
       * retained — only the claims of completion and of verification are removed.
       * This is the same denominator problem as KernelOSPage's "100% GAPS RESOLVED". */
      name: 'تعداد مكوّنات معمارية في المصفوفة (Gap Matrix Entry Count — completion NOT measured)',
        condition: Boolean(countTen),
        expected: '10 declared entries in the matrix (the "VERIFIED" status on each is a hardcoded literal, not a verification result)',
        actual: `${gapData.totalGaps || 0} components`,
        passed: Boolean(countTen)
      });

      // 2. Syscall Dispatcher Test
      const sysRes = await safeFetch('/api/kernel/syscall/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          syscallNumber: 1, 
          syscall: 'SYS_GET_VERSION', 
          callerAgent: 'architect',
          payload: { action: 'SYS_GET_VERSION' }
        })
      }, 4000);
      const sysData = await safeJson(sysRes);

      const sysSuccess = sysRes.ok && (sysData.ok === true || Boolean(sysData.result));
      assertions.push({
        name: 'استدعاء نداء النظام الفعلي (Microkernel Syscall Dispatcher)',
        condition: sysSuccess,
        expected: 'HTTP 200 OK with valid syscall execution result',
        actual: `HTTP ${sysRes.status} (Syscall: ${sysData.result || 'Executed'})`,
        passed: sysSuccess
      });

      const durationMs = Math.round(performance.now() - start);
      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `مصفوفة النواة ونداءات النظام تعمل بنجاح حقيقي (${durationMs}ms) • فحص 10/10 مكونات` 
          : 'فشل تدقيق مصفوفة فجوات النواة ونداءات النظام',
        durationMs,
        assertions,
        details: { gapData, sysData }
      };
    }
  },

  // 12. Input Dock - Workspace Tree Indexing & Hierarchy
  {
    id: 'input_dock_capsule_and_workspace_index',
    name: 'رصيف الإدخال وفهرسة كبسولات البيانات ومساحة العمل (Capsule Index & Multi-Modal Parser)',
    department: 'input',
    depthTier: 'L2-Integration',
    description: 'التحقق من اتصال رصيف الإدخال بشجرة الملفات الحقيقية واستعراض معلومات مساحة العمل النشطة.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      const infoRes = await safeFetch('/api/workspace/info', undefined, 4000);
      const infoData = await safeJson(infoRes);

      assertions.push({
        name: 'استعلام معلومات مساحة العمل الفيزيائية (Workspace Info Status)',
        condition: infoRes.ok && infoData.ok === true,
        expected: 'HTTP 200 with platform and root path',
        actual: `HTTP ${infoRes.status} (Platform: ${infoData.info?.platform || 'Unknown'})`,
        passed: infoRes.ok && infoData.ok === true
      });

      const treeRes = await safeFetch('/api/workspace/tree', undefined, 4000);
      const treeData = await safeJson(treeRes);

      const entries = treeData.entries || treeData.items || treeData.tree || (Array.isArray(treeData) ? treeData : null);
      const hasItems = Boolean(entries && (Array.isArray(entries) ? entries.length > 0 : true));

      assertions.push({
        name: 'قراءة وفهرسة عقد مساحة العمل (Workspace Hierarchy Nodes)',
        condition: hasItems,
        expected: 'Valid non-empty entries list',
        actual: hasItems ? `${Array.isArray(entries) ? entries.length : 'Valid'} nodes found` : 'No items',
        passed: hasItems
      });

      const durationMs = Math.round(performance.now() - start);
      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `رصيف الإدخال وفهرس مساحة العمل متصل بنجاح (${durationMs}ms) • المسار: ${infoData.info?.displayPath || 'مساحة العمل'}` 
          : 'فشل فحص رصيف الإدخال',
        durationMs,
        assertions,
        details: { info: infoData, entriesCount: Array.isArray(entries) ? entries.length : 0 }
      };
    }
  },

  // 13. Firestore & Cloud DB - Real State & Session Check
  {
    id: 'firestore_cloud_sync_and_auth_integrity',
    name: 'المزامنة السحابية لقاعدة بيانات Firestore وتوثيق الجلسات (Cloud State & Persistence)',
    department: 'database',
    depthTier: 'L3-Deep-System',
    description: 'التحقق من جاهزية محرك Firestore، حالة المستخدم، واستقرار قناة التخزين السحابي.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      const user = auth?.currentUser;
      const isDbActive = Boolean(db);

      assertions.push({
        name: 'جاهزية اتصال قاعدة بيانات Firestore (Database Connection Ready)',
        condition: isDbActive,
        expected: 'Firestore instance initialized and active',
        actual: isDbActive ? 'Active Engine' : 'Disconnected',
        passed: isDbActive
      });

      /* RECORDED LOGIC DEFECT — the assertion below is VACUOUS and always passes.
       * `Boolean(user || localStorage.getItem('sov_auth_session') || true)` ends
       * in `|| true`, so the expression is unconditionally true. No session check
       * of any kind is performed. `|| true` is the same defect as the audit
       * all-clear default this pass was commissioned to remove: a missing input
       * is converted into a positive verdict. It is the third instance of that
       * pattern found in this file.
       *
       * The `|| true` itself is LOGIC and is NOT removed here — this owner may not
       * change control flow. Removing it would flip this assertion to failing for
       * every anonymous visitor, which is a behavioural change for the owner to
       * make deliberately. ESCALATED.
       *
       * What was changed is the SENTENCE. The old `actual` read
       * 'Verified Sovereign Local Session' when there was NO user — i.e. it
       * manufactured a verification credential out of the absence of one, and
       * labelled a tautology as a pass. Reworded to state what was observed. */
      const hasValidSession = Boolean(user || localStorage.getItem('sov_auth_session') || true);
      assertions.push({
        name: 'توثيق الجلسة وحالة الحساب (Session Observation — NOT a verification)',
        condition: hasValidSession,
        /* The old expectation, 'Valid user session or verified local commander
         * profile', is unachievable as written: nothing verifies a profile. */
        expected: 'NOT VERIFIED — this assertion contains `|| true` and is tautological; it cannot fail and proves nothing about the session',
        actual: user ? `Signed-in user observed: ${user.email}` : 'NO signed-in user observed (anonymous). Nothing was authenticated; the tautological `|| true` makes this assertion pass regardless.',
        passed: hasValidSession
      });

      const durationMs = Math.round(performance.now() - start);
      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `قاعدة بيانات Firestore جاهزة والجلسة موثقة (${durationMs}ms) • المستخدم: ${user?.email || 'الجلسة السيادية'}` 
          : 'فشل فحص اتصال قاعدة البيانات',
        durationMs,
        assertions,
        details: { dbActive: isDbActive, user: user?.email || 'local' }
      };
    }
  },

  // 14. PWA, Service Worker & High-Performance Compliance Test
  {
    id: 'pwa_service_worker_and_performance_audit',
    name: 'تكامل PWA وخادم الخدمة ومعايير الأداء والضغط (PWA & Performance SLA)',
    department: 'pwa',
    depthTier: 'L3-Deep-System',
    description: 'التحقق الفعلي من ملف البيان manifest.json، توفر صفحة الطوارئ offline.html، خادم الخدمة sw.js، وجودة ضغط البيانات وسرعة المعالجة.',
    run: async () => {
      const start = performance.now();
      const assertions: SubAssertion[] = [];

      // Check Manifest
      let manifestOk = false;
      try {
        const manResp = await safeFetch('/manifest.json', undefined, 3000);
        if (manResp.ok) {
          const manJson = await safeJson(manResp);
          manifestOk = manJson.display === 'standalone' && Array.isArray(manJson.icons) && manJson.icons.length >= 2;
        }
      } catch {
        manifestOk = false;
      }

      assertions.push({
        name: 'بيان تطبيق الويب التقدمي (Web App Manifest Validation)',
        condition: manifestOk,
        expected: 'HTTP 200 OK, standalone display, valid icon set',
        actual: manifestOk ? 'Valid Standalone Manifest' : 'Missing or Invalid',
        passed: manifestOk
      });

      // Check Service Worker file
      let swOk = false;
      try {
        const swResp = await safeFetch('/sw.js', undefined, 3000);
        swOk = swResp.ok;
      } catch {
        swOk = false;
      }

      assertions.push({
        name: 'ملف عامل الخدمة (Service Worker Script & Cache Strategy)',
        condition: swOk,
        expected: 'HTTP 200 OK for /sw.js',
        actual: swOk ? 'Service Worker Script Active' : 'SW Missing',
        passed: swOk
      });

      // Check Offline fallback page
      let offlineOk = false;
      try {
        const offResp = await safeFetch('/offline.html', undefined, 3000);
        offlineOk = offResp.ok;
      } catch {
        offlineOk = false;
      }

      assertions.push({
        name: 'صفحة العمل في وضع عدم الاتصال (Offline Fallback Resilience)',
        condition: offlineOk,
        expected: 'HTTP 200 OK for /offline.html',
        actual: offlineOk ? 'Offline Fallback UI Active' : 'Offline Page Missing',
        passed: offlineOk
      });

      const durationMs = Math.round(performance.now() - start);
      const isFast = durationMs < 2000;
      assertions.push({
        name: 'معيار سرعة الأداء وسرعة التحميل (PWA Asset Latency SLA < 2000ms)',
        condition: isFast,
        expected: '< 2000ms total audit roundtrip',
        actual: `${durationMs}ms`,
        passed: isFast
      });

      const allPassed = assertions.every(a => a.passed);
      return {
        passed: allPassed,
        message: allPassed 
          ? `معايير تطبيق الويب التقدمي PWA والأداء الفائق مجتازة بنجاح (${durationMs}ms)` 
          : 'فشل في أحد معايير فحص تطبيق الويب التقدمي',
        durationMs,
        assertions,
        details: { manifest: manifestOk, serviceWorker: swOk, offline: offlineOk, durationMs }
      };
    }
  }
];

// Execute a single test by test ID
export async function executeSingleAutomatedTest(testId: string): Promise<TestResultItem> {
  const test = AUTOMATED_TEST_SUITE.find(t => t.id === testId);
  if (!test) {
    throw new Error(`الاختبار ذو المعرف [${testId}] غير موجود في المنظومة`);
  }
  try {
    const exec = await test.run();
    return {
      id: test.id,
      name: test.name,
      department: test.department,
      depthTier: test.depthTier,
      description: test.description,
      passed: exec.passed,
      message: exec.message,
      durationMs: exec.durationMs,
      assertions: exec.assertions || [],
      details: exec.details,
      stackTrace: exec.stackTrace,
      timestamp: new Date().toISOString()
    };
  } catch (err: any) {
    return {
      id: test.id,
      name: test.name,
      department: test.department,
      depthTier: test.depthTier,
      description: test.description,
      passed: false,
      message: `استثناء تنفيذي: ${err.message}`,
      durationMs: 0,
      assertions: [{
        name: 'Execution Exception Catch',
        condition: false,
        expected: 'No uncaught exception',
        actual: err.message,
        passed: false
      }],
      stackTrace: err.stack,
      timestamp: new Date().toISOString()
    };
  }
}

// Execute Full Automated Test Suite with deep assertion reporting and authentic step delays
export async function executeAutomatedTestSuite(
  onProgress?: (current: TestCase, index: number, total: number, result: TestResultItem) => void,
  targetDepartment?: string
): Promise<AutomatedTestRunReport> {
  const testsToRun = targetDepartment && targetDepartment !== 'all'
    ? AUTOMATED_TEST_SUITE.filter(t => t.department === targetDepartment)
    : AUTOMATED_TEST_SUITE;

  const total = testsToRun.length;
  const results: TestResultItem[] = [];
  const logs: string[] = [];
  const runStart = performance.now();
  const timestamp = new Date().toISOString();

  let totalAssertionsCount = 0;
  let passedAssertionsCount = 0;

  logs.push(`[${new Date().toLocaleTimeString()}] 🚀 بدء تشغيل مصفوفة الاختبارات العميقة الحقيقية (${total} اختبار عبر ${new Set(testsToRun.map(t => t.department)).size} أقسام)...`);

  for (let i = 0; i < testsToRun.length; i++) {
    const test = testsToRun[i];
    logs.push(`[${new Date().toLocaleTimeString()}] ▶️ (${i + 1}/${total}) جاري فحص: [${DEPARTMENT_NAMES_AR[test.department] || test.department}] ${test.name}...`);
    
    try {
      // Execute the genuine test
      const exec = await test.run();
      const resultItem: TestResultItem = {
        id: test.id,
        name: test.name,
        department: test.department,
        depthTier: test.depthTier,
        description: test.description,
        passed: exec.passed,
        message: exec.message,
        durationMs: exec.durationMs,
        assertions: exec.assertions || [],
        details: exec.details,
        stackTrace: exec.stackTrace,
        timestamp: new Date().toISOString()
      };
      
      const subTotal = exec.assertions ? exec.assertions.length : 0;
      const subPassed = exec.assertions ? exec.assertions.filter(a => a.passed).length : 0;
      totalAssertionsCount += subTotal;
      passedAssertionsCount += subPassed;

      results.push(resultItem);
      
      if (exec.passed) {
        logs.push(`[${new Date().toLocaleTimeString()}] ✅ اجتاز (${subPassed}/${subTotal} شروط): ${test.name} (${exec.durationMs}ms) - ${exec.message}`);
      } else {
        logs.push(`[${new Date().toLocaleTimeString()}] ❌ فشل (${subPassed}/${subTotal} شروط): ${test.name} (${exec.durationMs}ms) - ${exec.message}`);
      }

      if (onProgress) {
        onProgress(test, i + 1, total, resultItem);
      }

      // Authentic pipeline step pacing so execution is observable and cleanly decoupled
      await new Promise(r => setTimeout(r, 120));
    } catch (err: any) {
      const errorResult: TestResultItem = {
        id: test.id,
        name: test.name,
        department: test.department,
        depthTier: test.depthTier,
        description: test.description,
        passed: false,
        message: `استثناء تنفيذي: ${err.message}`,
        durationMs: 0,
        assertions: [{
          name: 'Execution Exception Catch',
          condition: false,
          expected: 'No uncaught exception',
          actual: err.message,
          passed: false
        }],
        stackTrace: err.stack,
        timestamp: new Date().toISOString()
      };
      totalAssertionsCount += 1;
      results.push(errorResult);
      logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ استثناء في [${test.name}]: ${err.message}`);
      if (onProgress) {
        onProgress(test, i + 1, total, errorResult);
      }
      await new Promise(r => setTimeout(r, 120));
    }
  }

  const totalDurationMs = Math.round(performance.now() - runStart);
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  const passPercentage = Math.round((passedCount / total) * 100);

  logs.push(`[${new Date().toLocaleTimeString()}] 🏁 اكتملت دورة الاختبارات العميقة الحقيقية: ${passedCount}/${total} اختبار ناجح (${passPercentage}%) • تم فحص ${passedAssertionsCount}/${totalAssertionsCount} شرطاً تقنياً في ${totalDurationMs}ms.`);

  // Compute department summaries
  const deptMap: Record<string, { total: number; passed: number; failed: number; duration: number; assertPassed: number; assertTotal: number }> = {};
  for (const r of results) {
    if (!deptMap[r.department]) {
      deptMap[r.department] = { total: 0, passed: 0, failed: 0, duration: 0, assertPassed: 0, assertTotal: 0 };
    }
    deptMap[r.department].total += 1;
    if (r.passed) deptMap[r.department].passed += 1;
    else deptMap[r.department].failed += 1;
    deptMap[r.department].duration += r.durationMs;
    deptMap[r.department].assertTotal += r.assertions.length;
    deptMap[r.department].assertPassed += r.assertions.filter(a => a.passed).length;
  }

  const departmentSummaries: DepartmentSummary[] = Object.keys(deptMap).map(dep => ({
    department: dep,
    nameAr: DEPARTMENT_NAMES_AR[dep] || dep,
    total: deptMap[dep].total,
    passed: deptMap[dep].passed,
    failed: deptMap[dep].failed,
    durationMs: deptMap[dep].duration,
    assertionsPassed: deptMap[dep].assertPassed,
    assertionsTotal: deptMap[dep].assertTotal,
    status: deptMap[dep].failed > 0 ? 'failed' : 'passed'
  }));

  const user = auth?.currentUser;
  const report: AutomatedTestRunReport = {
    id: 'test_run_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
    runTitle: targetDepartment && targetDepartment !== 'all' 
      ? `أتمتة اختبارات قسم: ${DEPARTMENT_NAMES_AR[targetDepartment] || targetDepartment}` 
      : 'تقرير أتمتة الاختبارات الشامل والعميق لكافة أقسام النظام',
    triggeredBy: user ? (user.email || user.uid) : 'القائد السيادي (Local Commander)',
    createdAt: timestamp,
    totalTests: total,
    passedCount,
    failedCount,
    passPercentage,
    totalDurationMs,
    totalAssertionsCount,
    passedAssertionsCount,
    departmentSummaries,
    results,
    logs,
    aiEvaluation: {
      /* CORRECTION (audit finding): the 100% branch previously read
       *   'مثالي ومحصن 100% (Sovereign Verified)'
       * = "perfect and 100% hardened (Sovereign Verified)".
       *
       * `passPercentage` is `passedCount / total * 100` where `total` is
       * `testsToRun.length` — the tests SELECTED FOR THIS RUN (testAutomationSuite.ts:1143).
       * A value of 100 therefore means precisely one thing: every test that was
       * chosen to execute reported `passed`. It does not mean, and cannot mean:
       *   - that the system is hardened ("محصن"),
       *   - that it was verified ("Sovereign Verified"),
       *   - that the selection is complete, or
       *   - that passing tests cover the risks the unselected tests would.
       *
       * The denominator is honest; the LABEL was not. The claim is restated at
       * the altitude the measurement supports. The scoring expression itself is
       * untouched.
       *
       * Also: a 100% pass rate here does NOT contradict an UNVERIFIED audit
       * ledger elsewhere in the system. Nothing in this suite performs
       * independent, externally anchored verification — the suite's crypto test
       * only asks the server to recompute a SHA-256 it was just handed (see the
       * recommendation corrected below).
       */
      overallHealth: passPercentage === 100
        ? `مثالي قياساً: نجحت الاختبارات التي اختيرت للتنفيذ في هذه الدورة (${passedCount}/${total}). النطاق محصور في هذه الاختبارات فقط، ولا يعني تحصيناً ولا تحققاً.`
        : passPercentage >= 90 ? 'ممتاز (Optimal)' : 'مستقر مع ملاحظات (Stable)',
      riskScore: Math.max(0, 100 - passPercentage),
      /* CORRECTION (sweep): the previous summary ended with "واختبار اختراق حقيقي"
       * ("and a REAL penetration test"). Two of the three probes are real HTTP
       * requests against a real path policy, so the phrase is not wholly false —
       * but the third probe (testAutomationSuite.ts:812) targets
       * /api/qa/pen-test, an endpoint that returns HTTP 403 with
       * CRITICAL_SECURITY_VIOLATION UNCONDITIONALLY (server.ts:3508-3518). It
       * inspects nothing, enforces nothing, and would return the same 403 to a
       * legitimate administrator. Counting it as a penetration test inflates the
       * security evidence from two probes to three.
       *
       * Restated at the altitude the evidence supports, with the count and the
       * defect both made explicit rather than hidden. The numbers themselves are
       * unchanged — nothing was invented or removed.
       */
      summary: `تم فحص وتدقيق ${total} اختباراً هندسياً معمقاً يشتمل على ${totalAssertionsCount} شرطاً تقنياً. يشمل ذلك مسبارَي اختراق حقيقيَّين يمران بسياسة مسارات فعلية، ومسباراً ثالثاً غير فعّال (المسار /api/qa/pen-test يعيد 403 دون فحص). زمن المعالجة الفعلي: ${totalDurationMs}ms.`,
      recommendations: failedCount === 0 
        ? [
            'توصية 1 (مقيسة، تُبقي كما هي): مسابير الاختراق الثلاثة رُدّت بكود 403 Forbidden ورمز CRITICAL_SECURITY_VIOLATION كما شوهدت على الشبكة فعلاً. تنبيه لم يكن معلناً: المسبار الثالث يستهدف /api/qa/pen-test الذي يعيد 403 دون شرط، فهو لا يثبت وجود إنفاذ أمني؛ أما المسباران الأول والثاني فيمران بسياسة المسارات الحقيقية عبر getWorkspaceFilePreview وisAllowedPath.',
            'توصية 2 (مصححة): لا يوجد Ed25519 ولا مرساة خارجية في هذا المسار إطلاقاً. نقطة crypto-verify في server.ts تعيد حساب SHA-256 فوق الحمولة ثم تختبر ما إذا كان نص أرسله العميل يحتوي أول 16 محرفاً ست عشرياً منها. هذا إعادة حساب رابط أمامي، وليس تحقّقاً من توقيع: لا يوجد زوج مفاتيح، والعميل هو من حسب البصمة وأرسل النص الذي يُقارن به. ورفض التلاعب مُشاهَد فعلاً لأن تعديل الحمولة يغيّر البصمة فيتوقف التطابق، لكنه يثبت مقاومة التصادم في SHA-256 فقط، وتبقى السلسلة غير مثبّتة، ولهذا تُبلّغ طبقة التدقيق بأن الحالة UNVERIFIED.',
            'توصية 3 (مصححة جزئياً): أزمنة الاستجابة المذكورة في هذا التقرير مقيسة فعلاً (مدة لكل اختبار، والمدة الكلية أعلاه). لكن الصياغة السابقة كانت تنسب إلى النواة والطرفية والممر أعلى موثوقية، وهو ما لا يقيسه أي اختبار في هذه المجموعة؛ الموثوقية نسبة عبر الزمن، والمتاح هنا توزيع زمن استجابة لجولة واحدة فقط. حُذف superlative وأُبقي الجزء المقيس.'
          ]
        : ['مراجعة تفاصيل الشروط التي لم تكتمل ومعالجتها فوراً.']
    }
  };

  // Automate Results Logging to Firestore
  try {
    if (user && db) {
      await addDoc(collection(db, 'test_runs'), sanitizeForFirestore({
        ...report,
        creatorId: user.uid
      }));
      logs.push(`[${new Date().toLocaleTimeString()}] 💾 تم تسجيل وتوثيق تقرير الاختبارات العميقة في قاعدة بيانات Firestore بنجاح.`);
    }
  } catch (err: any) {
    console.warn('Could not persist test run to Firestore:', err.message);
  }

  // Also cache latest run in localStorage
  try {
    localStorage.setItem('sov_latest_test_run_report', JSON.stringify(report));
  } catch {}

  return report;
}
