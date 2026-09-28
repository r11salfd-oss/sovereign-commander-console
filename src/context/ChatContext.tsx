import React, { 
  createContext, 
  useContext, 
  useState, 
  useEffect, 
  useCallback, 
  useRef,
  ReactNode 
} from 'react';
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where 
} from 'firebase/firestore';
import { db, auth, sanitizeForFirestore } from '../firebase';
import { ChatMessage, ChatSession } from '../types';

interface ChatContextType {
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  currentSessionId: string | null;
  loadingSessions: boolean;
  createNewSession: (initialTitle?: string, mode?: 'solo' | 'council', agent?: string) => Promise<string>;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  renameSession: (sessionId: string, newTitle: string) => Promise<void>;
  addMessageToCurrentSession: (msg: ChatMessage | ChatMessage[]) => Promise<void>;
  updateSessionSettings: (settings: {
    chatMode?: 'solo' | 'council';
    selectedAgent?: string;
    selectedCouncil?: string[];
    title?: string;
  }) => Promise<void>;
  clearCurrentSession: () => Promise<void>;
  removeMessageFromCurrentSession: (messageId: string) => Promise<void>;
  clearErrorMessagesFromCurrentSession: () => Promise<void>;
  scrubRepetitiveMessagesFromCurrentSession: () => Promise<void>;
}

const LOCAL_STORAGE_SESSIONS_KEY = 'sov_chat_sessions_cache';
const LOCAL_STORAGE_ACTIVE_ID_KEY = 'sov_active_chat_session_id';

const ChatContext = createContext<ChatContextType | undefined>(undefined);

function generateId(): string {
  return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
}

const INITIAL_WELCOME_MSG: ChatMessage = {
  id: 'init_welcome',
  sender: 'system',
  text: 'مرحباً بك في غرفة القيادة والاستشارات الهندسية.\nيمكنك طرح أي استفسار برمجى، أو لصق لقطات الشاشة (Ctrl+V) لفحصها وتحليل أخطائها، وسيقوم مهندس النظم بالإجابة المباشرة والحل العملي.',
  timestamp: new Date().toISOString()
};

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_SESSIONS_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_ACTIVE_ID_KEY);
    } catch {
      return null;
    }
  });

  const [loadingSessions, setLoadingSessions] = useState<boolean>(true);

  // Synchronous refs to prevent React state closure races
  const sessionsRef = useRef<ChatSession[]>(sessions);
  sessionsRef.current = sessions;

  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  // Sync sessions list to localStorage cache (trimmed to 10 most recent sessions to prevent QuotaExceededError)
  useEffect(() => {
    try {
      if (sessions.length > 0) {
        // Strip out heavy base64 imageUrl in localStorage to keep cache lean, while keeping texts intact
        const trimmedCache = sessions.slice(0, 10).map(s => ({
          ...s,
          messages: s.messages.slice(-50).map(m => {
            if (m.imageUrl && m.imageUrl.length > 500) {
              const { imageUrl, ...rest } = m;
              return rest;
            }
            return m;
          })
        }));
        localStorage.setItem(LOCAL_STORAGE_SESSIONS_KEY, JSON.stringify(trimmedCache));
      }
    } catch (err) {
      console.warn('LocalStorage session sync warning:', err);
    }
  }, [sessions]);

  // Sync currentSessionId to localStorage
  useEffect(() => {
    try {
      if (currentSessionId) {
        localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, currentSessionId);
      }
    } catch (err) {
      console.warn('LocalStorage active session sync warning:', err);
    }
  }, [currentSessionId]);

  // Real-time Firestore sync with intelligent merge to never drop local messages
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoadingSessions(false);
      return;
    }

    setLoadingSessions(true);
    const q = query(
      collection(db, 'chat_sessions'),
      where('creatorId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const remoteSessions: ChatSession[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            title: data.title || 'جلسة استشارة هندسية',
            creatorId: data.creatorId || user.uid,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
            chatMode: data.chatMode || 'solo',
            selectedAgent: data.selectedAgent || 'lead-engineer',
            selectedCouncil: data.selectedCouncil || ['lead-engineer', 'developer-agent', 'architect-agent'],
            lastMessage: data.lastMessage || '',
            messages: Array.isArray(data.messages) ? data.messages : []
          } as ChatSession;
        });

        // Merge intelligently: if local session has more messages than remote (because of in-flight write), preserve local messages
        const mergedSessions = remoteSessions.map(remote => {
          const local = sessionsRef.current.find(l => l.id === remote.id);
          if (local && local.messages.length > remote.messages.length) {
            return {
              ...remote,
              messages: local.messages,
              lastMessage: local.lastMessage || remote.lastMessage
            };
          }
          return remote;
        });

        // Also keep any local session that was just created and not yet in remote snapshot
        const newLocalSessions = sessionsRef.current.filter(l => !mergedSessions.some(r => r.id === l.id));
        const combined = [...newLocalSessions, ...mergedSessions];

        // Sort descending by updatedAt
        combined.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        sessionsRef.current = combined;
        setSessions(combined);
        setLoadingSessions(false);

        // If no active session or currentSessionId is not in list, pick the first
        if (combined.length > 0) {
          if (!currentSessionIdRef.current || !combined.some(s => s.id === currentSessionIdRef.current)) {
            const nextId = combined[0].id;
            currentSessionIdRef.current = nextId;
            setCurrentSessionId(nextId);
          }
        }
      },
      (error) => {
        console.warn('Firestore chat_sessions sync fallback:', error.message);
        setLoadingSessions(false);
      }
    );

    return () => unsubscribe();
  }, [auth.currentUser]);

  // Find active session
  const currentSession = sessions.find(s => s.id === currentSessionId) || sessions[0] || null;

  // Create a brand new session
  const createNewSession = useCallback(async (
    initialTitle?: string,
    mode: 'solo' | 'council' = 'solo',
    agent: string = 'lead-engineer'
  ): Promise<string> => {
    const user = auth.currentUser;
    const newId = generateId();
    const now = new Date().toISOString();

    const newSession: ChatSession = {
      id: newId,
      title: initialTitle || `جلسة استشارة ${new Date().toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      creatorId: user ? user.uid : 'local_commander',
      createdAt: now,
      updatedAt: now,
      chatMode: mode,
      selectedAgent: agent,
      selectedCouncil: ['lead-engineer', 'developer-agent', 'architect-agent', 'delivery-agent'],
      lastMessage: 'بدء جلسة جديدة',
      messages: [INITIAL_WELCOME_MSG]
    };

    // Update synchronous ref and state immediately
    sessionsRef.current = [newSession, ...sessionsRef.current];
    currentSessionIdRef.current = newId;
    setSessions(sessionsRef.current);
    setCurrentSessionId(newId);

    try {
      localStorage.setItem(LOCAL_STORAGE_SESSIONS_KEY, JSON.stringify(sessionsRef.current));
      localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, newId);
    } catch {}

    // Save to Firestore if authenticated
    if (user) {
      try {
        const sessionRef = doc(db, 'chat_sessions', newId);
        await setDoc(sessionRef, sanitizeForFirestore(newSession));
      } catch (err: any) {
        console.error('Failed to create session in Firestore:', err.message);
      }
    }

    return newId;
  }, []);

  // Ensure there's at least one session on first load
  useEffect(() => {
    if (!loadingSessions && sessions.length === 0) {
      createNewSession('جلسة الاستشارة الأولى', 'solo', 'lead-engineer');
    }
  }, [loadingSessions, sessions.length, createNewSession]);

  const switchSession = useCallback((sessionId: string) => {
    if (sessionsRef.current.some(s => s.id === sessionId)) {
      currentSessionIdRef.current = sessionId;
      setCurrentSessionId(sessionId);
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    const user = auth.currentUser;

    const remaining = sessionsRef.current.filter(s => s.id !== sessionId);
    sessionsRef.current = remaining;
    setSessions(remaining);

    if (currentSessionIdRef.current === sessionId) {
      const nextActiveId = remaining.length > 0 ? remaining[0].id : null;
      currentSessionIdRef.current = nextActiveId;
      setCurrentSessionId(nextActiveId);
    }

    try {
      localStorage.setItem(LOCAL_STORAGE_SESSIONS_KEY, JSON.stringify(remaining));
      if (currentSessionIdRef.current) {
        localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, currentSessionIdRef.current);
      }
    } catch {}

    if (user) {
      try {
        await deleteDoc(doc(db, 'chat_sessions', sessionId));
      } catch (err: any) {
        console.error('Failed to delete session from Firestore:', err.message);
      }
    }
  }, []);

  const deleteAllSessions = useCallback(async () => {
    const user = auth.currentUser;
    const oldSessions = [...sessionsRef.current];

    const newId = generateId();
    const now = new Date().toISOString();
    const cleanSession: ChatSession = {
      id: newId,
      title: 'جلسة جديدة',
      creatorId: user ? user.uid : 'local_commander',
      createdAt: now,
      updatedAt: now,
      chatMode: 'solo',
      selectedAgent: 'lead-engineer',
      selectedCouncil: ['lead-engineer', 'developer-agent', 'architect-agent'],
      lastMessage: 'تم تفريغ كافة الجلسات السابقة',
      messages: [INITIAL_WELCOME_MSG]
    };

    sessionsRef.current = [cleanSession];
    currentSessionIdRef.current = newId;
    setSessions([cleanSession]);
    setCurrentSessionId(newId);

    try {
      localStorage.setItem(LOCAL_STORAGE_SESSIONS_KEY, JSON.stringify([cleanSession]));
      localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, newId);
    } catch {}

    if (user) {
      try {
        await Promise.all(oldSessions.map(s => deleteDoc(doc(db, 'chat_sessions', s.id)).catch(() => {})));
        await setDoc(doc(db, 'chat_sessions', newId), sanitizeForFirestore(cleanSession));
      } catch (err: any) {
        console.error('Failed to purge Firestore chat sessions:', err.message);
      }
    }
  }, []);

  const renameSession = useCallback(async (sessionId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    sessionsRef.current = sessionsRef.current.map(s => s.id === sessionId ? { ...s, title: trimmed } : s);
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: trimmed } : s));

    const user = auth.currentUser;
    if (user) {
      try {
        await updateDoc(doc(db, 'chat_sessions', sessionId), sanitizeForFirestore({
          title: trimmed,
          updatedAt: new Date().toISOString()
        }));
      } catch (err: any) {
        console.error('Failed to rename session in Firestore:', err.message);
      }
    }
  }, []);

  /**
   * ATOMIC ADD MESSAGE:
   * Always reads the latest session from `sessionsRef.current` to completely eliminate
   * React closure race conditions where a message would be overwritten by a stale closure!
   */
  const addMessageToCurrentSession = useCallback(async (msg: ChatMessage | ChatMessage[]) => {
    const targetSessionId = currentSessionIdRef.current;
    if (!targetSessionId) return;

    const currentTarget = sessionsRef.current.find(s => s.id === targetSessionId) || sessionsRef.current[0];
    if (!currentTarget) return;

    const now = new Date().toISOString();
    const newItems = (Array.isArray(msg) ? msg : [msg]).map(m => sanitizeForFirestore(m));
    
    // Always append onto existing messages from freshest in-memory state
    const existingMessages = currentTarget.messages || [];
    const updatedMessages = [...existingMessages, ...newItems].map(m => sanitizeForFirestore(m));

    const lastMsgText = newItems[newItems.length - 1]?.text || '';
    const lastPreview = lastMsgText.substring(0, 80).replace(/\n/g, ' ') + (lastMsgText.length > 80 ? '...' : '');

    // Derive auto-title from first user message if title is still default
    let derivedTitle = currentTarget.title;
    if (currentTarget.title.includes('جلسة استشارة') || currentTarget.title.includes('جلسة جديدة')) {
      const firstUserMsg = updatedMessages.find(m => m.sender === 'user');
      if (firstUserMsg && firstUserMsg.text) {
        derivedTitle = firstUserMsg.text.slice(0, 35).replace(/\n/g, ' ') + (firstUserMsg.text.length > 35 ? '...' : '');
      }
    }

    const updatedSession: ChatSession = {
      ...currentTarget,
      title: derivedTitle,
      updatedAt: now,
      lastMessage: lastPreview,
      messages: updatedMessages
    };

    // Update synchronous ref FIRST so next immediate call sees this update
    sessionsRef.current = sessionsRef.current.map(s => s.id === targetSessionId ? updatedSession : s);

    // Update React state
    setSessions(prev => prev.map(s => s.id === targetSessionId ? updatedSession : s));

    // Save to localStorage
    try {
      localStorage.setItem(LOCAL_STORAGE_SESSIONS_KEY, JSON.stringify(sessionsRef.current));
    } catch {}

    // Persist to Firestore
    const user = auth.currentUser;
    if (user) {
      try {
        const sessionRef = doc(db, 'chat_sessions', targetSessionId);
        await updateDoc(sessionRef, sanitizeForFirestore({
          title: derivedTitle,
          updatedAt: now,
          lastMessage: lastPreview,
          messages: updatedMessages
        }));
      } catch (err: any) {
        console.error('Failed to append message to Firestore session:', err.message);
      }
    }
  }, []);

  const updateSessionSettings = useCallback(async (settings: {
    chatMode?: 'solo' | 'council';
    selectedAgent?: string;
    selectedCouncil?: string[];
    title?: string;
  }) => {
    const targetSessionId = currentSessionIdRef.current;
    if (!targetSessionId) return;
    const now = new Date().toISOString();

    sessionsRef.current = sessionsRef.current.map(s => s.id === targetSessionId ? { ...s, ...settings, updatedAt: now } : s);
    setSessions(prev => prev.map(s => s.id === targetSessionId ? { ...s, ...settings, updatedAt: now } : s));

    const user = auth.currentUser;
    if (user) {
      try {
        const sessionRef = doc(db, 'chat_sessions', targetSessionId);
        await updateDoc(sessionRef, sanitizeForFirestore({
          ...settings,
          updatedAt: now
        }));
      } catch (err: any) {
        console.error('Failed to update session settings in Firestore:', err.message);
      }
    }
  }, []);

  const clearCurrentSession = useCallback(async () => {
    const targetSessionId = currentSessionIdRef.current;
    if (!targetSessionId) return;
    const now = new Date().toISOString();
    const resetMsgs = [INITIAL_WELCOME_MSG];

    sessionsRef.current = sessionsRef.current.map(s => s.id === targetSessionId ? {
      ...s,
      messages: resetMsgs,
      lastMessage: 'تم مسح المحادثة',
      updatedAt: now
    } : s);

    setSessions(prev => prev.map(s => s.id === targetSessionId ? {
      ...s,
      messages: resetMsgs,
      lastMessage: 'تم مسح المحادثة',
      updatedAt: now
    } : s));

    const user = auth.currentUser;
    if (user) {
      try {
        const sessionRef = doc(db, 'chat_sessions', targetSessionId);
        await updateDoc(sessionRef, sanitizeForFirestore({
          messages: resetMsgs,
          lastMessage: 'تم مسح المحادثة',
          updatedAt: now
        }));
      } catch (err: any) {
        console.error('Failed to clear session in Firestore:', err.message);
      }
    }
  }, []);

  const removeMessageFromCurrentSession = useCallback(async (messageId: string) => {
    const targetSessionId = currentSessionIdRef.current;
    if (!targetSessionId) return;
    const now = new Date().toISOString();

    const target = sessionsRef.current.find(s => s.id === targetSessionId);
    if (!target) return;

    const filtered = target.messages.filter(m => m.id !== messageId);
    sessionsRef.current = sessionsRef.current.map(s => s.id === targetSessionId ? { ...s, messages: filtered, updatedAt: now } : s);
    setSessions(prev => prev.map(s => s.id === targetSessionId ? { ...s, messages: filtered, updatedAt: now } : s));

    const user = auth.currentUser;
    if (user) {
      try {
        const sessionRef = doc(db, 'chat_sessions', targetSessionId);
        await updateDoc(sessionRef, sanitizeForFirestore({
          messages: filtered,
          updatedAt: now
        }));
      } catch (err: any) {
        console.error('Failed to remove message in Firestore:', err.message);
      }
    }
  }, []);

  const clearErrorMessagesFromCurrentSession = useCallback(async () => {
    const targetSessionId = currentSessionIdRef.current;
    if (!targetSessionId) return;
    const now = new Date().toISOString();

    const target = sessionsRef.current.find(s => s.id === targetSessionId);
    if (!target) return;

    const filtered = target.messages.filter(m => !(m.sender === 'system' && (m.text.includes('تعذر استلام الرد') || m.text.includes('invalid JSON') || m.text.includes('Error'))));
    sessionsRef.current = sessionsRef.current.map(s => s.id === targetSessionId ? { ...s, messages: filtered, updatedAt: now } : s);
    setSessions(prev => prev.map(s => s.id === targetSessionId ? { ...s, messages: filtered, updatedAt: now } : s));

    const user = auth.currentUser;
    if (user) {
      try {
        const sessionRef = doc(db, 'chat_sessions', targetSessionId);
        await updateDoc(sessionRef, sanitizeForFirestore({
          messages: filtered,
          updatedAt: now
        }));
      } catch (err: any) {
        console.error('Failed to clear errors in Firestore:', err.message);
      }
    }
  }, []);

  /**
   * Cleans out any old repetitive theatrical roleplay messages from the current session
   */
  const scrubRepetitiveMessagesFromCurrentSession = useCallback(async () => {
    const targetSessionId = currentSessionIdRef.current;
    if (!targetSessionId) return;
    const now = new Date().toISOString();

    const target = sessionsRef.current.find(s => s.id === targetSessionId);
    if (!target) return;

    const cleaned = target.messages.filter(m => {
      if (m.sender === 'user') return true;
      const t = m.text || '';
      const isRoleplay = t.includes('المصفوفة الآن تحت سيطرتك') || 
                         t.includes('NEO CYBER MATRIX') || 
                         t.includes('The_ddad_leader') ||
                         t.includes('تم رصد الخلل في مخرجات النظام السابقة');
      return !isRoleplay;
    });

    sessionsRef.current = sessionsRef.current.map(s => s.id === targetSessionId ? { ...s, messages: cleaned, updatedAt: now } : s);
    setSessions(prev => prev.map(s => s.id === targetSessionId ? { ...s, messages: cleaned, updatedAt: now } : s));

    const user = auth.currentUser;
    if (user) {
      try {
        const sessionRef = doc(db, 'chat_sessions', targetSessionId);
        await updateDoc(sessionRef, sanitizeForFirestore({
          messages: cleaned,
          updatedAt: now
        }));
      } catch (err: any) {
        console.error('Failed to scrub repetitive messages in Firestore:', err.message);
      }
    }
  }, []);

  return (
    <ChatContext.Provider
      value={{
        sessions,
        currentSession,
        currentSessionId,
        loadingSessions,
        createNewSession,
        switchSession,
        deleteSession,
        deleteAllSessions,
        renameSession,
        addMessageToCurrentSession,
        updateSessionSettings,
        clearCurrentSession,
        removeMessageFromCurrentSession,
        clearErrorMessagesFromCurrentSession,
        scrubRepetitiveMessagesFromCurrentSession
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
