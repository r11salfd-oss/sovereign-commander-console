import React, { useState, useEffect } from 'react';
import { Shield, Brain, Hammer, Zap, Flame, Scale, Terminal, RefreshCw } from 'lucide-react';
import { useSystemTelemetry } from '../hooks/useSystemTelemetry';

interface HourlyDataPoint {
  hour: string;
  label: string;
  value: number;
}

interface AgentTelemetryMetric {
  total24h: number;
  peakHourly: number;
  hourlyData: HourlyDataPoint[];
  lastActive: string;
}

function Sparkline({ 
  data, 
  color, 
  name,
  onHoverPoint
}: { 
  data: HourlyDataPoint[]; 
  color: string; 
  name: string;
  onHoverPoint?: (point: HourlyDataPoint | null) => void;
}) {
  if (!data || data.length === 0) return null;
  const values = data.map(d => d.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const width = 240;
  const height = 44;
  const padY = 5;
  
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - padY - ((v - min) / range) * (height - padY * 2);
    return { x, y, value: v, raw: data[i] };
  });

  const linePath = `M ${points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`;
  const areaPath = `M 0,${height} L ${points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} L ${width},${height} Z`;
  const gradId = `spark-grad-${name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;

  return (
    <div className="relative w-full h-11 group">
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        className="w-full h-11 overflow-visible" 
        preserveAspectRatio="none"
        onMouseLeave={() => onHoverPoint && onHoverPoint(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

        {/* Interactive Dots with Real Data Hover */}
        {points.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={idx === points.length - 1 ? 3 : 1.5}
            fill={color}
            className="transition-all hover:r-3.5 cursor-crosshair"
            onMouseEnter={() => onHoverPoint && onHoverPoint(p.raw)}
          />
        ))}
      </svg>
    </div>
  );
}

export default function AgentCorps() {
  const { subsystems } = useSystemTelemetry();
  const serverOnline = subsystems.serverCore.status === 'ONLINE';

  const [metrics, setMetrics] = useState<{ [agentId: string]: AgentTelemetryMetric }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<{ [agentId: string]: HourlyDataPoint | null }>({});

  const fetchRealMetrics = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/agents/metrics', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.agents) {
          setMetrics(data.agents);
        }
      }
    } catch {
      // Graceful fallback to cached state
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRealMetrics();
    // Poll real metrics every 15 seconds
    const interval = setInterval(fetchRealMetrics, 15000);
    return () => clearInterval(interval);
  }, []);

  const agents = [
    {
      id: 'architect',
      name: 'Architect Agent',
      arName: 'مهندس الأنظمة',
      role: 'Planning, Architecture, Path Hygiene',
      description: 'Reviews file structure, imports, and layout sanity to maintain extreme code clarity and structural compliance.',
      status: 'active',
      icon: Brain,
      color: 'text-indigo-400 border-indigo-900/40 bg-indigo-950/20',
      activeColor: 'bg-indigo-500',
      chartColor: '#818cf8',
    },
    {
      id: 'developer',
      name: 'Developer Agent',
      arName: 'المطور الأساسي',
      role: 'Code Implementation, Verification, TS Checks',
      description: 'Executes clean codebase edits and launches compiler tests to guarantee full compatibility with types and schemas.',
      status: 'active',
      icon: Hammer,
      color: 'text-emerald-400 border-emerald-900/40 bg-emerald-950/20',
      activeColor: 'bg-emerald-500',
      chartColor: '#34d399',
    },
    {
      id: 'sentinel',
      name: 'Sentinel Agent',
      arName: 'الحارس الأمني',
      role: 'Defensive Security Review & Integrity Auditing',
      description: 'Aggressively blocks accesses seeking to touch SOVEREIGN_WAR_CHEST. Audits hashes and cryptographic integrity bounds.',
      status: 'active',
      icon: Shield,
      color: 'text-cyan-400 border-cyan-400/20 bg-cyan-950/20',
      activeColor: 'bg-cyan-500',
      chartColor: '#22d3ee',
    },
    {
      id: 'forge',
      name: 'Forge Agent',
      arName: 'مشغل المصنع',
      role: 'Generative Factory Pipeline Operator',
      description: 'Synthesizes code patterns, templates, components, and schema definitions according to tactical blueprint requests.',
      status: 'standby',
      icon: Zap,
      color: 'text-amber-400 border-amber-950/30 bg-amber-950/15',
      activeColor: 'bg-amber-500',
      chartColor: '#fbbf24',
    },
    {
      id: 'redSimulation',
      name: 'Red Simulation Agent',
      arName: 'محاكي الاختراق المحلي',
      role: 'Local Defensive Validation & Sandbox Simulation',
      description: 'Performs adversary simulation strictly in local sandboxed boundaries. Never initiates external target scanning or networks.',
      status: 'controlled',
      icon: Flame,
      color: 'text-rose-400 border-rose-500/20 bg-rose-950/20',
      activeColor: 'bg-rose-500',
      chartColor: '#fb7185',
    },
    {
      id: 'reviewer',
      name: 'Reviewer Agent',
      arName: 'مدقق الجودة',
      role: 'Architecture Alignment & Code Quality Reviews',
      description: 'Verifies readability, optimal structural layout, and consistency across interfaces and operational code artifacts.',
      status: 'standby',
      icon: Scale,
      color: 'text-slate-400 border-slate-800 bg-slate-950/30',
      activeColor: 'bg-slate-500',
      chartColor: '#94a3b8',
    },
    {
      id: 'geminiInterface',
      name: 'Gemini Interface Agent',
      arName: 'وكيل الواجهة والتحكم الإدراكي (العضو 8)',
      role: 'Interface Governance & Command Dispatch',
      description: 'The 8th sovereign council member. Dispatches commands, transmits directives to other agents, inspects interface state, and performs telemetry analysis.',
      status: 'active',
      icon: Terminal,
      color: 'text-cyan-300 border-cyan-400/30 bg-cyan-950/30',
      activeColor: 'bg-cyan-400',
      chartColor: '#06b6d4',
    }
  ];

  return (
    <section className="glass-panel rounded-xl p-5 glow-cyan border-cyan-500/10 mb-6 font-mono">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-cyan-400" />
          <h2 className="font-display font-semibold text-sm tracking-wider uppercase text-gray-200">
            Sovereign Agent Corps / فيلق العملاء السياديين
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchRealMetrics}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] text-cyan-300 hover:text-white transition cursor-pointer active:scale-95"
            title="تحديث بيانات النشاط الحقيقية"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>تحديث السجل الحي</span>
          </button>
          <div className="text-[10px] text-emerald-400 font-mono tracking-widest font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>بيانات حقيقية مسجلة 24H</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => {
          const IconComponent = agent.icon;
          const agentMetric = metrics[agent.id] || {
            total24h: 0,
            peakHourly: 0,
            hourlyData: Array.from({ length: 24 }).map((_, i) => ({
              hour: `${String(i).padStart(2, '0')}:00`,
              label: `${String(i).padStart(2, '0')}:00`,
              value: 0
            })),
            lastActive: new Date().toISOString()
          };

          const hovered = hoveredPoint[agent.id];

          return (
            <div 
              key={agent.name}
              className="bg-slate-950/60 hover:bg-slate-950/90 border border-slate-800/90 hover:border-cyan-500/40 rounded-xl p-4 transition-all duration-200 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-md border ${agent.color}`}>
                      <IconComponent className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-gray-200 uppercase tracking-wide font-mono">
                        {agent.name}
                      </h3>
                      <div className="text-[10px] text-cyan-400/90 font-mono font-semibold">
                        {agent.arName}
                      </div>
                    </div>
                  </div>

                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase ${
                    !serverOnline
                      ? 'bg-rose-950/40 text-rose-400 border border-rose-900/40'
                      : agent.status === 'active' 
                      ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/40' 
                      : agent.status === 'standby'
                      ? 'bg-slate-900 text-slate-500 border border-slate-800'
                      : 'bg-amber-950/30 text-amber-500 border border-amber-900/30'
                  }`}>
                    <span className={`h-1 w-1 rounded-full ${
                      !serverOnline 
                        ? 'bg-rose-500' 
                        : agent.status === 'active' 
                        ? 'bg-emerald-400 animate-pulse' 
                        : agent.status === 'standby' 
                        ? 'bg-slate-650' 
                        : 'bg-amber-500 animate-pulse'
                    }`} />
                    {!serverOnline ? 'OFFLINE' : agent.status}
                  </span>
                </div>

                <div className="text-[10px] text-cyan-400 bg-cyan-950/20 border border-cyan-900/30 rounded px-2 py-1 font-mono font-bold mb-3 flex justify-between items-center">
                  <span>ROLE: {agent.role}</span>
                </div>

                <p className="text-gray-400 text-xs font-mono leading-relaxed text-left font-light mb-3">
                  {agent.description}
                </p>

                {/* Real Proposal Volume Chart & Statistics */}
                <div className="pt-2 border-t border-slate-900/90">
                  <div className="text-[10px] font-mono font-bold text-slate-400 flex items-center justify-between mb-1.5">
                    <span className="text-slate-400">حجم العمليات المسجلة (24H):</span>
                    <span className="text-cyan-300 font-bold">
                      {agentMetric.total24h} <span className="text-slate-500 text-[9px] font-normal">عملية فعلية</span>
                    </span>
                  </div>

                  {/* Sparkline Canvas */}
                  <div className="h-11 w-full bg-slate-900/40 rounded-lg p-1 border border-slate-900">
                    <Sparkline 
                      data={agentMetric.hourlyData} 
                      color={agent.chartColor} 
                      name={agent.name}
                      onHoverPoint={(pt) => setHoveredPoint(prev => ({ ...prev, [agent.id]: pt }))}
                    />
                  </div>

                  {/* Hover or Summary Stats */}
                  <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono mt-1 px-1">
                    {hovered ? (
                      <span className="text-cyan-300 font-bold animate-in fade-in">
                        الساعة {hovered.hour}: {hovered.value} عملية مسجلة
                      </span>
                    ) : (
                      <span>الذروة: {agentMetric.peakHourly} عملية/ساعة</span>
                    )}
                    <span className="text-slate-600">تسجيل جنائي حقيقي</span>
                  </div>
                </div>
              </div>

              {agent.name === 'Red Simulation Agent' && (
                <div className="mt-3 pt-2 border-t border-slate-900/60 text-[9px] font-mono text-rose-400/80 uppercase">
                  ⚠️ strictly defensive bounds, local execution checks only
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
