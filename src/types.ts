export interface Approval {
  id: string;
  status: 'pending' | 'approved' | 'executed' | 'failed' | 'rejected' | 'expired';
  risk: 'low' | 'medium' | 'high' | 'critical';
  agent: string;
  type: string;
  summary: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  payload: any;
  signature?: string;
  result?: {
    stdout: string;
    stderr: string;
    exitCode: number;
    msg?: string;
  };
}

export interface BrainMap {
  endpoint?: string;
  models?: {
    reasoning?: string;
    planning?: string;
    coding?: string;
    fallback?: string;
    [key: string]: string | undefined;
  };
  fallbacks?: {
    reasoning?: string;
    planning?: string;
    coding?: string;
    fallback?: string;
    [key: string]: string | undefined;
  };
  disabled?: Record<string, boolean>;
}

export interface AuditStatus {
  status: 'INTACT' | 'BROKEN';
  brokenAt: string | null;
  lastRefresh: string;
}

export interface AgentInfo {
  name: string;
  role: string;
  description: string;
  status: 'active' | 'standby' | 'controlled';
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  agent?: string;
  modelRole?: string;
  model?: string;
  text: string;
  imageUrl?: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
  chatMode: 'solo' | 'council';
  selectedAgent?: string;
  selectedCouncil?: string[];
  lastMessage?: string;
  messages: ChatMessage[];
}
