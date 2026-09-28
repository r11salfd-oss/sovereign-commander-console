import React, { useState, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Wifi } from 'lucide-react';

export type HealthStatus = 'ready' | 'latency' | 'error' | 'checking';

interface ConnectionHealthIndicatorProps {
  modelId: string;
  className?: string;
  compact?: boolean;
}

export default function ConnectionHealthIndicator({
  modelId,
  className = '',
  compact = false
}: ConnectionHealthIndicatorProps) {
  const [status, setStatus] = useState<HealthStatus>('checking');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const pingEndpoint = useCallback(async () => {
    setIsRefreshing(true);
    const start = Date.now();
    try {
      const res = await fetch(`/api/gemini/ping?model=${encodeURIComponent(modelId)}`, {
        cache: 'no-store'
      });
      const data = await res.json();
      const measuredLatency = data.latencyMs || (Date.now() - start);
      setLatencyMs(measuredLatency);
      setLastChecked(new Date());

      if (!res.ok || data.status === 'error') {
        setStatus('error');
      } else if (measuredLatency > 600 || data.status === 'latency') {
        setStatus('latency');
      } else {
        setStatus('ready');
      }
    } catch (err) {
      console.warn('[Gemini Ping Error]:', err);
      setStatus('error');
      setLatencyMs(Date.now() - start);
      setLastChecked(new Date());
    } finally {
      setIsRefreshing(false);
    }
  }, [modelId]);

  // Initial ping and poll every 20 seconds
  useEffect(() => {
    pingEndpoint();
    const interval = setInterval(pingEndpoint, 20000);
    return () => clearInterval(interval);
  }, [pingEndpoint]);

  const getStatusDetails = () => {
    switch (status) {
      case 'ready':
        return {
          dotBg: 'bg-emerald-400',
          pingBg: 'bg-emerald-400',
          badgeBorder: 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300',
          text: 'جاهز (Ready)',
          icon: CheckCircle2,
          iconColor: 'text-emerald-400',
          desc: 'اتصال مستقر وفوري مع النواة العصبية لـ Gemini'
        };
      case 'latency':
        return {
          dotBg: 'bg-amber-400',
          pingBg: 'bg-amber-400',
          badgeBorder: 'border-amber-700/60 bg-amber-950/40 text-amber-300',
          text: 'استجابة بطيئة (Latency)',
          icon: AlertTriangle,
          iconColor: 'text-amber-400',
          desc: 'زمن الاستجابة مرتفع نسبياً لكن القناة العصبية متصلة'
        };
      case 'error':
        return {
          dotBg: 'bg-rose-500',
          pingBg: 'bg-rose-500',
          badgeBorder: 'border-rose-700/60 bg-rose-950/40 text-rose-300',
          text: 'انقطاع اتصال (Error)',
          icon: XCircle,
          iconColor: 'text-rose-400',
          desc: 'تعذر الوصول لنقطة النهاية أو مشكلة في مفتاح الاتصال'
        };
      case 'checking':
      default:
        return {
          dotBg: 'bg-cyan-400',
          pingBg: 'bg-cyan-400',
          badgeBorder: 'border-cyan-700/60 bg-cyan-950/40 text-cyan-300',
          text: 'جاري الفحص (Pinging...)',
          icon: Activity,
          iconColor: 'text-cyan-400',
          desc: 'جاري قياس سرعة الاتصال بنموذج الذكاء الاصطناعي'
        };
    }
  };

  const details = getStatusDetails();
  const StatusIcon = details.icon;

  return (
    <div className={`relative inline-flex items-center ${className}`} dir="rtl">
      {/* Trigger Pill Button */}
      <button
        type="button"
        onClick={() => pingEndpoint()}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono transition-all cursor-pointer shadow-sm hover:brightness-110 ${details.badgeBorder}`}
        title="انقر لإعادة فحص سرعة وحالة الاتصال"
      >
        {/* Pulsing Status Dot */}
        <span className="flex h-2 w-2 relative shrink-0">
          {status !== 'checking' && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${details.pingBg}`}></span>
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${details.dotBg}`}></span>
        </span>

        {/* Latency / Text */}
        <div className="flex items-center gap-1">
          {latencyMs !== null ? (
            <span className="font-bold tracking-tight">
              {latencyMs}ms
            </span>
          ) : (
            <span>فحص...</span>
          )}

          {!compact && (
            <span className="text-[10px] opacity-80 hidden md:inline">
              {status === 'ready' ? 'متصل' : status === 'latency' ? 'بطيء' : status === 'error' ? 'خطأ' : '...'}
            </span>
          )}
        </div>

        {/* Refresh spinner */}
        <RefreshCw className={`w-2.5 h-2.5 opacity-60 ml-0.5 ${isRefreshing ? 'animate-spin opacity-100 text-cyan-300' : ''}`} />
      </button>

      {/* Floating Detailed Status Popover / Tooltip */}
      {showTooltip && (
        <div 
          className="absolute top-full mt-2 left-0 sm:right-auto w-64 p-3 rounded-xl bg-[#090e1c] border border-slate-700 shadow-2xl z-50 text-right backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
          style={{ minWidth: '240px' }}
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
            <div className="flex items-center gap-1.5 font-bold font-mono text-xs text-white">
              <StatusIcon className={`w-3.5 h-3.5 ${details.iconColor}`} />
              <span>حالة اتصال Gemini</span>
            </div>
            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${details.badgeBorder}`}>
              {details.text}
            </span>
          </div>

          <p className="text-[11px] text-slate-300 font-sans leading-relaxed mb-2.5">
            {details.desc}
          </p>

          <div className="space-y-1 text-[10px] font-mono text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
            <div className="flex justify-between items-center">
              <span>النموذج النشط:</span>
              <span className="text-cyan-300 font-bold truncate max-w-[120px]">{modelId}</span>
            </div>
            <div className="flex justify-between items-center">
              <span>زمن الاستجابة (Latency):</span>
              <span className={`font-bold ${status === 'ready' ? 'text-emerald-400' : status === 'latency' ? 'text-amber-400' : 'text-rose-400'}`}>
                {latencyMs !== null ? `${latencyMs} ms` : 'غير محدد'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>آخر فحص:</span>
              <span className="text-slate-400">
                {lastChecked ? lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'الآن'}
              </span>
            </div>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-800 flex justify-between items-center text-[9px] font-mono text-slate-500">
            <span>انقر لإعادة القياس فوراً</span>
            <span className="text-cyan-400">REST + WebSocket Ping</span>
          </div>
        </div>
      )}
    </div>
  );
}
