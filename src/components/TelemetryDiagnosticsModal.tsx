import React from 'react';
import { 
  Activity, 
  Wifi, 
  Server, 
  Database, 
  UserCheck, 
  Cpu, 
  ShieldCheck, 
  Radio, 
  RefreshCw, 
  X, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle
} from 'lucide-react';
import { useSystemTelemetry } from '../hooks/useSystemTelemetry';
import { HealthStatusLevel } from '../services/systemTelemetryService';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TelemetryDiagnosticsModal({ isOpen, onClose }: ModalProps) {
  const { telemetry, isRefreshing, refreshNow } = useSystemTelemetry();

  if (!isOpen) return null;

  const getLevelBadge = (level: HealthStatusLevel) => {
    switch (level) {
      case 'optimal':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/50 text-emerald-400 text-[10px] font-mono font-bold">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>نشط ومؤكد (Verified)</span>
          </span>
        );
      case 'warning':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-500/50 text-amber-400 text-[10px] font-mono font-bold">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span>تنبيه / جزئي (Degraded)</span>
          </span>
        );
      case 'critical':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-950/60 border border-rose-500/50 text-rose-400 text-[10px] font-mono font-bold">
            <XCircle className="w-3 h-3 text-rose-400" />
            <span>غير متصل (Offline)</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono">
            <span>جاري القياس...</span>
          </span>
        );
    }
  };

  const getSubsystemIcon = (id: string) => {
    switch (id) {
      case 'network': return <Wifi className="w-4 h-4 text-cyan-400" />;
      case 'serverCore': return <Server className="w-4 h-4 text-emerald-400" />;
      case 'firestore': return <Database className="w-4 h-4 text-amber-400" />;
      case 'auth': return <UserCheck className="w-4 h-4 text-blue-400" />;
      case 'mcp': return <Radio className="w-4 h-4 text-purple-400" />;
      case 'auditLedger': return <ShieldCheck className="w-4 h-4 text-teal-400" />;
      case 'sentinelSoc': return <Cpu className="w-4 h-4 text-red-400" />;
      case 'pwaWorker': return <Activity className="w-4 h-4 text-indigo-400" />;
      default: return <Activity className="w-4 h-4 text-cyan-400" />;
    }
  };

  const subsList = Object.values(telemetry.subsystems);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div 
        className="w-full max-w-3xl bg-[#090d18] border border-cyan-500/30 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[90vh] overflow-hidden text-right"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-[#0c1222] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-400">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white font-mono flex items-center gap-2">
                <span>مصفوفة القياس والتشخيص الحي للنظام</span>
                <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/80 font-mono">
                  الحقيقة المطلقة (Live Truth)
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                مؤشرات حقيقية مشتقة من مسابير حية دون أي قيم ثابتة أو خادعة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refreshNow}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 hover:text-white hover:bg-cyan-900/60 transition text-xs font-mono font-bold cursor-pointer active:scale-95 disabled:opacity-50"
              title="إجراء فحص حي فوري"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">فحص حي الآن</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Status Banner */}
        <div className={`px-4 sm:px-5 py-3 border-b flex items-center justify-between gap-3 text-xs font-mono ${
          telemetry.overallLevel === 'optimal' 
            ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-300' 
            : telemetry.overallLevel === 'warning'
            ? 'bg-amber-950/20 border-amber-900/40 text-amber-300'
            : 'bg-rose-950/20 border-rose-900/40 text-rose-300'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              telemetry.overallLevel === 'optimal' ? 'bg-emerald-400 animate-pulse' :
              telemetry.overallLevel === 'warning' ? 'bg-amber-400' : 'bg-rose-500 animate-ping'
            }`} />
            <span className="font-bold">{telemetry.overallStatusText}</span>
          </div>

          <div className="text-[11px] text-slate-400 shrink-0">
            زمن استجابة الخادم: <span className="font-bold text-cyan-400">{telemetry.networkLatencyMs}ms</span>
          </div>
        </div>

        {/* Subsystems Live Matrix */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {subsList.map((sub) => (
            <div 
              key={sub.id}
              className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/90 hover:border-cyan-500/30 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 shrink-0 mt-0.5 sm:mt-0">
                  {getSubsystemIcon(sub.id)}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-200">{sub.arName}</span>
                    <span className="text-[11px] text-slate-500 font-normal">({sub.name})</span>
                    {typeof sub.latencyMs === 'number' && sub.latencyMs > 0 && (
                      <span className="text-[10px] text-cyan-400 px-1.5 py-0.2 rounded bg-cyan-950/40 border border-cyan-800/40">
                        {sub.latencyMs}ms
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {sub.details}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                {getLevelBadge(sub.level)}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-slate-800 bg-[#080c16] flex items-center justify-between text-[11px] font-mono text-slate-400">
          <div>
            آخر تدقيق تلقائي: <span className="text-slate-300">{new Date(telemetry.lastSyncTimestamp).toLocaleTimeString('ar-EG')}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
