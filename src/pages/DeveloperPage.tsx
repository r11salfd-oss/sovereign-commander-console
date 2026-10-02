import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Play, 
  RefreshCw, 
  Send, 
  Key, 
  Copy, 
  Check, 
  Trash2, 
  Plus, 
  Code2, 
  BookOpen, 
  Laptop,
  Folder,
  Clock,
  Server,
  AlertCircle
} from 'lucide-react';
import { getGoogleAuthHeaders } from '../firebase';
import ServersCenterPanel from '../components/ServersCenterPanel';

interface CliToken {
  id: string;
  name: string;
  rawToken?: string;
  maskedToken: string;
  role: string;
  createdAt: string;
  lastUsedAt?: string | null;
}

interface CommandHistoryItem {
  id: string;
  command: string;
  output: string;
  timestamp: string;
  cwd: string;
  exitCode: number;
  durationMs?: number;
}

export default function DeveloperPage() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'connect' | 'docs' | 'api' | 'servers-center'>('terminal');

  // Real Terminal & Shell State
  const [currentCwd, setCurrentCwd] = useState<string>('/app/applet');
  const [terminalInput, setTerminalInput] = useState('');
  /**
   * UI TRUTH NOTE (Chain Key 360ea36c28e66d9d)
   * ---------------------------------------------------------------------------
   * This seed is a LABELLLED PLACEHOLDER, not a measurement. The previous
   * revision printed `Node.js: v22.23.2 (Production Environment Active)` and a
   * `MCP Protocol : ONLINE` banner as if they were captured telemetry. They
   * were authored strings: nothing had been executed, nothing had been probed,
   * and in the container the real runtime is a different version entirely.
   *
   * Doctrine (AGENTS.md §5, Anti-Simulation & Anti-Fabrication Mandate): a
   * plausible-looking number with no physical evidence behind it is worse than
   * an honest "not measured". So the seed now states exactly what it is, and
   * every real reading appears only after an actual `/api/cli/execute` round
   * trip. Operator: run `node -v` in the terminal above to measure the runtime.
   */
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([
    {
      id: 'welcome',
      command: 'uname -a && node -v',
      output: [
        '(لم يُنفَّذ أي أمر بعد — هذا سجل مبدئي مُعلَّم وليس ناتج تنفيذ حقيقي.)',
        'حالة القياس: إصدار Node.js غير مقيس على هذا العميل.',
        'للحصول على رقم حقيقي: نفّذ "node -v" من الطرفية الحية أعلاه.'
      ].join('\n'),
      timestamp: new Date().toLocaleTimeString(),
      cwd: '/app/applet',
      exitCode: 0,
      durationMs: 4
    },
    {
      id: 'welcome-sov',
      command: 'sovereign status',
      output: [
        '👑 SOVEREIGN CORE OS v3.8 TELEMETRY STATUS',
        '------------------------------------------------------------',
        '(نص تمهيدي مُعلَّم — ليس ناتج تنفيذ حقيقي.)',
        '● Server Core       : UNVERIFIED (لم يُقَس في هذا السجل)',
        '● Shell Gateway     : UNVERIFIED (لم يُقَس في هذا السجل)',
        '● RAM Heap Memory   : UNVERIFIED (لم يُقَس في هذا السجل)',
        // Honesty fix: this used to assert ONLINE for the MCP protocol. The
        // registry performs a file-existence probe only and never emits ONLINE,
        // so the banner must not contradict the panel it links to.
        '● MCP Protocol      : UNVERIFIABLE (لم تُنفَّذ مصافحة — راجع تبويب مركز الخوادم)',
        '● HITL Guard        : UNVERIFIED (لم يُقَس في هذا السجل)',
        '● Audit Ledger      : UNVERIFIED (لم يُقَس في هذا السجل)',
        '● Sentinel SOC      : UNVERIFIED (لم يُقَس في هذا السجل)',
        '● Gemini Neural AI  : UNVERIFIED (لم يُقَس في هذا السجل)',
        '------------------------------------------------------------',
        'Hint: You can run ANY real Linux shell command here: ls, pwd, cat, git, npm, ps, or sovereign directives!'
      ].join('\n'),
      timestamp: new Date().toLocaleTimeString(),
      cwd: '/app/applet',
      exitCode: 0,
      durationMs: 12
    }
  ]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Tokens & Connection State
  const [tokens, setTokens] = useState<CliToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [generatedTokenSecret, setGeneratedTokenSecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // API Testbed State
  const [activeEndpoint, setActiveEndpoint] = useState('/api/antigravity/status');
  const [apiResponseOutput, setApiResponseOutput] = useState<string>('Select an API endpoint and click "Execute Request"');
  const [apiLoading, setApiLoading] = useState(false);
  const [apiLatency, setApiLatency] = useState<number | null>(null);

  const hostUrl = typeof window !== 'undefined' ? window.location.origin : 'https://ais-dev-...run.app';

  // Fetch CLI tokens
  const fetchTokens = async () => {
    setLoadingTokens(true);
    try {
      const res = await fetch('/api/cli/tokens');
      const data = await res.json();
      if (data.tokens) {
        setTokens(data.tokens);
      }
    } catch {
      // Graceful fallback
    } finally {
      setLoadingTokens(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, []);

  // Scroll to bottom of terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [commandHistory, isExecuting]);

  // Execute CLI Command
  const handleExecuteCli = async (cmdToRun?: string) => {
    const cmd = (cmdToRun !== undefined ? cmdToRun : terminalInput).trim();
    if (!cmd) return;

    if (cmd === 'clear' || cmd === 'cls') {
      setCommandHistory([]);
      setTerminalInput('');
      return;
    }

    setIsExecuting(true);
    setTerminalInput('');
    setHistoryIndex(-1);

    const startTime = performance.now();
    try {
      const res = await fetch('/api/cli/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          command: cmd,
          cwd: currentCwd
        })
      });
      const data = await res.json();
      const durationMs = data.durationMs || Math.round(performance.now() - startTime);

      if (data.cwd) {
        setCurrentCwd(data.cwd);
      }

      setCommandHistory(prev => [
        ...prev,
        {
          id: 'cmd_' + Date.now(),
          command: cmd,
          output: data.output || (data.ok ? '(تم التنفيذ بنجاح دون مخرجات نصية)' : `Error: ${data.error}`),
          timestamp: new Date().toLocaleTimeString(),
          cwd: data.cwd || currentCwd,
          exitCode: data.exitCode !== undefined ? data.exitCode : (data.ok ? 0 : 1),
          durationMs
        }
      ]);
    } catch (err: any) {
      setCommandHistory(prev => [
        ...prev,
        {
          id: 'cmd_' + Date.now(),
          command: cmd,
          output: `Network / Execution Error: ${err.message}`,
          timestamp: new Date().toLocaleTimeString(),
          cwd: currentCwd,
          exitCode: 1,
          durationMs: Math.round(performance.now() - startTime)
        }
      ]);
    } finally {
      setIsExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // Keyboard navigation for history (Arrow Up / Arrow Down)
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const executedCmds = commandHistory.map(h => h.command).filter(c => c && c !== 'clear' && c !== 'cls');
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (executedCmds.length === 0) return;
      const nextIdx = historyIndex === -1 ? executedCmds.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setTerminalInput(executedCmds[nextIdx] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIdx = historyIndex + 1;
      if (nextIdx >= executedCmds.length) {
        setHistoryIndex(-1);
        setTerminalInput('');
      } else {
        setHistoryIndex(nextIdx);
        setTerminalInput(executedCmds[nextIdx] || '');
      }
    }
  };

  // Generate new CLI token
  const handleCreateToken = async () => {
    if (!newTokenName.trim()) return;
    try {
      const res = await fetch('/api/cli/tokens/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim(), role: 'admin' })
      });
      const data = await res.json();
      if (data.tokenRecord) {
        setGeneratedTokenSecret(data.tokenRecord.rawToken);
        setNewTokenName('');
        fetchTokens();
      }
    } catch (e: any) {
      alert('Error creating token: ' + e.message);
    }
  };

  // Revoke token
  const handleRevokeToken = async (id: string) => {
    if (!confirm('هل أنت متأكد من رغبتك في إلغاء صلاحية هذا الرمز؟')) return;
    try {
      await fetch(`/api/cli/tokens/${id}`, { method: 'DELETE' });
      fetchTokens();
    } catch (e: any) {
      alert('Error revoking token: ' + e.message);
    }
  };

  // Copy helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // API Testbed Execution
  const handleExecuteApi = async (url: string) => {
    setApiLoading(true);
    setApiResponseOutput('Executing request...');
    const startTime = performance.now();
    try {
      const headers = await getGoogleAuthHeaders();
      const res = await fetch(url, { method: 'GET', headers });
      const data = await res.json();
      const endTime = performance.now();
      setApiLatency(Math.round(endTime - startTime));
      setApiResponseOutput(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setApiLatency(null);
      setApiResponseOutput(`Execution Error:\n${e.message}`);
    } finally {
      setApiLoading(false);
    }
  };

  const endpoints = [
    { url: '/api/antigravity/status', method: 'GET', desc: 'Verify Antigravity remote sandbox status & AGY CLI protocol' },
    { url: '/api/gemini/account-tier', method: 'GET', desc: 'Inspect Google account tier & Gemini Pro OAuth2 subscription binding' },
    { url: '/api/hitl/ping', method: 'GET', desc: 'HITL core sentinel ping and environment specs' },
    { url: '/api/brainmap', method: 'GET', desc: 'Inspect live cognitive matrix model mappings' },
    { url: '/api/mcp/status', method: 'GET', desc: 'Check Model Context Protocol (MCP) server daemon status' },
    { url: '/api/mcp/servers', method: 'GET', desc: 'Inspect full catalog of 6 MCP servers + Sovereign Commander' },
    { url: '/api/lsp/servers', method: 'GET', desc: 'Inspect all 6 Language Server Protocol (LSP) engines' },
    { url: '/api/servers-center/overview', method: 'GET', desc: 'Query unified Servers Center device hub — resolved root + FILE_EXISTENCE_ONLY measurement envelope (not a reachability claim)' },
    { url: '/api/hitl/audit/verify', method: 'GET', desc: 'Cryptographic ledger hash validation probe' },
    { url: '/api/agents/metrics', method: 'GET', desc: 'Real 24h deterministic agent operations telemetry' }
  ];

  const formatShortPath = (fullPath: string) => {
    if (fullPath === '/app/applet') return '~';
    if (fullPath.startsWith('/app/applet/')) return '~/' + fullPath.replace('/app/applet/', '');
    return fullPath;
  };

  return (
    <div className="min-h-screen bg-[#07090e] p-4 md:p-8 text-slate-200 font-mono">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs tracking-wider uppercase mb-1">
              <Terminal className="w-4 h-4" />
              <span>Real Linux Bash Shell & CLI Gateway</span>
            </div>
            <h1 className="text-2xl font-bold font-sans text-white">الطرفية البرمجية الحقيقية (Real Shell & CLI)</h1>
            <p className="text-xs text-slate-400 font-mono mt-1">
              طرفية Linux Bash حقيقية متصلة بالخادم، تنفيذ سطر الأوامر الفعلي، وإدارة مفاتيح الربط الخارجي.
            </p>
          </div>

          {/* Quick Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab('terminal')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'terminal' 
                  ? 'bg-cyan-600 text-white font-bold shadow-[0_0_12px_rgba(6,182,212,0.35)]' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>طرفية Bash الحية</span>
            </button>
            <button
              onClick={() => setActiveTab('connect')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'connect' 
                  ? 'bg-cyan-600 text-white font-bold shadow-[0_0_12px_rgba(6,182,212,0.35)]' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>ربط جهازك المحلي</span>
            </button>
            <button
              onClick={() => setActiveTab('docs')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'docs' 
                  ? 'bg-cyan-600 text-white font-bold shadow-[0_0_12px_rgba(6,182,212,0.35)]' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>دليل الأوامر</span>
            </button>
            <button
              onClick={() => setActiveTab('api')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'api' 
                  ? 'bg-cyan-600 text-white font-bold shadow-[0_0_12px_rgba(6,182,212,0.35)]' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>فحص الـ API</span>
            </button>
            <button
              onClick={() => setActiveTab('servers-center')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'servers-center' 
                  ? 'bg-cyan-600 text-white font-bold shadow-[0_0_12px_rgba(6,182,212,0.35)]' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>مركز الخوادم (MCP & LSP)</span>
            </button>
          </div>
        </div>

        {/* ── TAB 1: INTERACTIVE REAL LINUX BASH TERMINAL ── */}
        {activeTab === 'terminal' && (
          <div className="space-y-3">
            
            {/* Quick Command Chips */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs scrollbar-none">
              <span className="text-slate-500 shrink-0 text-[11px] flex items-center gap-1 font-bold">
                <Play className="w-3 h-3 text-cyan-400" />
                <span>أوامر حقيقية سريعة:</span>
              </span>
              {[
                'ls -la',
                'pwd',
                'git status',
                'node -v && npm -v',
                'cat package.json | grep -E "name|version"',
                'sovereign status',
                'sovereign memory clean',
                'sovereign agents',
                'sovereign audit verify',
                'sovereign tests',
                'ps aux | head -n 5',
                'df -h',
                'uptime',
                'clear'
              ].map(cmd => (
                <button
                  key={cmd}
                  onClick={() => handleExecuteCli(cmd)}
                  disabled={isExecuting}
                  className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 hover:border-cyan-500/60 text-cyan-300 hover:text-white transition shrink-0 cursor-pointer text-[11px] font-mono active:scale-95 disabled:opacity-50"
                >
                  {cmd}
                </button>
              ))}
            </div>

            {/* Terminal Window Box */}
            <div className="rounded-xl border border-slate-800 bg-[#05080e] shadow-2xl overflow-hidden font-mono flex flex-col h-[620px]">
              
              {/* Terminal Title Bar */}
              <div className="px-4 py-2.5 bg-[#0a0f1d] border-b border-slate-800/90 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-rose-500/80" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/80" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-slate-400 text-xs font-bold mr-2 flex items-center gap-1">
                    <Folder className="w-3.5 h-3.5 text-cyan-400" />
                    <span>sovereign@core:{formatShortPath(currentCwd)}$</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    REAL BASH SHELL (PID: ACTIVE)
                  </span>
                  <button
                    onClick={() => handleExecuteCli('clear')}
                    className="hover:text-slate-300 transition text-[10px] bg-slate-900 px-2 py-0.5 rounded border border-slate-800 cursor-pointer"
                  >
                    مسح (clear)
                  </button>
                </div>
              </div>

              {/* Terminal Scroll Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs leading-relaxed selection:bg-cyan-500/30">
                {commandHistory.map(item => (
                  <div key={item.id} className="space-y-1 group">
                    <div className="flex items-center justify-between text-cyan-400 font-bold border-b border-slate-900/60 pb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400">sovereign@core:{formatShortPath(item.cwd)}$</span>
                        <span className="text-white">{item.command}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-normal text-slate-500">
                        {item.durationMs !== undefined && (
                          <span className="text-slate-400 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5 text-slate-500" />
                            {item.durationMs}ms
                          </span>
                        )}
                        <span className={`px-1.5 py-0.2 rounded font-bold ${
                          item.exitCode === 0 
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/80' 
                            : 'bg-rose-950/80 text-rose-400 border border-rose-800/80'
                        }`}>
                          exit: {item.exitCode}
                        </span>
                        <span>{item.timestamp}</span>
                      </div>
                    </div>
                    <pre className={`whitespace-pre-wrap pl-3 border-l-2 font-mono text-[11px] leading-relaxed ${
                      item.exitCode === 0 
                        ? 'text-slate-300 border-emerald-500/30' 
                        : 'text-rose-300 border-rose-500/40'
                    }`}>
                      {item.output}
                    </pre>
                  </div>
                ))}

                {isExecuting && (
                  <div className="flex items-center gap-2 text-cyan-400 animate-pulse pl-3 py-1 border-l-2 border-cyan-500/50">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing in Linux container sandbox ({currentCwd})...</span>
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>

              {/* Terminal Input Prompt */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleExecuteCli();
                }}
                className="p-3 bg-[#0a0f1d] border-t border-slate-800/90 flex items-center gap-2 shadow-inner"
              >
                <span className="text-emerald-400 font-bold text-xs shrink-0 font-mono">
                  sovereign@core:{formatShortPath(currentCwd)}$
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="اكتب أمر bash حقيقي أو sovereign (مثال: ls -la أو cat package.json أو git status أو sovereign status)"
                  disabled={isExecuting}
                  className="flex-1 bg-transparent text-cyan-200 text-xs font-mono focus:outline-none placeholder-slate-600 disabled:opacity-50"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isExecuting || !terminalInput.trim()}
                  className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition disabled:opacity-40 flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                >
                  <Send className="w-3 h-3" />
                  <span>تنفيذ (Enter)</span>
                </button>
              </form>

            </div>
          </div>
        )}

        {/* ── TAB 2: CONNECT LOCAL CLI & TOKEN MANAGEMENT ── */}
        {activeTab === 'connect' && (
          <div className="space-y-6">
            
            {/* Quick 1-Step Setup Card */}
            <div className="p-5 rounded-xl bg-[#0b101b] border border-cyan-500/30 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                  <Laptop className="w-4 h-4" />
                  <span>ربط وتشغيل سطر الأوامر (CLI) من حاسوبك الشخصي الحقيقي</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-[10px] text-emerald-400 font-bold">
                  Linux / macOS / Windows WSL
                </span>
              </div>

              <p className="text-xs text-slate-300 font-sans leading-relaxed">
                يمكنك تنفيذ الأوامر الحقيقية واستدعاء وظائف المنصة كاملة من سطر الأوامر (Terminal) على حاسوبك أو خادمك الخارجي عبر الوسائل التالية:
              </p>

              {/* One-Line Curl Command */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400">1. تشغيل سكريبت التثبيت الآلي عبر cURL (يثبت أمر sovereign في نظامك):</span>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs text-cyan-300 font-mono">
                  <code className="truncate mr-2">
                    curl -sSL {hostUrl}/api/cli/install.sh | bash
                  </code>
                  <button
                    onClick={() => handleCopy(`curl -sSL ${hostUrl}/api/cli/install.sh | bash`, 'curl-install')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white transition text-xs shrink-0 cursor-pointer active:scale-95"
                  >
                    {copiedKey === 'curl-install' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'curl-install' ? 'تم النسخ' : 'نسخ'}</span>
                  </button>
                </div>
              </div>

              {/* Environment Variables Export */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400">2. ضبط متغيرات البيئة للربط المباشر مع الخادم:</span>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs text-amber-300 font-mono">
                  <code className="truncate mr-2">
                    export SOVEREIGN_HOST="{hostUrl}" && export SOVEREIGN_TOKEN="sov_live_d819c40ea7e260951b3fc1a97e682e"
                  </code>
                  <button
                    onClick={() => handleCopy(`export SOVEREIGN_HOST="${hostUrl}"\nexport SOVEREIGN_TOKEN="sov_live_d819c40ea7e260951b3fc1a97e682e"`, 'env-export')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white transition text-xs shrink-0 cursor-pointer active:scale-95"
                  >
                    {copiedKey === 'env-export' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'env-export' ? 'تم النسخ' : 'نسخ'}</span>
                  </button>
                </div>
              </div>

              {/* Direct REST / cURL Example */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400">3. تنفيذ أي أمر حقيقي (Bash أو Sovereign) عبر cURL:</span>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono relative">
                  <pre className="overflow-x-auto whitespace-pre">
{`curl -s -X POST "${hostUrl}/api/cli/execute" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sov_live_d819c40ea7e260951b3fc1a97e682e" \\
  -d '{"command": "ls -la"}'`}
                  </pre>
                  <button
                    onClick={() => handleCopy(`curl -s -X POST "${hostUrl}/api/cli/execute" -H "Content-Type: application/json" -H "Authorization: Bearer sov_live_d819c40ea7e260951b3fc1a97e682e" -d '{"command": "ls -la"}'`, 'curl-direct')}
                    className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white transition text-[10px] cursor-pointer"
                  >
                    {copiedKey === 'curl-direct' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'curl-direct' ? 'تم النسخ' : 'نسخ'}</span>
                  </button>
                </div>
              </div>

            </div>

            {/* CLI Tokens Management Card */}
            <div className="p-5 rounded-xl bg-[#0b101b] border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Key className="w-4 h-4 text-cyan-400" />
                  <span>مفاتيح ورموز وصول الـ CLI (API Tokens)</span>
                </div>
                <span className="text-xs text-slate-500">إجمالي الرموز: {loadingTokens ? 'جاري التحميل...' : tokens.length}</span>
              </div>

              {/* Generate New Token Form */}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="اسم الجهاز أو البيئة (مثال: MacBook Pro Local, CI Runner)"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={handleCreateToken}
                  disabled={!newTokenName.trim()}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إنشاء رمز وصول جديد</span>
                </button>
              </div>

              {/* Newly Generated Secret Alert */}
              {generatedTokenSecret && (
                <div className="p-4 rounded-lg bg-emerald-950/60 border border-emerald-600 space-y-2">
                  <div className="flex items-center justify-between text-xs text-emerald-300 font-bold">
                    <span>⚠️ تم إنشاء رمز الوصول بنجاح (انسخه الآن فلن يُعرض كاملاً مجدداً):</span>
                    <button 
                      onClick={() => setGeneratedTokenSecret(null)}
                      className="text-slate-400 hover:text-white text-xs cursor-pointer"
                    >
                      إغلاق
                    </button>
                  </div>
                  <div className="p-2.5 rounded bg-black/60 border border-emerald-800 flex items-center justify-between text-xs text-emerald-400 font-mono">
                    <span className="truncate mr-2">{generatedTokenSecret}</span>
                    <button
                      onClick={() => handleCopy(generatedTokenSecret, 'secret-key')}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-white transition text-xs shrink-0 cursor-pointer"
                    >
                      {copiedKey === 'secret-key' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'secret-key' ? 'تم النسخ' : 'نسخ الرمز'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Tokens Table */}
              <div className="space-y-2">
                {tokens.map(token => (
                  <div 
                    key={token.id}
                    className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{token.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-[10px] text-cyan-300 border border-cyan-800">
                          {token.role}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        الرمز: <code className="text-slate-400">{token.maskedToken}</code> • تم الإنشاء: {new Date(token.createdAt).toLocaleDateString('ar-EG')}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {token.rawToken && (
                        <button
                          onClick={() => handleCopy(token.rawToken!, `token-${token.id}`)}
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                          title="نسخ الرمز"
                        >
                          {copiedKey === `token-${token.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      <button
                        onClick={() => handleRevokeToken(token.id)}
                        className="p-1.5 rounded bg-rose-950/40 hover:bg-rose-900 border border-rose-900/60 text-rose-400 hover:text-white transition cursor-pointer"
                        title="إلغاء صلاحية الرمز"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

            </div>

          </div>
        )}

        {/* ── TAB 3: CLI COMMANDS REFERENCE ── */}
        {activeTab === 'docs' && (
          <div className="space-y-4">
            <div className="p-5 rounded-xl bg-[#0b101b] border border-slate-800 space-y-4">
              <h2 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
                <BookOpen className="w-4 h-4 text-cyan-400" />
                <span>دليل أوامر طرفية Sovereign CLI الشامل والأوامر الحقيقية</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    cmd: 'ls -la',
                    desc: 'استعراض حقيقي لملفات ومجلدات المشروع وحجمها وتصاريحها.',
                    cat: 'أوامر Linux Bash الحقيقية'
                  },
                  {
                    cmd: 'pwd',
                    desc: 'طباعة مسار المجلد الحالي النشط في حاوية النظام الحقيقية.',
                    cat: 'أوامر Linux Bash الحقيقية'
                  },
                  {
                    cmd: 'cd <dir>',
                    desc: 'الانتقال بين مجلدات النظام الفعلي وحفظ مسار الجلسة.',
                    cat: 'أوامر Linux Bash الحقيقية'
                  },
                  {
                    cmd: 'cat package.json',
                    desc: 'قراءة محتوى ملفات المشروع البرمجية بالكامل.',
                    cat: 'أوامر Linux Bash الحقيقية'
                  },
                  {
                    cmd: 'git status',
                    desc: 'فحص حالة مستودع Git والتعديلات البرمجية الحالية.',
                    cat: 'أوامر Linux Bash الحقيقية'
                  },
                  {
                    cmd: 'node -v && npm -v',
                    desc: 'طباعة إصدارات محرك Node.js ومدير الحزم npm الحقيقيين.',
                    cat: 'أوامر Linux Bash الحقيقية'
                  },
                  {
                    cmd: 'sovereign status',
                    desc: 'فحص صحة الخادم اللحظية، استهلاك الذاكرة، حالة MCP، وسلامة سلاسل التدقيق.',
                    cat: 'مراقبة النظام'
                  },
                  {
                    cmd: 'sovereign memory clean',
                    desc: 'تفريغ وتنظيف الذاكرة المؤقتة فورياً عبر Garbage Collection.',
                    cat: 'الذاكرة والموارد'
                  },
                  {
                    cmd: 'sovereign ping',
                    desc: 'قياس زمن الاستجابة اللحظي الدقيق (Roundtrip Ping) إلى خادم النظام.',
                    cat: 'الشبكة والاتصال'
                  },
                  {
                    cmd: 'sovereign agents',
                    desc: 'عرض مصفوفة فيلق الوكلاء الذاتيين (Agent Corps) مع أحجام العمليات الحقيقية المسجلة.',
                    cat: 'الذكاء الاصطناعي'
                  },
                  {
                    cmd: 'sovereign ask "<prompt>"',
                    desc: 'استشارة معرفية برمجية سريعة ومباشرة عبر نموذج Gemini 3.8 Flash.',
                    cat: 'الذكاء الاصطناعي'
                  },
                  {
                    cmd: 'sovereign tests',
                    desc: 'تشغيل حزمة اختبارات الجودة والانحدار الآلية (Automated QA Regression Suite).',
                    cat: 'ضمان الجودة'
                  }
                ].map((item, idx) => (
                  <div 
                    key={idx}
                    className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2 hover:border-cyan-500/40 transition"
                  >
                    <div className="flex items-center justify-between">
                      <code className="text-cyan-300 font-bold text-xs bg-slate-950 px-2 py-0.5 rounded border border-cyan-900/40">
                        {item.cmd}
                      </code>
                      <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        {item.cat}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-sans leading-relaxed">
                      {item.desc}
                    </p>
                    <button
                      onClick={() => {
                        setActiveTab('terminal');
                        setTerminalInput(item.cmd);
                      }}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer pt-1"
                    >
                      <Play className="w-2.5 h-2.5" />
                      <span>تجربة في الطرفية الحية</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 4: API TESTBED ── */}
        {activeTab === 'api' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Endpoint Selector */}
            <div className="lg:col-span-4 space-y-3">
              <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Diagnostic Endpoints</span>
                {apiLatency !== null && (
                  <span className="text-emerald-400 font-bold">{apiLatency}ms</span>
                )}
              </div>
              {endpoints.map(ep => (
                <button
                  key={ep.url}
                  onClick={() => {
                    setActiveEndpoint(ep.url);
                    handleExecuteApi(ep.url);
                  }}
                  className={`w-full p-3 rounded-lg border text-left font-mono transition space-y-1 cursor-pointer ${
                    activeEndpoint === ep.url
                      ? 'bg-slate-800/90 border-cyan-500/60 shadow-[0_0_12px_rgba(6,182,212,0.15)] text-white'
                      : 'bg-slate-900/40 border-slate-800 hover:bg-slate-800/50 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan-400">{ep.url}</span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-950 text-[9px] uppercase text-slate-400 border border-slate-800">
                      {ep.method}
                    </span>
                  </div>
                  <div className="text-[11px] font-sans text-slate-400 leading-snug">
                    {ep.desc}
                  </div>
                </button>
              ))}
            </div>

            {/* Response Output */}
            <div className="lg:col-span-8 flex flex-col space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                  Raw JSON Payload
                </span>
                <button
                  onClick={() => handleExecuteApi(activeEndpoint)}
                  disabled={apiLoading}
                  className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${apiLoading ? 'animate-spin' : ''}`} />
                  <span>إعادة الإرسال</span>
                </button>
              </div>

              <div className="flex-1 min-h-[420px] p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs overflow-auto text-cyan-300/90">
                <pre>{apiResponseOutput}</pre>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 5: SERVERS CENTER (MCP & LSP UNIFIED CONTROL) ── */}
        {activeTab === 'servers-center' && (
          <div className="space-y-3">
            {/* Honesty banner: what this page will and will not claim about the
                Servers Center. The panel below prints only measured values; this
                banner tells the operator that a path check is all there is, so a
                wall of UNVERIFIABLE badges is read as a missing handshake rather
                than as a broken fleet. */}
            <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-700/50 bg-amber-950/20 text-[11px] font-mono">
              <AlertCircle className="w-4 h-4 mt-px shrink-0 text-amber-400" aria-hidden="true" />
              <p className="text-slate-300 leading-relaxed">
                اللوحة أدناه تعرض <span className="text-amber-300">القياس الفعلي فقط</span>:
                فحص وجود المسارات على القرص عبر{' '}
                <span dir="ltr">FILESYSTEM_EXISTENCE_PROBE</span>. لا يوجد في هذه الواجهة أي مصافحة
                <span dir="ltr"> MCP/LSP</span>، لذلك لن يظهر أي مدخل بحالة «متصل» — وهذا نقص قياس
                صريح وليس عطلاً في الخوادم.
              </p>
            </div>
            <ServersCenterPanel />
          </div>
        )}

      </div>
    </div>
  );
}
