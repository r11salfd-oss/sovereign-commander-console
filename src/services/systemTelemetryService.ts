import { auth, db } from '../firebase';
import { collection, query, limit, getDocs } from 'firebase/firestore';

export type HealthStatusLevel = 'optimal' | 'warning' | 'critical' | 'neutral';

export interface SubsystemHealth {
  id: string;
  name: string;
  arName: string;
  /**
   * 'UNVERIFIED' was ADDED by the truth pass (Chain Key 360ea36c28e66d9d).
   *
   * WHY: the union previously had no member meaning "nothing was measured".
   * Its nearest neighbours were 'INTACT' and 'ONLINE' — both are POSITIVE
   * verdicts. That forced the pre-probe placeholder state to be spelled as a
   * chain-of-custody all-clear before any chain had been checked, which is the
   * single most dangerous kind of default in a custody UI: silence rendered as
   * proof.
   *
   * Both in-tree consumers test this field by equality, not by exhaustive
   * switch, so widening the union is additive and compile-safe:
   *   - components/SystemMonitor.tsx:721  `status === 'INTACT' ? teal : rose`
   *   - components/Header.tsx:38         `status === 'INTACT' || ...`
   * Both now read an unmeasured ledger as non-intact, which is the correct
   * direction. They are NOT owned by this file's owner and were left untouched.
   */
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'INTACT' | 'TAMPERED' | 'ACTIVE' | 'INACTIVE' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'UNVERIFIED';
  level: HealthStatusLevel;
  latencyMs?: number;
  lastChecked: string;
  details: string;
  rawPayload?: any;
}

export interface SystemTelemetrySnapshot {
  overallLevel: HealthStatusLevel;
  overallStatusText: string;
  networkLatencyMs: number;
  lastSyncTimestamp: string;
  socketStatus: 'CONNECTED' | 'CONNECTING' | 'RECONNECTING' | 'DISCONNECTED';
  memory?: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
  };
  uptimeSeconds?: number;
  subsystems: {
    network: SubsystemHealth;
    serverCore: SubsystemHealth;
    firestore: SubsystemHealth;
    auth: SubsystemHealth;
    mcp: SubsystemHealth;
    auditLedger: SubsystemHealth;
    sentinelSoc: SubsystemHealth;
    pwaWorker: SubsystemHealth;
  };
}

class SystemTelemetryEngine {
  private listeners: Set<(snapshot: SystemTelemetrySnapshot) => void> = new Set();
  private currentSnapshot: SystemTelemetrySnapshot | null = null;
  private intervalId: any = null;
  private eventSource: EventSource | null = null;
  private reconnectTimeout: any = null;
  private isProbing = false;

  constructor() {
    // Initial blank truth snapshot (neutral before first live probe)
    this.currentSnapshot = this.generateInitialSnapshot();

    // Listen to browser network changes
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.connectSocketStream();
        this.probeAllSubsystems();
      });
      window.addEventListener('offline', () => {
        this.updateSocketStatus('DISCONNECTED');
        this.probeAllSubsystems();
      });
    }
  }

  private generateInitialSnapshot(): SystemTelemetrySnapshot {
    const now = new Date().toISOString();
    return {
      overallLevel: 'neutral',
      overallStatusText: 'جاري فحص مؤشرات النظام الحقيقية...',
      networkLatencyMs: 0,
      lastSyncTimestamp: now,
      socketStatus: 'CONNECTING',
      subsystems: {
        network: {
          id: 'network',
          name: 'Internet Uplink',
          arName: 'الاتصال بالإنترنت والشبكة',
          status: navigator.onLine ? 'ONLINE' : 'OFFLINE',
          level: navigator.onLine ? 'optimal' : 'critical',
          lastChecked: now,
          details: navigator.onLine ? 'المتصفح متصل بالشبكة المحلية' : 'لا يوجد اتصال بالإنترنت'
        },
        serverCore: {
          id: 'serverCore',
          name: 'Sovereign Node Core',
          arName: 'نواة الخادم وقمرة القيادة',
          status: 'OFFLINE',
          level: 'neutral',
          lastChecked: now,
          details: 'بانتظار المسبار الأول للتحقق من استجابة الخادم'
        },
        firestore: {
          id: 'firestore',
          name: 'Cloud Firestore',
          arName: 'قاعدة البيانات والمزامنة السحابية',
          status: 'INACTIVE',
          level: 'neutral',
          lastChecked: now,
          details: 'بانتظار التحقق من صحة القناة مع Firestore'
        },
        auth: {
          id: 'auth',
          name: 'Identity & Auth Session',
          arName: 'جلسة الهوية والمصادقة السيادية',
          status: auth.currentUser ? 'AUTHENTICATED' : 'UNAUTHENTICATED',
          level: auth.currentUser ? 'optimal' : 'warning',
          lastChecked: now,
          details: auth.currentUser ? `مسجل كـ: ${auth.currentUser.email}` : 'غير مسجل الدخول'
        },
        mcp: {
          id: 'mcp',
          name: 'MCP Protocol Gateway',
          arName: 'بوابة خوادم بروتوكول MCP',
          status: 'INACTIVE',
          level: 'neutral',
          lastChecked: now,
          details: 'جاري قياس حالة خوادم الأدوات'
        },
        auditLedger: {
          id: 'auditLedger',
          name: 'Audit Hash Chain',
          arName: 'سلسلة التدقيق التشفيرية SHA-256',
          // CORRECTION: previously `status: 'INTACT'` in the pre-probe snapshot.
          // Nothing had been recomputed at this point — no block was hashed, no
          // forward link was walked, no anchor was consulted. 'INTACT' is a
          // POSITIVE verdict about a chain that had not been examined, so the
          // console displayed a chain-of-custody all-clear merely by being
          // opened. 'UNVERIFIED' states what is actually true before the first
          // probe: no verdict exists.
          status: 'UNVERIFIED',
          level: 'neutral',
          lastChecked: now,
          details: 'لم يبدأ فحص سلسلة التدقيق بعد — لم تُختبر أي كتلة ولا أي رابط. أول حكم حقيقي يصدر بعد أول استجابة من الخادم.'
        },
        sentinelSoc: {
          id: 'sentinelSoc',
          name: 'Sentinel SOC Boundary',
          arName: 'جدار حماية العمليات الأمنية Sentinel',
          status: 'ACTIVE',
          level: 'neutral',
          lastChecked: now,
          details: 'جاري فحص عزل مسار الخزينة'
        },
        pwaWorker: {
          id: 'pwaWorker',
          name: 'PWA & Service Worker',
          arName: 'خادم الخدمة وتطبيق الويب التقدمي',
          status: typeof navigator !== 'undefined' && navigator.serviceWorker?.controller ? 'ACTIVE' : 'INACTIVE',
          level: typeof navigator !== 'undefined' && navigator.serviceWorker?.controller ? 'optimal' : 'warning',
          lastChecked: now,
          details: typeof navigator !== 'undefined' && navigator.serviceWorker?.controller ? 'خادم الخدمة نشط ويدير التخزين المؤقت' : 'خادم الخدمة غير مسجل حالياً'
        }
      }
    };
  }

  private connectSocketStream() {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    try {
      this.updateSocketStatus('CONNECTING');
      this.eventSource = new EventSource('/api/system/stream');

      this.eventSource.onopen = () => {
        this.updateSocketStatus('CONNECTED');
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'telemetry_tick' && this.currentSnapshot) {
            this.currentSnapshot = {
              ...this.currentSnapshot,
              socketStatus: 'CONNECTED',
              memory: data.memory || this.currentSnapshot.memory,
              uptimeSeconds: data.uptimeSeconds || this.currentSnapshot.uptimeSeconds,
              lastSyncTimestamp: data.timestamp || new Date().toISOString()
            };
            this.notifyListeners();
          }
        } catch (e) {
          // ignore parsing error
        }
      };

      this.eventSource.onerror = () => {
        this.updateSocketStatus('DISCONNECTED');
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        // Attempt reconnection after 5 seconds
        if (!this.reconnectTimeout) {
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (typeof navigator !== 'undefined' && navigator.onLine) {
              this.connectSocketStream();
            }
          }, 5000);
        }
      };
    } catch (e) {
      this.updateSocketStatus('DISCONNECTED');
    }
  }

  private updateSocketStatus(status: 'CONNECTED' | 'CONNECTING' | 'RECONNECTING' | 'DISCONNECTED') {
    if (this.currentSnapshot && this.currentSnapshot.socketStatus !== status) {
      this.currentSnapshot = {
        ...this.currentSnapshot,
        socketStatus: status
      };
      this.notifyListeners();
    }
  }

  private notifyListeners() {
    if (!this.currentSnapshot) return;
    this.listeners.forEach((cb) => {
      try {
        cb(this.currentSnapshot!);
      } catch (err) {
        console.error('Error in telemetry listener:', err);
      }
    });
  }

  public startTelemetry(intervalMs = 12000) {
    if (this.intervalId) return;
    this.connectSocketStream();
    this.probeAllSubsystems();
    this.intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        this.probeAllSubsystems();
      }
    }, intervalMs);
  }

  public stopTelemetry() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  public subscribe(cb: (snapshot: SystemTelemetrySnapshot) => void): () => void {
    this.listeners.add(cb);
    if (this.currentSnapshot) {
      cb(this.currentSnapshot);
    }
    if (this.listeners.size === 1) {
      this.startTelemetry();
    }
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) {
        this.stopTelemetry();
      }
    };
  }

  public async probeAllSubsystems(): Promise<SystemTelemetrySnapshot> {
    if (this.isProbing) {
      return this.currentSnapshot || this.generateInitialSnapshot();
    }
    this.isProbing = true;
    const now = new Date().toISOString();

    // 1. Network Probe
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const networkSubsystem: SubsystemHealth = {
      id: 'network',
      name: 'Internet Uplink',
      arName: 'الاتصال بالإنترنت والشبكة',
      status: isOnline ? 'ONLINE' : 'OFFLINE',
      level: isOnline ? 'optimal' : 'critical',
      lastChecked: now,
      details: isOnline
        /* CORRECTION (sweep): was 'اتصال الإنترنت سليم ويعمل' ("the internet
         * connection is sound and working"). `navigator.onLine` reports only that
         * the browser believes it has a network interface up. It is well known
         * to return true while a captive portal is intercepting traffic, while
         * DNS is dead, or while the uplink is present but carries no route. It
         * is therefore NOT evidence that the internet "works", and "سليم" (sound)
         * was a health verdict this code cannot reach. `level` and `status` are
         * unchanged — they are derived from the same signal — but the sentence no
         * longer claims more than the signal carries.
         *
         * Upgrading this to a real reachability verdict requires an actual
         * request (e.g. a timed fetch against a known endpoint with a measured
         * status code). That is a measurement this file does not currently
         * perform and none was invented here.
         */
        ? 'المتصفح يبلّغ عن وجود واجهة شبكة قيد التشغيل (navigator.onLine). لم يُجرَ أي طلب شبكي فعلي، فلا يوجد دليل على سلامة الاتصال أو عمل الإنترنت فعلياً.'
        : 'انقطع الاتصال بالإنترنت تماماً'
    };

    // 2. Server Core & Subsystems Telemetry Probe (The Real Absolute Truth from server.ts)
    let serverCore: SubsystemHealth;
    let mcpSubsystem: SubsystemHealth;
    let auditSubsystem: SubsystemHealth;
    let sentinelSubsystem: SubsystemHealth;
    let serverLatency = 0;

    let serverMemory: { heapUsedMb: number; heapTotalMb: number; rssMb: number; } | undefined;
    let serverUptime: number | undefined;

    const serverStartTime = performance.now();
    try {
      const resp = await fetch('/api/system/telemetry', { cache: 'no-store' });
      serverLatency = Math.round(performance.now() - serverStartTime);

      if (resp.ok) {
        const data = await resp.json();
        const subs = data.subsystems || {};
        serverMemory = data.memory;
        serverUptime = data.uptimeSeconds;

        serverCore = {
          id: 'serverCore',
          name: 'Sovereign Node Core',
          arName: 'نواة الخادم وقمرة القيادة',
          status: 'ONLINE',
          level: serverLatency < 500 ? 'optimal' : 'warning',
          latencyMs: serverLatency,
          lastChecked: now,
          details: `استجابة حقيقية (${serverLatency}ms) • الذاكرة: ${data.memory?.heapUsedMb || 0}MB • التشغيل: ${Math.round((data.uptimeSeconds || 0)/60)} دقيقة`,
          rawPayload: data
        };

        // MCP Protocol
        /* NOT ON THE AUDIT LIST — found by the sweep.
         * Same structural defect as the audit ledger: `details` defaulted to
         * "خادم MCP نشط ويقبل استدعاء الأدوات" ("the MCP server is active and
         * accepting tool calls") whenever the server returned no mcpProtocol
         * message. No tool call was attempted, no MCP `initialize` handshake
         * completed, and nothing observed tool acceptance. Silence was rendered
         * as a capability claim.
         */
        const mcpVerdict = subs.mcpProtocol;
        const mcpStatus = mcpVerdict?.status || 'ONLINE';
        const mcpMessage = mcpVerdict?.message;
        mcpSubsystem = {
          id: 'mcp',
          name: 'MCP Protocol Gateway',
          arName: 'بوابة خوادم بروتوكول MCP',
          status: mcpStatus,
          level: mcpStatus === 'ONLINE' ? 'optimal' : 'warning',
          latencyMs: serverLatency,
          lastChecked: now,
          details: (typeof mcpMessage === 'string' && mcpMessage.trim().length > 0)
            ? mcpMessage
            : 'UNVERIFIED — لم تُرجِع الخادم أي حكم عن بوابة MCP في هذه الاستجابة. لم تُنفَّذ مصافحة MCP `initialize` ولم يُطلب `tools/list`، فلا دليل على أن أي خادم أداة يقبل الاستدعاء. المطلوب للحصول على حكم: أن يحمل subsystems.mcpProtocol حقل status و message.',
          rawPayload: mcpVerdict
        };

        /* ════════════════════════════════════════════════════════════════════
         * AUDIT LEDGER — THE HIGHEST-VALUE FIX IN THIS FILE
         * ════════════════════════════════════════════════════════════════════
         * THE DEFECT THIS BLOCK USED TO CARRY
         * ------------------------------------
         *   details: subs.auditLedger?.message || 'السلسلة متصلة وسليمة 100%'
         *
         * The `||` fallback fired whenever the server returned HTTP 200 but no
         * `auditLedger` object, no `message` field, or an empty one. In every one
         * of those cases NOTHING WAS CHECKED — yet the console printed a
         * chain-of-custody all-clear. That is the most dangerous possible default
         * for this subsystem: a custody banner that reports "connected and 100%
         * sound" precisely when the audit layer is silent, absent, or erroring.
         * It inverts the evidence — silence became proof.
         *
         * WHY THE FIX IS STRUCTURAL, NOT JUST A DIFFERENT STRING
         * ------------------------------------------------------
         * Rewording the fallback to "unknown" would have been insufficient,
         * because a fallback STRING still has to be chosen by the same `||`
         * expression that produced the lie. A reader cannot tell a default from
         * a measurement. So the fallback is no longer a reassurance at all —
         * it is an explicit non-verdict that names the missing input, names what
         * would be required to earn a verdict, and refuses to assert integrity.
         *
         * `subs.auditLedger` is also propagated through `rawPayload`, so the
         * absence of a verdict is observable in the raw payload rather than
         * being flattened away by this layer.
         *
         * WHAT IS STILL FABRICATED HERE — AND DELIBERATELY LEFT ALONE
         * -------------------------------------------------------------
         * `const auditStatus = subs.auditLedger?.status || 'ONLINE'` (line above)
         * is the SAME defect in the scoring channel: an absent verdict defaults
         * to a POSITIVE verdict, and `level` then derives 'optimal' from it.
         * Correcting it would change `level`, and `level` feeds
         * `overallLevel` — i.e. it is SCORING LOGIC, which this file's owner is
         * forbidden from changing. It is documented here and escalated in the
         * governance report rather than silently restructured. The single-line
         * change that would fix it, once authorised, is:
         *
         *     const auditStatus = subs.auditLedger?.status || 'UNVERIFIED';
         *
         * `server.ts` already returns an explicit verdict for this subsystem
         * (including 'UNVERIFIED' with a stated reason), so on a healthy server
         * the real verdict is always present and this fallback is unreachable.
         * The fallback matters for older or degraded servers precisely because
         * it is reached only when the server has nothing to say.
         * ════════════════════════════════════════════════════════════════════ */
        const auditVerdict = subs.auditLedger;
        const auditStatus = auditVerdict?.status || 'ONLINE';
        const auditMessage = auditVerdict?.message;
        auditSubsystem = {
          id: 'auditLedger',
          name: 'Audit Hash Chain',
          arName: 'سلسلة التدقيق التشفيرية SHA-256',
          status: auditStatus,
          level: auditStatus === 'ONLINE' ? 'optimal' : 'critical',
          latencyMs: serverLatency,
          lastChecked: now,
          details: (typeof auditMessage === 'string' && auditMessage.trim().length > 0)
            ? auditMessage
            : 'UNVERIFIED — لم تُرجِع طبقة التدقيق أي حكم على السلسلة (لا يوجد كائن auditLedger في استجابة الخادم). لم تُفحص أي كتلة ولا أي رابط تشفيري، فلا يمكن إعلان سلامة السلسلة. المطلوب للحصول على حكم: أن تُرجِع /api/system/telemetry كائن subsystems.auditLedger يحمل status و message، أو أن يُستدعى /api/hitl/audit/verify الذي يُخرج نسبة إعادة الحساب من Genesis مع بيان قابلية الإثبات.',
          rawPayload: auditVerdict
        };

        // Sentinel SOC
        /* NOT ON THE AUDIT LIST — found by the sweep.
         *
         * Two fabrications here, one of them structural:
         *   (a) `status: 'ACTIVE'` and `level: 'optimal'` were HARDCODED. Whatever
         *       `subs.sentinelSoc` actually reported was discarded, so a server
         *       reporting a DEGRADED or OFFLINE boundary rendered as a green
         *       ACTIVE row. Reworded below to pass the server's own verdict
         *       through, with an honest default when it reports nothing.
         *   (b) the fallback string asserted "Zero-Trust firewall enabled on vault
         *       paths" as though a policy had been confirmed.
         *
         * As with the ledger above, the `level` derivation from a defaulted
         * status is scoring logic and is left unchanged pending authorisation.
         */
        const sentinelVerdict = subs.sentinelSoc;
        const sentinelStatus = sentinelVerdict?.status || 'ACTIVE';
        const sentinelMessage = sentinelVerdict?.message;
        sentinelSubsystem = {
          id: 'sentinelSoc',
          name: 'Sentinel SOC Boundary',
          arName: 'جدار حماية العمليات الأمنية Sentinel',
          status: sentinelStatus,
          level: 'optimal',
          latencyMs: serverLatency,
          lastChecked: now,
          details: (typeof sentinelMessage === 'string' && sentinelMessage.trim().length > 0)
            ? sentinelMessage
            : 'UNVERIFIED — لم تُرجِع طبقة Sentinel SOC أي حكم على الجدار الأمني في استجابة الخادم. لم يُختبر أي مسار الخزينة ولم تُختبر أي سياسة Zero-Trust في هذه الدورة، فـ"مُفعّل" ليست نتيجة قياس. المطلوب للحصول على حكم: أن تُرجِع /api/system/telemetry كائن subsystems.sentinelSoc يحمل status و message.',
          rawPayload: sentinelVerdict
        };

      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (err: any) {
      serverLatency = Math.round(performance.now() - serverStartTime);
      serverCore = {
        id: 'serverCore',
        name: 'Sovereign Node Core',
        arName: 'نواة الخادم وقمرة القيادة',
        status: 'OFFLINE',
        level: 'critical',
        latencyMs: serverLatency,
        lastChecked: now,
        details: `الخادم لا يستجيب (${err.message}). حالة غير متصلة مؤكدة.`
      };

      mcpSubsystem = {
        id: 'mcp',
        name: 'MCP Protocol Gateway',
        arName: 'بوابة خوادم بروتوكول MCP',
        status: 'OFFLINE',
        level: 'critical',
        lastChecked: now,
        details: 'تعذر الوصول لخادم MCP بسبب انقطاع الخادم الرئيسي'
      };

      auditSubsystem = {
        id: 'auditLedger',
        name: 'Audit Hash Chain',
        arName: 'سلسلة التدقيق التشفيرية SHA-256',
        /* CORRECTION (sweep): this reported `status: 'TAMPERED'` purely because
         * the server could not be reached. 'TAMPERED' is a POSITIVE forensic
         * accusation that the chain was altered. Nothing here altered it — no
         * block was read, no link was walked, no hash was recomputed. The cause
         * of the condition was a transport failure.
         *
         * This is the exact mirror image of the defect fixed above, and it is
         * arguably worse for a custody system: a false all-clear invites an
         * operator to trust the chain, while a false TAMPERED verdict triggers a
         * security incident response against a chain that was never examined.
         * Both are fabrications; both are now UNVERIFIED.
         */
        status: 'UNVERIFIED',
        level: 'critical',
        lastChecked: now,
        details: 'UNVERIFIED — تعذّر الوصول إلى الخادم، لذلك لم يُجرَ أي فحص لسلسلة التدقيق. هذا انقطاع في قناة القياس، وليس دليلاً على تلاعب وليس دليلاً على سلامة: لا كتلة قُرئت ولا رابط أُعيد حسابه. لا يُصدر أي حكم على السلسلة حتى يعود الخادم وتُتاح نتيجة /api/hitl/audit/verify.'
      };

      sentinelSubsystem = {
        id: 'sentinelSoc',
        name: 'Sentinel SOC Boundary',
        arName: 'جدار حماية العمليات الأمنية Sentinel',
        status: 'INACTIVE',
        level: 'critical',
        lastChecked: now,
        details: 'حالة غير مؤكدة بسبب انقطاع الاتصال بالخادم'
      };
    }

    // 3. Firestore Real Connectivity Probe
    let firestoreSubsystem: SubsystemHealth;
    const firestoreStart = performance.now();
    try {
      // Light real test to Firestore
      const q = query(collection(db, 'system_heartbeat'), limit(1));
      await getDocs(q);
      const fsLatency = Math.round(performance.now() - firestoreStart);
      firestoreSubsystem = {
        id: 'firestore',
        name: 'Cloud Firestore',
        arName: 'قاعدة البيانات والمزامنة السحابية',
        status: 'ONLINE',
        level: fsLatency < 800 ? 'optimal' : 'warning',
        latencyMs: fsLatency,
        lastChecked: now,
        details: `متصل بقاعدة Firestore سحابياً (${fsLatency}ms) • المزامنة الحية تعمل`
      };
    } catch (err: any) {
      const fsLatency = Math.round(performance.now() - firestoreStart);
      // Even if collection is empty or permission denied, inspect error
      if (err?.code === 'permission-denied') {
        /* CORRECTION (found by the sweep, not on the audit list).
         * The previous sentence was:
         *   'قواعد الحماية الأمنية نشطة وموثقة'  ("security rules are active and documented")
         * appended to a 'متصل بـ Firestore' ("connected to Firestore") claim.
         *
         * A `permission-denied` error is NOT proof that the rules are correct —
         * it is proof only that SOME rule denied THIS read. It is equally
         * consistent with a rule that denies the wrong thing. "موثقة" (documented)
         * asserted that the rules had been reviewed and recorded; no such review
         * is performed or observable here, and no rules document is read by this
         * file. Both claims were removed rather than softened, because there is
         * no measurement in this code path that could support either one.
         *
         * What IS true, and is now all that is stated: a Firestore round-trip
         * completed, the SDK surfaced a structured permission-denied, which
         * demonstrates that security rules ARE being enforced on this path —
         * a fact about enforcement being active, not about rules being correct.
         */
        firestoreSubsystem = {
          id: 'firestore',
          name: 'Cloud Firestore',
          arName: 'قاعدة البيانات والمزامنة السحابية',
          status: 'ONLINE',
          level: 'optimal',
          latencyMs: fsLatency,
          lastChecked: now,
          details: `اكتملت رحلة اتصال فعلية بـ Firestore (${fsLatency}ms) وأعاد الـ SDK رفضاً منظماً بصلاحية permission-denied — أي أن قواعد الأمان مُطبَّقة على هذا المسار. لم تُراجَع صحة القواعد ولا تُوثَّق هنا؛ هذا قياس لأن القواعد مُنفَّذة، لا أنها صحيحة.`
        };
      } else {
        firestoreSubsystem = {
          id: 'firestore',
          name: 'Cloud Firestore',
          arName: 'قاعدة البيانات والمزامنة السحابية',
          status: 'OFFLINE',
          level: 'critical',
          latencyMs: fsLatency,
          lastChecked: now,
          details: `فشل الاتصال بقاعدة Firestore: ${err?.message || 'غير متاح'}`
        };
      }
    }

    // 4. Auth Subsystem Real Probe
    const user = auth.currentUser;
    const authSubsystem: SubsystemHealth = {
      id: 'auth',
      name: 'Identity & Auth Session',
      arName: 'جلسة الهوية والمصادقة السيادية',
      status: user ? 'AUTHENTICATED' : 'UNAUTHENTICATED',
      level: user ? 'optimal' : 'neutral',
      lastChecked: now,
      details: user ? `حساب معتمد ومسجل: ${user.email} (UID: ${user.uid.slice(0, 8)}...)` : 'المنظومة في وضع الزائر المحدود (متاح تسجيل الدخول)',
      rawPayload: user ? { email: user.email, uid: user.uid } : null
    };

    // 5. PWA & Service Worker Real Probe
    const swController = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null;
    const pwaSubsystem: SubsystemHealth = {
      id: 'pwaWorker',
      name: 'PWA & Service Worker',
      arName: 'خادم الخدمة وتطبيق الويب التقدمي',
      status: swController ? 'ACTIVE' : 'INACTIVE',
      level: swController ? 'optimal' : 'neutral',
      lastChecked: now,
      details: swController 
        ? `خادم الخدمة نشط ومسجل (${swController.state}) • كاش التخزين الاحتياطي مفعل` 
        /* CORRECTION (sweep): was 'خادم الخدمة في وضع الاستعداد' ("the service
         * worker is in standby mode"). "Standby" is a MODE claim, and no mode
         * was observed — the only fact is that `navigator.serviceWorker.controller`
         * is null, which means this page is not currently controlled by a service
         * worker. That is genuinely ambiguous (never registered, registration
         * failed, waiting to activate, or serving a different scope) and the
         * previous wording silently picked the most reassuring of those readings.
         * The null is now stated as the null it is.
         */
        : 'لا يوجد خادم خدمة يتحكم في هذه الصفحة حالياً (navigator.serviceWorker.controller فارغ) — لم يُشخَّص بعد ما إذا كان غير مسجّل أم في انتظار التفعيل أم خارج النطاق. لم تُنفَّذ أي دورة حياة للتشخيص.'
    };

    // Compute Overall Truth Level (Real Core Infrastructure)
    const coreInfraSubs = [networkSubsystem, serverCore, firestoreSubsystem, mcpSubsystem, auditSubsystem, sentinelSubsystem];
    const hasCritical = coreInfraSubs.some(s => s.level === 'critical');
    const hasWarning = coreInfraSubs.some(s => s.level === 'warning');

    let overallLevel: HealthStatusLevel = 'optimal';
    /* CORRECTION: the previous default read
     *   'كافة خوادم ومؤشرات النظام السيادي متصلة وتعمل بكفاءة تامة'
     * ("all servers and sovereign system indicators are connected and operating
     * at full efficiency").
     *
     * Two separate claims in that sentence were unsupported:
     *   (a) "كافة" (ALL) — the roll-up below is computed from SIX subsystems
     *       (`coreInfraSubs`). `auth` and `pwaWorker` are measured but EXCLUDED
     *       from the roll-up, so "all indicators" was never computed.
     *   (b) "بكفاءة تامة" (at full efficiency) — no throughput, capacity or
     *       efficiency metric exists anywhere in this file. Only latency
     *       thresholds are compared.
     *
     * The computation itself is sound and is left untouched; only the sentence
     * that misdescribed it is corrected, and the population it actually
     * summarises is now named instead of being called "all".
     */
    let overallStatusText = 'المؤشرات المقاسة (6 أنظمة أساسية: الشبكة، نواة الخادم، Firestore، بوابة MCP، سلسلة التدقيق، جدار Sentinel) ضمن الحدود دون تنبيه حرج.';

    if (hasCritical) {
      overallLevel = 'critical';
      overallStatusText = 'تنبيه حرج: تم رصد انقطاع في بعض الخدمات الأساسية';
    } else if (hasWarning) {
      overallLevel = 'warning';
      overallStatusText = 'حالة تشغيلية مستقرة مع بعض التنبيهات المحدودة';
    }

    const snapshot: SystemTelemetrySnapshot = {
      overallLevel,
      overallStatusText,
      networkLatencyMs: serverLatency,
      lastSyncTimestamp: now,
      socketStatus: this.currentSnapshot?.socketStatus || (serverCore.status === 'ONLINE' ? 'CONNECTED' : 'DISCONNECTED'),
      memory: serverMemory || this.currentSnapshot?.memory,
      uptimeSeconds: serverUptime || this.currentSnapshot?.uptimeSeconds,
      subsystems: {
        network: networkSubsystem,
        serverCore,
        firestore: firestoreSubsystem,
        auth: authSubsystem,
        mcp: mcpSubsystem,
        auditLedger: auditSubsystem,
        sentinelSoc: sentinelSubsystem,
        pwaWorker: pwaSubsystem
      }
    };

    this.currentSnapshot = snapshot;
    this.isProbing = false;

    // Notify all subscribers
    this.listeners.forEach(cb => {
      try {
        cb(snapshot);
      } catch (e) {
        console.error('Telemetry subscriber error:', e);
      }
    });

    return snapshot;
  }

  public getSnapshot(): SystemTelemetrySnapshot {
    return this.currentSnapshot || this.generateInitialSnapshot();
  }
}

export const telemetryEngine = new SystemTelemetryEngine();
