import React, { useState } from 'react';
import { Zap, Code, Terminal, Copy, Check, Send, CheckSquare, Play, Sparkles, FileCode } from 'lucide-react';
import { getGoogleAuthHeaders, db, auth } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { Approval } from '../types';

export default function ForgePage() {
  const [prompt, setPrompt] = useState('');
  const [targetPath, setTargetPath] = useState('src/components/SovereignModule.tsx');
  const [language, setLanguage] = useState('typescript');
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [queuedProposal, setQueuedProposal] = useState(false);

  const presets = [
    { label: 'Secure Middleware', prompt: 'Write an Express middleware in TypeScript that guards against path traversal and blocks access to SOVEREIGN_WAR_CHEST paths.', path: 'src/middleware/guard.ts', lang: 'typescript' },
    { label: 'SHA-256 Chain Verifier', prompt: 'Write a TypeScript module that verifies a sequential cryptographic hash ledger using Web Crypto SHA-256.', path: 'src/crypto/verifier.ts', lang: 'typescript' },
    { label: 'React Cyber Status Badge', prompt: 'Create a stylish Tailwind React component displaying real-time system sovereign status and active model metrics.', path: 'src/components/StatusBadge.tsx', lang: 'typescript' },
    { label: 'Bash Sandbox Runner', prompt: 'Write a bash script for safely executing commands within a restricted sandbox environment and logging outputs.', path: 'scripts/sandbox.sh', lang: 'bash' }
  ];

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setQueuedProposal(false);
    try {
      const headers = await getGoogleAuthHeaders();
      const res = await fetch('/api/chat/agent', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent: 'forge-agent',
          model: 'gemini-3.8-flash',
          message: `المطلوب: توليد كود برمجي احترافي بلغة ${language} للملف: ${targetPath}.\n\nالمواصفات المطلوبة:\n${prompt}\n\nيرجى كتابة الكود البرمجي كاملاً وبدون أي شروحات أو مقدمات خارج بلوك الكود حتى يمكن نسخه وتطبيقه مباشرة.`
        })
      });

      const data = await res.json();
      if (data.ok && data.message) {
        setGeneratedCode(data.message);
      } else {
        setGeneratedCode('// Error in code generation: ' + (data.error || 'Server returned failure'));
      }
    } catch (e: any) {
      setGeneratedCode('// Network failure: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQueueForHITL = async () => {
    if (!generatedCode) return;
    try {
      const id = `forge-${Date.now()}`;
      const user = auth.currentUser;
      const now = new Date();
      const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24);
      const approval: Approval = {
        id,
        status: 'pending',
        risk: 'medium',
        agent: 'forge-agent',
        type: 'modify_file',
        summary: `Forge Synthesis: ${targetPath}`,
        reason: `Synthesized code for ${targetPath}`,
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        payload: {
          targetPath,
          code: generatedCode
        }
      };

      if (user) {
        await setDoc(doc(db, 'approvals', id), {
          ...approval,
          creatorId: user.uid
        });
      }
      setQueuedProposal(true);
    } catch (e: any) {
      console.error('Error queueing proposal:', e);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#07090e] p-4 md:p-8 text-slate-200">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-amber-400 font-mono text-sm tracking-wider uppercase mb-1">
              <Zap className="w-5 h-5" />
              <span>Forge Code Synthesis Engine</span>
            </div>
            <h1 className="text-2xl font-bold font-sans text-white">Structural Generation Workspace</h1>
            <p className="text-xs text-slate-400 font-mono mt-1">
              High-throughput tactical code generation directly integrated into the HITL pipeline.
            </p>
          </div>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap gap-2 items-center text-xs font-mono">
          <span className="text-slate-500 uppercase text-[10px] mr-1">Blueprint Presets:</span>
          {presets.map(p => (
            <button
              key={p.label}
              onClick={() => {
                setPrompt(p.prompt);
                setTargetPath(p.path);
                setLanguage(p.lang);
              }}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700/80 hover:border-amber-500/50 hover:bg-amber-950/20 text-slate-300 hover:text-amber-300 transition"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Generation Input Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="glass-panel border border-slate-800 rounded-xl bg-[#0b101b]/80 p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1">Target File Path</label>
                <input
                  type="text"
                  value={targetPath}
                  onChange={e => setTargetPath(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1">Language</label>
                <select
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-amber-500"
                >
                  <option value="typescript">TypeScript / React</option>
                  <option value="javascript">JavaScript / Node</option>
                  <option value="python">Python</option>
                  <option value="bash">Bash / Shell</option>
                  <option value="json">JSON Blueprint</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1">Synthesis Instructions</label>
                <textarea
                  rows={6}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Describe the exact requirements, inputs, outputs, and constraints for the synthesized code..."
                  className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading || !prompt.trim()}
                className="w-full py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-mono text-xs font-bold tracking-widest uppercase transition flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.25)] disabled:opacity-40"
              >
                <Sparkles className="w-4 h-4" />
                <span>{loading ? 'Synthesizing Architecture...' : 'Ignite Forge Engine'}</span>
              </button>
            </div>
          </div>

          {/* Generated Code Preview */}
          <div className="lg:col-span-7">
            <div className="glass-panel border border-slate-800 rounded-xl bg-[#0b101b]/90 p-5 flex flex-col h-full min-h-[460px]">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                <div className="flex items-center gap-2 text-xs font-mono text-amber-400">
                  <FileCode className="w-4 h-4" />
                  <span>{targetPath}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    disabled={!generatedCode}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 transition disabled:opacity-30"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    onClick={handleQueueForHITL}
                    disabled={!generatedCode || queuedProposal}
                    className="flex items-center gap-1.5 px-3 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white font-mono text-xs font-semibold transition disabled:opacity-40"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>{queuedProposal ? 'Queued in Approvals ✓' : 'Submit to HITL'}</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 bg-slate-950 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-auto whitespace-pre leading-relaxed border border-slate-800/80 shadow-inner">
                {generatedCode ? (
                  generatedCode
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2">
                    <Code className="w-8 h-8 opacity-40" />
                    <span>Awaiting blueprint input. Click "Ignite Forge Engine" to synthesize code.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
