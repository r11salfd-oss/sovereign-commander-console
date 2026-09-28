import React, { useState, useCallback } from 'react';
import { UploadCloud, File, Image as ImageIcon, FileText, Video, X, Lock } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Attachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  previewUrl?: string;
  status: 'accepted' | 'blocked';
  reason?: string;
};

export default function InputDock() {
  const [isHovering, setIsHovering] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const validateFile = (file: File): Attachment => {
    const isSecret = file.name.endsWith('.key') || 
      file.name.endsWith('.pem') || 
      file.name === '.env' || 
      file.name.includes('secret') || 
      file.name.includes('token') || 
      file.name.includes('credential') ||
      file.name.includes('private') ||
      file.name === 'id_rsa' ||
      file.name === 'id_ed25519' ||
      file.name.includes('SOVEREIGN_WAR_CHEST') ||
      file.name === 'commander.hmac.key';
    
    if (isSecret) {
      return {
        id: Math.random().toString(),
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'blocked',
        reason: 'Policy Violation: Secrets blocked.'
      };
    }

    let previewUrl;
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      previewUrl = URL.createObjectURL(file);
    }

    return {
      id: Math.random().toString(),
      name: file.name,
      size: file.size,
      type: file.type,
      previewUrl,
      status: 'accepted'
    };
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsHovering(false);
    
    const files = Array.from(e.dataTransfer.files);
    setAttachments(prev => [...prev, ...files.map(validateFile)]);
  }, []);

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div className="bg-[#0b101b]/80 border border-slate-800 rounded-xl overflow-hidden glassmorphism flex flex-col h-full shadow-xl">
      <div className="p-4 border-b border-slate-800 bg-slate-900/40 flex justify-between items-center">
        <h2 className="font-mono text-sm uppercase tracking-widest text-[#fbbf24] font-bold flex items-center gap-2">
          <UploadCloud className="w-5 h-5" /> Commander Input Dock
        </h2>
        <span className="text-[10px] text-slate-500 font-mono">LOCAL ONLY. NO UPLOAD.</span>
      </div>
      
      <div className="p-4 space-y-4">
        <div 
          onDragOver={(e) => { e.preventDefault(); setIsHovering(true); }}
          onDragLeave={() => setIsHovering(false)}
          onDrop={onDrop}
          className={cn(
            "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all min-h-[160px] text-center",
            isHovering ? "border-cyan-400 bg-cyan-950/20" : "border-slate-700 bg-slate-900/20 hover:border-slate-600"
          )}
        >
          <UploadCloud className={cn("w-10 h-10 mb-3", isHovering ? "text-cyan-400" : "text-slate-500")} />
          <div className="text-sm font-bold text-slate-300 font-sans">Drag & Drop Context / إسقاط الملفات هنا</div>
          <div className="text-[10px] text-slate-500 font-mono mt-2">Images, Videos, Logs, Notes (Local Browsing Only)</div>
        </div>

        {attachments.length > 0 && (
          <div className="space-y-3 mt-4">
            <h3 className="text-[10px] uppercase text-slate-500 tracking-wider font-bold">Context Queue</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {attachments.map(att => (
                <div key={att.id} className={cn(
                  "p-3 rounded-lg border flex gap-3 relative group transition",
                  att.status === 'accepted' ? "border-emerald-900/50 bg-emerald-950/20" : "border-rose-900/50 bg-rose-950/20"
                )}>
                  <div className="w-10 h-10 shrink-0 rounded bg-black/40 flex justify-center items-center overflow-hidden border border-white/5">
                    {att.status === 'blocked' ? (
                      <Lock className="w-5 h-5 text-rose-500" />
                    ) : att.previewUrl ? (
                      att.type.startsWith('video/') 
                        ? <video src={att.previewUrl} className="object-cover w-full h-full opacity-70" />
                        : <img src={att.previewUrl} className="object-cover w-full h-full" alt="preview" />
                    ) : (
                      <FileText className="w-5 h-5 text-emerald-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-xs font-bold truncate", att.status === 'accepted' ? 'text-emerald-400' : 'text-rose-400')}>
                      {att.name}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">
                      {att.status === 'blocked' ? att.reason : `${(att.size / 1024).toFixed(1)} KB`}
                    </div>
                  </div>
                  <button 
                    onClick={() => removeAttachment(att.id)}
                    className="absolute top-2 right-2 text-slate-500 hover:text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            
            <button className="w-full mt-4 py-2 bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20 border border-[#fbbf24]/30 text-[#fbbf24] font-mono text-xs font-bold rounded uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
              <File className="w-4 h-4" /> Synthesize Context Capsule
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
