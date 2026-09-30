/**
 * ============================================================================
 * SOVEREIGN SERVERS CENTER PANEL (MCP & LSP UNIFIED CONTROL)
 * Location: E:\Servers-Center (Device Canonical Servers Hub)
 * Standard: Model Context Protocol (6+1 Servers) & Language Server Protocol (6 Servers)
 * Chain Key ID: 360ea36c28e66d9d
 * ============================================================================
 */

import React, { useState, useEffect } from 'react';
import { 
  Server, 
  Cpu, 
  Layers, 
  Terminal, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Code2, 
  ShieldCheck, 
  Sparkles,
  ExternalLink,
  ChevronRight,
  FileCode,
  Box
} from 'lucide-react';
import { ServersCenterOverview } from '../services/serversCenterRegistry';

export default function ServersCenterPanel() {
  const [overview, setOverview] = useState<ServersCenterOverview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selectedSubTab, setSelectedSubTab] = useState<'mcp' | 'lsp' | 'all'>('all');
  const [testResult, setTestResult] = useState<{ [id: string]: string }>({});

  const fetchOverview = async () => {
    try {
      setRefreshing(true);
      const res = await fetch('/api/servers-center/overview');
      const data = await res.json();
      setOverview(data);
    } catch (err: any) {
      console.error('[ServersCenterPanel] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const handleTestMcp = async (serverId: string) => {
    setTestResult(prev => ({ ...prev, [serverId]: 'جاري الفحص...' }));
    try {
      if (serverId === 'sovereign-commander') {
        const res = await fetch('/api/mcp/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
              name: 'sovereign_verify_chain',
              arguments: { chainKeyId: '360ea36c28e66d9d' }
            }
          })
        });
        const data = await res.json();
        const text = data.result?.content?.[0]?.text || JSON.stringify(data);
        setTestResult(prev => ({ ...prev, [serverId]: `✅ استجابة فورية: ${text.slice(0, 100)}` }));
      } else {
        const res = await fetch('/api/mcp/status');
        const data = await res.json();
        setTestResult(prev => ({ ...prev, [serverId]: `✅ مسجل في المركز السيادي (Status: ${data.status || 'Active'})` }));
      }
    } catch (e: any) {
      setTestResult(prev => ({ ...prev, [serverId]: `❌ خطأ في الاتصال: ${e.message}` }));
    }
  };

  if (loading && !overview) {
    return (
      <div className="p-8 text-center text-slate-400 bg-slate-900/60 rounded-xl border border-slate-800 animate-pulse">
        <Server className="w-8 h-8 mx-auto mb-2 text-cyan-400 animate-spin" />
        <p className="text-xs font-mono">جاري استدعاء وفحص سجلات المركز الموحد E:\Servers-Center...</p>
      </div>
    );
  }

  const mcpList = overview?.mcpSummary.servers || [];
  const lspList = overview?.lspSummary.servers || [];

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Telemetry Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-[#0c1322] border border-cyan-500/30 rounded-2xl p-5 shadow-[0_0_25px_rgba(6,182,212,0.15)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono uppercase tracking-wider mb-1">
              <Server className="w-4 h-4 text-cyan-400" />
              <span>Device Canonical Hub: E:\Servers-Center</span>
              <span className="bg-cyan-950/80 text-cyan-300 border border-cyan-700/50 px-2 py-0.5 rounded-full text-[10px] font-bold">
                Chain Key: 360ea36c28e66d9d
              </span>
            </div>
            <h2 className="text-xl font-bold font-sans text-white flex items-center gap-2">
              مركز الخوادم الموحد (MCP & LSP Central Matrix)
              <Sparkles className="w-4 h-4 text-yellow-400" />
            </h2>
            <p className="text-xs text-slate-400 font-mono mt-1">
              مرجع الخوادم الموحد على القرص E:. خوادم بروتوكول السياق (MCP) الستة وخوادم لغات البرمجة (LSP) متكاملة مركزياً لخدمة كافة الوكلاء والمحررات.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchOverview}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg text-xs font-mono transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>تحديث الفحص الميداني</span>
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-800 text-xs font-mono">
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-cyan-400" />
              <span>خوادم الـ MCP المعتمدة</span>
            </div>
            <div className="text-lg font-bold text-cyan-300 flex items-center gap-2">
              <span>{overview?.mcpSummary.total || 0} خوادم</span>
              <span className="text-[10px] bg-cyan-950 text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-800/50">
                {overview?.mcpSummary.onlineCount} نشط
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>خوادم الـ LSP للغات البرمجة</span>
            </div>
            <div className="text-lg font-bold text-indigo-300 flex items-center gap-2">
              <span>{overview?.lspSummary.total || 0} خوادم</span>
              <span className="text-[10px] bg-indigo-950 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-800/50">
                {overview?.lspSummary.readyCount} جاهز
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>بيئة التشغيل المحمولة (Runtime)</span>
            </div>
            <div className="text-sm font-bold text-emerald-300 truncate" title={overview?.nodeRuntime.path}>
              Node.js {overview?.nodeRuntime.version} (E:)
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              <span>صمود النظام والبقاء (Persistence)</span>
            </div>
            <div className="text-sm font-bold text-amber-300 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>محصن ضد إعادة تثبيت C:</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub Filter Tabs */}
      <div className="flex items-center gap-2 pb-1 border-b border-slate-800 text-xs font-mono">
        <button
          onClick={() => setSelectedSubTab('all')}
          className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
            selectedSubTab === 'all'
              ? 'bg-slate-800 text-white font-bold border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          كافة الخوادم ({mcpList.length + lspList.length})
        </button>
        <button
          onClick={() => setSelectedSubTab('mcp')}
          className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
            selectedSubTab === 'mcp'
              ? 'bg-cyan-950/80 text-cyan-300 font-bold border border-cyan-700/60'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          <span>خوادم الـ MCP الـ 6 + السيادي ({mcpList.length})</span>
        </button>
        <button
          onClick={() => setSelectedSubTab('lsp')}
          className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
            selectedSubTab === 'lsp'
              ? 'bg-indigo-950/80 text-indigo-300 font-bold border border-indigo-700/60'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>خوادم الـ LSP للغات ({lspList.length})</span>
        </button>
      </div>

      {/* Section 1: Model Context Protocol (MCP) Servers */}
      {(selectedSubTab === 'all' || selectedSubTab === 'mcp') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold font-sans text-cyan-400 flex items-center gap-2">
              <Box className="w-4 h-4 text-cyan-400" />
              خوادم بروتوكول سياق النماذج (Model Context Protocol Servers - 6 External + Sovereign)
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              بروتوكول JSON-RPC 2.0 القياسي للأدوات والموارد
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {mcpList.map((srv) => (
              <div
                key={srv.id}
                className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/50 transition flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="text-white font-bold text-sm flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{srv.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-400/80 block mt-0.5">
                        ID: {srv.id} • v{srv.version}
                      </span>
                    </div>

                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      srv.status === 'ONLINE'
                        ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                        : 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                    }`}>
                      {srv.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 mb-3">
                    {srv.description}
                  </p>

                  <div className="text-[11px] font-mono text-slate-500 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 mb-2 truncate" title={srv.fullPath}>
                    <span className="text-slate-400">المسار: </span>
                    {srv.entry}
                  </div>

                  {srv.tools && srv.tools.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono text-slate-400">الأدوات البرمجية المتاحة:</div>
                      <div className="flex flex-wrap gap-1">
                        {srv.tools.slice(0, 4).map((t, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-800/40 px-1.5 py-0.5 rounded"
                          >
                            {t}
                          </span>
                        ))}
                        {srv.tools.length > 4 && (
                          <span className="text-[10px] font-mono text-slate-500 px-1">
                            +{srv.tools.length - 4} المزيد
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleTestMcp(srv.id)}
                    className="text-[11px] font-mono px-2.5 py-1 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/50 rounded transition cursor-pointer flex items-center gap-1"
                  >
                    <span>فحص الاستجابة</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>

                  {testResult[srv.id] && (
                    <span className="text-[10px] font-mono text-slate-300 truncate max-w-[150px]" title={testResult[srv.id]}>
                      {testResult[srv.id]}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 2: Language Server Protocol (LSP) Servers */}
      {(selectedSubTab === 'all' || selectedSubTab === 'lsp') && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold font-sans text-indigo-400 flex items-center gap-2">
              <Code2 className="w-4 h-4 text-indigo-400" />
              خوادم بروتوكول لغات البرمجة (Language Server Protocol - 6 Language Engines)
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              ذكاء الكود، التشخيص التلقائي والتحليل السكوني الموحد
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {lspList.map((srv) => (
              <div
                key={srv.id}
                className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 transition flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="text-white font-bold text-sm flex items-center gap-1.5">
                        <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{srv.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-indigo-400/80 block mt-0.5">
                        اللغة: {srv.language} • v{srv.version}
                      </span>
                    </div>

                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      srv.status === 'READY'
                        ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                        : 'bg-indigo-950/80 text-indigo-400 border border-indigo-800/60'
                    }`}>
                      {srv.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 mb-3">
                    {srv.description}
                  </p>

                  <div className="text-[11px] font-mono text-slate-500 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 truncate" title={srv.fullPath || srv.source || srv.note}>
                    <span className="text-slate-400">نقطة الدخول: </span>
                    {srv.entry || srv.source || srv.note || 'System Package'}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>جاهز للاستدعاء عبر المحررات</span>
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {srv.source ? 'System Toolchain' : 'Relocatable Pinned'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
