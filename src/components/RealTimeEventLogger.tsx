import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Shield, Cpu, Activity, Download, Trash2, Search, Filter, CheckCircle2, AlertTriangle, Radio } from 'lucide-react';

export interface LogEvent {
  id: string;
  timestamp: string;
  type: 'MODEL_INTERACTION' | 'SYSTEM_STATUS' | 'AUDIT_EVENT' | 'ERROR';
  source: string;
  message: string;
  details?: string;
  metadata?: Record<string, any>;
}

interface RealTimeEventLoggerProps {
  logs: LogEvent[];
  onClearLogs: () => void;
  onExportLogs: () => void;
}

export default function RealTimeEventLogger({ logs, onClearLogs, onExportLogs }: RealTimeEventLoggerProps) {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs if enabled
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter(log => {
    const matchesType = filterType === 'ALL' || log.type === filterType;
    const matchesSearch = searchTerm === '' || 
      log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.source.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.details && log.details.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesType && matchesSearch;
  });

  const getTypeBadge = (type: LogEvent['type']) => {
    switch (type) {
      case 'MODEL_INTERACTION':
        return <span className="bg-cyan-950/80 text-cyan-400 border border-cyan-800/50 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1"><Cpu className="h-3 w-3" /> MODEL_AI</span>;
      case 'SYSTEM_STATUS':
        return <span className="bg-blue-950/80 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1"><Activity className="h-3 w-3" /> SYSTEM</span>;
      case 'AUDIT_EVENT':
        return <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1"><Shield className="h-3 w-3" /> AUDIT</span>;
      case 'ERROR':
        return <span className="bg-rose-950/80 text-rose-400 border border-rose-800/50 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> ERROR</span>;
    }
  };

  return (
    <div className="bg-[#0b101b] border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden flex flex-col h-[520px]">
      {/* Header bar */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400">
            <Radio className="h-4 w-4 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 font-display flex items-center gap-2">
              <span>Real-Time Audit Event Logger</span>
              <span className="text-[10px] font-mono bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">
                {logs.length} EVENTS CAPTURED
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 font-sans">
              Live stream capturing all model interactions & system status changes for audit & compliance.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all border ${
              autoScroll 
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' 
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Auto-Scroll"
          >
            Auto-Scroll: {autoScroll ? 'ON' : 'OFF'}
          </button>
          
          <button
            onClick={onExportLogs}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-all"
            title="Export JSON audit logs"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export</span>
          </button>

          <button
            onClick={onClearLogs}
            className="bg-rose-950/40 hover:bg-rose-900/50 border border-rose-900/50 text-rose-300 px-3 py-1 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-all"
            title="Clear Event Log Buffer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-950/60 border-b border-slate-800/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-400 font-mono text-[11px]">Filter:</span>
          {['ALL', 'MODEL_INTERACTION', 'SYSTEM_STATUS', 'AUDIT_EVENT', 'ERROR'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-2.5 py-1 rounded font-mono text-[10px] transition-all uppercase ${
                filterType === type 
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm' 
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {type.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs rounded-lg pl-9 pr-3 py-1.5 focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>
      </div>

      {/* Logs Feed Container */}
      <div 
        ref={logContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-2.5 font-mono text-xs bg-[#060911]/9ery"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12">
            <Terminal className="h-10 w-10 text-slate-600 mb-2 animate-pulse" />
            <p className="text-sm font-sans">No audit events captured matching criteria.</p>
            <p className="text-[11px] text-slate-600 mt-1">Interactions with AI models and status changes will appear here in real-time.</p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div 
              key={log.id}
              className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 hover:border-slate-700 transition-all group"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {getTypeBadge(log.type)}
                  <span className="text-[11px] font-bold text-cyan-300 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {log.source}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(log.timestamp).toISOString().replace('T', ' ').substring(0, 19)}
                </span>
              </div>
              <p className="text-slate-200 text-xs font-sans leading-relaxed">
                {log.message}
              </p>
              {log.details && (
                <div className="mt-2 text-[11px] text-slate-400 bg-slate-950/80 border border-slate-800/60 rounded p-2 overflow-x-auto font-mono text-cyan-200/90">
                  {log.details}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer bar status */}
      <div className="bg-slate-950 border-t border-slate-800 px-4 py-2 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Buffer Active: Recording Real-Time Telemetry & Interactions</span>
        </div>
        <div>
          Showing {filteredLogs.length} of {logs.length} events
        </div>
      </div>
    </div>
  );
}
