import React from 'react';
import { Brain, Cpu, ShieldCheck, Sparkles, Terminal } from 'lucide-react';
import { BrainMap as BrainMapType } from '../types';

interface BrainMapProps {
  modelMap: BrainMapType | null;
  loading: boolean;
}

export default function BrainMap({ modelMap, loading }: BrainMapProps) {
  // Antigravity & Gemini Sovereign Model Architecture
  const models = {
    reasoning: modelMap?.models?.reasoning || 'gemini-3.8-flash',
    planning: modelMap?.models?.planning || 'gemini-3.8-flash',
    coding: modelMap?.models?.coding || 'gemini-3.8-flash',
    fallback: modelMap?.models?.fallback || 'gemini-3.1-flash-lite'
  };

  const modelCores = [
    {
      id: 'brain-antigravity',
      label: 'Antigravity Core Agent',
      subLabel: 'وكيل أنتي جرافيتي السيادي / Remote Sandbox',
      model: models.reasoning,
      purpose: 'Autonomous execution in Google-hosted Linux sandbox. Runs bash, python, file operations, and web searches.',
      badgeColor: 'text-cyan-400 bg-cyan-950/40 border-cyan-800/60',
      activeColor: 'bg-cyan-400',
      specs: 'Antigravity Managed Sandbox Engine'
    },
    {
      id: 'brain-reasoning',
      label: 'Deep Reasoning Core',
      subLabel: 'التفكير العميق والتحليل المعماري / Strategic Mind',
      model: models.planning,
      purpose: 'High-level architectural planning, cryptographic verification, security audits, and complex chain-of-thought.',
      badgeColor: 'text-indigo-400 bg-indigo-950/40 border-indigo-800/60',
      activeColor: 'bg-indigo-400',
      specs: 'Gemini 3.1 Pro Cognitive Core'
    },
    {
      id: 'brain-research',
      label: 'Deep Research Agent',
      subLabel: 'البحث الشامل والأدلة / Autonomous Intelligence',
      model: models.coding,
      purpose: 'Multi-turn web crawling, multi-source evidence synthesis, and exhaustive technical validation.',
      badgeColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60',
      activeColor: 'bg-emerald-400',
      specs: 'Deep Research 04-2026 Agent'
    },
    {
      id: 'brain-tactical',
      label: 'Tactical Flash Core',
      subLabel: 'الاستجابة التكتيكية السريعة / Low Latency',
      model: models.fallback,
      purpose: 'Ultra-low-latency command parsing, fast operational verification, and high-throughput real-time streaming.',
      badgeColor: 'text-amber-400 bg-amber-950/40 border-amber-800/60',
      activeColor: 'bg-amber-400',
      specs: 'Gemini 3.8 Flash Streaming'
    }
  ];

  return (
    <section className="glass-panel rounded-xl p-5 glow-cyan border-cyan-500/10 mb-6 relative">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 pb-3 border-b border-slate-800 gap-2">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-cyan-400" />
          <h2 className="font-display font-semibold text-sm tracking-wider uppercase text-gray-200">
            Antigravity Model Matrix / خريطة العقل الاصطناعي (AGY)
          </h2>
          <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>ANTIGRAVITY ACTIVE</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono font-medium">
          <div className="flex items-center gap-1.5 text-indigo-300 bg-indigo-950/50 border border-indigo-800/70 px-2.5 py-1 rounded">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span>Gemini Pro Subscribed (r11salfd@gmail.com)</span>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2.5 py-1 rounded">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>OAuth2 Session Auth (No Billing / No API Key)</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {modelCores.map((core) => (
          <div
            key={core.id}
            id={core.id}
            className="bg-slate-950/50 hover:bg-slate-950/80 border border-slate-800 hover:border-slate-700/80 rounded-lg p-4 transition-all duration-200 flex flex-col justify-between group"
          >
            <div>
              {/* Header inside card */}
              <div className="flex justify-between items-start gap-2 mb-2">
                <div>
                  <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wide group-hover:text-cyan-400 transition-colors">
                    {core.label}
                  </h3>
                  <div className="text-[9px] text-cyan-500/70 font-display font-medium">
                    {core.subLabel}
                  </div>
                </div>
                <div className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${core.badgeColor}`}>
                  {core.specs}
                </div>
              </div>

              {/* Model Tag name */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded px-2.5 py-1.5 font-mono text-xs text-cyan-300 font-bold mb-3 flex items-center justify-between">
                <span className="truncate">{core.model}</span>
                <span className="flex h-1.5 w-1.5 relative">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${core.activeColor} opacity-75`}></span>
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${core.activeColor}`}></span>
                </span>
              </div>

              {/* Purpose */}
              <p className="text-gray-400 text-xs leading-relaxed mb-4 font-sans font-light">
                {core.purpose}
              </p>
            </div>

            {/* Neural Connector status */}
            <div className="pt-3 border-t border-slate-900/60 flex items-center justify-between text-[10px] font-mono text-slate-500">
              <span className="flex items-center gap-1">
                <Terminal className="h-3 w-3 text-cyan-500" />
                <span>Interactions API</span>
              </span>
              <span className="text-emerald-400 font-semibold">AGY PROTOCOL OK</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

