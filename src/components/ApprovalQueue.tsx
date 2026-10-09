import React, { useState, useOptimistic, useTransition } from 'react';
import { 
  Clock, Check, X, Play, Copy, RefreshCw, AlertTriangle, 
  Terminal, ShieldCheck, ChevronRight, ChevronDown 
} from 'lucide-react';
import { Approval } from '../types';

interface ApprovalQueueProps {
  approvals: Approval[];
  onExecute: (id: string) => Promise<void>;
  onRejectLocal: (id: string) => Promise<void>;
  onApproveLocal: (id: string) => Promise<void>;
  onRefresh: () => void;
  executingId: string | null;
}

export default function ApprovalQueue({ 
  approvals, 
  onExecute, 
  onRejectLocal,
  onApproveLocal,
  onRefresh, 
  executingId 
}: ApprovalQueueProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  // React 19 Optimistic UI: Immediately reflects status transition
  const [optimisticApprovals, setOptimisticApprovals] = useOptimistic(
    approvals,
    (state: Approval[], update: { id: string; status: Approval['status'] }) => {
      return state.map(item => item.id === update.id ? { ...item, status: update.status } : item);
    }
  );

  const handleOptimisticApprove = (id: string) => {
    startTransition(async () => {
      setOptimisticApprovals({ id, status: 'approved' });
      await onApproveLocal(id);
    });
  };

  const handleOptimisticReject = (id: string) => {
    startTransition(async () => {
      setOptimisticApprovals({ id, status: 'rejected' });
      await onRejectLocal(id);
    });
  };

  const handleOptimisticExecute = (id: string) => {
    startTransition(async () => {
      setOptimisticApprovals({ id, status: 'executed' });
      await onExecute(id);
    });
  };

  const handleCopy = (text: string, id: string, type: 'approve' | 'execute' | 'verify') => {
    navigator.clipboard.writeText(text);
    setCopiedId(`${id}-${type}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleResult = (id: string) => {
    setExpandedResults(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'pending':
        return {
          bg: 'bg-amber-950/40 border-amber-900/60',
          text: 'text-amber-400',
          glow: 'glow-amber',
          dot: 'bg-amber-500'
        };
      case 'approved':
        return {
          bg: 'bg-cyan-950/40 border-cyan-900/60',
          text: 'text-cyan-400',
          glow: 'glow-cyan',
          dot: 'bg-cyan-400'
        };
      case 'executed':
        return {
          bg: 'bg-emerald-950/40 border-emerald-900/60',
          text: 'text-emerald-400',
          glow: 'glow-emerald',
          dot: 'bg-emerald-400'
        };
      case 'failed':
        return {
          bg: 'bg-rose-950/40 border-rose-900/60',
          text: 'text-rose-400',
          glow: 'shadow-rose-900/20',
          dot: 'bg-rose-500'
        };
      case 'rejected':
        return {
          bg: 'bg-slate-900/60 border-slate-800',
          text: 'text-slate-400',
          glow: '',
          dot: 'bg-slate-500'
        };
      case 'expired':
        return {
          bg: 'bg-orange-950/40 border-orange-900/50',
          text: 'text-orange-400',
          glow: '',
          dot: 'bg-orange-500'
        };
      default:
        return {
          bg: 'bg-slate-900/60 border-slate-800',
          text: 'text-slate-400',
          glow: '',
          dot: 'bg-slate-400'
        };
    }
  };

  const getRiskStyle = (risk: string) => {
    switch (risk) {
      case 'low':
        return 'text-emerald-400 border-emerald-500/20 bg-emerald-950/20';
      case 'medium':
        return 'text-cyan-400 border-cyan-500/20 bg-cyan-950/20';
      case 'high':
        return 'text-amber-400 border-amber-500/20 bg-amber-950/20';
      case 'critical':
        return 'text-rose-400 border-rose-500/20 bg-rose-950/20 animate-pulse';
      default:
        return 'text-slate-400 border-slate-500/20 bg-slate-950/20';
    }
  };

  return (
    <section className="glass-panel rounded-xl p-5 glow-cyan border-cyan-500/10 mb-6">
      {/* Title block */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse"></div>
          <div>
            <h2 className="font-display font-semibold text-sm tracking-wider uppercase text-gray-200">
              HITL Human Approval Queue / طابور الموافقة البشرية
            </h2>
            <p className="text-[10px] text-gray-500 font-mono mt-0.5">
              Secure commander cryptographic approvals ledger
            </p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-950/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 font-mono text-xs text-cyan-400 hover:text-cyan-300 transition-all cursor-pointer"
          id="btn-manual-refresh-approvals"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Sync Queue / تحديث</span>
        </button>
      </div>

      {approvals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-slate-800/80 rounded-xl bg-slate-950/20">
          <ShieldCheck className="h-10 w-10 text-slate-600 mb-3" />
          <h3 className="text-gray-400 font-medium text-sm uppercase tracking-wider">Queue Clear</h3>
          <p className="text-gray-500 text-xs mt-1 max-w-sm">
            All agent operations are fully approved or executed. Rest.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {optimisticApprovals.map((appr) => {
            const styles = getStatusStyle(appr.status);
            const riskClass = getRiskStyle(appr.risk);

            // Command strings generated for PowerShell instructions to mimic sovereign security rules
            const approveCmd = `powershell -ExecutionPolicy Bypass -File "C:\\Users\\ai\\Hitl-Approve.ps1" -Id "${appr.id}"`;
            const executeCmd = `powershell -ExecutionPolicy Bypass -File "C:\\Users\\ai\\Hitl-Execute.ps1" -Id "${appr.id}"`;
            const verifyCmd = `powershell -ExecutionPolicy Bypass -File "C:\\Users\\ai\\Hitl-VerifyChain.ps1"`;

            const isPending = appr.status === 'pending';
            const isApproved = appr.status === 'approved';
            const isExecuted = appr.status === 'executed';

            return (
              <div
                key={appr.id}
                id={`approval-card-${appr.id}`}
                className={`border rounded-xl transition-all duration-300 relative overflow-hidden bg-slate-950/30 ${styles.bg}`}
              >
                {/* Visual Glow Status bar Left boundary stripe */}
                <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${styles.dot}`} />

                {/* Card Header information grid */}
                <div className="p-5">
                  <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono font-bold text-xs text-slate-500 tracking-wider">
                        #{appr.id}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${riskClass}`}>
                        RISK: {appr.risk}
                      </span>
                      <span className="text-xs font-semibold text-cyan-400 bg-cyan-950/20 border border-cyan-900/50 px-2 py-0.5 rounded font-mono">
                        {appr.agent}
                      </span>
                      <span className="bg-slate-900/60 border border-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] font-mono">
                        {appr.type}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 mr-2">
                        <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
                        <span className={`font-mono text-[11px] font-bold uppercase relative tracking-wider ${styles.text}`}>
                          {appr.status}
                        </span>
                      </div>
                      
                      {/* React 19 Optimistic Interactive Action Controls */}
                      {isPending && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOptimisticApprove(appr.id)}
                            className="bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-600/70 text-emerald-300 text-[10px] font-mono font-bold px-2.5 py-1 rounded transition-all duration-200 flex items-center gap-1 shadow-sm shadow-emerald-950 hover:scale-105 active:scale-95"
                            title="Approve and authorize cryptographic execution"
                          >
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span>Approve / موافقة</span>
                          </button>
                          <button
                            onClick={() => handleOptimisticReject(appr.id)}
                            className="bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-400 text-[10px] font-mono font-medium px-2 py-1 rounded transition-all duration-200 flex items-center gap-1 hover:scale-105 active:scale-95"
                            title="Reject proposed operation"
                          >
                            <X className="h-3 w-3 text-rose-400" />
                            <span>Reject / رفض</span>
                          </button>
                        </div>
                      )}

                      {(isPending || isApproved) && (
                        <button
                          disabled={!isApproved || executingId === appr.id}
                          onClick={() => handleOptimisticExecute(appr.id)}
                          className={`border text-[10px] font-mono font-bold px-2.5 py-1 rounded transition-all duration-200 flex items-center gap-1
                            ${isApproved 
                              ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/40 hover:border-emerald-400 text-emerald-300 animate-pulse hover:scale-105 active:scale-95' 
                              : 'bg-slate-900/60 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                            }`
                          }
                          title={isApproved ? "Authorized signature attached. Execute operational pipeline." : "Cannot execute without signature"}
                        >
                          {executingId === appr.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                          <span>
                            {executingId === appr.id ? 'Running...' : 'Execute / تشغيل'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Operational Summary */}
                  <div className="mb-4">
                    <h3 className="text-gray-200 text-sm font-semibold tracking-wide font-sans mb-1">
                      {appr.summary}
                    </h3>
                    <p className="text-gray-400 text-xs font-light leading-relaxed font-sans">
                      {appr.reason}
                    </p>
                  </div>

                  {/* Host-Bound Command Prompts Box */}
                  <div className="bg-slate-950/80 border border-slate-900 rounded-lg p-3.5 mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 text-[11px] font-mono">
                    
                    {/* Command: Crypto Sign */}
                    <div className="flex flex-col justify-between p-2.5 bg-slate-900/60 rounded border border-slate-800/80">
                      <div className="flex justify-between items-center text-slate-500 font-bold text-[9px] uppercase tracking-wider mb-2">
                        <span>1. Approve & Crypto-Sign Line</span>
                        <span className="text-amber-500">PowerShell API</span>
                      </div>
                      <code className="text-amber-300 font-bold truncate block bg-slate-950 px-1.5 py-1 rounded border border-slate-900 my-1 font-mono text-[10px]">
                        {approveCmd}
                      </code>
                      <button
                        onClick={() => handleCopy(approveCmd, appr.id, 'approve')}
                        className="mt-2 text-[10px] text-cyan-400 font-bold hover:text-cyan-300 transition-colors flex items-center gap-1 self-start pointer-events-auto"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>
                          {copiedId === `${appr.id}-approve` ? 'Copied Command!' : 'Copy Power-Sign Script'}
                        </span>
                      </button>
                    </div>

                    {/* Command: Execute Payload */}
                    <div className="flex flex-col justify-between p-2.5 bg-slate-900/60 rounded border border-slate-800/80">
                      <div className="flex justify-between items-center text-slate-500 font-bold text-[9px] uppercase tracking-wider mb-2">
                        <span>2. Host Execution Line</span>
                        <span className="text-emerald-500">Signature Required</span>
                      </div>
                      <code className={`font-bold truncate block bg-slate-950 px-1.5 py-1 rounded border border-slate-900 my-1 font-mono text-[10px] ${isApproved ? 'text-emerald-300' : 'text-slate-600'}`}>
                        {executeCmd}
                      </code>
                      <button
                        disabled={!isApproved}
                        onClick={() => handleCopy(executeCmd, appr.id, 'execute')}
                        className={`mt-2 text-[10px] font-bold transition-colors flex items-center gap-1 self-start cursor-pointer ${
                          isApproved ? 'text-cyan-400 hover:text-cyan-300' : 'text-slate-600 cursor-not-allowed'
                        }`}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>
                          {copiedId === `${appr.id}-execute` ? 'Copied Command!' : 'Copy Execution Script'}
                        </span>
                      </button>
                    </div>

                    {/* Command: System Verify */}
                    <div className="flex flex-col justify-between p-2.5 bg-slate-900/60 rounded border border-slate-800/80 md:col-span-2 lg:col-span-1">
                      <div className="flex justify-between items-center text-slate-500 font-bold text-[9px] uppercase tracking-wider mb-2">
                        <span>3. Audit chain verify logic</span>
                        <span className="text-cyan-500">Global Ledger</span>
                      </div>
                      <code className="text-cyan-300 font-bold truncate block bg-slate-950 px-1.5 py-1 rounded border border-slate-900 my-1 font-mono text-[10px]">
                        {verifyCmd}
                      </code>
                      <button
                        onClick={() => handleCopy(verifyCmd, appr.id, 'verify')}
                        className="mt-2 text-[10px] text-cyan-400 font-bold hover:text-cyan-300 transition-colors flex items-center gap-1 self-start pointer-events-auto"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>
                          {copiedId === `${appr.id}-verify` ? 'Copied Command!' : 'Copy Verify Script'}
                        </span>
                      </button>
                    </div>

                  </div>

                  {/* Core Payload View Fold */}
                  <div className="bg-slate-950/70 border border-slate-900 rounded-lg p-3">
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-mono font-bold mb-2">
                      <span className="flex items-center gap-1">
                        <Terminal className="h-3.5 w-3.5 text-cyan-500" />
                        <span>PROPOSED PAYLOAD SCHEMATIC</span>
                      </span>
                      <span>JSON / UTF-8</span>
                    </div>
                    <pre className="text-[11px] font-mono text-cyan-200/90 overflow-x-auto p-2 bg-slate-950 rounded border border-slate-900 max-h-48 leading-relaxed">
                      {JSON.stringify(appr.payload, null, 2)}
                    </pre>
                  </div>

                  {/* Cryptographic Signature line if exists */}
                  {appr.signature && (
                    <div className="mt-3.5 pt-3.5 border-t border-slate-900/40 flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-slate-500 font-bold">HMAC PROTOCOL SIGNATURE:</span>
                      <span className="text-cyan-400 truncate tracking-wide bg-cyan-950/30 px-2 py-0.5 rounded border border-cyan-900/30">
                        {appr.signature}
                      </span>
                    </div>
                  )}

                  {/* Execution Results Stdout / Stderr Accordion drawer */}
                  {isExecuted && appr.result && (
                    <div className="mt-4 pt-4 border-t border-slate-900">
                      <button
                        onClick={() => toggleResult(appr.id)}
                        className="flex items-center justify-between w-full hover:bg-slate-900/60 p-2 rounded transition-colors text-xs font-mono font-bold text-emerald-400 select-none pb-2 text-left"
                      >
                        <span className="flex items-center gap-1.5">
                          <Terminal className="h-4 w-4" />
                          <span>OPERATION OUTPUTS (EXIT: {appr.result.exitCode})</span>
                        </span>
                        {expandedResults[appr.id] ? (
                          <ChevronDown className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-emerald-500" />
                        )}
                      </button>

                      {(!expandedResults[appr.id]) && (
                        <div className="text-slate-500 font-mono text-[10px] italic pl-7 cursor-pointer" onClick={() => toggleResult(appr.id)}>
                          Click to expand standard outputs feed...
                        </div>
                      )}

                      {expandedResults[appr.id] && (
                        <div className="mt-2 text-[11px] font-mono bg-slate-950 border border-slate-900 rounded p-3 text-emerald-300/90 max-h-60 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                          {appr.result.stdout || 'None'}
                          {appr.result.stderr && (
                            <div className="text-rose-400 mt-2 border-t border-rose-950/40 pt-2">
                              {appr.result.stderr}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Dates tracker row */}
                  <div className="mt-3.5 pt-3.5 border-t border-slate-900/40 flex flex-wrap gap-x-6 gap-y-2 text-[11px] font-mono text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-600" />
                      <span>Lodge Date: {appr.createdAt.replace('T', ' ').substring(0, 19)} UTC</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-slate-600" />
                      <span>Expires: {appr.expiresAt.replace('T', ' ').substring(0, 19)} UTC</span>
                    </span>
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
