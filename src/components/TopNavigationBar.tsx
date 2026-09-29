import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Terminal, 
  MessageSquare, 
  UploadCloud, 
  Shield, 
  CheckSquare, 
  Users, 
  Zap, 
  Code, 
  ShieldAlert, 
  LogOut, 
  Cpu, 
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Activity,
  Sparkles,
  AlertTriangle,
  Search
} from 'lucide-react';
import { auth, logoutUser, loginWithGoogle } from '../firebase';
import { User } from 'firebase/auth';
import TelemetryDiagnosticsModal from './TelemetryDiagnosticsModal';
import SystemMonitor, { LatencyThresholdAlert } from './SystemMonitor';
import LiveVoiceCommanderModal from './LiveVoiceCommanderModal';
import CommandPaletteModal from './CommandPaletteModal';

interface NavItem {
  to: string;
  label: string;
  arLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  dividerAfter?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/commander', label: 'Console', arLabel: 'قمرة القيادة', icon: Terminal, dividerAfter: true },
  { to: '/commander/chat', label: 'Chat Chamber', arLabel: 'غرفة المحادثة', icon: MessageSquare },
  { to: '/commander/approvals', label: 'Approvals', arLabel: 'الموافقات HITL', icon: CheckSquare },
  { to: '/commander/audit', label: 'Audit Ledger', arLabel: 'سجل التدقيق', icon: ShieldAlert },
  { to: '/commander/tests', label: 'Automated QA', arLabel: 'حزمة الاختبارات', icon: CheckCheck },
  { to: '/commander/agents', label: 'Agent Corps', arLabel: 'فيلق الوكلاء', icon: Users, dividerAfter: true },
  { to: '/commander/forge', label: 'Forge', arLabel: 'مصنع الأكواد', icon: Zap },
  { to: '/commander/developer', label: 'Developer CLI', arLabel: 'المطور التنفيذي', icon: Code },
  { to: '/commander/sentinel', label: 'Sentinel SOC', arLabel: 'مركز العمليات الأمنية', icon: Shield, dividerAfter: true },
  { to: '/commander/kernel', label: 'Kernel OS', arLabel: 'نواة النظام', icon: Cpu },
  { to: '/commander/input', label: 'Input Dock', arLabel: 'رصيف الأوامر', icon: UploadCloud }
];

export default function TopNavigationBar() {
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState<User | null>(auth.currentUser);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [latencyAlert, setLatencyAlert] = useState<LatencyThresholdAlert | null>(null);
  const navScrollRef = useRef<HTMLDivElement>(null);

  // Global Ctrl+K / Cmd+K listener for Command Palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Scroll state
  const [canScrollLeft, setCanScrollLeft] = useState<boolean>(false);
  const [canScrollRight, setCanScrollRight] = useState<boolean>(false);

  // Mouse Drag state
  const isDraggingRef = useRef<boolean>(false);
  const startXRef = useRef<number>(0);
  const startScrollLeftRef = useRef<number>(0);
  const hasDraggedRef = useRef<boolean>(false);

  useEffect(() => {
    const checkLocalUser = () => {
      try {
        const saved = localStorage.getItem('sovereign_local_commander') || sessionStorage.getItem('sovereign_local_commander');
        if (saved) return JSON.parse(saved);
      } catch (e) {}
      return null;
    };
    const localU = checkLocalUser();
    if (localU) setCurrentUser(localU);

    return auth.onAuthStateChanged((u) => {
      if (u) {
        setCurrentUser(u);
      } else {
        setCurrentUser(checkLocalUser());
      }
    });
  }, []);

  // Check scroll boundary
  const updateScrollIndicators = useCallback(() => {
    const el = navScrollRef.current;
    if (!el) return;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    const scrollPos = Math.abs(scrollLeft);
    setCanScrollLeft(scrollPos > 10 || scrollLeft > 10);
    setCanScrollRight(maxScroll - scrollPos > 10 || (scrollWidth > clientWidth && scrollPos < maxScroll - 10));
  }, []);

  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;

    updateScrollIndicators();
    window.addEventListener('resize', updateScrollIndicators);
    return () => window.removeEventListener('resize', updateScrollIndicators);
  }, [updateScrollIndicators]);

  // Smooth scroll left / right on button click
  const handleScroll = (direction: 'left' | 'right') => {
    const el = navScrollRef.current;
    if (!el) return;
    const distance = 300;
    const delta = direction === 'left' ? -distance : distance;
    el.scrollBy({ left: delta, behavior: 'smooth' });
    setTimeout(updateScrollIndicators, 300);
  };

  // Mouse wheel horizontal translation
  const handleWheel = (e: React.WheelEvent) => {
    const el = navScrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY * 0.9;
      updateScrollIndicators();
    }
  };

  // Mouse drag-to-scroll handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = navScrollRef.current;
    if (!el) return;
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    startXRef.current = e.pageX - el.offsetLeft;
    startScrollLeftRef.current = el.scrollLeft;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const el = navScrollRef.current;
    if (!el) return;
    const currentX = e.pageX - el.offsetLeft;
    const diff = currentX - startXRef.current;
    if (Math.abs(diff) > 25) {
      hasDraggedRef.current = true;
      el.scrollLeft = startScrollLeftRef.current - diff * 1.2;
      updateScrollIndicators();
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    setTimeout(() => {
      hasDraggedRef.current = false;
    }, 40);
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
    hasDraggedRef.current = false;
  };

  // Auto-scroll active item into visible center on route change
  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;

    const activeEl = el.querySelector('[data-active="true"]') as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    setTimeout(updateScrollIndicators, 200);
  }, [location.pathname, updateScrollIndicators]);

  const isAlertTriggered = latencyAlert?.isTriggered;
  const isCritical = latencyAlert?.level === 'critical';

  return (
    <>
      <header className={`sticky top-0 z-50 w-full select-none shadow-[0_6px_25px_rgba(0,0,0,0.65)] bg-[#070b13] border-b transition-all duration-300 relative ${
        isAlertTriggered 
          ? isCritical 
            ? 'border-b-2 border-b-rose-500 shadow-[0_4px_30px_rgba(244,63,94,0.45)] ring-1 ring-rose-500/50' 
            : 'border-b-2 border-b-amber-500 shadow-[0_4px_22px_rgba(245,158,11,0.35)] ring-1 ring-amber-500/40'
          : 'border-slate-800/90'
      }`}>
        
        {/* Animated Top Perimeter Warning Pulse Beam when Latency Exceeds Safety Parameters */}
        {isAlertTriggered && (
          <div 
            className={`absolute top-0 left-0 right-0 h-1 z-50 pointer-events-none animate-pulse ${
              isCritical 
                ? 'bg-gradient-to-r from-rose-600 via-amber-400 to-rose-600 shadow-[0_0_15px_#f43f5e]' 
                : 'bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-500 shadow-[0_0_12px_#f59e0b]'
            }`} 
          />
        )}

        {/* ── TIER 1: System Status, Tools, Search, & User Identity ── */}
        <div className="px-3 sm:px-4 py-1.5 flex items-center justify-between gap-3 border-b border-slate-800/80 bg-[#090e18] text-xs font-mono">
          
          {/* Brand Identity / Logo */}
          <Link to="/commander" className="flex items-center gap-2 group cursor-pointer shrink-0">
            <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 group-hover:border-cyan-400 group-hover:shadow-[0_0_12px_rgba(34,211,238,0.35)] transition">
              <Terminal className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <div className="text-xs font-bold font-sans text-white tracking-wide flex items-center gap-1.5">
                <span>Sovereign Commander</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-mono">v3.8</span>
              </div>
              <span className="text-[10px] text-cyan-400/80 font-mono hidden sm:inline">مركز التحكم والقيادة السيادي</span>
            </div>
          </Link>

          {/* Right Action Tools: Search, Telemetry, Voice, Account */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            
            {/* Command Palette Trigger Button (Ctrl+K) */}
            <button
              type="button"
              onClick={() => setIsCommandPaletteOpen(true)}
              title="فتح لوحة الأوامر السريعة والبحث (Ctrl+K)"
              className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/60 hover:border-cyan-400 text-cyan-300 transition cursor-pointer active:scale-95 shadow-[0_0_12px_rgba(6,182,212,0.2)] text-[10px] sm:text-xs font-bold"
            >
              <Search className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden md:inline">أمر أو بحث</span>
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono rounded bg-slate-900 border border-cyan-700/60 text-cyan-300">
                Ctrl+K
              </kbd>
            </button>

            {/* Real-time State-driven System Health Monitor with Threshold Alerting */}
            <SystemMonitor 
              onAlertChange={setLatencyAlert}
              onOpenDiagnostics={() => setIsDiagnosticsOpen(true)} 
            />

            {/* Visual Alert Pulse Pill (Visible in top bar when threshold exceeded) */}
            {isAlertTriggered && (
              <div 
                className={`hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-bold animate-pulse ${
                  isCritical 
                    ? 'bg-rose-950/80 border-rose-500 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.6)]' 
                    : 'bg-amber-950/80 border-amber-500 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                }`}
                title={latencyAlert.message}
              >
                <AlertTriangle className="w-3 h-3 text-rose-400 animate-bounce" />
                <span>{latencyAlert.currentLatency}ms</span>
              </div>
            )}

            {/* Live Voice Conversation Trigger (gemini-3.8-live) */}
            <button
              type="button"
              onClick={() => setIsVoiceModalOpen(true)}
              title="محادثة صوتية حية فورية باستخدام gemini-3.8-live (Live API)"
              className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border border-purple-500/50 bg-purple-950/40 hover:bg-purple-900/60 hover:border-purple-400 text-purple-200 transition cursor-pointer active:scale-95 shadow-[0_0_12px_rgba(168,85,247,0.25)] text-[10px] sm:text-xs font-bold"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
              </span>
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">صوت حي</span>
            </button>

            {/* User Account or Login Button */}
            {currentUser ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <div 
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-950/40 border border-cyan-500/40 text-cyan-300 text-[10px] sm:text-[11px]"
                  title={`المستخدم المسجل: ${currentUser.email || ''}`}
                >
                  <span className="truncate max-w-[90px] sm:max-w-[150px]">
                    {currentUser.email}
                  </span>
                </div>
                <button 
                  onClick={() => logoutUser()} 
                  title="تسجيل الخروج (Sign Out)"
                  className="flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 hover:text-white hover:bg-rose-900/70 hover:border-rose-600 transition text-[10px] sm:text-[11px] font-bold cursor-pointer shadow active:scale-95"
                >
                  <LogOut className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="hidden md:inline">تسجيل الخروج</span>
                </button>
              </div>
            ) : (
              <button 
                onClick={async () => {
                  try {
                    await loginWithGoogle();
                  } catch (e: any) {
                    console.error('Login error:', e);
                  }
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition text-[10px] sm:text-xs cursor-pointer shadow active:scale-95"
              >
                <span>تسجيل الدخول</span>
              </button>
            )}
          </div>
        </div>

        {/* ── TIER 2: Spacious Full-Width Navigation Bar ── */}
        <div className="relative w-full bg-[#080d16] px-2 py-1.5 flex items-center shadow-inner">
          
          {/* Left Scroll Arrow Button */}
          <button
            onClick={() => handleScroll('left')}
            aria-label="تمرير لليسار"
            title="تمرير القائمة لليسار"
            className={`shrink-0 z-20 w-8 h-8 rounded-lg bg-[#0e1728] border border-cyan-500/40 text-cyan-300 hover:text-white hover:bg-cyan-950 hover:border-cyan-400 flex items-center justify-center transition shadow-md cursor-pointer ml-1 active:scale-90 ${
              !canScrollLeft ? 'opacity-50 hover:border-cyan-500/30' : 'opacity-100'
            }`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Full-Width Scrollable Container with Smooth Touch, Drag, & Wheel Support */}
          <div 
            ref={navScrollRef}
            onWheel={handleWheel}
            onScroll={updateScrollIndicators}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            className="flex-1 min-w-0 overflow-x-auto scrollbar-none flex items-center gap-2 py-0.5 px-2 cursor-grab active:cursor-grabbing scroll-smooth"
            style={{ 
              scrollbarWidth: 'none', 
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch' 
            }}
          >
            {NAV_ITEMS.map((item) => {
              const isActive = location.pathname === item.to || (item.to === '/commander' && location.pathname === '/');
              const Icon = item.icon;

              return (
                <React.Fragment key={item.to}>
                  <Link
                    to={item.to}
                    data-active={isActive ? "true" : "false"}
                    onClick={(e) => {
                      if (hasDraggedRef.current) {
                        e.preventDefault();
                        hasDraggedRef.current = false;
                      }
                    }}
                    className={`flex flex-shrink-0 items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all duration-200 font-mono text-xs border ${
                      isActive 
                        ? 'bg-cyan-950/80 text-cyan-200 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)] font-bold ring-1 ring-cyan-400/50' 
                        : 'bg-slate-900/60 text-slate-300 border-slate-800 hover:bg-slate-800/90 hover:text-cyan-300 hover:border-cyan-500/40'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="font-bold">{item.label}</span>
                      <span className={`text-[10px] ${isActive ? 'text-cyan-300/80 font-normal' : 'text-slate-500 font-normal'}`}>
                        ({item.arLabel})
                      </span>
                    </div>
                  </Link>

                  {item.dividerAfter && (
                    <div className="w-px h-5 bg-slate-800/90 mx-1 shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Right Scroll Arrow Button */}
          <button
            onClick={() => handleScroll('right')}
            aria-label="تمرير لليمين"
            title="تمرير القائمة لليمين"
            className={`shrink-0 z-20 w-8 h-8 rounded-lg bg-[#0e1728] border border-cyan-500/40 text-cyan-300 hover:text-white hover:bg-cyan-950 hover:border-cyan-400 flex items-center justify-center transition shadow-md cursor-pointer mr-1 active:scale-90 ${
              !canScrollRight ? 'opacity-50 hover:border-cyan-500/30' : 'opacity-100'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

        </div>
      </header>

      {/* Real-time Telemetry Diagnostics Modal */}
      <TelemetryDiagnosticsModal 
        isOpen={isDiagnosticsOpen} 
        onClose={() => setIsDiagnosticsOpen(false)} 
      />

      {/* Gemini 3.8 Live API Voice Conversation Chamber */}
      <LiveVoiceCommanderModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
      />

      {/* Global Command Palette Modal (Ctrl+K) */}
      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenVoiceModal={() => setIsVoiceModalOpen(true)}
      />
    </>
  );
}
