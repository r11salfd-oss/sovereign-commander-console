import React, { useState, useEffect } from 'react';
import { Folder, File, ChevronRight, ChevronDown, Shield, FileText } from 'lucide-react';

type FileEntry = {
  name: string;
  type: 'directory' | 'file';
  size?: number;
  relativePath: string;
};

type WorkspaceTree = {
  path: string;
  entries: FileEntry[];
};

export default function WorkspaceBrowser() {
  const [currentPath, setCurrentPath] = useState('');
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewContent, setPreviewContent] = useState<string | null>(null);

  const fetchTree = async (path: string) => {
    setLoading(true);
    setError('');
    setPreviewContent(null);
    try {
      const res = await fetch(`/api/workspace/tree?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to fetch directory tree');
      }
      const data = await res.json();
      setTree(data);
      setCurrentPath(path);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/workspace/preview?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to load preview');
      }
      const data = await res.json();
      setPreviewContent(data.content);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTree('');
  }, []);

  return (
    <div className="bg-[#0b101b]/80 border border-slate-800 rounded-xl overflow-hidden glassmorphism flex flex-col h-96 shadow-xl mt-6">
      <div className="p-3 border-b border-slate-800 bg-slate-900/40 flex justify-between items-center">
        <h2 className="font-mono text-sm uppercase tracking-widest text-cyan-400 font-bold flex items-center gap-2">
          <Folder className="w-5 h-5" /> Workspace Browser
        </h2>
        <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
          <Shield className="w-3 h-3 text-emerald-500" /> SAFE SCOPE
        </span>
      </div>
      
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {loading && <div className="absolute inset-0 bg-slate-950/50 z-10 flex items-center justify-center text-cyan-400 font-mono text-xs">Loading...</div>}
        
        {/* Navigation Bar */}
        <div className="bg-slate-900/80 p-2 text-xs font-mono text-slate-400 flex items-center gap-2 border-b border-slate-800">
          <button onClick={() => fetchTree('')} className="hover:text-white">root</button>
          {currentPath && currentPath.split(/[\/\\]/).filter(Boolean).map((part, idx, arr) => (
            <React.Fragment key={idx}>
              <span className="text-slate-600">/</span>
              <button 
                onClick={() => fetchTree(arr.slice(0, idx + 1).join('/'))}
                className="hover:text-white"
              >
                {part}
              </button>
            </React.Fragment>
          ))}
        </div>

        {error && (
          <div className="bg-rose-950 text-rose-400 p-3 m-3 rounded text-xs font-mono border border-rose-900">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto flex">
          <div className="w-full flex flex-col p-2 gap-1 h-full max-h-[300px]">
             {tree?.entries.length === 0 && <span className="text-slate-500 p-2 text-xs font-mono">Empty directory.</span>}
             {tree?.entries.map(entry => (
               <div key={entry.relativePath} className="flex items-center gap-2 text-xs font-mono text-slate-300 hover:bg-slate-800/50 p-1.5 rounded cursor-pointer transition">
                  {entry.type === 'directory' ? (
                    <div onClick={() => fetchTree(entry.relativePath)} className="flex items-center gap-2 w-full">
                       <Folder className="w-4 h-4 text-cyan-500" />
                       <span>{entry.name}</span>
                    </div>
                  ) : (
                    <div onClick={() => loadPreview(entry.relativePath)} className="flex items-center justify-between w-full">
                       <div className="flex items-center gap-2">
                         <File className="w-4 h-4 text-slate-500" />
                         <span>{entry.name}</span>
                       </div>
                       <span className="text-[10px] text-slate-600">
                         {entry.size ? `${(entry.size / 1024).toFixed(1)} KB` : ''}
                       </span>
                    </div>
                  )}
               </div>
             ))}
          </div>

          {previewContent && (
            <div className="absolute inset-0 bg-slate-950 flex flex-col z-20">
              <div className="p-2 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                <div className="text-xs font-mono text-cyan-400 flex flex-center gap-2 items-center"><FileText className="w-4 h-4" /> File Preview</div>
                <button onClick={() => setPreviewContent(null)} className="text-xs font-mono text-slate-400 hover:text-white px-2 py-1 bg-slate-800 rounded">Close</button>
              </div>
              <pre className="flex-1 overflow-auto p-4 text-[10px] font-mono text-slate-300 leading-relaxed">
                {previewContent}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
