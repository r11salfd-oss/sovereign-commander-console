import React, { useState, useEffect } from 'react';
import { Terminal, FolderPlus, FileSpreadsheet, ShieldCheck, Play } from 'lucide-react';
import { useWorkspace } from '../hooks/useWorkspace';

interface ProposeActionProps {
  onPropose: (payload: {
    agent: string;
    type: string;
    summary: string;
    reason: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    payload: any;
  }) => Promise<void>;
  submitting: boolean;
}

export default function ProposeAction({ onPropose, submitting }: ProposeActionProps) {
  const { workspaceInfo } = useWorkspace();
  const [activeTab, setActiveTab] = useState<'tscheck' | 'mkdir' | 'audit'>('tscheck');

  // Directory Proposal State inputs
  const [targetPath, setTargetPath] = useState('');
  const [dirSummary, setDirSummary] = useState('Create static commander folder structure');
  const [dirReason, setDirReason] = useState('Structure secure subdirectories for deployment static commander site assets.');
  const [dirRisk, setDirRisk] = useState<'low' | 'medium' | 'high' | 'critical'>('low');

  useEffect(() => {
    if (workspaceInfo?.subpaths?.commander) {
      setTargetPath(workspaceInfo.subpaths.commander);
    }
  }, [workspaceInfo]);

  // Audit State inputs
  const [auditFile, setAuditFile] = useState('package.json');
  const [auditCheck, setAuditCheck] = useState('dependencies');
  const [auditSummary, setAuditSummary] = useState('Read-only package.json schema validation audit');
  const [auditReason, setAuditReason] = useState('Security review of internal packages to audit lockfile integrity.');

  const handleSubmitTSCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    await onPropose({
      agent: 'developer-agent',
      type: 'command',
      summary: 'Run TypeScript verification Check',
      reason: 'Commander requested safe verification check through local terminal verification loop.',
      risk: 'low',
      payload: {
        binary: 'npm',
        args: ['run', 'check'],
        cwd: workspaceInfo.subpaths.forge
      }
    });
  };

  const handleSubmitMkdir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPath || !dirSummary || !dirReason) return;
    await onPropose({
      agent: 'architect-agent',
      type: 'mkdir',
      summary: dirSummary,
      reason: dirReason,
      risk: dirRisk,
      payload: {
        targetPath
      }
    });
  };

  const handleSubmitAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onPropose({
      agent: 'sentinel-agent',
      type: 'verify',
      summary: auditSummary,
      reason: auditReason,
      risk: 'low',
      payload: {
        file: auditFile,
        check: auditCheck
      }
    });
  };

  return (
    <section className="glass-panel rounded-xl p-5 glow-cyan border-cyan-500/10 mb-6">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-800">
        <Terminal className="h-5 w-5 text-cyan-400" />
        <h2 className="font-display font-semibold text-sm tracking-wider uppercase text-gray-200">
          Propose Action Panel / تقديم مقترح تشغيلي
        </h2>
      </div>

      {/* Action Preset Toggler tabs */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950/80 border border-slate-900 rounded-lg mb-6">
        <button
          onClick={() => setActiveTab('tscheck')}
          className={`px-3 py-2 rounded-md font-mono text-xs font-semibold uppercase flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'tscheck'
              ? 'bg-cyan-500/15 border border-cyan-500/20 text-cyan-300'
              : 'text-slate-500 hover:text-slate-300 border border-transparent'
          }`}
        >
          <Terminal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">TypeScript Check</span>
          <span className="sm:hidden">TS check</span>
        </button>

        <button
          onClick={() => setActiveTab('mkdir')}
          className={`px-3 py-2 rounded-md font-mono text-xs font-semibold uppercase flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'mkdir'
              ? 'bg-cyan-500/15 border border-cyan-500/20 text-cyan-300'
              : 'text-slate-500 hover:text-slate-300 border border-transparent'
          }`}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Create Directory</span>
          <span className="sm:hidden">Mkdir</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`px-3 py-2 rounded-md font-mono text-xs font-semibold uppercase flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'audit'
              ? 'bg-cyan-500/15 border border-cyan-500/20 text-cyan-300'
              : 'text-slate-500 hover:text-slate-300 border border-transparent'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Read Audit</span>
          <span className="sm:hidden">Audit</span>
        </button>
      </div>

      {/* Tab content containers */}

      {/* Preset A: TypeScript check */}
      {activeTab === 'tscheck' && (
        <form onSubmit={handleSubmitTSCheck} className="space-y-4">
          <div className="bg-slate-950/60 border border-slate-900 rounded-lg p-4 font-sans text-xs space-y-3">
            <p className="text-gray-400 leading-relaxed font-light">
              This action triggers static checks inside the Workspace shell to ensure there are no TypeScript syntax or runtime compiler errors. Very safe; read-only verification context.
            </p>
            <div className="bg-slate-950 border border-slate-900 rounded p-3 font-mono text-[11px] text-cyan-200">
              <div className="text-slate-500 font-bold mb-1 uppercase text-[9px]">Previewing payload JSON</div>
              {`{
  "agent": "developer-agent",
  "type": "command",
  "summary": "Run TypeScript verification",
  "reason": "Commander requested safe verification through HITL",
  "risk": "low",
  "payload": {
    "binary": "npm",
    "args": ["run", "check"],
    "cwd": "${(workspaceInfo?.subpaths?.forge || '/workspace/apps/forge-backend').replace(/\\/g, '\\\\')}"
  }
}`}
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-cyan-600/15 hover:bg-cyan-600/30 border border-cyan-500/40 hover:border-cyan-400 text-cyan-300 font-mono font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Play className="h-4 w-4" />
            <span>
              {submitting ? 'Lodging Proposal...' : 'Propose Verification Check / الترويج للفحص'}
            </span>
          </button>
        </form>
      )}

      {/* Preset B: Directory structure creation state form */}
      {activeTab === 'mkdir' && (
        <form onSubmit={handleSubmitMkdir} className="space-y-4 font-mono text-xs text-gray-400">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className="text-slate-500 font-bold uppercase text-[9px]">Target Absolute File-System Path</label>
              <input
                type="text"
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder={workspaceInfo?.subpaths?.commander || '/workspace/apps/forge-backend/public/commander'}
                className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-cyan-200 text-xs focus:outline-none focus:border-cyan-500 select-all"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-slate-500 font-bold uppercase text-[9px]">Operational Summary</label>
              <input
                type="text"
                value={dirSummary}
                onChange={(e) => setDirSummary(e.target.value)}
                placeholder="Summary..."
                className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-cyan-200 text-xs focus:outline-none focus:border-cyan-500"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-slate-500 font-bold uppercase text-[9px]">Risk Profile Matrix</label>
              <select
                value={dirRisk}
                onChange={(e) => setDirRisk(e.target.value as any)}
                className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-cyan-200 text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="low">LOW RISK - Reads & Safe Structures</option>
                <option value="medium">MEDIUM RISK - Path hygiene exceptions</option>
                <option value="high">HIGH RISK - Potential permission overrides</option>
                <option value="critical">CRITICAL RISK - Direct kernel structural shifts</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className="text-slate-500 font-bold uppercase text-[9px]">Justification Reason (RTL/English Allowed)</label>
              <textarea
                value={dirReason}
                onChange={(e) => setDirReason(e.target.value)}
                rows={2}
                placeholder="Secure justification for auditing..."
                className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-cyan-200 text-xs focus:outline-none focus:border-cyan-500 font-sans"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-cyan-600/15 hover:bg-cyan-600/30 border border-cyan-500/40 hover:border-cyan-400 text-cyan-300 font-mono font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <FolderPlus className="h-4 w-4" />
            <span>
              {submitting ? 'Lodging Proposal...' : 'Propose Directory Action / مقترح مجلد جديد'}
            </span>
          </button>
        </form>
      )}

      {/* Preset C: Safeguard read-only inspect tool */}
      {activeTab === 'audit' && (
        <form onSubmit={handleSubmitAudit} className="space-y-4 font-mono text-xs text-gray-400">
          <div className="bg-slate-950/40 border border-slate-900 rounded-lg p-3.5 mb-4 text-xs font-sans text-gray-400 space-y-2">
            <p className="leading-relaxed font-light">
              Submit defensive read-only audit requests to investigate dependencies and integrity schemas locally. Fully defensive simulation operations with no external targets.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-500 font-bold uppercase text-[9px]">Target Local Audit File</label>
              <input
                type="text"
                value={auditFile}
                onChange={(e) => setAuditFile(e.target.value)}
                placeholder="package.json"
                className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-cyan-200 text-xs focus:outline-none focus:border-cyan-500"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-slate-500 font-bold uppercase text-[9px]">Verification Hook Mode</label>
              <input
                type="text"
                value={auditCheck}
                onChange={(e) => setAuditCheck(e.target.value)}
                placeholder="dependenciesCheck"
                className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-cyan-200 text-xs focus:outline-none focus:border-cyan-500"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className="text-slate-500 font-bold uppercase text-[9px]">Audit Summary</label>
              <input
                type="text"
                value={auditSummary}
                onChange={(e) => setAuditSummary(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-cyan-200 text-xs focus:outline-none focus:border-cyan-500"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className="text-slate-500 font-bold uppercase text-[9px]">Audit Operational Justification</label>
              <textarea
                value={auditReason}
                onChange={(e) => setAuditReason(e.target.value)}
                rows={2}
                className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-cyan-200 text-xs focus:outline-none focus:border-cyan-500 font-sans"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-cyan-600/15 hover:bg-cyan-600/30 border border-cyan-500/40 hover:border-cyan-400 text-cyan-300 font-mono font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>
              {submitting ? 'Lodging Audit Proposal...' : 'Propose Verify Audit Loop / مقترح تدقيق'}
            </span>
          </button>
        </form>
      )}
    </section>
  );
}
