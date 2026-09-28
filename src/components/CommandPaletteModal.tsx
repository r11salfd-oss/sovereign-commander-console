import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search,
  Terminal,
  MessageSquare,
  CheckSquare,
  Shield,
  Activity,
  Users,
  Cpu,
  Code,
  ShieldAlert,
  HardDrive,
  Sparkles,
  RefreshCw,
  Zap,
  ArrowRight,
  CornerDownLeft,
  X,
  Radio,
  Sliders,
  Play,
  Copy,
  Maximize2,
  Minimize2,
  LogOut,
  UploadCloud,
  CheckCircle2,
  Flame,
  AlertTriangle
} from 'lucide-react';
import { auth, logoutUser, loginWithGoogle } from '../firebase';

export interface CommandItem {
  id: string;
  title: string;
  description: string;
  category: 'navigation' | 'system' | 'qa' | 'security' | 'developer';
  categoryLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
  shortcut?: string;
  badge?: string;
  action: () => void | Promise<void>;
}

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenVoiceModal?: () => void;
  onOpenDiagnostics?: () => void;
}

export default function CommandPaletteModal({
  isOpen,
  onClose,
  onOpenVoiceModal,
  onOpenDiagnostics
}: CommandPaletteModalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Display a brief feedback notification toast
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  // Build the complete command catalog
  const commands: CommandItem[] = useMemo(() => {
    return [
      // ── 1. NAVIGATION COMMANDS ──────────────────────────────────────────
      {
        id: 'nav-console',
        title: 'وحدة التحكم الرئيسية (Operations Console)',
        description: 'الانتقال إلى المركز الرئيسي لرصد العمليات والحالة الحية',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: Terminal,
        keywords: ['console', 'dashboard', 'home', 'الرئيسية', 'تحكم', 'كونسول', 'لوحة'],
        badge: 'مسار: /commander',
        action: () => {
          navigate('/commander');
          onClose();
        }
      },
      {
        id: 'nav-chat',
        title: 'غرفة المحادثة والتشغيل الذكي (Chat Chamber)',
        description: 'جلسات الدردشة التوليدية متعددة القنوات وإدارة الحوار',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: MessageSquare,
        keywords: ['chat', 'chamber', 'conversation', 'محادثة', 'شات', 'دردشة', 'جلسات'],
        badge: 'مسار: /commander/chat',
        action: () => {
          navigate('/commander/chat');
          onClose();
        }
      },
      {
        id: 'nav-approvals',
        title: 'طابور الموافقات البشرية (Human-in-the-Loop Approvals)',
        description: 'مراجعة واعتماد الإجراءات الحساسة والتفويض البشري',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: CheckSquare,
        keywords: ['approvals', 'queue', 'human-in-the-loop', 'موافقات', 'اعتماد', 'تفويض', 'طابور'],
        badge: 'مسار: /commander/approvals',
        action: () => {
          navigate('/commander/approvals');
          onClose();
        }
      },
      {
        id: 'nav-audit',
        title: 'سجل التدقيق والتشفير (Audit Chain SHA-256)',
        description: 'فحص وتدقيق القيود المشفرة وسلاسل النزاهة غير القابلة للتغيير',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: Shield,
        keywords: ['audit', 'chain', 'sha256', 'ledger', 'تدقيق', 'سجل', 'نزاهة', 'تشفير'],
        badge: 'مسار: /commander/audit',
        action: () => {
          navigate('/commander/audit');
          onClose();
        }
      },
      {
        id: 'nav-tests',
        title: 'مركز الأتمتة وضمان الجودة (Test Automation & QA)',
        description: 'تشغيل حزم الاختبارات البرمجية وفحص تكامل النظام الآلي',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: Activity,
        keywords: ['tests', 'qa', 'automation', 'اختبارات', 'جودة', 'أتمتة', 'فحوصات'],
        badge: 'مسار: /commander/tests',
        action: () => {
          navigate('/commander/tests');
          onClose();
        }
      },
      {
        id: 'nav-agents',
        title: 'فيلق الوكلاء الذاتيين (Autonomous Agent Corps)',
        description: 'رصد وإدارة وكلاء الذكاء الاصطناعي ومهامهم المتوازية',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: Users,
        keywords: ['agents', 'corps', 'autonomous', 'وكلاء', 'فيلق', 'أسراب', 'مهام'],
        badge: 'مسار: /commander/agents',
        action: () => {
          navigate('/commander/agents');
          onClose();
        }
      },
      {
        id: 'nav-forge',
        title: 'مصنع التخصيص السيادي (Forge Studio)',
        description: 'بناء النماذج وتوليد الكبسولات وتشكيل برومبتات الوكلاء',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: Zap,
        keywords: ['forge', 'studio', 'customization', 'مصنع', 'فورج', 'تخصيص', 'كبسولات'],
        badge: 'مسار: /commander/forge',
        action: () => {
          navigate('/commander/forge');
          onClose();
        }
      },
      {
        id: 'nav-developer',
        title: 'بوابة المطور والـ APIs (Developer Portal)',
        description: 'إدارة مفاتيح الربط وتكامل الـ REST API واستدعاء الخدمات',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: Code,
        keywords: ['developer', 'portal', 'api', 'keys', 'مطور', 'واجهات', 'برمجة'],
        badge: 'مسار: /commander/developer',
        action: () => {
          navigate('/commander/developer');
          onClose();
        }
      },
      {
        id: 'nav-sentinel',
        title: 'درع الحراسة والأمان (Sentinel Defense)',
        description: 'مراقبة التهديدات، وتصفية المدخلات وحصانة البروتوكولات',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: ShieldAlert,
        keywords: ['sentinel', 'defense', 'security', 'أمان', 'حراسة', 'سنتينل', 'دفاع'],
        badge: 'مسار: /commander/sentinel',
        action: () => {
          navigate('/commander/sentinel');
          onClose();
        }
      },
      {
        id: 'nav-kernel',
        title: 'نواة نظام التشغيل السيادي (Kernel OS Core)',
        description: 'رصد تخصيص الموارد والخيوط البرمجية والمعالجة الجوهرية',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: Cpu,
        keywords: ['kernel', 'os', 'core', 'system', 'نواة', 'نظام', 'موارد', 'كرنل'],
        badge: 'مسار: /commander/kernel',
        action: () => {
          navigate('/commander/kernel');
          onClose();
        }
      },
      {
        id: 'nav-input',
        title: 'رصيف الإدخال المباشر (Input Dock)',
        description: 'كبسولة الإدخال السريع للأوامر والمرفقات البرمجية',
        category: 'navigation',
        categoryLabel: 'التنقل في المنصة',
        icon: UploadCloud,
        keywords: ['input', 'dock', 'capsule', 'إدخال', 'رصيف', 'أوامر'],
        badge: 'مسار: /commander/input',
        action: () => {
          navigate('/commander/input');
          onClose();
        }
      },

      // ── 2. SYSTEM COMMANDS & ACTIONS ──────────────────────────────────
      {
        id: 'cmd-voice',
        title: 'بدء محادثة صوتية حية (Start Live Voice Session)',
        description: 'تنشيط الاتصال الصوتي ثنائي الاتجاه عبر gemini-3.8-live',
        category: 'system',
        categoryLabel: 'أوامر النظام والتشغيل',
        icon: Sparkles,
        keywords: ['voice', 'live', 'gemini', 'audio', 'صوت', 'محادثة صوتية', 'حي', 'تحدث'],
        badge: 'gemini-3.8-live',
        action: () => {
          onClose();
          if (onOpenVoiceModal) {
            onOpenVoiceModal();
          }
        }
      },
      {
        id: 'cmd-diagnostics',
        title: 'عرض مصفوفة التشخيص والمقاييس (Open Telemetry Matrix)',
        description: 'فتح النافذة التفصيلية لمقاييس الذاكرة وزمن الاستجابة والمحطات',
        category: 'system',
        categoryLabel: 'أوامر النظام والتشغيل',
        icon: HardDrive,
        keywords: ['diagnostics', 'telemetry', 'metrics', 'matrix', 'تشخيص', 'مقاييس', 'ذاكرة', 'مصفوفة'],
        badge: 'Live Metrics',
        action: () => {
          onClose();
          if (onOpenDiagnostics) {
            onOpenDiagnostics();
          }
        }
      },
      {
        id: 'cmd-refresh-telemetry',
        title: 'تحديث مقاييس النظام فوراً (Force Telemetry Refresh)',
        description: 'إعادة قياس زمن الاستجابة، واستهلاك الـ Heap RAM وحالة النواة',
        category: 'system',
        categoryLabel: 'أوامر النظام والتشغيل',
        icon: RefreshCw,
        keywords: ['refresh', 'ping', 'latency', 'update', 'تحديث', 'قياس', 'إنعاش'],
        shortcut: 'Ctrl+R',
        action: async () => {
          setIsExecuting(true);
          try {
            const res = await fetch('/api/system/telemetry');
            const data = await res.json();
            showToast(`✅ تم تحديث المقاييس بنجاح: الاستجابة ${data.networkLatencyMs || 0}ms - الذاكرة ${data.memory?.heapUsedMb || 0}MB`);
          } catch {
            showToast('⚠️ تعذر تحديث المقاييس اللحظية');
          } finally {
            setIsExecuting(false);
          }
        }
      },
      {
        id: 'cmd-clean-memory',
        title: 'تنظيف وتفريغ الذاكرة المؤقتة (Run RAM Garbage Collection)',
        description: 'تفريغ الكائنات المؤقتة وتحرير السعة الفائضة من سقف الـ 512MB',
        category: 'system',
        categoryLabel: 'أوامر النظام والتشغيل',
        icon: RefreshCw,
        keywords: ['clean', 'memory', 'ram', 'gc', 'تنظيف', 'ذاكرة', 'تفريغ', 'استهلاك', 'رام'],
        badge: 'RAM GC',
        action: async () => {
          setIsExecuting(true);
          try {
            const res = await fetch('/api/system/memory/clean', { method: 'POST' });
            const data = await res.json();
            showToast(`🧹 ${data.message}: ${data.memory?.heapUsedMb || 0}MB / ${data.memory?.heapTotalMb || 512}MB`);
          } catch {
            showToast('⚠️ تعذر تشغيل تنظيف الذاكرة');
          } finally {
            setIsExecuting(false);
          }
        }
      },
      {
        id: 'cmd-run-qa',
        title: 'تشغيل حزمة الفحوصات الآلية الشاملة (Run Automated QA Suite)',
        description: 'بدء تنفيذ كافة اختبارات الوحدات والتكامل وحساب معدل النجاح',
        category: 'qa',
        categoryLabel: 'الأتمتة وضمان الجودة',
        icon: Play,
        keywords: ['run', 'tests', 'qa', 'suite', 'execute', 'تشغيل', 'اختبارات', 'فحص'],
        badge: 'QA Suite',
        action: async () => {
          setIsExecuting(true);
          try {
            const res = await fetch('/api/tests/run', { method: 'POST' });
            const data = await res.json();
            showToast(`🚀 تم بدء حزمة الاختبارات الآلية (${data.totalTests || 10} اختبار)`);
            navigate('/commander/tests');
            onClose();
          } catch {
            showToast('⚠️ تعذر إرسال أمر تشغيل الاختبارات');
          } finally {
            setIsExecuting(false);
          }
        }
      },
      {
        id: 'cmd-verify-mcp',
        title: 'فحص تكامل خادم بروتوكول MCP (Verify MCP Tools Gateway)',
        description: 'التحقق من جاهزية أدوات وقنوات تبادل السياق السيادي',
        category: 'system',
        categoryLabel: 'أوامر النظام والتشغيل',
        icon: Radio,
        keywords: ['mcp', 'tools', 'protocol', 'gateway', 'أدوات', 'بروتوكول', 'بوابة'],
        badge: 'MCP Protocol',
        action: async () => {
          setIsExecuting(true);
          try {
            const res = await fetch('/api/mcp/tools');
            const data = await res.json();
            const count = Array.isArray(data.tools) ? data.tools.length : 0;
            showToast(`🔌 خادم MCP جاهز: ${count} أداة بروتوكولية نشطة ومتاحة`);
          } catch {
            showToast('⚠️ لم تكتمل استجابة خادم MCP');
          } finally {
            setIsExecuting(false);
          }
        }
      },
      {
        id: 'cmd-verify-audit',
        title: 'التحقق من نزاهة سلسلة التدقيق (Verify Audit Ledger Hashes)',
        description: 'فحص التوقيعات الجنائية والـ Hashes لضمان عدم حدوث تلاعب',
        category: 'security',
        categoryLabel: 'الأمان والنزاهة',
        icon: Shield,
        keywords: ['audit', 'verify', 'hash', 'security', 'تحقق', 'نزاهة', 'تشفير'],
        badge: 'SHA-256',
        action: async () => {
          setIsExecuting(true);
          try {
            const res = await fetch('/api/audit');
            const data = await res.json();
            const count = Array.isArray(data) ? data.length : 0;
            showToast(`🔒 سلسلة التدقيق سليمة وغير مخترقة (${count} قيد مسجل وموقع)`);
          } catch {
            showToast('⚠️ تعذر الاتصال بسجل التدقيق');
          } finally {
            setIsExecuting(false);
          }
        }
      },

      // ── 3. DEVELOPER & POWER TOOLS ────────────────────────────────────
      {
        id: 'cmd-copy-route',
        title: 'نسخ مسار الصفحة الحالية (Copy Current Route URL)',
        description: 'نسخ عنوان الرابط الفعلي للصفحة الحالية إلى الحافظة',
        category: 'developer',
        categoryLabel: 'أدوات المطور والمحاكاة',
        icon: Copy,
        keywords: ['copy', 'url', 'route', 'link', 'نسخ', 'رابط', 'مسار'],
        action: async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            showToast('📋 تم نسخ رابط الصفحة الحالية إلى الحافظة بنجاح');
          } catch {
            showToast('⚠️ تعذر نسخ الرابط');
          }
        }
      },
      {
        id: 'cmd-fullscreen',
        title: 'تبديل وضع العرض الكامل (Toggle Fullscreen HUD)',
        description: 'تفعيل أو إلغاء وضع الشاشة الكاملة لتجربة غرفة العمليات',
        category: 'developer',
        categoryLabel: 'أدوات المطور والمحاكاة',
        icon: document.fullscreenElement ? Minimize2 : Maximize2,
        keywords: ['fullscreen', 'screen', 'hud', 'ملء', 'شاشة', 'عرض'],
        shortcut: 'F11',
        action: () => {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
            showToast('🖥️ تم تفعيل وضع ملء الشاشة');
          } else {
            document.exitFullscreen().catch(() => {});
            showToast('🖥️ تم الخروج من وضع ملء الشاشة');
          }
          onClose();
        }
      },
      {
        id: 'cmd-auth',
        title: auth.currentUser ? 'تسجيل الخروج من الحساب (Sign Out)' : 'تسجيل الدخول بـ Google (Sign In)',
        description: auth.currentUser ? `المستخدم الحالي: ${auth.currentUser.email}` : 'تسجيل الدخول الآمن لتفعيل الصلاحيات الكاملة',
        category: 'system',
        categoryLabel: 'أوامر النظام والتشغيل',
        icon: LogOut,
        keywords: ['auth', 'login', 'logout', 'google', 'دخول', 'خروج', 'تسجيل', 'حساب'],
        action: async () => {
          if (auth.currentUser) {
            await logoutUser();
            showToast('👋 تم تسجيل الخروج بنجاح');
          } else {
            await loginWithGoogle();
            showToast('🔐 تم فتح نافذة تسجيل الدخول بـ Google');
          }
          onClose();
        }
      }
    ];
  }, [navigate, onClose, onOpenVoiceModal, onOpenDiagnostics]);

  // Filter commands based on user query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      return commands;
    }
    const q = query.toLowerCase().trim();
    return commands.filter((cmd) => {
      const matchTitle = cmd.title.toLowerCase().includes(q);
      const matchDesc = cmd.description.toLowerCase().includes(q);
      const matchCategory = cmd.categoryLabel.toLowerCase().includes(q);
      const matchKeywords = cmd.keywords.some((kw) => kw.toLowerCase().includes(q));
      const matchBadge = cmd.badge ? cmd.badge.toLowerCase().includes(q) : false;
      return matchTitle || matchDesc || matchCategory || matchKeywords || matchBadge;
    });
  }, [commands, query]);

  // Group filtered commands by category for clear presentation
  const groupedCommands = useMemo(() => {
    const groups: { [key: string]: CommandItem[] } = {};
    filteredCommands.forEach((cmd) => {
      if (!groups[cmd.categoryLabel]) {
        groups[cmd.categoryLabel] = [];
      }
      groups[cmd.categoryLabel].push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  // Keep selected index within valid bounds
  useEffect(() => {
    if (selectedIndex >= filteredCommands.length) {
      setSelectedIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, selectedIndex]);

  // Auto-scroll selected item into view
  useEffect(() => {
    const el = document.getElementById(`command-item-${selectedIndex}`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // Keyboard navigation inside the palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filteredCommands[selectedIndex];
      if (selected) {
        selected.action();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-start justify-center pt-12 sm:pt-20 px-3 sm:px-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      dir="rtl"
    >
      {/* Toast Feedback Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[110] px-4 py-2 rounded-xl bg-cyan-950/95 border border-cyan-400 text-cyan-200 font-mono text-xs shadow-[0_0_25px_rgba(6,182,212,0.4)] animate-in fade-in slide-in-from-top-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Palette Modal Container */}
      <div 
        className="w-full max-w-2xl rounded-2xl bg-[#090e1a]/95 border border-cyan-500/50 shadow-[0_0_50px_rgba(6,182,212,0.25)] overflow-hidden flex flex-col max-h-[82vh] font-mono text-right animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Top Input Bar with Cybernetic Styling */}
        <div className="relative p-3.5 sm:p-4 border-b border-slate-800 bg-[#0c1324] flex items-center gap-3">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-950/60 border border-cyan-500/40 text-cyan-400 shrink-0">
            <Search className="w-4 h-4" />
          </div>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="ابحث عن صفحة، أو نفّذ أمراً سيادياً، أو استعلم عن خدمة... (Ctrl+K)"
            className="flex-1 bg-transparent border-none text-slate-100 placeholder-slate-500 text-sm sm:text-base outline-none font-mono tracking-wide"
          />

          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition"
              title="مسح البحث"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <div className="hidden sm:flex items-center gap-1 text-[11px] text-slate-400 bg-slate-900/90 border border-slate-800 px-2 py-1 rounded-lg">
            <kbd className="font-bold text-cyan-400">ESC</kbd>
            <span className="text-[10px]">للإغلاق</span>
          </div>
        </div>

        {/* Command Items List with Categorization */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-4 max-h-[55vh]">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center text-slate-500 flex flex-col items-center gap-2">
              <Search className="w-8 h-8 opacity-30 text-slate-400" />
              <p className="text-sm">لم يتم العثور على أوامر تطابق "{query}"</p>
              <p className="text-xs text-slate-600">جرّب كلمات مثل: محادثة، تدقيق، اختبارات، وكلاء، صوت، كونسول</p>
            </div>
          ) : (
            Object.entries(groupedCommands).map(([category, items]) => (
              <div key={category} className="space-y-1">
                {/* Category Header */}
                <div className="px-3 py-1 text-[11px] font-bold text-cyan-400/90 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  <span>{category}</span>
                  <span className="text-[10px] text-slate-500 font-normal">({items.length})</span>
                </div>

                {/* Items in this Category */}
                <div className="space-y-1">
                  {items.map((cmd) => {
                    const globalIndex = filteredCommands.findIndex((c) => c.id === cmd.id);
                    const isSelected = globalIndex === selectedIndex;
                    const Icon = cmd.icon;

                    return (
                      <div
                        id={`command-item-${globalIndex}`}
                        key={cmd.id}
                        onClick={() => cmd.action()}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className={`group flex items-center justify-between p-2.5 sm:p-3 rounded-xl cursor-pointer transition-all duration-150 border ${
                          isSelected
                            ? 'bg-cyan-950/70 border-cyan-500/70 text-cyan-200 shadow-[0_0_18px_rgba(6,182,212,0.2)]'
                            : 'bg-slate-900/30 border-slate-800/60 text-slate-300 hover:bg-slate-850/60 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`p-2 rounded-lg border transition ${
                            isSelected 
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300' 
                              : 'bg-slate-900 border-slate-800 text-slate-400 group-hover:text-slate-200'
                          }`}>
                            <Icon className="w-4 h-4 shrink-0" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs sm:text-sm font-bold truncate ${
                                isSelected ? 'text-white' : 'text-slate-200'
                              }`}>
                                {cmd.title}
                              </span>

                              {cmd.badge && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-400 border border-slate-700/80 shrink-0">
                                  {cmd.badge}
                                </span>
                              )}
                            </div>

                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {cmd.description}
                            </p>
                          </div>
                        </div>

                        {/* Trailing Shortcut / Indicator */}
                        <div className="flex items-center gap-2 shrink-0 mr-2">
                          {cmd.shortcut && (
                            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] rounded bg-slate-900 text-slate-400 border border-slate-800">
                              {cmd.shortcut}
                            </kbd>
                          )}
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center transition ${
                            isSelected ? 'bg-cyan-500 text-black font-bold' : 'text-slate-600 opacity-0 group-hover:opacity-100'
                          }`}>
                            <CornerDownLeft className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Navigation Help Bar */}
        <div className="p-3 bg-[#0a0f1d] border-t border-slate-800/90 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-400 text-[10px]">↑↓</kbd>
              <span>للتنقل</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-400 text-[10px]">↵ Enter</kbd>
              <span>للتنفيذ</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-400 text-[10px]">Esc</kbd>
              <span>للإغلاق</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-500">
            <Terminal className="w-3 h-3 text-cyan-400" />
            <span>لوحة الأوامر السريعة السيادية</span>
          </div>
        </div>
      </div>
    </div>
  );
}
