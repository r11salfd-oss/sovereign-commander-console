import React, { useState, useEffect, useCallback, useRef } from 'react';
import { collection, onSnapshot, query, where, orderBy, getDocs, doc, writeBatch, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import Header from '../components/Header';
import BrainMap from '../components/BrainMap';
import ApprovalQueue from '../components/ApprovalQueue';
import ProposeAction from '../components/ProposeAction';
import AuditChain from '../components/AuditChain';
import AgentCorps from '../components/AgentCorps';
import Footer from '../components/Footer';
import InputDock from '../components/capsule/InputDock';
import WorkspaceBrowser from '../components/capsule/WorkspaceBrowser';
import { Approval, BrainMap as BrainMapType, AuditStatus } from '../types';
import { Activity, ShieldAlert, Terminal, RefreshCw, X } from 'lucide-react';
import { useWorkspace } from '../hooks/useWorkspace';
import RealTimeEventLogger, { LogEvent } from '../components/RealTimeEventLogger';

export default function ConsolePage() {
  const { workspaceInfo } = useWorkspace();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [brainMap, setBrainMap] = useState<BrainMapType | null>(null);
  const [auditStatus, setAuditStatus] = useState<AuditStatus | null>(null);
  
  // Real-Time Event Logs state
  const [logs, setLogs] = useState<LogEvent[]>([
    {
      id: 'init-1',
      timestamp: new Date().toISOString(),
      type: 'SYSTEM_STATUS',
      source: 'CONSOLE_KERNEL',
      message: 'Sovereign Commander Console initialized successfully. Real-time event logging system active.',
      details: 'Connected to Firebase Firestore & Gemini AI endpoints.'
    }
  ]);

  const addLog = useCallback((type: LogEvent['type'], source: string, message: string, details?: string) => {
    const newLog: LogEvent = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      type,
      source,
      message,
      details
    };
    setLogs(prev => [...prev.slice(-200), newLog]);
  }, []);

  
  // UI States
  const [loading, setLoading] = useState<Record<string, boolean>>({
    approvals: false,
    brainMap: false,
    audit: false,
    sys: false
  });
  
  const [submittingProposal, setSubmittingProposal] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  
  // Custom Error alert structures
  const [errorBanner, setErrorBanner] = useState<{
    message: string;
    details?: string;
    visible: boolean;
  } | null>(null);

  // Direction RTL state
  const [isRtl, setIsRtl] = useState(false);

  // Critical Audit Toast Alert State
  const [auditAlert, setAuditAlert] = useState<{ visible: boolean; time: string } | null>(null);
  const previousAuditStatus = useRef<AuditStatus | null>(null);

  // --- API Function 1: Load Approvals ---
  const loadApprovals = useCallback(async () => {
    // Relying on useEffect for onSnapshot instead of single fetch
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'approvals'), 
      where('creatorId', '==', auth.currentUser.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fbApprovals = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Approval))
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      setApprovals(fbApprovals);
      setLoading(prev => ({ ...prev, approvals: false }));
    }, (error) => {
      setErrorBanner({
        message: 'Network Error: Failed to sync approvals queue from Firebase.',
        details: error.message,
        visible: true
      });
      setLoading(prev => ({ ...prev, approvals: false }));
    });
    return () => unsubscribe();
  }, []);

  // --- API Function 2: Load Brain Map ---
  const loadBrainMap = useCallback(async () => {
    setLoading(prev => ({ ...prev, brainMap: true }));
    try {
      const resp = await fetch('/api/brainmap');
      if (!resp.ok) {
        throw new Error(`Failed to load model map. Status: ${resp.status}`);
      }
      const data = await resp.json();
      setBrainMap(data);
      addLog('MODEL_INTERACTION', 'GEMINI_BRAINMAP', 'Model brain map synchronized successfully with active LLM routes.', JSON.stringify(data.models));
    } catch (err: any) {
      console.warn('Unable to load api/brainmap, using graceful offline fallbacks.', err);
      setBrainMap({
        models: {
          reasoning: 'gemini-3.1-flash-lite',
          planning: 'gemini-3.1-flash-lite',
          coding: 'gemini-3.1-flash-lite',
          fallback: 'gemini-3.1-flash-lite'
        }
      });
      addLog('ERROR', 'GEMINI_BRAINMAP', 'Failed to fetch dynamic brain map. Fallback models engaged.', err.message);
    } finally {
      setLoading(prev => ({ ...prev, brainMap: false }));
    }
  }, [addLog]);

  // --- API Function 3: Load Audit Verify ---
  const loadAudit = useCallback(async () => {
    setLoading(prev => ({ ...prev, audit: true }));
    try {
      const resp = await fetch('/api/hitl/audit/verify', { cache: 'no-store' });
      const contentType = resp.headers.get('content-type') || '';
      
      if (!resp.ok || !contentType.includes('application/json')) {
        return;
      }
      
      const data = await resp.json();
      const normalized: AuditStatus = {
        status: data.ok === true ? "INTACT" : "BROKEN",
        brokenAt: data.brokenAt ?? null,
        lastRefresh: new Date().toISOString()
      };
      
      if (previousAuditStatus.current?.status === 'INTACT' && normalized.status === 'BROKEN') {
        setAuditAlert({ 
          visible: true, 
          time: normalized.brokenAt || new Date().toISOString() 
        });
        addLog('ERROR', 'AUDIT_CHAIN', 'CRITICAL: Cryptographic audit chain integrity broken!', `Broken at: ${normalized.brokenAt}`);
      } else if (previousAuditStatus.current?.status !== normalized.status) {
        addLog('AUDIT_EVENT', 'AUDIT_CHAIN', `Audit ledger status verified: ${normalized.status}`, `Timestamp: ${normalized.lastRefresh}`);
      }
      previousAuditStatus.current = normalized;
      
      setAuditStatus(normalized);
      setErrorBanner(prev => (prev?.visible && prev.message.includes('Security Audit Connection Failure') ? null : prev));
    } catch (err: any) {
      console.warn('Audit ledger check error:', err);
    } finally {
      setLoading(prev => ({ ...prev, audit: false }));
    }
  }, [addLog]);

  // --- API Function 4: Propose operational action ---
  const handleProposeAction = async (payload: {
    agent: string;
    type: string;
    summary: string;
    reason: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    payload: any;
  }) => {
    setSubmittingProposal(true);
    try {
      if (!auth.currentUser) throw new Error("Must be logged in to propose.");
      const docRef = doc(collection(db, 'approvals'));
      
      await setDoc(docRef, {
        ...payload,
        id: docRef.id,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        creatorId: auth.currentUser.uid
      });
      addLog('SYSTEM_STATUS', 'APPROVAL_QUEUE', `Operational proposal lodged by agent [${payload.agent}]`, `Summary: ${payload.summary} (Risk: ${payload.risk})`);
    } catch (err: any) {
      setErrorBanner({
        message: 'Lodge Proposal Exception: Verification blocked.',
        details: err.message || JSON.stringify(err),
        visible: true
      });
      addLog('ERROR', 'APPROVAL_QUEUE', 'Failed to lodge operational proposal.', err.message);
    } finally {
      setSubmittingProposal(false);
    }
  };

  // --- API Function 5: Approve Action (Disabled from browser) ---
  const handleApproveLocal = async (id: string) => {
    setErrorBanner({
      message: 'Browser approval forbidden.',
      details: 'Please use the PowerShell command to approve with HMAC signature.',
      visible: true
    });
    addLog('ERROR', 'GOVERNANCE', 'Attempted unauthorized browser approval action.', `Target ID: ${id}`);
  };

  // --- API Function 6: Reject Action ---
  const handleRejectLocal = async (id: string) => {
    try {
      await updateDoc(doc(db, 'approvals', id), {
        status: 'rejected'
      });
      addLog('SYSTEM_STATUS', 'APPROVAL_QUEUE', `Approval operational block rejected.`, `ID: ${id}`);
    } catch (err: any) {
      setErrorBanner({
        message: 'State Update Error: Failed to reject operational block.',
        details: err.message || JSON.stringify(err),
        visible: true
      });
      addLog('ERROR', 'APPROVAL_QUEUE', 'Failed to reject approval block.', err.message);
    }
  };

  // --- API Function 7: Execute Approved Action (Disabled from browser) ---
  const handleExecute = async (id: string) => {
    setErrorBanner({
      message: 'Browser execution forbidden.',
      details: 'Please use the PowerShell command to execute the signed payload.',
      visible: true
    });
    addLog('ERROR', 'GOVERNANCE', 'Attempted unauthorized browser execution action.', `Target ID: ${id}`);
  };

  const handleClearLogs = () => {
    setLogs([{
      id: 'cleared-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: 'SYSTEM_STATUS',
      source: 'CONSOLE_KERNEL',
      message: 'Event log buffer cleared by commander.'
    }]);
  };

  const handleExportLogs = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `sovereign_audit_logs_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    addLog('SYSTEM_STATUS', 'CONSOLE_KERNEL', 'Audit logs exported successfully as JSON payload.');
  };

  // --- Sync Master Wrapper ---
  const refreshAll = useCallback(async () => {
    setLoading(prev => ({ ...prev, sys: true }));
    try {
      await Promise.all([
        loadBrainMap(),
        loadAudit()
      ]);
    } catch (err) {
      console.error('Unified sync sequence reported exceptions:', err);
    } finally {
      setLoading(prev => ({ ...prev, sys: false }));
    }
  }, [loadBrainMap, loadAudit]);

  // --- Auto-Refresh Intervals Hook ---
  useEffect(() => {
    // Initial sync
    refreshAll();

    // audit: every 20s with visibility guard to prevent background CPU drain
    const auditInv = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      loadAudit();
    }, 20000);

    return () => {
      clearInterval(auditInv);
    };
  }, [refreshAll, loadAudit]);

  return (
    <main 
      className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col justify-between"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Background Subtle Tech Grid Line Accents */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(11,16,27,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(11,16,27,0.4)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-50"></div>

      {/* Main Console Container */}
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 relative z-10 flex-grow">
        
        {/* Audit Critical Toast Notification */}
        {auditAlert?.visible && (
          <div className="fixed bottom-6 right-6 z-50 bg-rose-950/95 border border-rose-500/50 shadow-[0_10px_40px_-5px_rgba(225,29,72,0.4)] rounded-xl p-4 w-80 lg:w-96 transition-all duration-300">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-rose-500 rounded-l-xl"></div>
            <div className="flex items-start gap-4">
              <ShieldAlert className="h-7 w-7 text-rose-500 shrink-0 mt-0.5 animate-pulse" />
              <div className="flex-1">
                <h4 className="text-[13px] font-bold text-rose-400 font-display uppercase tracking-widest text-shadow-sm shadow-rose-900 filter drop-shadow">CRITICAL ALERT</h4>
                <p className="text-xs text-rose-200 mt-1.5 font-sans leading-relaxed">
                  Ledger integrity compromised at <span className="font-mono text-[10px] text-rose-300 bg-rose-950/50 px-1 py-0.5 rounded border border-rose-900 overflow-hidden block mt-1">{new Date(auditAlert.time).toISOString().replace('T', ' ')}</span>
                </p>
                <div className="text-[10px] font-mono text-rose-400/80 uppercase mt-2">Immediate review required.</div>
              </div>
              <button 
                onClick={() => setAuditAlert(null)} 
                className="text-rose-500 hover:text-rose-400 p-1 hover:bg-rose-950 rounded transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Upper Option Bar (RTL Toggle, Unified Refresh) */}
        <div className="flex justify-between items-center mb-4 text-xs font-mono font-bold select-none">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsRtl(!isRtl)}
              className="bg-slate-950/80 border border-slate-800 text-cyan-400 hover:text-cyan-300 px-3 py-1.5 rounded transition-all cursor-pointer flex items-center gap-1.5 uppercase"
            >
              <span>{isRtl ? 'English Base' : 'العربية RTL'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 hidden sm:inline">WAR_CHEST BOUNDS: STRICTLY_ENFORCED</span>
            <button
              onClick={refreshAll}
              disabled={loading.sys}
              className="bg-cyan-600/10 hover:bg-cyan-600/20 border border-cyan-500/20 hover:border-cyan-400 text-cyan-300 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all cursor-pointer"
              id="btn-master-sync"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading.sys ? 'animate-spin' : ''}`} />
              <span>{loading.sys ? 'Syncing...' : 'Commander Sync / مزامنة رئيسية'}</span>
            </button>
          </div>
        </div>

        {/* Global Error Banner Display */}
        {errorBanner?.visible && (
          <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 p-4 rounded-xl flex items-start gap-3.5 mb-6 shadow-2xl relative overflow-hidden animate-bounce-short">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-rose-500"></div>
            <ShieldAlert className="h-6 w-6 text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="w-full">
              <div className="flex justify-between items-start gap-2">
                <h4 className="font-bold text-sm uppercase tracking-wide">
                  Sentinel System Notification / إشعار النظام
                </h4>
                <button
                  onClick={() => setErrorBanner(null)}
                  className="text-rose-400 hover:text-rose-300 p-0.5"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs font-sans mt-1 leading-relaxed">{errorBanner.message}</p>
              {errorBanner.details && (
                <details className="mt-2.5">
                  <summary className="text-[10px] font-mono font-bold cursor-pointer text-rose-400 select-none uppercase hover:underline">
                    Collapse Diagnostic Core Dump / تفاصيل الهاش
                  </summary>
                  <pre className="mt-2 text-[10px] font-mono bg-slate-950 border border-slate-900 rounded p-2.5 max-h-36 overflow-y-auto leading-relaxed text-rose-200">
                    {errorBanner.details}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}

        {/* 1. Header component status strip */}
        <Header
          hitlActive={true}
          auditIntact={auditStatus?.status === 'INTACT'}
          workspacePath={workspaceInfo.displayPath}
        />

        {/* 2. Model Brain Matrix Map */}
        <BrainMap modelMap={brainMap} loading={loading.brainMap} />

        {/* Grid Block splits Main queue + proposal tools layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Main approvals operations queue (8 columns grid room) */}
          <div className="lg:col-span-8 space-y-6">
            <ApprovalQueue
              approvals={approvals}
              onExecute={handleExecute}
              onRejectLocal={handleRejectLocal}
              onApproveLocal={handleApproveLocal}
              onRefresh={loadApprovals}
              executingId={executingId}
            />
          </div>

          {/* Quick proposal launcher widgets (4 columns grid room) */}
          <div className="lg:col-span-4 space-y-6">
            <ProposeAction 
              onPropose={handleProposeAction} 
              submitting={submittingProposal} 
            />

            <InputDock />
            
            <WorkspaceBrowser />

            <AuditChain
              auditStatus={auditStatus}
              loading={loading.audit}
              onRefresh={loadAudit}
            />
          </div>

        </div>

        {/* Real-Time Event Logging System */}
        <div className="my-6">
          <RealTimeEventLogger 
            logs={logs} 
            onClearLogs={handleClearLogs} 
            onExportLogs={handleExportLogs} 
          />
        </div>

        {/* 3. Operational Agent Core directory */}
        <AgentCorps />

        {/* 4. Console safe disclaimers/limits footer */}
        <Footer />

      </div>
    </main>
  );
}
