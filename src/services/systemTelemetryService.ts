import { auth, db } from '../firebase';
import { collection, query, limit, getDocs } from 'firebase/firestore';

export type HealthStatusLevel = 'optimal' | 'warning' | 'critical' | 'neutral';

export interface SubsystemHealth {
  id: string;
  name: string;
  arName: string;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'INTACT' | 'TAMPERED' | 'ACTIVE' | 'INACTIVE' | 'AUTHENTICATED' | 'UNAUTHENTICATED';
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
          status: 'INTACT',
          level: 'neutral',
          lastChecked: now,
          details: 'جاري فحص سلامة كتل التدقيق'
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
      details: isOnline ? 'اتصال الإنترنت سليم ويعمل' : 'انقطع الاتصال بالإنترنت تماماً'
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
        const mcpStatus = subs.mcpProtocol?.status || 'ONLINE';
        mcpSubsystem = {
          id: 'mcp',
          name: 'MCP Protocol Gateway',
          arName: 'بوابة خوادم بروتوكول MCP',
          status: mcpStatus,
          level: mcpStatus === 'ONLINE' ? 'optimal' : 'warning',
          latencyMs: serverLatency,
          lastChecked: now,
          details: subs.mcpProtocol?.message || 'خادم MCP نشط ويقبل استدعاء الأدوات',
          rawPayload: subs.mcpProtocol
        };

        // Audit Ledger
        const auditStatus = subs.auditLedger?.status || 'ONLINE';
        auditSubsystem = {
          id: 'auditLedger',
          name: 'Audit Hash Chain',
          arName: 'سلسلة التدقيق التشفيرية SHA-256',
          status: auditStatus,
          level: auditStatus === 'ONLINE' ? 'optimal' : 'critical',
          latencyMs: serverLatency,
          lastChecked: now,
          details: subs.auditLedger?.message || 'السلسلة متصلة وسليمة 100%',
          rawPayload: subs.auditLedger
        };

        // Sentinel SOC
        sentinelSubsystem = {
          id: 'sentinelSoc',
          name: 'Sentinel SOC Boundary',
          arName: 'جدار حماية العمليات الأمنية Sentinel',
          status: 'ACTIVE',
          level: 'optimal',
          latencyMs: serverLatency,
          lastChecked: now,
          details: subs.sentinelSoc?.message || 'جدار حماية Zero-Trust مفعل على مسارات الخزينة',
          rawPayload: subs.sentinelSoc
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
        status: 'TAMPERED',
        level: 'critical',
        lastChecked: now,
        details: 'فشل التحقق من سلسلة التدقيق (الخادم غير متاح)'
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
        firestoreSubsystem = {
          id: 'firestore',
          name: 'Cloud Firestore',
          arName: 'قاعدة البيانات والمزامنة السحابية',
          status: 'DEGRADED',
          level: 'warning',
          latencyMs: fsLatency,
          lastChecked: now,
          details: 'قاعدة Firestore متصلة، لكن تتطلب تسجيل الدخول للوصول للجلسات'
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
        : 'خادم الخدمة في وضع الاستعداد'
    };

    // Compute Overall Truth Level (Real Core Infrastructure)
    const coreInfraSubs = [networkSubsystem, serverCore, firestoreSubsystem, mcpSubsystem, auditSubsystem, sentinelSubsystem];
    const hasCritical = coreInfraSubs.some(s => s.level === 'critical');
    const hasWarning = coreInfraSubs.some(s => s.level === 'warning');

    let overallLevel: HealthStatusLevel = 'optimal';
    let overallStatusText = 'كافة خوادم ومؤشرات النظام السيادي متصلة وتعمل بكفاءة تامة';

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
