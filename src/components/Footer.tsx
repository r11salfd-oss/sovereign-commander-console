import React from 'react';
import { ShieldAlert, Cpu, Heart } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="mt-8 border-t border-slate-900 pt-6 pb-12 font-mono text-xs text-slate-500">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
        {/* Status Line Safeguards */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 justify-center md:justify-start">
            <ShieldAlert className="h-4 w-4 text-rose-500 animate-pulse" />
            <span className="text-gray-300 font-bold tracking-wider">SOVEREIGN_WAR_CHEST:</span>
            <span className="text-rose-500 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-900/40 font-bold uppercase tracking-widest text-[10px]">
              DENY_ALL / غير مصرح بالوصول
            </span>
          </div>
          <p className="text-[10px] text-slate-600 font-sans font-light">
            Critical assets protection gate is enforced. Core payload scanners are online.
          </p>
        </div>

        {/* Dynamic platform indicators */}
        <div className="flex flex-wrap justify-center gap-2.5 text-[10px] font-mono font-semibold">
          <span className="bg-slate-950/80 border border-slate-800 text-slate-400 px-2 py-1 rounded">
            🛡️ HITL_LEDGER: ATTESTED
          </span>
          <span className="bg-slate-950/80 border border-slate-800 text-slate-400 px-2 py-1 rounded">
            🧬 PATHS: WIN32_WSL_NORMALIZED
          </span>
          <span className="bg-slate-950/80 border border-slate-800 text-emerald-400 border-emerald-900/40 px-2 py-1 rounded">
            ✨ EXECUTIONS: NO_BYPASS
          </span>
        </div>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row justify-between items-center border-t border-slate-900/40 pt-4 text-[10px] text-slate-600 font-sans gap-2">
        <p className="flex items-center gap-1.5">
          <Cpu className="h-3 w-3 text-cyan-600" />
          <span>Sovereign Forge Command Core Console • Handcrafted and Verified</span>
        </p>
        <p className="text-right">
          Authorized Commander Oversight Protocol Enforced.
        </p>
      </div>
    </footer>
  );
}
