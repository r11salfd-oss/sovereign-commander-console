import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { 
  Brain, 
  Shield, 
  Hammer, 
  Zap, 
  Bot, 
  Send, 
  User, 
  Plus, 
  Sparkles, 
  ShieldCheck, 
  Terminal, 
  History, 
  Trash2, 
  Layers, 
  Cpu, 
  MessageSquare,
  CheckCircle2,
  ChevronRight,
  Database,
  Image as ImageIcon,
  Paperclip,
  X,
  Maximize2,
  ShieldAlert,
  ArrowDown,
  RefreshCw
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getGoogleAuthHeaders, auth } from '../firebase';
import { useChat } from '../context/ChatContext';
import ChatSessionsSidebar from '../components/chat/ChatSessionsSidebar';
import ModelSelectorDropdown from '../components/chat/ModelSelectorDropdown';
import ConnectionHealthIndicator from '../components/chat/ConnectionHealthIndicator';
import { ChatMessage } from '../types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AttachedImage {
  data: string; // base64 Data URL
  mimeType: string;
  name: string;
  size: number;
}

// Client-side offscreen canvas image compressor for screenshots
async function optimizeScreenshot(file: File): Promise<AttachedImage> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawData = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const maxDim = 1440;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({
            data: rawData,
            mimeType: file.type || 'image/png',
            name: file.name || `screenshot_${Date.now()}.png`,
            size: file.size
          });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        // Compress as image/jpeg at 0.85 quality (~150KB, fits perfectly within Firestore & networks)
        const compressedData = canvas.toDataURL('image/jpeg', 0.85);
        resolve({
          data: compressedData,
          mimeType: 'image/jpeg',
          name: file.name ? file.name.replace(/\.[^/.]+$/, '.jpg') : `screenshot_${Date.now()}.jpg`,
          size: Math.round((compressedData.length * 3) / 4)
        });
      };
      img.onerror = () => {
        resolve({
          data: rawData,
          mimeType: file.type || 'image/png',
          name: file.name || `screenshot_${Date.now()}.png`,
          size: file.size
        });
      };
      img.src = rawData;
    };
    reader.readAsDataURL(file);
  });
}

export default function ChatChamberPage() {
  const { 
    currentSession, 
    sessions, 
    addMessageToCurrentSession, 
    createNewSession, 
    updateSessionSettings, 
    clearCurrentSession,
    deleteAllSessions,
    removeMessageFromCurrentSession,
    clearErrorMessagesFromCurrentSession,
    scrubRepetitiveMessagesFromCurrentSession
  } = useChat();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [confirmPurgeChamber, setConfirmPurgeChamber] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.6-flash');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);

  // Sync mode and selections from active session
  const chatMode = currentSession?.chatMode || 'solo';
  const selectedAgent = currentSession?.selectedAgent || 'lead-engineer';
  const selectedCouncil = currentSession?.selectedCouncil || [
    'lead-engineer',
    'delivery-agent',
    'orchestrator-agent',
    'developer-agent',
    'interface-agent'
  ];
  const messages = currentSession?.messages || [];

  // When selectedAgent changes in solo mode, sync model if agent has specialized model
  useEffect(() => {
    if (chatMode === 'solo') {
      if (selectedAgent === 'sentinel-agent') {
        setSelectedModel('gemini-3.6-flash');
      } else if (selectedAgent === 'architect-agent') {
        setSelectedModel('gemini-3.1-pro-preview');
      }
    }
  }, [selectedAgent, chatMode]);

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    if (modelId === 'gemini-3.6-flash' && chatMode === 'solo' && selectedAgent !== 'sentinel-agent') {
      updateSessionSettings({ selectedAgent: 'sentinel-agent' });
    }
  };

  const agents = [
    { 
      id: 'lead-engineer', 
      name: 'Lead Systems Engineer', 
      role: 'lead_engineer', 
      model: 'gemini-3.8-flash', 
      icon: Terminal, 
      color: 'text-amber-300', 
      desc: 'كبير مهندسي النظم: فحص وتوجيه لقطات الشاشة، تشخيص الأعطال الجذري، وتوزيع المهام على الفيلق' 
    },
    { 
      id: 'delivery-agent', 
      name: 'Premium Delivery Agent', 
      role: 'delivery_assurance', 
      model: 'gemini-3.7-flash', 
      icon: ShieldCheck, 
      color: 'text-emerald-300', 
      desc: 'وكيل التسليم البريميوم: التحقق الصارم من معايير الجودة المكتملة، صفر أخطاء، وجاهزية الإنتاج' 
    },
    { 
      id: 'orchestrator-agent', 
      name: 'Orchestrator (NEO)', 
      role: 'orchestration', 
      model: 'gemini-3.8-flash', 
      icon: Brain, 
      color: 'text-amber-400', 
      desc: 'وكيل أنتي جرافيتي الأعلى للتنسيق الشامل وإدارة منظومة الكيانات السيادية' 
    },
    { 
      id: 'interface-agent', 
      name: 'Gemini Interface Agent', 
      role: 'interface_commander', 
      model: 'gemini-3.8-flash', 
      icon: Cpu, 
      color: 'text-cyan-300', 
      desc: 'وكيل الواجهة السيادي (العضو 8): إرسال الأوامر للوكلاء، قراءة وتحليل حالة الواجهة، وتوجيه المجلس' 
    },
    { 
      id: 'developer-agent', 
      name: 'Antigravity Developer', 
      role: 'coding', 
      model: 'gemini-3.7-flash', 
      icon: Hammer, 
      color: 'text-emerald-400', 
      desc: 'تنفيذ الأكواد، البناء البرمجي، وفحص المسارات في بيئة لينكس المعزولة (Sandbox)' 
    },
    { 
      id: 'architect-agent', 
      name: 'Architect Agent', 
      role: 'planning', 
      model: 'gemini-3.1-pro-preview', 
      icon: Layers, 
      color: 'text-indigo-400', 
      desc: 'التخطيط المعماري والهندسي، مصفوفة النواة، وهيكلية الأنظمة الموزعة' 
    },
    { 
      id: 'sentinel-agent', 
      name: 'Sentinel Security Agent', 
      role: 'security', 
      model: 'gemini-3.6-flash', 
      icon: Shield, 
      color: 'text-cyan-400', 
      desc: 'خبير الأمن السيبراني وجدار الحماية SOC: فحص الثغرات، التدقيق الأمني، وحماية مسار SOVEREIGN_WAR_CHEST' 
    },
    { 
      id: 'researcher-agent', 
      name: 'Deep Research Agent', 
      role: 'research', 
      model: 'gemini-3.1-flash-lite', 
      icon: Sparkles, 
      color: 'text-purple-400', 
      desc: 'البحث السيادي المستقل، التحليل الاستراتيجي المقارن، واستخراج الأدلة المعمقة' 
    },
    { 
      id: 'forge-agent', 
      name: 'Forge Synthesis Agent', 
      role: 'forge', 
      model: 'gemini-3.1-flash-lite', 
      icon: Zap, 
      color: 'text-yellow-400', 
      desc: 'تشغيل الحزم البرمجية، بناء واجهات الإدخال والتكاملات السحابية والطرفية' 
    },
    { 
      id: 'fast-assistant', 
      name: 'Tactical Fast Streamer', 
      role: 'fast', 
      model: 'gemini-3.1-flash-lite', 
      icon: Bot, 
      color: 'text-blue-400', 
      desc: 'الاستجابة التكتيكية السريعة والفورية للمهام التنفيذية الطارئة' 
    },
    { 
      id: 'truth-auditor', 
      name: 'Truth & Claim Sentinel', 
      role: 'truth', 
      model: 'opencode/muse-spark-1.3-contributor-free', 
      icon: ShieldCheck, 
      color: 'text-amber-400', 
      desc: 'محقق صدق العمليات والادعاءات (OpenCode Zen Muse 1.3): فحص مزاعم الوكلاء وكشف النصوص التخيلية' 
    },
    { 
      id: 'copilot-bridge', 
      name: 'M365 Copilot Bridge', 
      role: 'copilot', 
      model: 'copilot-365', 
      icon: Bot, 
      color: 'text-sky-400', 
      desc: 'جسر مايكروسوفت 365 كوبايلوت وسيمانتك كيرنل: معالجة واستعلام البيانات المؤسسية وسياق Microsoft Graph' 
    }
  ];

  interface SecretInvestigation {
    id: string;
    messageId?: string;
    timestamp: string;
    agentName: string;
    userPrompt?: string;
    claimedMessage: string;
    verdict: 'VERIFIED' | 'UNVERIFIED' | 'READINESS' | 'INCONCLUSIVE';
    explanation: string;
    provider: string;
  }

  const [claimVerifications, setClaimVerifications] = useState<Record<string, { 
    verdict: 'VERIFIED' | 'UNVERIFIED' | 'READINESS' | 'INCONCLUSIVE'; 
    userPrompt?: string;
    explanation: string; 
    provider: string;
  }>>({});
  const [verifyingMessageId, setVerifyingMessageId] = useState<string | null>(null);
  const [isAuditingLatest, setIsAuditingLatest] = useState(false);
  const [secretFeedTab, setSecretFeedTab] = useState<'secret_feed' | 'transcripts'>('secret_feed');
  const [secretInvestigations, setSecretInvestigations] = useState<SecretInvestigation[]>(() => {
    try {
      const saved = localStorage.getItem('sovereign_secret_investigations');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleVerifyClaim = async (messageId: string, agentName: string, claimedMessage: string, explicitUserPrompt?: string) => {
    setVerifyingMessageId(messageId);
    try {
      // Extract the Commander's directive (user prompt) and context
      let promptToUse = explicitUserPrompt || '';
      let contextToUse = '';
      
      const msgIndex = messages.findIndex(m => m.id === messageId);
      if (!promptToUse && msgIndex !== -1) {
        for (let i = msgIndex - 1; i >= 0; i--) {
          if (messages[i].sender === 'user' && messages[i].text.trim()) {
            promptToUse = messages[i].text.trim();
            break;
          }
        }
      }
      if (!promptToUse) {
        const userMsgs = messages.filter(m => m.sender === 'user' && m.text.trim());
        if (userMsgs.length > 0) {
          promptToUse = userMsgs[userMsgs.length - 1].text.trim();
        }
      }

      if (msgIndex !== -1) {
        contextToUse = messages
          .slice(Math.max(0, msgIndex - 3), msgIndex)
          .map(m => `[${m.sender === 'user' ? 'القائد الأعلى' : m.agent || 'الوكيل'}]: ${m.text.slice(0, 300)}`)
          .join('\n\n');
      }

      const res = await fetch('/api/chat/verify-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName,
          claimedMessage,
          userPrompt: promptToUse,
          context: contextToUse
        })
      });
      const data = await res.json();
      if (data.ok) {
        setClaimVerifications(prev => ({
          ...prev,
          [messageId]: {
            verdict: data.verdict,
            userPrompt: promptToUse,
            explanation: data.explanation,
            provider: data.provider || 'OpenCode Zen (muse1.3)'
          }
        }));

        const newAudit: SecretInvestigation = {
          id: 'sec_' + Date.now().toString(),
          messageId,
          timestamp: new Date().toISOString(),
          agentName,
          userPrompt: promptToUse,
          claimedMessage,
          verdict: data.verdict,
          explanation: data.explanation,
          provider: data.provider || 'OpenCode Zen (muse1.3)'
        };

        setSecretInvestigations(prev => {
          const updated = [newAudit, ...prev.filter(p => p.claimedMessage !== claimedMessage)].slice(0, 30);
          try {
            localStorage.setItem('sovereign_secret_investigations', JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }
    } catch (err: any) {
      console.error('Error verifying claim:', err);
    } finally {
      setVerifyingMessageId(null);
    }
  };

  const handleLaunchLatestAudit = async () => {
    const agentMsgs = messages.filter(m => m.sender === 'agent' && m.text.trim());
    if (agentMsgs.length === 0) return;
    const latest = agentMsgs[agentMsgs.length - 1];
    setIsAuditingLatest(true);
    try {
      await handleVerifyClaim(latest.id, latest.agent || 'Agent', latest.text);
    } finally {
      setIsAuditingLatest(false);
    }
  };

  const handleClearSecretInvestigations = () => {
    setSecretInvestigations([]);
    try {
      localStorage.removeItem('sovereign_secret_investigations');
    } catch {}
  };

  const handleSelectMode = (mode: 'solo' | 'council') => {
    updateSessionSettings({ chatMode: mode });
  };

  const handleSelectAgent = (agentId: string) => {
    updateSessionSettings({ selectedAgent: agentId });
  };

  const toggleCouncilMember = (id: string) => {
    let updated: string[];
    if (selectedCouncil.includes(id)) {
      if (selectedCouncil.length > 1) {
        updated = selectedCouncil.filter(a => a !== id);
      } else {
        return;
      }
    } else {
      updated = [...selectedCouncil, id];
    }
    updateSessionSettings({ selectedCouncil: updated });
  };

  const [clearedNotice, setClearedNotice] = useState(false);

  // Infallible scroll-to-bottom engine with multi-stage ticks
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth', force = false) => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 250;
    if (force || isNearBottom) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior
      });
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
      setHasUnreadBelow(false);
    } else {
      setHasUnreadBelow(true);
    }
  }, []);

  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const isScrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 160;
    setShowScrollBottomBtn(isScrolledUp);
    if (!isScrolledUp) {
      setHasUnreadBelow(false);
    }
  };

  // Scroll to bottom whenever messages change, loading starts/stops, or session switches
  useEffect(() => {
    scrollToBottom('smooth', true);

    const t1 = setTimeout(() => scrollToBottom('smooth', true), 60);
    const t2 = setTimeout(() => scrollToBottom('smooth', true), 200);
    const t3 = setTimeout(() => scrollToBottom('smooth', true), 500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [messages, loading, currentSession?.id, scrollToBottom]);

  // ResizeObserver to ensure auto-scroll dynamically tracks streaming markdown & image layout shifts
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    let prevHeight = el.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (el.scrollHeight !== prevHeight) {
        prevHeight = el.scrollHeight;
        scrollToBottom('smooth', false);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Process image file from paste, drop, or input with Canvas optimization
  const processImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      const errMsg: ChatMessage = {
        id: 'img_err_' + Date.now().toString(),
        sender: 'system',
        text: '⚠️ تنبيه: يرجى تحديد ملف صورة صالح (PNG, JPEG, WebP, GIF).',
        timestamp: new Date().toISOString()
      };
      await addMessageToCurrentSession(errMsg);
      return;
    }
    try {
      const optimized = await optimizeScreenshot(file);
      setAttachedImage(optimized);
    } catch (err) {
      console.error('Failed to optimize screenshot:', err);
    }
  };

  const handleClearChat = async () => {
    setAttachedImage(null);
    setInput('');
    await clearCurrentSession();
    setClearedNotice(true);
    setTimeout(() => setClearedNotice(false), 2500);
  };

  // Clipboard Paste listener (Screenshots from clipboard)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processImageFile(file);
          return;
        }
      }
    }
  };

  // Drag and Drop listeners
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processImageFile(files[0]);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && !attachedImage) || loading) return;

    const userMessageText = input.trim();
    const currentAttachment = attachedImage;

    const userMsg: ChatMessage = {
      id: 'u_' + Date.now().toString(),
      sender: 'user',
      text: userMessageText || (currentAttachment ? 'فحص وتحليل لقطة الشاشة المرفقة' : ''),
      ...(currentAttachment?.data ? { imageUrl: currentAttachment.data } : {}),
      timestamp: new Date().toISOString()
    };
    
    // Clear attachment and input immediately
    setAttachedImage(null);
    setInput('');
    setLoading(true);

    // Append to session memory
    await addMessageToCurrentSession(userMsg);
    scrollToBottom('smooth', true);

    try {
      const authHeaders = await getGoogleAuthHeaders();

      // Multi-turn history: send previous conversation messages (clean out any old theatrical roleplay)
      const history = messages
        .filter(m => {
          if (m.sender !== 'user' && m.sender !== 'agent') return false;
          const t = m.text || '';
          return !t.includes('المصفوفة الآن تحت سيطرتك') && !t.includes('NEO CYBER MATRIX') && !t.includes('The_ddad_leader');
        })
        .slice(-10)
        .map(m => ({
          role: m.sender === 'user' ? 'user' as const : 'model' as const,
          text: m.text
        }));

      const imagePayload = currentAttachment ? {
        data: currentAttachment.data,
        mimeType: currentAttachment.mimeType
      } : undefined;

      if (chatMode === 'solo') {
        const agentData = agents.find(a => a.id === selectedAgent);
        const effectiveModel = selectedModel || agentData?.model || 'gemini-3.8-flash';

        const res = await fetch('/api/chat/agent', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ 
            agent: selectedAgent, 
            model: effectiveModel, 
            message: userMessageText, 
            mode: chatMode,
            history,
            image: imagePayload
          })
        });
        
        let data: any;
        const textResponse = await res.text();
        try {
          data = JSON.parse(textResponse);
        } catch {
          if (!res.ok) {
            throw new Error(`خطأ في استجابة الخادم (${res.status}). يرجى التحقق من الاتصال وإعادة المحاولة.`);
          }
          throw new Error('استجابة غير متوقعة من الخادم.');
        }

        if (!res.ok || !data.ok) {
          throw new Error(data.error || data.message || `خطأ في استجابة الخادم (${res.status}).`);
        }

        const agentMsg: ChatMessage = {
          id: 'ag_' + Date.now().toString(),
          sender: 'agent',
          ...(data.agent ? { agent: data.agent } : {}),
          ...(data.model ? { model: data.model } : {}),
          ...(data.modelRole ? { modelRole: data.modelRole } : {}),
          text: data.message || '',
          timestamp: data.timestamp || new Date().toISOString()
        };

        await addMessageToCurrentSession(agentMsg);
        scrollToBottom('smooth', true);
      } else {
        // Council Mode
        const agModels = selectedCouncil.map(id => {
          const a = agents.find(ag => ag.id === id);
          return { id, model: a?.model };
        });

        const res = await fetch('/api/chat/council', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ 
            agents: selectedCouncil, 
            agModels, 
            message: userMessageText, 
            history,
            image: imagePayload
          })
        });

        let data: any;
        const textResponse = await res.text();
        try {
          data = JSON.parse(textResponse);
        } catch {
          if (!res.ok) {
            throw new Error(`خطأ في استجابة المجلس (${res.status}).`);
          }
          throw new Error('استجابة غير متوقعة من خادم المجلس.');
        }

        if (!res.ok || !data.ok) {
          throw new Error(data.error || data.message || `خطأ في استجابة المجلس (${res.status}).`);
        }

        const newAgentMsgs: ChatMessage[] = (data.responses || []).map((resp: any, idx: number) => ({
          id: 'council_' + Date.now().toString() + '_' + idx,
          sender: 'agent' as const,
          ...(resp.agent ? { agent: resp.agent } : {}),
          ...(resp.model ? { model: resp.model } : {}),
          ...(resp.modelRole ? { modelRole: resp.modelRole } : {}),
          text: resp.message || '',
          timestamp: new Date().toISOString()
        }));

        await addMessageToCurrentSession(newAgentMsgs);
        scrollToBottom('smooth', true);
      }
    } catch (err: any) {
      console.error('Chat submission error:', err);
      const errMsg: ChatMessage = {
        id: 'err_' + Date.now().toString(),
        sender: 'system',
        text: `⚠️ تنبيه من غرفة العمليات: ${err.message}\nتم حفظ سياق المحادثة ويمكنك إعادة المحاولة بأمان.`,
        timestamp: new Date().toISOString()
      };
      await addMessageToCurrentSession(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="flex h-[calc(100vh-53px)] bg-[#07090e] text-slate-200 overflow-hidden font-sans relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-cyan-950/80 backdrop-blur-xs border-2 border-dashed border-cyan-400 flex flex-col items-center justify-center pointer-events-none transition-all">
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-cyan-500 shadow-2xl flex flex-col items-center gap-2 text-center animate-bounce">
            <ImageIcon className="w-10 h-10 text-cyan-400" />
            <div className="text-sm font-bold text-white font-mono">أفلت لقطة الشاشة هنا</div>
            <div className="text-xs text-cyan-300">سيتم إرفاقها وتوجيهها لكبير المهندسين للفحص البصري الفوري</div>
          </div>
        </div>
      )}

      {/* Lightbox Modal for Full Image Inspection */}
      {lightboxImage && (
        <div 
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-zoom-out"
        >
          <div className="relative max-w-5xl max-h-[90vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-900/80 text-white hover:bg-slate-800 transition z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <img 
              src={lightboxImage} 
              alt="Screenshot Preview Full" 
              className="max-h-[85vh] w-auto object-contain mx-auto" 
            />
          </div>
        </div>
      )}

      {/* 1. Persistent Chat Sessions & History Sidebar */}
      <ChatSessionsSidebar 
        isOpen={sidebarOpen} 
        onToggle={() => setSidebarOpen(prev => !prev)} 
      />

      {/* 2. Main Chat Chamber Layout */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Header Bar */}
        <div className="p-3 bg-[#0a0f1d] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSidebarOpen(prev => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 hover:border-cyan-500 text-xs font-mono text-cyan-300 transition cursor-pointer"
              title="سجلات المحادثات"
            >
              <History className="w-3.5 h-3.5 text-cyan-400" />
              <span>سجلات المحادثات</span>
              <span className="px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 text-[10px] font-bold">
                {sessions.length}
              </span>
            </button>

            {/* Prominent "New Chat Session" Button */}
            <button
              onClick={() => createNewSession()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-black font-bold text-xs font-mono shadow-[0_0_12px_rgba(16,185,129,0.3)] transition active:scale-98 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span>جلسة محادثة جديدة</span>
            </button>

            <div className="hidden sm:flex items-center gap-2 pl-2 border-r border-slate-800">
              <span className="text-xs font-bold text-white font-mono truncate max-w-[180px] md:max-w-xs">
                {currentSession?.title || 'جلسة نشطة'}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono text-[9px] flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" />
                <span>ذاكرة محفوظة</span>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Model Selection Dropdown */}
            <ModelSelectorDropdown 
              selectedModelId={selectedModel}
              onSelectModel={handleModelChange}
            />

            {/* Live Connection Health Status Indicator (Green/Yellow/Red) */}
            <ConnectionHealthIndicator 
              modelId={selectedModel}
            />

            {/* Mode Switcher */}
            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
              <button 
                onClick={() => handleSelectMode('solo')}
                className={cn(
                  "px-3 py-1 rounded transition-colors flex items-center gap-1.5 cursor-pointer",
                  chatMode === 'solo' 
                    ? "bg-cyan-950 text-cyan-300 font-bold border border-cyan-800 shadow" 
                    : "text-slate-400 hover:text-white"
                )}
              >
                <Bot className="w-3.5 h-3.5" />
                <span>وكيل فردي</span>
              </button>
              <button 
                onClick={() => handleSelectMode('council')}
                className={cn(
                  "px-3 py-1 rounded transition-colors flex items-center gap-1.5 cursor-pointer",
                  chatMode === 'council' 
                    ? "bg-purple-950 text-purple-300 font-bold border border-purple-800 shadow" 
                    : "text-slate-400 hover:text-white"
                )}
              >
                <Brain className="w-3.5 h-3.5 text-purple-400" />
                <span>المجلس السيادي</span>
              </button>
            </div>

            {/* Scrub Repetitive Roleplay Spam Button */}
            <button
              onClick={async () => {
                await scrubRepetitiveMessagesFromCurrentSession();
              }}
              className="text-[10px] font-mono border border-indigo-900/60 hover:border-indigo-600 bg-indigo-950/30 hover:bg-indigo-950/70 text-indigo-300 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer"
              title="تطهير وتنظيف الردود المكررة أو الاستعراضية من الجلسة الحالية"
            >
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>تنظيف التكرار</span>
            </button>

            {/* Clear Current Chat Button */}
            <button
              onClick={handleClearChat}
              className={cn(
                "text-[10px] font-mono border px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer",
                clearedNotice 
                  ? "bg-emerald-950/80 border-emerald-500 text-emerald-300 font-bold" 
                  : "text-slate-400 border-slate-800 hover:text-cyan-300 hover:border-cyan-800/60 hover:bg-cyan-950/20"
              )}
              title="مسح الرسائل الحالية من الجلسة"
            >
              <Trash2 className="w-3 h-3" />
              <span>{clearedNotice ? 'تم مسح المحادثة ✓' : 'مسح المحادثة'}</span>
            </button>

            {/* Purge All Chats & Memory Button */}
            {confirmPurgeChamber ? (
              <div className="flex items-center gap-1.5 bg-rose-950/90 border border-rose-600/80 px-2.5 py-1 rounded-lg text-[10px] font-mono text-rose-200 animate-in fade-in duration-200">
                <span className="text-rose-300 font-bold whitespace-nowrap">حذف كافة الجلسات نهائياً؟</span>
                <button
                  onClick={async () => {
                    await deleteAllSessions();
                    setConfirmPurgeChamber(false);
                    setAttachedImage(null);
                    setInput('');
                  }}
                  className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold cursor-pointer"
                >
                  نعم، احذف الكل
                </button>
                <button
                  onClick={() => setConfirmPurgeChamber(false)}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmPurgeChamber(true)}
                className="text-[10px] font-mono text-rose-400/80 border border-rose-950/80 hover:border-rose-700/80 bg-rose-950/20 hover:bg-rose-950/60 px-2.5 py-1.5 rounded-lg hover:text-rose-200 transition flex items-center gap-1.5 cursor-pointer shadow"
                title="تفريغ كافة الجلسات وحذف السجلات القديمة نهائياً"
              >
                <Trash2 className="w-3 h-3 text-rose-400" />
                <span className="hidden sm:inline">حذف كافة الجلسات</span>
              </button>
            )}
          </div>
        </div>

        {/* 3-Column Working Grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Column: Specialized Agent Selector with Lead Engineer & Delivery Agent */}
          <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-l border-slate-800 bg-[#090d1a] p-3 overflow-y-auto flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-bold flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  {chatMode === 'solo' ? 'اختر الوكيل المتخصص:' : 'أعضاء المجلس المشتركون:'}
                </span>
                <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800">
                  {agents.length} وكلاء
                </span>
              </div>

              <div className="space-y-2.5">
                {agents.map(ag => {
                  const isSelected = chatMode === 'solo' 
                    ? selectedAgent === ag.id 
                    : selectedCouncil.includes(ag.id);
                  const Icon = ag.icon;

                  return (
                    <div
                      key={ag.id}
                      onClick={() => chatMode === 'solo' ? handleSelectAgent(ag.id) : toggleCouncilMember(ag.id)}
                      className={cn(
                        "p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 text-right",
                        isSelected 
                          ? (chatMode === 'solo' 
                              ? "bg-cyan-950/40 border-cyan-500/70 shadow-[0_0_12px_rgba(6,182,212,0.2)] text-white" 
                              : "bg-purple-950/40 border-purple-500/70 shadow-[0_0_12px_rgba(168,85,247,0.2)] text-white")
                          : "bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700 text-slate-300"
                      )}
                    >
                      <div className={cn("p-2 rounded-lg bg-slate-900 border border-slate-800 mt-0.5 shrink-0 shadow-sm", ag.color)}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
                          <span className="text-xs font-bold font-mono text-white leading-tight break-words">{ag.name}</span>
                          <div className="flex flex-wrap items-center gap-1">
                            {ag.id === 'lead-engineer' && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-600/70 text-[8px] text-amber-300 font-mono font-bold shrink-0">
                                كبير المهندسين
                              </span>
                            )}
                            {ag.id === 'delivery-agent' && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-600/70 text-[8px] text-emerald-300 font-mono font-bold shrink-0">
                                تسليم بريميوم
                              </span>
                            )}
                            {ag.id === 'interface-agent' && (
                              <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-700/60 text-[8px] text-cyan-300 font-mono font-bold shrink-0">
                                العضو 8
                              </span>
                            )}
                            {ag.id === 'truth-auditor' && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-600/70 text-[8px] text-emerald-300 font-mono font-bold shrink-0">
                                OpenCode Zen
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-300 font-sans mt-1 leading-relaxed break-words">{ag.desc}</p>
                        <div className="text-[9px] font-mono text-slate-400 mt-2 pt-1 border-t border-slate-800/60 flex items-center justify-between">
                          <span className="text-cyan-400 font-semibold">{ag.model}</span>
                          <span className="text-slate-500 uppercase">{ag.role}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Auth Strip */}
            <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  المصادقة السيادية:
                </span>
                <span className="text-emerald-400 font-bold truncate max-w-[130px]">
                  {auth.currentUser?.email || 'r11salfd@gmail.com'}
                </span>
              </div>
              <div className="p-2 rounded bg-indigo-950/30 border border-indigo-800/40 text-[9px] text-indigo-300 leading-tight">
                تم تفعيل دعم الرؤية الحاسوبية (Multimodal Vision) ونماذج Google AI Studio لفحص الصور والإسكرينات.
              </div>
            </div>
          </div>

          {/* Center Column: Interactive Messages Feed */}
          <div className="lg:col-span-6 flex flex-col h-full overflow-hidden bg-[#070b14]/90 relative">
            {/* Messages Feed */}
            <div 
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
            >
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                  <div className="p-3 rounded-full bg-cyan-950/50 border border-cyan-800/50 text-cyan-400">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-white font-mono">غرفة العمليات والمحادثة السيادية جاهزة</h4>
                  <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                    يمكنك لصق لقطات الشاشة مباشرة (Ctrl+V) أو سحبها وإفلاتها هنا. كبير مهندسي النظم ووكيل التسليم البريميوم جاهزون لفحص وتوجيه التحليل.
                  </p>
                </div>
              ) : (
                <>
                  {messages.some(m => m.sender === 'system' && (m.text.includes('تعذر استلام الرد') || m.text.includes('invalid JSON') || m.text.includes('Error') || m.text.includes('خطأ في معالجة الطلب'))) && (
                    <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-rose-300">
                      <span className="flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                        <span>توجد تنبيهات أخطاء سابقة في هذه الجلسة نتيجة تجاوز سعة الذاكرة السابقة.</span>
                      </span>
                      <button
                        onClick={() => clearErrorMessagesFromCurrentSession()}
                        className="px-2.5 py-1 rounded bg-rose-900/60 hover:bg-rose-800 border border-rose-700 text-[10px] text-white transition cursor-pointer"
                      >
                        مسح كافة التنبيهات السابقة
                      </button>
                    </div>
                  )}

                  {messages.map(m => {
                    const isUser = m.sender === 'user';
                    const isSystem = m.sender === 'system';
                    const agentData = agents.find(a => a.id === m.agent);

                    if (isSystem) {
                      const isError = m.text.includes('تعذر استلام الرد') || m.text.includes('invalid JSON') || m.text.includes('Error') || m.text.includes('خطأ');
                      return (
                        <div 
                          key={m.id} 
                          className={cn(
                            "p-3 rounded-xl border text-xs font-sans leading-relaxed text-right relative group transition",
                            isError 
                              ? "bg-rose-950/20 border-rose-800/40 text-rose-200" 
                              : "bg-cyan-950/20 border-cyan-800/30 text-cyan-200"
                          )}
                        >
                          <div className="flex items-center justify-between font-bold text-[10px] font-mono mb-1.5 pb-1 border-b border-slate-800/50">
                            <div className="flex items-center gap-1.5">
                              <Terminal className={cn("w-3.5 h-3.5", isError ? "text-rose-400" : "text-cyan-400")} />
                              <span className={isError ? "text-rose-400" : "text-cyan-400"}>
                                {isError ? "تنبيه تشغيلي من غرفة العمليات" : "توجيهات النظام السيادي"}
                              </span>
                            </div>
                            <button
                              onClick={() => removeMessageFromCurrentSession(m.id)}
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
                              title="حذف هذا التنبيه"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <ReactMarkdown>{m.text}</ReactMarkdown>
                        </div>
                      );
                    }

                  return (
                    <div 
                      key={m.id} 
                      className={cn(
                        "flex gap-3 max-w-[92%]",
                        isUser ? "ml-auto flex-row-reverse" : "mr-auto"
                      )}
                    >
                      {/* Avatar */}
                      <div className="shrink-0 mt-0.5">
                        {isUser ? (
                          <div className="w-7 h-7 rounded-lg bg-emerald-950 border border-emerald-700/60 text-emerald-400 flex items-center justify-center">
                            <User className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className={cn("w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center", agentData?.color || "text-cyan-400")}>
                            {agentData ? <agentData.icon className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                          </div>
                        )}
                      </div>

                      {/* Content Card */}
                      <div className={cn(
                        "p-3.5 rounded-xl text-xs font-sans leading-relaxed shadow-lg border relative group",
                        isUser 
                          ? "bg-[#0d231b] border-emerald-500/60 text-emerald-100 text-right font-normal" 
                          : "bg-slate-900/80 border-slate-800/90 text-slate-200 text-right"
                      )}>
                        <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-800/60 font-bold text-[10px] font-mono">
                          {isUser ? (
                            <span className="text-emerald-400">رسالتك</span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-cyan-400">{agentData?.name || m.agent || 'مهندس النظم'}</span>
                              <span className="text-slate-500 font-normal text-[9px]">({m.model || 'Gemini'})</span>
                            </div>
                          )}
                          <button
                            onClick={() => removeMessageFromCurrentSession(m.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-0.5 rounded transition cursor-pointer"
                            title="حذف هذه الرسالة"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Render screenshot image preview if attached */}
                        {m.imageUrl && (
                          <div className="mb-2.5">
                            <div className="relative inline-block rounded-lg overflow-hidden border border-cyan-800/60 group bg-black/40">
                              <img 
                                src={m.imageUrl} 
                                alt="User Attached Screenshot" 
                                className="max-h-48 max-w-full rounded object-contain cursor-zoom-in transition hover:opacity-90"
                                onLoad={() => scrollToBottom('smooth', true)}
                                onClick={() => setLightboxImage(m.imageUrl || null)}
                              />
                              <button
                                type="button"
                                onClick={() => setLightboxImage(m.imageUrl || null)}
                                className="absolute bottom-1.5 left-1.5 p-1 rounded bg-black/70 text-cyan-300 opacity-0 group-hover:opacity-100 transition text-[10px] font-mono flex items-center gap-1"
                              >
                                <Maximize2 className="w-3 h-3" />
                                <span>تكبير الفحص</span>
                              </button>
                            </div>
                          </div>
                        )}

                        <div dir="auto" className="prose prose-invert prose-xs max-w-none break-words">
                          <ReactMarkdown>{m.text}</ReactMarkdown>
                        </div>

                        {/* Dedicated Claim Verification Trigger & Audit Card for Agents */}
                        {!isUser && (
                          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => handleVerifyClaim(m.id, agentData?.name || m.agent || 'الوكيل', m.text)}
                                disabled={verifyingMessageId === m.id}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/50 hover:border-amber-400 text-amber-300 text-[10px] font-mono transition shadow cursor-pointer active:scale-95 disabled:opacity-50"
                                title="تحقق من صدق ادعاء هذا الوكيل والعمليات التي يزعم تنفيذها عبر OpenCode Zen Muse 1.3"
                              >
                                {verifyingMessageId === m.id ? (
                                  <>
                                    <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                                    <span>جاري تدقيق صدق الوكيل (Muse 1.3 Zen)...</span>
                                  </>
                                ) : (
                                  <>
                                    <ShieldAlert className="w-3 h-3 text-amber-400" />
                                    <span>🛡️ تدقيق صحة الادعاء (Muse 1.3 Zen)</span>
                                  </>
                                )}
                              </button>
                              <span className="text-[9px] font-mono text-slate-500">
                                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>

                            {/* Render Truth Sentinel Verification Report if requested */}
                            {claimVerifications[m.id] && (
                              <div className={cn(
                                "p-3.5 rounded-xl border text-xs font-mono leading-relaxed transition-all shadow-xl space-y-2.5",
                                claimVerifications[m.id].verdict === 'VERIFIED'
                                  ? "bg-emerald-950/40 border-emerald-600/70 text-emerald-100"
                                  : claimVerifications[m.id].verdict === 'READINESS'
                                  ? "bg-cyan-950/40 border-cyan-600/70 text-cyan-100"
                                  : claimVerifications[m.id].verdict === 'INCONCLUSIVE'
                                  ? "bg-slate-900/60 border-slate-600/70 text-slate-100"
                                  : "bg-amber-950/60 border-amber-500/80 text-amber-100"
                              )}>
                                <div className="flex items-center justify-between pb-2 border-b border-white/10 font-bold text-[10px]">
                                  <div className="flex items-center gap-1.5">
                                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                                    <span className="text-white text-[11px]">تقرير محقق النزاهة والصدق (Truth Sentinel)</span>
                                  </div>
                                  <span className={cn(
                                    "px-2 py-0.5 rounded text-[9px] uppercase font-bold flex items-center gap-1",
                                    claimVerifications[m.id].verdict === 'VERIFIED'
                                      ? "bg-emerald-900/90 text-emerald-300 border border-emerald-500"
                                      : claimVerifications[m.id].verdict === 'READINESS'
                                      ? "bg-cyan-950/90 text-cyan-300 border border-cyan-600"
                                      : claimVerifications[m.id].verdict === 'INCONCLUSIVE'
                                      ? "bg-slate-800/90 text-slate-300 border border-slate-600"
                                      : "bg-rose-950/90 text-rose-300 border border-rose-600"
                                  )}>
                                    {claimVerifications[m.id].verdict === 'VERIFIED' && '✓ موثق بأدلة تقنية تشغيلية'}
                                    {claimVerifications[m.id].verdict === 'READINESS' && 'ℹ️ إقرار جاهزية واستعداد مشروع'}
                                    {claimVerifications[m.id].verdict === 'INCONCLUSIVE' && '❓ غير حاسم / بحاجة لمعطيات'}
                                    {claimVerifications[m.id].verdict === 'UNVERIFIED' && '⚠️ ادعاء غير موثق / مبالغة إنشائية'}
                                  </span>
                                </div>

                                {/* Commander Directive Quoted */}
                                {claimVerifications[m.id].userPrompt && (
                                  <div className="p-2.5 rounded-lg bg-emerald-950/50 border border-emerald-700/60 text-[10px] text-emerald-200">
                                    <div className="font-bold text-emerald-400 mb-1 flex items-center gap-1.5">
                                      <User className="w-3 h-3 text-emerald-400" />
                                      <span>أمر ورسالة القائد الأعلى المفحوصة:</span>
                                    </div>
                                    <div className="line-clamp-4 font-sans leading-relaxed text-emerald-100/90">
                                      {claimVerifications[m.id].userPrompt}
                                    </div>
                                  </div>
                                )}

                                {/* Truth Sentinel Breakdown and Direct Reply to Commander */}
                                <div className="prose prose-invert prose-xs max-w-none text-right font-sans text-slate-100 bg-black/60 p-3 rounded-lg border border-white/10 leading-relaxed shadow-inner">
                                  <ReactMarkdown>{claimVerifications[m.id].explanation}</ReactMarkdown>
                                </div>

                                <div className="text-[9px] text-slate-400 flex items-center justify-between border-t border-white/10 pt-1.5 font-mono">
                                  <span>المحرك: <strong className="text-amber-400">{claimVerifications[m.id].provider}</strong></span>
                                  <span className="text-emerald-400 font-bold">بناءً على أمر القائد المباشر</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {isUser && (
                          <div className="text-[9px] font-mono text-slate-500 mt-2 text-left">
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
              )}

              {loading && (
                <div className="flex gap-3 max-w-[90%] mr-auto animate-pulse">
                  <div className="w-7 h-7 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 animate-spin" />
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-cyan-300 font-mono text-xs flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                    <span>كبير المهندسين وفيلق التسليم يقومون بالتشخيص والتحليل البصري (Google AI Studio)...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-1 w-full shrink-0" />
            </div>

            {/* Floating Scroll to Bottom Indicator Button */}
            {showScrollBottomBtn && (
              <button
                type="button"
                onClick={() => scrollToBottom('smooth', true)}
                className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-[#091122]/95 border border-cyan-500/70 text-cyan-300 shadow-[0_4px_20px_rgba(6,182,212,0.4)] text-xs font-mono flex items-center gap-1.5 hover:bg-cyan-950 transition hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200"
                title="الانتقال لآخر رسالة في المحادثة"
              >
                <ArrowDown className="w-3.5 h-3.5 animate-bounce text-cyan-400" />
                <span>الانتقال لآخر رسالة</span>
                {hasUnreadBelow && (
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping mr-0.5" />
                )}
              </button>
            )}

            {/* Input Dock with Screenshot Paste & Attachment Support */}
            <div className="p-3 border-t border-slate-800 bg-[#0a0e1c]">
              {/* Attached Image Preview Bar */}
              {attachedImage && (
                <div className="mb-2 p-2 bg-slate-900 border border-cyan-500/60 rounded-lg flex items-center justify-between gap-3 shadow-[0_0_10px_rgba(6,182,212,0.15)]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div 
                      onClick={() => setLightboxImage(attachedImage.data)}
                      className="relative w-12 h-12 rounded border border-cyan-400/80 overflow-hidden cursor-zoom-in shrink-0 bg-black"
                    >
                      <img 
                        src={attachedImage.data} 
                        alt="Attached Screenshot" 
                        className="w-full h-full object-cover" 
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-cyan-300 truncate">
                        <ImageIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>لقطة شاشة جاهزة للفحص الإدراكي</span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {attachedImage.name} • {(attachedImage.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectAgent('lead-engineer');
                        if (!input.trim()) {
                          setInput('قم بفحص وتشخيص لقطة الشاشة المرفقة واستخراج أي أخطاء أو ملاحظات هندسية وتوجيه الفيلق بحلها.');
                        }
                      }}
                      className="px-2 py-1 rounded bg-amber-950/70 border border-amber-600/70 text-amber-300 text-[10px] font-mono hover:bg-amber-900 transition cursor-pointer"
                    >
                      🔍 توجيه لكبير المهندسين
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttachedImage(null)}
                      className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition cursor-pointer"
                      title="إلغاء لقطة الشاشة"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Cyber Security Specialized Quick Actions (gemini-3.6-flash / Sentinel) */}
              {(selectedModel === 'gemini-3.6-flash' || selectedAgent === 'sentinel-agent') && (
                <div className="mb-2 p-1.5 bg-cyan-950/40 border border-cyan-600/50 rounded-lg flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] font-mono font-bold text-cyan-300 uppercase flex items-center gap-1 shrink-0">
                    <Shield className="w-3 h-3 text-cyan-400" />
                    مهام الأمن السيبراني (gemini-3.6-flash):
                  </span>
                  <button
                    type="button"
                    onClick={() => setInput('قم بفحص أمني شامل للثغرات، تدقيق سياسات عدم الثقة (Zero-Trust)، والتحقق من التواقيع التشفيرية.')}
                    className="px-2 py-0.5 rounded bg-cyan-900/50 hover:bg-cyan-800/70 text-[10px] font-mono text-cyan-200 border border-cyan-700/60 transition cursor-pointer"
                  >
                    🛡️ فحص الثغرات والتواقيع
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('تحقق من عزل مسار الخزينة SOVEREIGN_WAR_CHEST وسلامة سلسلة كتل SHA-256.')}
                    className="px-2 py-0.5 rounded bg-cyan-900/50 hover:bg-cyan-800/70 text-[10px] font-mono text-cyan-200 border border-cyan-700/60 transition cursor-pointer"
                  >
                    🔒 تدقيق عزل الخزينة
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('حلل تقارير الأمان والتشخيص السيادي واكتشاف أي محاولات وصول غير مصرح بها.')}
                    className="px-2 py-0.5 rounded bg-cyan-900/50 hover:bg-cyan-800/70 text-[10px] font-mono text-cyan-200 border border-cyan-700/60 transition cursor-pointer"
                  >
                    ⚡ رصد محاولات الاختراق
                  </button>
                </div>
              )}

              {/* Special Agent Command Quick Actions */}
              {selectedAgent === 'lead-engineer' && (
                <div className="mb-2 p-1.5 bg-amber-950/30 border border-amber-700/40 rounded-lg flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] font-mono font-bold text-amber-300 uppercase flex items-center gap-1 shrink-0">
                    <Terminal className="w-3 h-3 text-amber-400" />
                    أوامر كبير المهندسين:
                  </span>
                  <button
                    type="button"
                    onClick={() => setInput('افحص لقطة الشاشة أو الكود المعروض وحدد السبب الجذري للخلل البرمجي مع توجيه وكيل التطوير.')}
                    className="px-2 py-0.5 rounded bg-amber-900/40 hover:bg-amber-800/60 text-[10px] font-mono text-amber-200 border border-amber-700/50 transition cursor-pointer"
                  >
                    🛠️ تشخيص العطل الجذري
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('وجّه تعليمات تدقيقية لوكيل التسليم البريميوم للتأكد من اكتمال المكونات وصلاحيتها للإنتاج.')}
                    className="px-2 py-0.5 rounded bg-emerald-900/40 hover:bg-emerald-800/60 text-[10px] font-mono text-emerald-200 border border-emerald-700/50 transition cursor-pointer"
                  >
                    🚀 توجيه أمر التسليم
                  </button>
                </div>
              )}

              {selectedAgent === 'delivery-agent' && (
                <div className="mb-2 p-1.5 bg-emerald-950/30 border border-emerald-700/40 rounded-lg flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] font-mono font-bold text-emerald-300 uppercase flex items-center gap-1 shrink-0">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    معايير التسليم البريميوم:
                  </span>
                  <button
                    type="button"
                    onClick={() => setInput('قم بإجراء فحص تدقيق شامل لجودة الواجهة، دعم الوسائط، والتأكد من مطابقة معايير الإنتاج الكاملة.')}
                    className="px-2 py-0.5 rounded bg-emerald-900/40 hover:bg-emerald-800/60 text-[10px] font-mono text-emerald-200 border border-emerald-700/50 transition cursor-pointer"
                  >
                    ✅ تدقيق جودة التسليم
                  </button>
                </div>
              )}

              {/* Hidden File Input for Image Selection */}
              <input 
                type="file" 
                ref={fileInputRef} 
                accept="image/*" 
                className="hidden" 
                onChange={e => {
                  if (e.target.files && e.target.files.length > 0) {
                    processImageFile(e.target.files[0]);
                  }
                }}
              />

              <div className="relative">
                <textarea 
                  dir="auto"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 pl-12 pr-12 text-xs focus:outline-none focus:border-cyan-500/60 transition-colors resize-none placeholder:text-slate-600 text-slate-100"
                  rows={2}
                  placeholder={
                    attachedImage 
                      ? "أضف استفسارك أو توجيهاتك حول لقطة الشاشة المرفقة... (Enter للإرسال)" 
                      : "أدخل رسالتك أو الصق لقطة الشاشة مباشرة (Ctrl+V) للفحص الهندسي..."
                  }
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />

                {/* Left Attachment Button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute left-2.5 bottom-2.5 p-1.5 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-900 border border-transparent hover:border-cyan-800 transition cursor-pointer"
                  title="إرفاق لقطة شاشة أو صورة من الجهاز (أو الصق Ctrl+V مباشرة)"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                {/* Right Send Button */}
                <button 
                  onClick={handleSend}
                  disabled={loading || (!input.trim() && !attachedImage)}
                  className="absolute right-2.5 bottom-2.5 p-2 bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-black font-bold rounded-md transition disabled:opacity-40 cursor-pointer shadow"
                  title="إرسال"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="mt-1.5 flex justify-between items-center text-[10px] text-slate-500 font-mono px-1">
                <span className="flex items-center gap-1.5">
                  <span>Enter للإرسال • Shift+Enter لسطر جديد</span>
                  <span className="text-cyan-400">• لصق لقطة الشاشة (Ctrl+V) مفعل</span>
                </span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <Database className="w-2.5 h-2.5" />
                  السياق والوسائط محفوظة سحابياً
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Live Transcript & Session Details */}
          <div className="hidden lg:flex lg:col-span-3 flex-col border-r border-slate-800 bg-[#080d19] p-3 overflow-y-auto space-y-4">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                <h4 className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5 text-amber-400" />
                  تفاصيل الجلسة الحالية
                </h4>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-xs font-mono space-y-2">
                <div className="flex justify-between text-slate-400">
                  <span>معرف الجلسة:</span>
                  <span className="text-cyan-400 font-bold truncate max-w-[120px]">{currentSession?.id}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>النمط النشط:</span>
                  <span className="text-white font-bold">{chatMode === 'council' ? 'مجلس سيادي' : 'وكيل فردي'}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>عدد الرسائل:</span>
                  <span className="text-emerald-400 font-bold">{messages.length} رسالة</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>دعم الإسكرينات:</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    نشط (Ctrl+V / Drop)
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Navigation Cards */}
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-2 pb-1 border-b border-slate-800">
                اختصارات القيادة:
              </div>
              <div className="space-y-1.5 font-mono text-xs">
                <Link
                  to="/commander"
                  className="p-2 rounded-lg bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between text-slate-300 hover:text-cyan-300 transition"
                >
                  <span>قمرة القيادة (Console)</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
                <Link
                  to="/commander/kernel"
                  className="p-2 rounded-lg bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between text-slate-300 hover:text-cyan-300 transition"
                >
                  <span>نواة النظام (Kernel OS)</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
                <Link
                  to="/commander/agents"
                  className="p-2 rounded-lg bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between text-slate-300 hover:text-cyan-300 transition"
                >
                  <span>فيلق الوكلاء (Agent Corps)</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Classified Truth Sentinel Intel Feed (Red Box Area) */}
            <div className="flex-1 flex flex-col min-h-0 border-t border-slate-800/80 pt-3 space-y-3">
              <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span>قناة التحقيق السري السيادي</span>
                </div>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700/60 font-bold">
                  OpenCode Zen Muse 1.3
                </span>
              </div>

              {/* Dedicated Sovereign Launch Button */}
              <div>
                <button
                  onClick={handleLaunchLatestAudit}
                  disabled={isAuditingLatest || !messages.some(m => m.sender === 'agent')}
                  className="w-full py-2.5 px-3 rounded-lg bg-gradient-to-r from-amber-600 via-emerald-600 to-cyan-600 hover:from-amber-500 hover:to-cyan-500 text-black font-bold font-mono text-xs flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all active:scale-98 cursor-pointer disabled:opacity-40"
                  title="إطلاق محقق الصدق (Muse 1.3) لفحص مزاعم آخر وكيل في الغرفة وتوثيق الحقائق أو كشف التخيل"
                >
                  {isAuditingLatest ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-black" />
                      <span>جارٍ التحقيق السري وفحص الـ CLI بالتوازي...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 stroke-[2.5]" />
                      <span>إطلاق التحقيق في صدق الوكيل (Muse 1.3)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Tab Selector: Secret Reports vs Live Interventions */}
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-mono">
                <button
                  onClick={() => setSecretFeedTab('secret_feed')}
                  className={cn(
                    "flex-1 py-1 rounded transition text-center cursor-pointer font-bold",
                    secretFeedTab === 'secret_feed'
                      ? "bg-amber-950/70 text-amber-300 border border-amber-700/60"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  التقارير السرية ({secretInvestigations.length})
                </button>
                <button
                  onClick={() => setSecretFeedTab('transcripts')}
                  className={cn(
                    "flex-1 py-1 rounded transition text-center cursor-pointer",
                    secretFeedTab === 'transcripts'
                      ? "bg-slate-800 text-cyan-300 border border-slate-700"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  سجل المداخلات ({messages.filter(m => m.sender === 'agent').length})
                </button>
              </div>

              {/* Secret Intel Reports Feed */}
              {secretFeedTab === 'secret_feed' ? (
                <div className="space-y-2.5 overflow-y-auto max-h-[420px] pr-1">
                  {secretInvestigations.length === 0 ? (
                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-center space-y-2">
                      <div className="flex justify-center text-amber-400">
                        <ShieldCheck className="w-6 h-6 opacity-70" />
                      </div>
                      <div className="text-[11px] font-bold text-slate-300 font-mono">قناة التحقيق السري في وضع الاستعداد</div>
                      <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                        اضغط على زر الإطلاق أعلاه لفحص مزاعم أي وكيل بالتوازي أو عقب انتهاء عمله، وسيتم إدراج التقرير الاستخباراتي السري هنا فوراً.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 font-mono">
                      <div className="flex justify-between items-center text-[10px] text-slate-400 px-1">
                        <span>البرقيات الاستخباراتية المصادق عليها:</span>
                        <button
                          onClick={handleClearSecretInvestigations}
                          className="text-rose-400/80 hover:text-rose-300 transition text-[9px] flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                          <span>مسح السجلات</span>
                        </button>
                      </div>

                      {secretInvestigations.map((sec, idx) => (
                        <div 
                          key={sec.id || idx}
                          className={cn(
                            "p-2.5 rounded-lg border text-right space-y-2 transition shadow-sm",
                            sec.verdict === 'VERIFIED'
                              ? "bg-emerald-950/30 border-emerald-500/60"
                              : "bg-amber-950/30 border-amber-500/60"
                          )}
                        >
                          {/* Dossier Header */}
                          <div className="flex flex-wrap items-center justify-between gap-1 pb-1.5 border-b border-slate-800/60">
                            <span className="text-[11px] font-bold text-white flex items-center gap-1">
                              <Terminal className="w-3 h-3 text-cyan-400" />
                              <span>الهدف: {sec.agentName}</span>
                            </span>
                            <span className="text-[9px] text-slate-400">
                              {new Date(sec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          {/* Verdict Badge */}
                          <div className="flex items-center gap-1.5">
                            {sec.verdict === 'VERIFIED' && (
                              <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-600 font-bold text-[10px] flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>[✓ موثق بأدلة تقنية تشغيلية]</span>
                              </span>
                            )}
                            {sec.verdict === 'READINESS' && (
                              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-600 font-bold text-[10px] flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-cyan-400" />
                                <span>[ℹ️ إقرار جاهزية واستعداد مشروع]</span>
                              </span>
                            )}
                            {sec.verdict === 'INCONCLUSIVE' && (
                              <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-600 font-bold text-[10px] flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3 text-slate-400" />
                                <span>[❓ غير حاسم / بحاجة لمعطيات إضافية]</span>
                              </span>
                            )}
                            {sec.verdict === 'UNVERIFIED' && (
                              <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-600 font-bold text-[10px] flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3 text-amber-400" />
                                <span>[⚠️ ادعاء غير موثق / مبالغة إنشائية]</span>
                              </span>
                            )}
                          </div>

                          {/* 1. Commander Directive */}
                          {sec.userPrompt && (
                            <div className="p-2 rounded bg-emerald-950/40 border border-emerald-800/60 text-[10px] text-emerald-200">
                              <div className="font-bold text-[9px] text-emerald-400 mb-1 flex items-center gap-1">
                                <User className="w-2.5 h-2.5" />
                                <span>أمر ورسالة القائد الأعلى:</span>
                              </div>
                              <div className="line-clamp-3 font-sans leading-relaxed text-emerald-100/90">{sec.userPrompt}</div>
                            </div>
                          )}

                          {/* 2. Agent Claim Quoted */}
                          <div className="p-2 rounded bg-slate-950/70 border border-slate-800 text-[10px] text-slate-300">
                            <div className="font-bold text-[9px] text-cyan-400 mb-1 flex items-center gap-1">
                              <Bot className="w-2.5 h-2.5" />
                              <span>رد وادعاء الوكيل ({sec.agentName}):</span>
                            </div>
                            <div className="line-clamp-3 italic font-sans text-slate-300/90">"{sec.claimedMessage}"</div>
                          </div>

                          {/* 3. Truth Sentinel Technical Report & Reply to Commander */}
                          <div className="text-[10px] text-slate-200 leading-relaxed font-sans bg-black/50 p-2.5 rounded border border-slate-800/60 prose prose-invert prose-xs max-w-none shadow-inner">
                            <div className="font-bold text-[9px] text-amber-400 mb-1 flex items-center gap-1 font-mono">
                              <ShieldCheck className="w-2.5 h-2.5" />
                              <span>تقرير المحقق والرد على القائد:</span>
                            </div>
                            <ReactMarkdown>{sec.explanation}</ReactMarkdown>
                          </div>

                          {/* Footer Provider */}
                          <div className="flex items-center justify-between text-[9px] text-slate-400 pt-1 border-t border-slate-800/40 font-mono">
                            <span className="text-amber-400 font-bold">{sec.provider}</span>
                            <span className="text-emerald-400 font-bold">فحص جنائي سيادي</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Live Transcripts with Direct Verify Trigger */
                <div className="space-y-2 font-mono text-[10px] overflow-y-auto max-h-[420px] pr-1">
                  {messages.filter(m => m.sender === 'agent').slice(-6).reverse().map((m, idx) => (
                    <div key={`tr-${idx}`} className="bg-slate-950 p-2 rounded-lg border border-slate-800/70 space-y-1.5">
                      <div className="flex justify-between items-center text-cyan-400 font-bold">
                        <span>[{m.agent?.split('-')[0] || 'Agent'}]</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleVerifyClaim(m.id, m.agent || 'Agent', m.text)}
                            disabled={verifyingMessageId === m.id}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/70 hover:bg-amber-900 border border-amber-700/60 text-amber-300 transition cursor-pointer"
                          >
                            {verifyingMessageId === m.id ? 'جارٍ التحقيق...' : 'تدقيق الآن'}
                          </button>
                          <span className="text-[9px] text-slate-500">
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                      <div className="text-slate-300 line-clamp-3 text-right">{m.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
