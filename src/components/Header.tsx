import React, { useState, useEffect } from 'react';
import { Cpu, ShieldAlert, BadgeCheck, FileCode, Clock, Database, Radio, Activity } from 'lucide-react';
import { useSystemTelemetry } from '../hooks/useSystemTelemetry';
import TelemetryDiagnosticsModal from './TelemetryDiagnosticsModal';

interface HeaderProps {
  hitlActive: boolean;
  auditIntact: boolean;
  workspacePath: string;
}

export default function Header({ hitlActive, auditIntact, workspacePath }: HeaderProps) {
  const [time, setTime] = useState<string>('');
  const [platform, setPlatform] = useState<string>('Dynamic Cloud Shell');
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);

  const { subsystems, telemetry } = useSystemTelemetry();

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (subsystems.serverCore?.rawPayload?.platform) {
      setPlatform(subsystems.serverCore.rawPayload.platform);
    }
  }, [subsystems.serverCore]);

  const coreOnline = subsystems.serverCore.status === 'ONLINE';
  const mcpOnline = subsystems.mcp.status === 'ONLINE';
  const firestoreOnline = subsystems.firestore.status === 'ONLINE';
  const auditIsIntact = subsystems.auditLedger.status === 'INTACT' || auditIntact;

  return (
    <>
      <header className="glass-panel rounded-xl p-5 sm:p-6 glow-cyan border-cyan-500/20 relative overflow-hidden mb-6">
        {/* Absolute Decorative High-tech Corner Accent */}
        <div className="absolute top-0 right-0 h-16 w-16 pointer-events-none overflow-hidden">
          <div className="absolute top-0 right-0 w-[200%] h-[200%] rotate-45 border-t border-r border-cyan-500/30 translate-x-[50%] -translate-y-[50%] bg-cyan-950/20"></div>
        </div>

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          {/* Title Block */}
          <div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-full bg-cyan-500/20 blur animate-pulse"></div>
                <Cpu className="h-8 w-8 text-cyan-400 relative z-10" id="header-logo-icon" />
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <h1 className="text-xl sm:text-2xl font-display font-bold text-gray-100 tracking-wider uppercase">
                    Sovereign Commander Console
                  </h1>
                  <span className="text-xs font-semibold text-cyan-500/80 font-mono tracking-widest hidden sm:inline">
                    v1.3.0
                  </span>
                </div>
                <p className="text-xs text-cyan-400/70 font-display flex items-center gap-1.5 mt-0.5">
                  <span className="font-sans font-medium text-emerald-400">مركز التحكم السيادي</span>
                  <span className="opacity-40">•</span>
                  <span>AI Human-in-the-Loop Operations & Defensive Lab</span>
                </p>
              </div>
            </div>
          </div>

          {/* 100% Real Live Status Indicators Bar (Clickable for Diagnostics) */}
          <div 
            onClick={() => setIsDiagnosticsOpen(true)}
            title="انقر لفتح مصفوفة القياس والتشخيص الحي للنظام"
            className="grid grid-cols-2 md:grid-cols-5 gap-3 w-full lg:w-auto text-xs font-mono cursor-pointer group"
          >
            {/* Status 1: Real Server Core */}
            <div className={`p-2.5 rounded-lg border transition flex items-center gap-2.5 ${
              coreOnline 
                ? 'bg-slate-950/60 border-slate-800 hover:border-emerald-500/40' 
                : 'bg-rose-950/40 border-rose-800/60'
            }`}>
              <span className="relative flex h-2.5 w-2.5">
                {coreOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${coreOnline ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
              </span>
              <div>
                <div className="text-gray-500 text-[10px] uppercase tracking-wider flex items-center gap-1">
                  <span>Sovereign Core</span>
                  {subsystems.serverCore.latencyMs ? <span className="text-[9px] text-cyan-400">({subsystems.serverCore.latencyMs}ms)</span> : null}
                </div>
                <div className={`${coreOnline ? 'text-emerald-400' : 'text-rose-400'} font-bold uppercase text-[11px]`}>
                  {coreOnline ? 'ONLINE / متصل' : 'OFFLINE'}
                </div>
              </div>
            </div>
            
            {/* Status 2: Real MCP Protocol Probe */}
            <div className={`p-2.5 rounded-lg border transition flex items-center gap-2.5 ${
              mcpOnline 
                ? 'bg-slate-950/60 border-slate-800 hover:border-cyan-500/40' 
                : subsystems.mcp.status === 'DEGRADED'
                ? 'bg-amber-950/30 border-amber-800/40'
                : 'bg-rose-950/40 border-rose-800/60'
            }`}>
              <Radio className={`h-4 w-4 ${mcpOnline ? 'text-cyan-400' : 'text-amber-400'}`} />
              <div>
                <div className="text-gray-500 text-[10px] uppercase tracking-wider">MCP Protocol</div>
                <div className={`${
                  mcpOnline ? 'text-cyan-400' : subsystems.mcp.status === 'DEGRADED' ? 'text-amber-400' : 'text-rose-400'
                } font-bold uppercase text-[11px]`}>
                  {mcpOnline ? 'ACTIVE' : subsystems.mcp.status}
                </div>
              </div>
            </div>

            {/* Status 3: Real Cloud Firestore */}
            <div className={`p-2.5 rounded-lg border transition flex items-center gap-2.5 ${
              firestoreOnline 
                ? 'bg-slate-950/60 border-slate-800 hover:border-emerald-500/40' 
                : 'bg-amber-950/30 border-amber-800/40'
            }`}>
              <Database className={`h-4 w-4 ${firestoreOnline ? 'text-emerald-400' : 'text-amber-400'}`} />
              <div>
                <div className="text-gray-500 text-[10px] uppercase tracking-wider flex items-center gap-1">
                  <span>Firestore Cloud</span>
                  {subsystems.firestore.latencyMs ? <span className="text-[9px] text-emerald-400">({subsystems.firestore.latencyMs}ms)</span> : null}
                </div>
                <div className={`${firestoreOnline ? 'text-emerald-400' : 'text-amber-400'} font-bold uppercase text-[11px]`}>
                  {firestoreOnline ? 'SYNCHRONIZED' : subsystems.firestore.status}
                </div>
              </div>
            </div>

            {/* Status 4: Real Audit Ledger */}
            <div className={`p-2.5 rounded-lg border transition flex items-center gap-2.5 ${
              auditIsIntact 
                ? 'bg-slate-950/60 border-slate-800 hover:border-teal-500/40' 
                : 'bg-rose-950/40 border-rose-800/60'
            }`}>
              <BadgeCheck className={`h-4 w-4 ${auditIsIntact ? 'text-teal-400' : 'text-rose-500 animate-pulse'}`} />
              <div>
                <div className="text-gray-500 text-[10px] uppercase tracking-wider">Audit Integrity</div>
                <div className={`${auditIsIntact ? 'text-teal-400' : 'text-rose-400'} font-bold uppercase text-[11px]`}>
                  {auditIsIntact ? 'INTACT' : 'TAMPERED'}
                </div>
              </div>
            </div>

            {/* Status 5: Live System Clock & Telemetry Trigger */}
            <div className="bg-slate-950/60 border border-slate-800 group-hover:border-cyan-500/50 rounded-lg p-2.5 flex items-center gap-2.5 col-span-2 md:col-span-1 transition">
              <Clock className="h-4 w-4 text-cyan-400 shrink-0" />
              <div className="w-full">
                <div className="text-gray-500 text-[10px] uppercase tracking-wider flex items-center justify-between">
                  <span>System Clock</span>
                  <span className="text-[9px] text-cyan-400 group-hover:underline">تشخيص حي 🔍</span>
                </div>
                <div className="text-cyan-400 font-bold truncate text-[11px] whitespace-nowrap" title={time}>
                  {time || 'Syncing...'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Workspace Path Strip */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center text-xs text-gray-400 gap-2 font-mono">
          <div className="flex items-center gap-2 flex-wrap text-slate-400">
            <FileCode className="h-4 w-4 text-cyan-500" />
            <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Platform Workspace:</span>
            <span className="text-cyan-200 bg-slate-950/40 px-2 py-0.5 rounded border border-slate-800 font-mono text-[11px]">
              {workspacePath}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsDiagnosticsOpen(true)}
              className="text-[10px] text-cyan-400 hover:text-white bg-cyan-950/40 hover:bg-cyan-900/60 px-2 py-0.5 rounded border border-cyan-800/50 transition cursor-pointer flex items-center gap-1"
            >
              <Activity className="w-3 h-3 text-cyan-400" />
              <span>فحص الحقيقة المطلقة للمنظومة</span>
            </button>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest bg-cyan-950/20 px-2.5 py-0.5 rounded border border-cyan-900/40">
              {platform}
            </div>
          </div>
        </div>
      </header>

      {/* Diagnostics Modal with Absolute Truth Telemetry */}
      <TelemetryDiagnosticsModal 
        isOpen={isDiagnosticsOpen} 
        onClose={() => setIsDiagnosticsOpen(false)} 
      />
    </>
  );
}
