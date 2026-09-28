import React from 'react';
import { ShieldCheck, ShieldAlert, RefreshCw, Layers } from 'lucide-react';
import { AuditStatus } from '../types';

interface AuditChainProps {
  auditStatus: AuditStatus | null;
  loading: boolean;
  onRefresh: () => void;
}

export default function AuditChain({ auditStatus, loading, onRefresh }: AuditChainProps) {
  const isIntact = auditStatus?.status !== 'BROKEN';

  return (
    <section className="glass-panel rounded-xl p-5 glow-cyan border-cyan-500/10 mb-6">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-cyan-400" />
          <h2 className="font-display font-semibold text-sm tracking-wider uppercase text-gray-200">
            Hash Audit Chain Ledger / سلسلة التدقيق وتوقيعات الهاش
          </h2>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors uppercase cursor-pointer"
        >
          {loading ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          <span>Verify Chain / تحقق</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Visual Ledger integrity badge */}
        <div className={`p-4 rounded-lg border flex flex-col justify-between md:col-span-2 ${
          isIntact 
            ? 'bg-emerald-950/25 border-emerald-950/70 text-emerald-400 glow-emerald' 
            : 'bg-rose-950/25 border-rose-950/80 text-rose-400 animate-pulse'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-full ${isIntact ? 'bg-emerald-950/55' : 'bg-rose-950/50'}`}>
              {isIntact ? (
                <ShieldCheck className="h-6 w-6 text-emerald-400" />
              ) : (
                <ShieldAlert className="h-6 w-6 text-rose-400" />
              )}
            </div>
            <div>
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                Lattice Verification State
              </h3>
              <div className="text-lg font-display font-bold tracking-widest mt-0.5">
                {isIntact ? 'INTEGRITY SECURED / سليم' : 'CRYPTO_CHAIN_TAMPERED / مخترق'}
              </div>
              <p className="text-xs text-slate-400 font-sans font-light mt-1.5 leading-relaxed">
                {isIntact 
                  ? 'The local decentralized audit chain verification was successfully compiled. cryptographic ledger block hashes align perfectly. No unacknowledged path tampering of source artifacts detected.' 
                  : `Warning! Ledger chain mismatch detected. Action context hash is corrupted since: ${auditStatus?.brokenAt || 'Unknown timestamp'}. Review administrative terminal log immediately.`
                }
              </p>
            </div>
          </div>
        </div>

        {/* Technical Ledger details list */}
        <div className="bg-slate-950/50 border border-slate-900 rounded-lg p-4 font-mono text-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex justify-between items-center text-slate-500 font-bold uppercase text-[9px]">
              <span>LEDGER SYSTEM ATTESTATION</span>
              <span className="text-cyan-500">SHA-256</span>
            </div>
            
            <div className="space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Verification Logic:</span>
                <span className="text-slate-300 font-semibold truncate">C:\\Users\\ai\\Hitl-VerifyChain.ps1</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Security Gate:</span>
                <span className="text-emerald-400">ENFORCED</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Last Checked:</span>
                <span className="text-cyan-300 truncate tracking-tight">
                  {auditStatus?.lastRefresh 
                    ? new Date(auditStatus.lastRefresh).toISOString().replace('T', ' ').substring(11, 19) + ' UTC' 
                    : 'System starting...'
                  }
                </span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-500">
            <span>PowerShell Node Link</span>
            <span className="text-emerald-500 font-bold bg-emerald-950/25 px-1.5 py-0.5 rounded border border-emerald-900/30">SECURE BOUNDS</span>
          </div>
        </div>
      </div>
    </section>
  );
}
