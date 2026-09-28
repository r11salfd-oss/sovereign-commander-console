import React, { useState } from 'react';
import { 
  Plus, 
  MessageSquare, 
  Trash2, 
  Search, 
  Sparkles, 
  Layers, 
  Bot, 
  Clock, 
  Database,
  Edit2,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertOctagon
} from 'lucide-react';
import { useChat } from '../../context/ChatContext';
import { ChatSession } from '../../types';

interface ChatSessionsSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export default function ChatSessionsSidebar({ isOpen, onToggle }: ChatSessionsSidebarProps) {
  const { 
    sessions, 
    currentSessionId, 
    switchSession, 
    createNewSession, 
    deleteSession, 
    deleteAllSessions,
    renameSession,
    loadingSessions 
  } = useChat();

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);

  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(search.toLowerCase()) || 
    (s.lastMessage && s.lastMessage.toLowerCase().includes(search.toLowerCase()))
  );

  const handleStartNewSession = async () => {
    try {
      setCreating(true);
      await createNewSession();
    } finally {
      setCreating(false);
    }
  };

  const handleStartRename = (s: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(s.id);
    setEditTitle(s.title);
  };

  const handleSaveRename = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      await renameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleRequestDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
  };

  const handleConfirmDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(id);
    setDeletingId(null);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(null);
  };

  const handlePurgeAll = async () => {
    await deleteAllSessions();
    setConfirmPurgeAll(false);
  };

  const formatSessionTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'الآن';
      if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `منذ ${diffHours} ساعة`;
      return date.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          onClick={onToggle}
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-30 lg:hidden"
        />
      )}

      <aside className={`
        fixed lg:static top-0 right-0 h-full lg:h-auto z-40
        transition-all duration-300 ease-in-out flex flex-col
        border-l border-slate-800 bg-[#060a14]
        ${isOpen ? 'w-80 translate-x-0' : 'w-0 translate-x-full lg:translate-x-0 lg:w-0 overflow-hidden'}
      `}>
        {isOpen && (
          <div className="flex flex-col h-full w-80 p-3.5 space-y-3 font-sans">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-cyan-950/60 border border-cyan-800/60 text-cyan-400">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white font-mono">سجلات المحادثات والذاكرة</h3>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                    <ShieldCheck className="w-3 h-3" />
                    <span>متزامنة سحابياً (Cloud Memory)</span>
                  </div>
                </div>
              </div>

              <button
                onClick={onToggle}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="إغلاق السجلات"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Primary "New Chat Session" Button */}
            <button
              onClick={handleStartNewSession}
              disabled={creating}
              className="w-full py-2.5 px-3 rounded-lg bg-gradient-to-r from-cyan-600 via-cyan-500 to-emerald-500 hover:from-cyan-500 hover:to-emerald-400 text-black font-bold text-xs font-mono shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>{creating ? 'جاري إنشاء الجلسة...' : 'بدء جلسة محادثة جديدة'}</span>
            </button>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="البحث في الجلسات السابقة..."
                className="w-full pl-3 pr-8 py-1.5 bg-slate-950/90 border border-slate-800 rounded-md text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono transition"
              />
            </div>

            {/* Sessions List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 scrollbar-thin scrollbar-thumb-slate-800">
              {loadingSessions ? (
                <div className="p-4 text-center text-xs font-mono text-slate-500 animate-pulse">
                  جاري تحميل الجلسات السيادية...
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="p-4 text-center text-xs font-mono text-slate-500 space-y-1">
                  <div>لا توجد جلسات تطابق البحث.</div>
                  <button 
                    onClick={handleStartNewSession} 
                    className="text-cyan-400 hover:underline text-[11px] cursor-pointer"
                  >
                    إنشاء جلسة جديدة الآن
                  </button>
                </div>
              ) : (
                filteredSessions.map(session => {
                  const isActive = session.id === currentSessionId;
                  const isEditing = editingId === session.id;
                  const isDeleting = deletingId === session.id;

                  return (
                    <div
                      key={session.id}
                      onClick={() => switchSession(session.id)}
                      className={`
                        group relative p-2.5 rounded-lg border transition cursor-pointer text-right flex flex-col gap-1
                        ${isActive 
                          ? 'bg-cyan-950/40 border-cyan-500/70 shadow-[0_0_12px_rgba(6,182,212,0.15)] text-white' 
                          : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/60 hover:border-slate-700 text-slate-300'
                        }
                      `}
                    >
                      {/* Top Bar of item */}
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
                          
                          {isEditing ? (
                            <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                              <input
                                type="text"
                                value={editTitle}
                                onChange={e => setEditTitle(e.target.value)}
                                className="w-full bg-slate-950 border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                                autoFocus
                              />
                              <button 
                                onClick={(e) => handleSaveRename(session.id, e)} 
                                className="p-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={handleCancelRename} 
                                className="p-1 text-slate-400 hover:text-white cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-bold font-mono truncate text-right">
                              {session.title}
                            </span>
                          )}
                        </div>

                        {!isEditing && !isDeleting && (
                          <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition">
                            <button
                              onClick={(e) => handleStartRename(session, e)}
                              className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition cursor-pointer"
                              title="تعديل العنوان"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => handleRequestDelete(session.id, e)}
                              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition cursor-pointer"
                              title="حذف الجلسة"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        {/* Inline Delete Confirmation Badge */}
                        {isDeleting && (
                          <div className="flex items-center gap-1.5 shrink-0 bg-rose-950/90 border border-rose-600/80 px-2 py-0.5 rounded text-[10px] font-mono text-rose-200" onClick={e => e.stopPropagation()}>
                            <span className="text-rose-300 font-bold">تأكيد الحذف؟</span>
                            <button
                              onClick={(e) => handleConfirmDelete(session.id, e)}
                              className="px-1.5 py-0.5 bg-rose-600 text-white rounded font-bold hover:bg-rose-500 cursor-pointer"
                            >
                              نعم
                            </button>
                            <button
                              onClick={handleCancelDelete}
                              className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 cursor-pointer"
                            >
                              إلغاء
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Snippet & Metadata */}
                      <p className="text-[11px] text-slate-400 truncate leading-snug">
                        {session.lastMessage || 'لا توجد رسائل بعد'}
                      </p>

                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-800/40">
                        <span className={`px-1.5 py-0.2 rounded text-[9px] ${
                          session.chatMode === 'council' ? 'bg-purple-950/80 text-purple-300 border border-purple-800/50' : 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/50'
                        }`}>
                          {session.chatMode === 'council' ? 'مجلس سيادي' : 'وكيل فردي'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {formatSessionTime(session.updatedAt)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Memory Status & Purge All Footer */}
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400 space-y-2">
              <div className="flex items-center justify-between text-slate-300">
                <span>الجلسات المحفوظة:</span>
                <span className="font-bold text-cyan-400">{sessions.length} جلسة</span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span>حفظ السياق عند التنقل:</span>
                <span className="font-bold text-emerald-400">مفعل (Persisted)</span>
              </div>

              {/* Purge All Sessions Button */}
              <div className="pt-1.5 border-t border-slate-800/80">
                {confirmPurgeAll ? (
                  <div className="p-2 bg-rose-950/80 border border-rose-700 rounded-md space-y-1.5 text-center">
                    <div className="text-[11px] font-bold text-rose-300 flex items-center justify-center gap-1">
                      <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                      <span>تأكيد تفريغ وحذف كافة الجلسات؟</span>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handlePurgeAll}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold text-[10px] cursor-pointer"
                      >
                        نعم، احذف الكل
                      </button>
                      <button
                        onClick={() => setConfirmPurgeAll(false)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] cursor-pointer"
                      >
                        تراجع
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmPurgeAll(true)}
                    className="w-full py-1 px-2 rounded bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-800/60 text-slate-400 hover:text-rose-300 transition flex items-center justify-center gap-1.5 cursor-pointer text-[10px]"
                    title="تفريغ كافة الجلسات وحذف السجلات القديمة نهائياً"
                  >
                    <Trash2 className="w-3 h-3 text-rose-400" />
                    <span>تفريغ ومسح كافة الجلسات</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
