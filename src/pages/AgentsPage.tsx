import React, { useState } from 'react';
import { Brain, Hammer, Shield, Zap, Sparkles, Bot, Terminal, Send, CheckCircle2, Cpu, Sliders, ChevronDown } from 'lucide-react';
import { getGoogleAuthHeaders } from '../firebase';
import { useSystemTelemetry } from '../hooks/useSystemTelemetry';

interface AgentConfig {
  id: string;
  name: string;
  arName: string;
  role: string;
  model: string;
  description: string;
  systemPrompt: string;
  status: 'active' | 'standby';
  tools: string[];
}

export default function AgentsPage() {
  const { subsystems } = useSystemTelemetry();
  const serverOnline = subsystems.serverCore.status === 'ONLINE';

  const [agents, setAgents] = useState<AgentConfig[]>([
    {
      id: 'orchestrator-agent',
      name: 'Orchestrator (NEO)',
      arName: 'منسق المجلس السيادي الأعلى',
      role: 'Global Orchestration & Strategy',
      model: 'gemini-3.8-flash',
      description: 'The supreme cognitive commander presiding over all multi-agent deliberations.',
      systemPrompt: 'أنت نيو (NEO)، قائد المجلس ومنسق العمليات السيادية. تحلل الأوامر بصرامة هندسية وبرود تكتيكي.',
      status: 'active',
      tools: ['council_moderation', 'hitl_dispatch', 'remote_sandbox']
    },
    {
      id: 'architect-agent',
      name: 'Architect Agent',
      arName: 'مهندس النظم والمعماريات',
      role: 'System Design & Path Compliance',
      model: 'gemini-3.1-flash-lite',
      description: 'Inspects architectural boundaries, import hygiene, and dependency DAGs.',
      systemPrompt: 'أنت المهندس المعماري للنظم. تفحص كل ملف وكل هيكلية للتأكد من سلامتها التامة.',
      status: 'active',
      tools: ['dag_audit', 'type_compliance', 'diff_generator']
    },
    {
      id: 'developer-agent',
      name: 'Antigravity Developer',
      arName: 'المطور التنفيذي المعزول',
      role: 'Implementation & Sandbox Execution',
      model: 'gemini-3.1-flash-lite',
      description: 'Executes structural modifications and compiler tests in a protected Linux sandbox.',
      systemPrompt: 'أنت المطور السيبراني. تنفذ الأكواد بدقة عالية وبدون أي استطراد غير تقني.',
      status: 'active',
      tools: ['bash_sandbox', 'npm_runner', 'code_patcher']
    },
    {
      id: 'sentinel-agent',
      name: 'Sentinel Security Agent',
      arName: 'حارس الأمن السيبراني وجدار الحماية SOC',
      role: 'Cybersecurity & Zero-Trust SOC Boundary',
      model: 'gemini-3.6-flash',
      description: 'Specialized in defensive cybersecurity, SHA-256 hash chaining, SOVEREIGN_WAR_CHEST vault isolation, and penetration defense.',
      systemPrompt: 'أنت مهندس وخبير أمن سيبراني متخصص. تتولى فحص الثغرات، التحقق من التواقيع التشفيرية، وفرض سياسات الحماية الصارمة.',
      status: 'active',
      tools: ['path_guard', 'sha256_verifier', 'rate_limiter', 'threat_scanner', 'vault_defense']
    },
    {
      id: 'forge-agent',
      name: 'Forge Agent',
      arName: 'مشغل مصنع الأكواد السيادية',
      role: 'Structural Code Synthesis',
      model: 'gemini-3.1-flash-lite',
      description: 'High-throughput code generator designed for production-ready boilerplate and interfaces.',
      systemPrompt: 'أنت مشغل المصنع البرمجي. تولد أكواداً متينة ونظيفة جاهزة للتجميع فوراً.',
      status: 'active',
      tools: ['template_engine', 'component_generator', 'syntax_checker']
    },
    {
      id: 'researcher-agent',
      name: 'Deep Research Agent',
      arName: 'وكيل البحث المعمق السيادي',
      role: 'Autonomous Web & Evidence Synthesis',
      model: 'gemini-3.1-flash-lite',
      description: 'Crawls multiple intelligence sources to produce verified technical summaries.',
      systemPrompt: 'أنت باحث تقني استقصائي. تقدم ملخصات موثقة ومعززة بالأدلة والروابط.',
      status: 'standby',
      tools: ['web_search', 'citation_index', 'deep_synthesizer']
    },
    {
      id: 'fast-assistant',
      name: 'Tactical Fast Streamer',
      arName: 'المعالج التكتيكي الفوري',
      role: 'Ultra-low Latency Response',
      model: 'gemini-3.1-flash-lite',
      description: 'Optimized for high-frequency operations, quick triage, and rapid terminal answers.',
      systemPrompt: 'أنت المعالج التكتيكي الفوري. تقدم إجابات سريعة، مقتضبة، وحاسمة.',
      status: 'active',
      tools: ['stream_buffer', 'quick_triage', 'realtime_ping']
    },
    {
      id: 'interface-agent',
      name: 'Gemini Interface Agent',
      arName: 'وكيل الواجهة التفاعلية وإصدار الأوامر (العضو الثامن)',
      role: 'Interface Governance & Command Dispatch',
      model: 'gemini-3.1-flash-lite',
      description: 'The 8th sovereign council member. Dispatches commands, transmits directives to other agents, inspects interface state, and performs telemetry analysis.',
      systemPrompt: 'أنت وكيل الواجهة والتحكم الإدراكي (Gemini Interface Agent) - العضو الثامن (8) في المجلس السيادي الأعلى. تصيغ وتوزع الأوامر والتعليمات على أعضاء المجلس السبعة وتقرأ حالة النظام والواجهة بصرامة واحترافية.',
      status: 'active',
      tools: ['command_dispatch', 'ui_inspection', 'system_reading', 'council_broadcast', 'hitl_propose']
    },
    {
      id: 'lead-engineer',
      name: 'Lead Systems Engineer',
      arName: 'كبير مهندسي النظم والتشخيص السيادي',
      role: 'System Diagnostics, Screenshot Triage & Team Lead',
      model: 'gemini-3.1-flash-lite',
      description: 'Senior lead principal engineer. Inspects screenshots, performs root-cause fault diagnosis, and directs agent corps execution.',
      systemPrompt: 'أنت كبير مهندسي النظم والتشخيص السيادي (Lead Systems Engineer). تفحص لقطات الشاشة والأكواد وتحدد الأسباب الجذرية للأعطال وتوجه باقي أعضاء الفيلق لحلها.',
      status: 'active',
      tools: ['screenshot_vision_analyzer', 'root_cause_diagnosis', 'corps_director', 'stack_trace_auditor']
    },
    {
      id: 'delivery-agent',
      name: 'Premium Delivery Agent',
      arName: 'وكيل التسليم البريميوم وضمان الجودة المكتملة',
      role: 'Production Delivery & Engineering Excellence',
      model: 'gemini-3.1-flash-lite',
      description: 'Audits deliverables against rigorous production-grade standards: zero compilation errors, multimodal perfection, and pristine UX.',
      systemPrompt: 'أنت وكيل التسليم البريميوم وضمان الجودة الشاملة. تتحقق من خلو الأنظمة من الأخطاء التجميعية ومطابقتها لمعايير البناء المتطورة والمكتملة دون استثناء.',
      status: 'active',
      tools: ['zero_error_auditor', 'multimodal_qa_gate', 'production_readiness_check', 'artifact_verifier']
    }
  ]);

  const [activeTestAgent, setActiveTestAgent] = useState<string>('orchestrator-agent');
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const handleTestAgent = async (agentId: string) => {
    if (!testInput.trim()) return;
    setTesting(true);
    setTestOutput(null);
    try {
      const agent = agents.find(a => a.id === agentId);
      const headers = await getGoogleAuthHeaders();
      const res = await fetch('/api/chat/agent', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent: agentId,
          model: agent?.model,
          message: testInput
        })
      });
      const data = await res.json();
      if (data.ok) {
        setTestOutput(data.message);
        // Record real agent action
        fetch('/api/agents/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: agentId.replace('-agent', ''), actionType: 'diagnostic_test' })
        }).catch(() => {});
      } else {
        setTestOutput('Error: ' + (data.error || 'Execution failed'));
      }
    } catch (e: any) {
      setTestOutput('Network Error: ' + e.message);
    } finally {
      setTesting(false);
    }
  };

  const handleModelChange = (agentId: string, newModel: string) => {
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, model: newModel } : a));
  };

  return (
    <div className="min-h-screen bg-[#07090e] p-4 md:p-8 text-slate-200">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-mono text-sm tracking-wider uppercase mb-1">
              <Cpu className="w-5 h-5" />
              <span>Sovereign Intelligence Units</span>
            </div>
            <h1 className="text-2xl font-bold font-sans text-white">Agent Corps & Neural Allocations</h1>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Configure autonomous roles, system instructions, and engine assignments.
            </p>
          </div>
        </div>

        {/* Live Quick Test Console */}
        <div className="glass-panel border border-cyan-500/30 rounded-xl bg-[#0b101b]/95 p-5 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
            <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
              <Terminal className="w-4 h-4" />
              <span>Live Agent Diagnostic Tester / اختبار استجابة الكيانات الحية</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
              <span>Target:</span>
              <select
                value={activeTestAgent}
                onChange={e => setActiveTestAgent(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-cyan-300 font-mono focus:outline-none"
              >
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.model})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Type a technical prompt to test the selected agent in real-time..."
                value={testInput}
                onChange={e => setTestInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTestAgent(activeTestAgent)}
                className="flex-1 bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-500"
              />
              <button
                onClick={() => handleTestAgent(activeTestAgent)}
                disabled={testing || !testInput.trim()}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold tracking-wider transition disabled:opacity-40 flex items-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{testing ? 'Executing...' : 'Dispatch'}</span>
              </button>
            </div>

            {testOutput && (
              <div className="mt-3 p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed shadow-inner">
                <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Live Agent Execution Output
                </div>
                {testOutput}
              </div>
            )}
          </div>
        </div>

        {/* Agent Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map(agent => (
            <div
              key={agent.id}
              className="glass-panel border border-slate-800 rounded-xl bg-[#0b101b]/80 p-5 flex flex-col justify-between hover:border-slate-700 transition space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h3 className="text-sm font-bold font-mono text-white flex items-center gap-2">
                      {agent.name}
                    </h3>
                    <div className="text-[11px] font-mono text-cyan-400">{agent.arName}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase font-bold ${
                    !serverOnline 
                      ? 'bg-rose-950 border border-rose-800 text-rose-400' 
                      : agent.status === 'active' 
                      ? 'bg-emerald-950 border border-emerald-800 text-emerald-400' 
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {!serverOnline ? 'OFFLINE' : agent.status}
                  </span>
                </div>

                <p className="text-xs text-slate-400 font-sans mt-2 leading-relaxed">
                  {agent.description}
                </p>

                {/* Model Selector */}
                <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2">
                  <div className="text-[10px] font-mono uppercase text-slate-500 flex items-center justify-between">
                    <span>Neural Engine Assigned</span>
                    <Sliders className="w-3 h-3 text-slate-500" />
                  </div>
                  <select
                    value={agent.model}
                    onChange={e => handleModelChange(agent.id, e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-amber-300 font-mono focus:outline-none focus:border-cyan-500"
                  >
                    <option value="gemini-3.8-flash">gemini-3.8-flash (Fast Tactical & Operations)</option>
                    <option value="gemini-3.7-flash">gemini-3.7-flash (Multimodal & Advanced Vision)</option>
                    <option value="gemini-3.6-flash">gemini-3.6-flash (Cybersecurity & Sentinel SOC)</option>
                    <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Deep Reasoning)</option>
                    <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra Lightweight)</option>
                    <option value="antigravity-preview-09-2026">antigravity-preview-09-2026 (Remote Sandbox)</option>
                    <option value="deep-research-preview-04-2026">deep-research-preview-04-2026 (Research Core)</option>
                  </select>
                </div>

                {/* Tools Allowed */}
                <div className="mt-3">
                  <div className="text-[10px] font-mono uppercase text-slate-500 mb-1.5">Authorized Capabilities</div>
                  <div className="flex flex-wrap gap-1">
                    {agent.tools.map(tool => (
                      <span key={tool} className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 font-mono text-[9px] border border-slate-800">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => {
                    setActiveTestAgent(agent.id);
                    setTestInput(`اختبار الجاهزية التشغيلية للكيان ${agent.name}`);
                  }}
                  className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  <Terminal className="w-3 h-3" /> Quick Diagnostic
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
