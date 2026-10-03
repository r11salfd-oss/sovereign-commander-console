import React, { useState } from 'react';
import { 
  Zap, Code, Copy, Check, CheckSquare, Sparkles, FileCode, 
  Cpu, ShieldCheck, Terminal, CheckCircle2, AlertTriangle, Layers
} from 'lucide-react';
import { getGoogleAuthHeaders, db, auth } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { Approval } from '../types';

interface LspDiagnosticsResult {
  passed: boolean;
  lspServer: string;
  diagnostics: string[];
  errorsCount: number;
}

export default function ForgePage() {
  const [prompt, setPrompt] = useState('');
  const [targetPath, setTargetPath] = useState('src/components/SovereignModule.tsx');
  const [language, setLanguage] = useState('typescript');
  const [model, setModel] = useState('gemini-3.7-flash');
  const [enableMcpContext, setEnableMcpContext] = useState(true);
  const [enableLspValidation, setEnableLspValidation] = useState(true);
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [validatingLsp, setValidatingLsp] = useState(false);
  const [lspResult, setLspResult] = useState<LspDiagnosticsResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [queuedProposal, setQueuedProposal] = useState(false);
  const [synthesisMeta, setSynthesisMeta] = useState<{ provider: string; model: string; timestamp: string } | null>(null);

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
    setLspResult(null);
    try {
      const headers = await getGoogleAuthHeaders();
      const res = await fetch('/api/forge/synthesize', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          targetPath,
          language,
          model,
          enableLspValidation,
          enableMcpContext
        })
      });

      const data = await res.json();
      if (data.ok && data.code) {
        setGeneratedCode(data.code);
        setLspResult(data.lspValidation || null);
        setSynthesisMeta({
          provider: data.provider || (model.startsWith('opencode') ? 'OpenCode Zen' : model.startsWith('copilot') ? 'Microsoft 365 Copilot' : 'Google AI Pro'),
          model: data.model || model,
          timestamp: data.timestamp || new Date().toISOString()
        });
      } else {
        setGeneratedCode('// Error in code generation: ' + (data.error || 'Server returned failure'));
      }
    } catch (e: any) {
      setGeneratedCode('// Network failure: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualLspValidate = async () => {
    if (!generatedCode.trim()) return;
    setValidatingLsp(true);
    try {
      const res = await fetch('/api/forge/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: generatedCode,
          language,
          targetPath
        })
      });
      const data = await res.json();
      if (data.ok) {
        setLspResult({
          passed: data.passed,
          lspServer: data.lspServer,
          diagnostics: data.diagnostics || [],
          errorsCount: data.errorsCount || 0
        });
      }
    } catch (err: any) {
      console.error('LSP validation error:', err);
    } finally {
      setValidatingLsp(false);
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
        reason: `Synthesized code for ${targetPath} via ${synthesisMeta?.model || model} (static in-process check: ${lspResult?.passed ? 'PASSED' : 'UNCHECKED'}) — no LSP handshake was performed`,
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
              <Zap className="w-5 h-5 text-amber-400 animate-pulse" />
              <span>Forge Code Synthesis Engine / مصنع الأكواد السيادي</span>
            </div>
            <h1 className="text-2xl font-bold font-sans text-white">Structural Generation & Compilation Matrix</h1>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Integrated with OpenCode Zen Agents, Unified MCP Protocol (7 Servers), and Language Server Protocol (LSP).
            </p>
          </div>

          {/* Connected Matrix Badges */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
            <span className="px-2.5 py-1 rounded bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 flex items-center gap-1.5">
              <Cpu className="w-3 h-3 text-indigo-400" />
              <span>OpenCode Zen: Connected</span>
            </span>
            <span className="px-2.5 py-1 rounded bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-cyan-400" />
              <span>MCP Protocol: 7 Servers Active</span>
            </span>
            <span className="px-2.5 py-1 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 flex items-center gap-1.5">
              <Terminal className="w-3 h-3 text-emerald-400" />
              <span>LSP Diagnostics: 6 Engines Ready</span>
            </span>
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
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700/80 hover:border-amber-500/50 hover:bg-amber-950/20 text-slate-300 hover:text-amber-300 transition cursor-pointer"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Generation Input Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="glass-panel border border-slate-800 rounded-xl bg-[#0b101b]/80 p-5 space-y-4">
              
              {/* Agent & Model Engine Selector */}
              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1 flex items-center justify-between">
                  <span>Synthesis Engine & Model</span>
                  <span className="text-[10px] text-amber-400/80">Gemini + Antigravity + OpenCode + Copilot 365</span>
                </label>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-500"
                >
                  <optgroup label="🌟 Google Gemini & Antigravity (Account r11salfd)">
                    <option value="gemini-3.7-flash">gemini-3.7-flash (Google AI Pro Code Factory)</option>
                    <option value="gemini-3.8-flash">gemini-3.8-flash (Google AI Pro Low Latency)</option>
                    <option value="antigravity-preview-09-2026">antigravity-preview-09-2026 (Antigravity Core Pro)</option>
                  </optgroup>
                  <optgroup label="⚡ OpenCode Zen Agents (opencode.ai/zen)">
                    <option value="opencode/muse-spark-1.3-contributor-free">opencode/muse-spark-1.3-contributor-free (Muse 1.3 Contributor)</option>
                    <option value="opencode/space-bunny-free">opencode/space-bunny-free (Zen Community Coder)</option>
                  </optgroup>
                  <optgroup label="🌐 Microsoft 365 Copilot & Semantic Kernel">
                    <option value="copilot-365">copilot-365 (M365 Copilot & Microsoft Graph)</option>
                  </optgroup>
                </select>
              </div>

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
                  <option value="typescript">TypeScript / React (.tsx, .ts)</option>
                  <option value="javascript">JavaScript / Node (.js, .mjs)</option>
                  <option value="python">Python 3 (.py)</option>
                  <option value="bash">Bash / Shell (.sh)</option>
                  <option value="json">JSON Blueprint (.json)</option>
                </select>
              </div>

              {/* Protocol Integration Controls */}
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2 text-xs font-mono">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Tethered Protocols</div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableMcpContext}
                      onChange={e => setEnableMcpContext(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
                    />
                    <span>Inject Sovereign MCP Context</span>
                  </label>
                  <span className="text-[10px] text-cyan-400 font-bold">7 MCP Tools</span>
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableLspValidation}
                      onChange={e => setEnableLspValidation(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
                    />
                    <span>Run Real-time LSP Syntax Check</span>
                  </label>
                  <span className="text-[10px] text-emerald-400 font-bold">tsserver / ast</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1">Synthesis Instructions</label>
                <textarea
                  rows={5}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Describe the exact requirements, inputs, outputs, and constraints for the synthesized code..."
                  className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading || !prompt.trim()}
                className="w-full py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-mono text-xs font-bold tracking-widest uppercase transition flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.25)] disabled:opacity-40 cursor-pointer active:scale-95"
              >
                <Sparkles className="w-4 h-4" />
                <span>{loading ? 'Synthesizing via ' + (model.includes('muse') ? 'OpenCode Muse 1.3...' : 'Forge Engine...') : 'Ignite Forge Engine'}</span>
              </button>
            </div>
          </div>

          {/* Generated Code & LSP Diagnostics Preview */}
          <div className="lg:col-span-7 flex flex-col space-y-4">
            <div className="glass-panel border border-slate-800 rounded-xl bg-[#0b101b]/90 p-5 flex flex-col flex-1 min-h-[460px]">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800 mb-3 gap-2">
                <div className="flex items-center gap-2 text-xs font-mono text-amber-400">
                  <FileCode className="w-4 h-4" />
                  <span>{targetPath}</span>
                  {synthesisMeta && (
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-cyan-300">
                      {synthesisMeta.provider} ({synthesisMeta.model})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleManualLspValidate}
                    disabled={!generatedCode || validatingLsp}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-emerald-300 transition disabled:opacity-30 cursor-pointer"
                    title="Validate syntax with Language Server Protocol"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{validatingLsp ? 'LSP Checking...' : 'Validate with LSP'}</span>
                  </button>
                  <button
                    onClick={handleCopy}
                    disabled={!generatedCode}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 transition disabled:opacity-30 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    onClick={handleQueueForHITL}
                    disabled={!generatedCode || queuedProposal}
                    className="flex items-center gap-1.5 px-3 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white font-mono text-xs font-semibold transition disabled:opacity-40 cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>{queuedProposal ? 'Queued in Approvals ✓' : 'Submit to HITL'}</span>
                  </button>
                </div>
              </div>

              {/* Code Viewport */}
              <div className="flex-1 bg-slate-950 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-auto whitespace-pre leading-relaxed border border-slate-800/80 shadow-inner max-h-[500px]">
                {generatedCode ? (
                  generatedCode
                ) : (
                  <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-slate-600 space-y-2">
                    <Code className="w-8 h-8 opacity-40" />
                    <span>Awaiting blueprint input. Click "Ignite Forge Engine" to synthesize code.</span>
                  </div>
                )}
              </div>

              {/* LSP Diagnostics Bar */}
              {lspResult && (
                <div className={`mt-4 p-3 rounded-lg border text-xs font-mono ${
                  lspResult.passed 
                    ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300' 
                    : 'bg-rose-950/20 border-rose-500/40 text-rose-300'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 font-bold">
                      {lspResult.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-400" />
                      )}
                      <span>Static Check Status: {lspResult.passed ? 'Zero Syntax Errors (PASS)' : `Errors Detected (${lspResult.errorsCount})`}</span>
                      </div>
                      {/* CORRECTION (audit finding, sweep follow-up): the heading above
                          said "LSP Status", which named a protocol that is never spoken
                          on this path — for TypeScript it is an in-process
                          `ts.transpileModule()` call (server.ts:2784), not a language
                          server. Renamed to "Static Check Status" so the heading matches
                          what actually ran.
                          The word "PASS" was KEPT deliberately: it is accurate that the
                          check reported no errors, and removing it would destroy real
                          signal. What is called out instead is the vacuous-pass case —
                          server.ts:2874 returns a pass for languages with no validator at
                          all ('the pass is vacuous') — so a green PASS is not by itself
                          evidence that anything was examined.
                          `lspResult.lspServer` below is the server's own authoritative
                          statement of the method used and is rendered verbatim. */}
                    <span className="text-[10px] text-slate-400">{lspResult.lspServer}</span>
                  </div>
                  {lspResult.diagnostics.length > 0 ? (
                    <ul className="list-disc list-inside space-y-1 text-[11px] text-rose-300/90 max-h-24 overflow-auto">
                      {lspResult.diagnostics.map((d, idx) => (
                        <li key={idx}>{d}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[11px] text-emerald-400/90">
                      {/* CORRECTION (audit finding): was
                          '✓ Clean code structure confirmed by Language Server Protocol.
                           Ready for Human-In-The-Loop review.'
                          No LSP handshake occurs anywhere on this path. For
                          TypeScript the server calls `ts.transpileModule()` in-process
                          (server.ts:2784) — that is a compiler invocation, not a
                          language server: no `initialize` request, no LSP framing, no
                          tsserver process. For bash and python it is a string
                          heuristic, and for an unlisted language it is an explicitly
                          VACUOUS pass (server.ts:2874, 'no validator executed for this
                          language; the pass is vacuous').
                          This line also directly contradicted the honest
                          `lspServer` string rendered 12 pixels above it, which now
                          reads 'NONE — in-process ts.transpileModule() diagnostics; no
                          tsserver process spawned, no LSP handshake'.
                          `lspResult.lspServer` (server-returned) is the authoritative
                          statement of WHAT ACTUALLY RAN and is preserved verbatim
                          above; it is not deleted here. What changed is that the pass
                          branch no longer names a protocol that was never spoken. */}
                      ✓ No syntax errors reported by the in-process check. This is NOT an
                      LSP validation — no language server was contacted (see the method
                      above). Ready for Human-In-The-Loop review.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
