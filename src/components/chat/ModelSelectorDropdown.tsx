import React, { useState, useRef, useEffect } from 'react';
import { 
  Shield, 
  Brain, 
  Zap, 
  Cpu, 
  Sparkles, 
  ChevronDown, 
  Check, 
  Lock, 
  Flame,
  Layers,
  Terminal,
  ShieldCheck
} from 'lucide-react';

export interface ModelOption {
  id: string;
  name: string;
  badge: string;
  badgeColor: string;
  borderColor: string;
  specialty: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: React.ComponentType<{ className?: string }>;
  isSpecializedSecurity?: boolean;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.6-flash',
    name: 'gemini-3.6-flash',
    badge: 'الأمن السيبراني والدفاع',
    badgeColor: 'bg-cyan-950/80 text-cyan-300 border-cyan-500/60',
    borderColor: 'border-cyan-500/70 shadow-[0_0_12px_rgba(6,182,212,0.25)]',
    specialty: 'Cyber Security & Sentinel SOC Specialist',
    descriptionAr: 'نموذج مخصص للأمن السيبراني، فحص الثغرات، التحقق التشفيري من التواقيع Ed25519/SHA-256، وحماية مسار الخزينة.',
    descriptionEn: 'Engineered for threat intelligence, zero-trust enforcement, and cryptographic verification.',
    icon: Shield,
    isSpecializedSecurity: true
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'gemini-3.1-pro',
    badge: 'استدلال عميق ومعمارية',
    badgeColor: 'bg-indigo-950/80 text-indigo-300 border-indigo-500/60',
    borderColor: 'border-indigo-500/70 shadow-[0_0_12px_rgba(99,102,241,0.25)]',
    specialty: 'Deep Reasoning & Architecture',
    descriptionAr: 'نموذج الاستدلال العميق وهندسة البرمجيات المعقدة، حل مشكلات الـ Runtime، وتصميم الهياكل الموزعة.',
    descriptionEn: 'High cognitive depth for complex system architecture and root cause debugging.',
    icon: Brain
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'gemini-3.5-flash-lite',
    badge: 'استجابة فائقة السرعة',
    badgeColor: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/60',
    borderColor: 'border-emerald-500/70 shadow-[0_0_12px_rgba(16,185,129,0.25)]',
    specialty: 'Ultra-Fast Lightweight Streamer',
    descriptionAr: 'أسرع نموذج استجابة لحظية (600ms) للمهام السريعة ومعالجة البيانات المتدفقة.',
    descriptionEn: 'High throughput ultra-fast low-latency execution model.',
    icon: Sparkles
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'gemini-3.1-flash',
    badge: 'فائق السرعة وخفيف',
    badgeColor: 'bg-amber-950/80 text-amber-300 border-amber-500/60',
    borderColor: 'border-amber-500/70 shadow-[0_0_12px_rgba(245,158,11,0.25)]',
    specialty: 'Fast & Lightweight Streamer',
    descriptionAr: 'استجابة لحظية فائقة السرعة واستهلاك خفيف للذاكرة للمهام التكتيكية والاستفسارات المباشرة.',
    descriptionEn: 'Ultra-low latency tactical execution for quick conversational flows.',
    icon: Zap
  },
  {
    id: 'gemini-3.8-flash',
    name: 'gemini-3.8-flash',
    badge: 'العمليات التكتيكية والقيادة',
    badgeColor: 'bg-blue-950/80 text-blue-300 border-blue-500/60',
    borderColor: 'border-blue-500/70 shadow-[0_0_12px_rgba(59,130,246,0.25)]',
    specialty: 'Tactical Operations Core',
    descriptionAr: 'النموذج القيادي الافتراضي لتوجيه الأوامر والتحكم السيادي العام.',
    descriptionEn: 'General tactical orchestrator for multi-agent dispatch.',
    icon: Cpu
  },
  {
    id: 'opencode/muse-spark-1.3-contributor-free',
    name: 'muse-spark-1.3',
    badge: 'OpenCode Zen Muse 1.3',
    badgeColor: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/60',
    borderColor: 'border-emerald-500/70 shadow-[0_0_12px_rgba(16,185,129,0.25)]',
    specialty: 'Truth Sentinel & Claims Auditor',
    descriptionAr: 'نموذج محقق الصدق والادعاءات عبر مزود OpenCode Zen (تدقيق العمليات وكشف التخيل).',
    descriptionEn: 'OpenCode Zen specialized model for claim verification and anti-hallucination auditing.',
    icon: ShieldCheck
  },
  {
    id: 'opencode/space-bunny-free',
    name: 'space-bunny-free',
    badge: 'OpenCode Zen Gateway',
    badgeColor: 'bg-purple-950/80 text-purple-300 border-purple-500/60',
    borderColor: 'border-purple-500/70 shadow-[0_0_12px_rgba(168,85,247,0.25)]',
    specialty: 'OpenCode Zen Community Coder',
    descriptionAr: 'بوابة OpenCode Zen الخارجية للاستدلال السريع والأكواد المفتوحة (opencode.ai/zen).',
    descriptionEn: 'OpenCode Zen autonomous gateway model for open programming workflows.',
    icon: Terminal
  }
];

interface ModelSelectorDropdownProps {
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  className?: string;
  compact?: boolean;
}

export default function ModelSelectorDropdown({
  selectedModelId,
  onSelectModel,
  className = '',
  compact = false
}: ModelSelectorDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Normalize model ID match (supports aliases like gemini-3.1-pro or gemini-3.1-pro-preview)
  const activeModel = AVAILABLE_MODELS.find(m => 
    m.id === selectedModelId || 
    (selectedModelId.includes('3.6') && m.id === 'gemini-3.6-flash') ||
    (selectedModelId.includes('3.1-pro') && m.id === 'gemini-3.1-pro-preview') ||
    (selectedModelId.includes('3.1-flash') && m.id === 'gemini-3.1-flash-lite')
  ) || AVAILABLE_MODELS[0];

  const Icon = activeModel.icon;

  // Handle click outside to close popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative inline-block text-right ${className}`} dir="rtl">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-[#080d1a] hover:bg-[#0c1324] transition-all cursor-pointer font-mono text-xs shadow-sm ${
          isOpen ? activeModel.borderColor : 'border-slate-700/80 hover:border-slate-500'
        }`}
        title={`النموذج العصبي النشط: ${activeModel.name} (${activeModel.specialty})`}
      >
        <div className={`p-1 rounded ${activeModel.isSpecializedSecurity ? 'bg-cyan-950 text-cyan-400' : 'bg-slate-900 text-slate-300'}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>

        <div className="flex flex-col text-right items-start leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-200">{activeModel.name}</span>
            {activeModel.isSpecializedSecurity && (
              <span className="flex h-1.5 w-1.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span>
              </span>
            )}
          </div>
          {!compact && (
            <span className="text-[9px] text-slate-400 font-sans truncate max-w-[140px]">
              {activeModel.badge}
            </span>
          )}
        </div>

        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 mr-1 transition-transform duration-200 ${isOpen ? 'rotate-180 text-cyan-400' : ''}`} />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div 
          className="absolute left-0 sm:right-auto mt-2 w-80 sm:w-96 rounded-xl bg-[#090e1c] border border-slate-700 shadow-2xl z-50 overflow-hidden backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
          style={{ minWidth: '320px' }}
        >
          {/* Header */}
          <div className="p-3 bg-[#060a14] border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-white font-mono">اختر المحرك العصبي (Gemini Matrix)</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
              {AVAILABLE_MODELS.length} نماذج
            </span>
          </div>

          {/* Model Options List */}
          <div className="p-2 space-y-1.5 max-h-96 overflow-y-auto">
            {AVAILABLE_MODELS.map((model) => {
              const isSelected = activeModel.id === model.id;
              const ModelIcon = model.icon;

              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onSelectModel(model.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-right p-2.5 rounded-lg border transition-all cursor-pointer flex items-start gap-3 group ${
                    isSelected 
                      ? `${model.badgeColor} ${model.borderColor} bg-opacity-30`
                      : 'border-slate-800/80 bg-slate-900/40 hover:bg-slate-800/60 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {/* Icon */}
                  <div className={`p-2 rounded-lg mt-0.5 shrink-0 border ${
                    isSelected 
                      ? 'bg-slate-950 border-cyan-500/60 text-cyan-300' 
                      : 'bg-slate-950 border-slate-800 text-slate-400 group-hover:text-white'
                  }`}>
                    <ModelIcon className="w-4 h-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-mono text-xs text-white group-hover:text-cyan-300 transition">
                          {model.name}
                        </span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${model.badgeColor}`}>
                          {model.badge}
                        </span>
                      </div>
                      {isSelected && (
                        <div className="w-4 h-4 rounded-full bg-cyan-500 text-black flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-300 font-sans leading-relaxed line-clamp-2 mb-1">
                      {model.descriptionAr}
                    </p>

                    <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-500">
                      <span>•</span>
                      <span className="truncate">{model.specialty}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Security Guarantee Footer */}
          <div className="p-2.5 bg-[#050811] border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>gemini-3.6-flash مفعل لمهام الأمن السيبراني</span>
            </span>
            <span className="text-slate-500">Zero-Trust SOC</span>
          </div>
        </div>
      )}
    </div>
  );
}
