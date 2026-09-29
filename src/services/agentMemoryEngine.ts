/**
 * ============================================================================
 * SOVEREIGN AGENT MEMORY ENGINE (CoALA Cognitive Architecture)
 * Standards: Cognitive Architectures for Language Agents (CoALA)
 * Triple Memory Architecture: Semantic, Episodic, Procedural, & Working Memory
 * Chain Key ID: 360ea36c28e66d9d
 * ============================================================================
 */

export type MemoryOutcome = 'success' | 'failure' | 'mitigated';

export interface SemanticMemoryItem {
  id: string;
  namespace: string; // e.g. 'commander_profile', 'system_invariants', 'security_policies'
  key: string;
  facts: Record<string, any>;
  confidence: number; // 0.0 to 1.0
  createdAt: number;
  updatedAt: number;
}

export interface EpisodicMemoryItem {
  id: string;
  sessionOrTaskId: string;
  agentId: string;
  timestamp: number;
  summary: string;
  outcome: MemoryOutcome;
  keyInsights: string[];
  importanceScore: number; // 1 to 10
  tags: string[];
}

export interface ProceduralMemoryItem {
  id: string;
  taskType: string;
  triggerCondition: string;
  steps: string[];
  executionStrategy: string;
  successCount: number;
  failureCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkingMemoryState {
  sessionId: string;
  activeAgent: string;
  activeGoal: string;
  shortTermBuffer: Array<{ role: string; text: string; timestamp: number }>;
  tokenBudget: number;
  currentEstimatedTokens: number;
}

export interface RetrievedAgentContext {
  semanticFacts: Record<string, any>;
  relevantEpisodicMemories: Array<{ item: EpisodicMemoryItem; relevanceScore: number }>;
  applicableProceduralSkills: Array<{ item: ProceduralMemoryItem; matchScore: number }>;
  workingMemorySummary: string;
}

/**
 * Calculates Ebbinghaus exponential recency decay factor.
 * Decay = 2 ^ (-ageInHours / halfLifeInHours)
 */
export function calculateRecencyDecay(timestamp: number, halfLifeInHours = 72): number {
  const ageMs = Math.max(0, Date.now() - timestamp);
  const ageHours = ageMs / (1000 * 60 * 60);
  return Math.pow(2, -ageHours / halfLifeInHours);
}

/**
 * Normalized token-based similarity score (Jaccard / Keyword overlap).
 */
export function computeKeywordSimilarity(textA: string, textB: string): number {
  const tokensA = new Set(textA.toLowerCase().split(/\W+/).filter(t => t.length > 2));
  const tokensB = new Set(textB.toLowerCase().split(/\W+/).filter(t => t.length > 2));
  
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Core Sovereign Agent Memory Store
 */
export class SovereignAgentMemoryEngine {
  private semanticStore: Map<string, SemanticMemoryItem> = new Map();
  private episodicStore: EpisodicMemoryItem[] = [];
  private proceduralStore: Map<string, ProceduralMemoryItem> = new Map();
  private activeWorkingMemories: Map<string, WorkingMemoryState> = new Map();

  constructor() {
    this.seedDefaultSovereignMemories();
  }

  /**
   * Pre-seeds foundational semantic knowledge and sovereign procedural skills.
   */
  private seedDefaultSovereignMemories() {
    // 1. Semantic Foundation
    this.upsertSemanticMemory(
      'system_invariants',
      'zero_trust_policy',
      {
        rule: 'Never trust, always verify with cryptographic Ed25519 signatures and HMAC tokens.',
        enforcedBy: 'sentinel-agent',
        restrictedPaths: ['SOVEREIGN_WAR_CHEST', '/etc/shadow', 'vault.key']
      },
      1.0
    );

    this.upsertSemanticMemory(
      'commander_profile',
      'default_commander',
      {
        title: 'Supreme Commander',
        preferredCommunication: 'Arabic (Concise, authoritative military-grade precision)',
        securityClearance: 'LEVEL_5_SOVEREIGN',
        defaultChatMode: 'council'
      },
      0.95
    );

    // 2. Procedural Skills Foundation
    this.registerProceduralSkill(
      'hitl_destructive_action',
      'User or agent attempts destructive change on critical file or database table',
      [
        'Intercept operation before execution',
        'Generate structured proposal with risk evaluation',
        'Lodge approval block into sovereign_approvals ledger',
        'Require manual cryptographic commander sign-off'
      ],
      'STRICT_HITL_ISOLATION'
    );

    this.registerProceduralSkill(
      'concurrency_stress_analysis',
      'System experiences elevated P95 latency or memory spike',
      [
        'Capture heap snapshot and V8 allocation metrics',
        'Trigger automatic garbage collection probe via /api/system/memory/clean',
        'Profile microkernel ring-0 memory queues',
        'Issue sovereign health diagnostic report'
      ],
      'AUTOMATED_RECOVERY_LOOP'
    );
  }

  // =========================================================================
  // 1. SEMANTIC MEMORY (Facts, Profiles, Knowledge)
  // =========================================================================

  public upsertSemanticMemory(
    namespace: string,
    key: string,
    facts: Record<string, any>,
    confidence = 1.0
  ): SemanticMemoryItem {
    const storeKey = `${namespace}::${key}`;
    const existing = this.semanticStore.get(storeKey);
    const now = Date.now();

    const item: SemanticMemoryItem = {
      id: existing ? existing.id : `sem_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
      namespace,
      key,
      facts: existing ? { ...existing.facts, ...facts } : facts,
      confidence: Math.min(1.0, Math.max(0.0, confidence)),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    this.semanticStore.set(storeKey, item);
    return item;
  }

  public getSemanticMemory(namespace: string, key: string): SemanticMemoryItem | undefined {
    return this.semanticStore.get(`${namespace}::${key}`);
  }

  public listSemanticMemoriesByNamespace(namespace: string): SemanticMemoryItem[] {
    return Array.from(this.semanticStore.values()).filter(item => item.namespace === namespace);
  }

  // =========================================================================
  // 2. EPISODIC MEMORY (Experiences, Events, Outcomes)
  // =========================================================================

  public recordEpisodicMemory(
    sessionOrTaskId: string,
    agentId: string,
    summary: string,
    outcome: MemoryOutcome,
    keyInsights: string[],
    importanceScore = 5,
    tags: string[] = []
  ): EpisodicMemoryItem {
    const item: EpisodicMemoryItem = {
      id: `epi_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
      sessionOrTaskId,
      agentId,
      timestamp: Date.now(),
      summary,
      outcome,
      keyInsights,
      importanceScore: Math.min(10, Math.max(1, importanceScore)),
      tags
    };

    this.episodicStore.push(item);
    
    // Memory capacity cap (Keep up to 2000 episodic events with pruning of low-importance older events)
    if (this.episodicStore.length > 2000) {
      this.episodicStore.sort((a, b) => {
        const scoreA = a.importanceScore * calculateRecencyDecay(a.timestamp, 168);
        const scoreB = b.importanceScore * calculateRecencyDecay(b.timestamp, 168);
        return scoreA - scoreB;
      });
      this.episodicStore.shift();
    }

    return item;
  }

  public searchEpisodicMemories(
    queryText: string,
    filter?: { agentId?: string; outcome?: MemoryOutcome; minImportance?: number },
    limit = 5
  ): Array<{ item: EpisodicMemoryItem; relevanceScore: number }> {
    const results: Array<{ item: EpisodicMemoryItem; relevanceScore: number }> = [];

    for (const item of this.episodicStore) {
      if (filter?.agentId && item.agentId !== filter.agentId) continue;
      if (filter?.outcome && item.outcome !== filter.outcome) continue;
      if (filter?.minImportance && item.importanceScore < filter.minImportance) continue;

      const sim = computeKeywordSimilarity(queryText, `${item.summary} ${item.keyInsights.join(' ')} ${item.tags.join(' ')}`);
      const decay = calculateRecencyDecay(item.timestamp, 72);
      const importanceWeight = item.importanceScore / 10;

      // Hybrid score: 50% keyword similarity + 30% recency decay + 20% importance
      const score = (sim * 0.5) + (decay * 0.3) + (importanceWeight * 0.2);

      results.push({ item, relevanceScore: Number(score.toFixed(4)) });
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, limit);
  }

  // =========================================================================
  // 3. PROCEDURAL MEMORY (How-To Skills, Workflows)
  // =========================================================================

  public registerProceduralSkill(
    taskType: string,
    triggerCondition: string,
    steps: string[],
    executionStrategy: string
  ): ProceduralMemoryItem {
    const existing = this.proceduralStore.get(taskType);
    const now = Date.now();

    const item: ProceduralMemoryItem = {
      id: existing ? existing.id : `proc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
      taskType,
      triggerCondition,
      steps,
      executionStrategy,
      successCount: existing ? existing.successCount : 0,
      failureCount: existing ? existing.failureCount : 0,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    this.proceduralStore.set(taskType, item);
    return item;
  }

  public recordSkillExecution(taskType: string, passed: boolean) {
    const skill = this.proceduralStore.get(taskType);
    if (!skill) return;
    if (passed) skill.successCount++;
    else skill.failureCount++;
    skill.updatedAt = Date.now();
  }

  public findMatchingSkills(
    queryText: string,
    limit = 3
  ): Array<{ item: ProceduralMemoryItem; matchScore: number }> {
    const matches: Array<{ item: ProceduralMemoryItem; matchScore: number }> = [];

    for (const skill of this.proceduralStore.values()) {
      const match = computeKeywordSimilarity(queryText, `${skill.taskType} ${skill.triggerCondition} ${skill.steps.join(' ')}`);
      const totalExecs = skill.successCount + skill.failureCount;
      const successRatio = totalExecs > 0 ? (skill.successCount / totalExecs) : 0.8;
      
      const score = (match * 0.7) + (successRatio * 0.3);
      matches.push({ item: skill, matchScore: Number(score.toFixed(4)) });
    }

    matches.sort((a, b) => b.matchScore - a.matchScore);
    return matches.slice(0, limit);
  }

  // =========================================================================
  // 4. WORKING MEMORY (Active Context Buffer & Session State)
  // =========================================================================

  public getOrCreateWorkingMemory(sessionId: string, activeAgent = 'lead-engineer'): WorkingMemoryState {
    let wm = this.activeWorkingMemories.get(sessionId);
    if (!wm) {
      wm = {
        sessionId,
        activeAgent,
        activeGoal: 'Assist Commander with sovereign system management',
        shortTermBuffer: [],
        tokenBudget: 8192,
        currentEstimatedTokens: 0
      };
      this.activeWorkingMemories.set(sessionId, wm);
    }
    return wm;
  }

  public appendWorkingMemory(sessionId: string, role: string, text: string) {
    const wm = this.getOrCreateWorkingMemory(sessionId);
    const estimatedTokens = Math.ceil(text.length / 3.5);
    
    wm.shortTermBuffer.push({ role, text, timestamp: Date.now() });
    wm.currentEstimatedTokens += estimatedTokens;

    // Auto-prune working memory if token budget is exceeded
    while (wm.currentEstimatedTokens > wm.tokenBudget && wm.shortTermBuffer.length > 2) {
      const removed = wm.shortTermBuffer.shift();
      if (removed) {
        wm.currentEstimatedTokens -= Math.ceil(removed.text.length / 3.5);
      }
    }
  }

  // =========================================================================
  // 5. RUNTIME CONTEXT PREPARATION (CoALA Unified Retrieval)
  // =========================================================================

  public prepareUnifiedContext(
    sessionId: string,
    queryText: string,
    agentId = 'lead-engineer'
  ): RetrievedAgentContext {
    // 1. Semantic Facts (Commander profile & invariants)
    const commanderProfile = this.getSemanticMemory('commander_profile', 'default_commander');
    const systemPolicy = this.getSemanticMemory('system_invariants', 'zero_trust_policy');

    const semanticFacts = {
      ...(commanderProfile?.facts || {}),
      ...(systemPolicy?.facts || {})
    };

    // 2. Episodic Recall (Past experiences & incident outcomes)
    const relevantEpisodicMemories = this.searchEpisodicMemories(queryText, undefined, 3);

    // 3. Procedural Workflows
    const applicableProceduralSkills = this.findMatchingSkills(queryText, 2);

    // 4. Working Memory State
    const wm = this.getOrCreateWorkingMemory(sessionId, agentId);
    const recentMessages = wm.shortTermBuffer.slice(-3).map(m => `[${m.role}]: ${m.text.slice(0, 80)}`).join(' | ');
    const workingMemorySummary = `Active Session: ${sessionId} (Estimated Tokens: ${wm.currentEstimatedTokens}/${wm.tokenBudget}) Recent: ${recentMessages}`;

    return {
      semanticFacts,
      relevantEpisodicMemories,
      applicableProceduralSkills,
      workingMemorySummary
    };
  }

  // =========================================================================
  // 6. MEMORY CONSOLIDATION (Background Formation)
  // =========================================================================

  public consolidateConversationToLongTerm(
    sessionId: string,
    agentId: string,
    title: string,
    messages: Array<{ sender: string; text: string }>
  ) {
    if (messages.length === 0) return;

    const userMessages = messages.filter(m => m.sender === 'user').map(m => m.text);
    const agentMessages = messages.filter(m => m.sender === 'agent').map(m => m.text);

    const summary = `Session [${title}] conducted by agent [${agentId}]. Addressed ${userMessages.length} commander inquiries.`;
    const keyInsights: string[] = [];

    // Extract potential semantic facts
    for (const msg of userMessages) {
      if (msg.includes('تفضيل') || msg.includes('يفضل') || msg.includes('اعتماد') || msg.includes('قواعد')) {
        keyInsights.push(`User stated preference/directive: ${msg.slice(0, 100)}`);
      }
    }

    if (keyInsights.length === 0) {
      keyInsights.push(`Standard deliberation completed successfully with ${messages.length} total messages.`);
    }

    // Record into episodic memory
    this.recordEpisodicMemory(
      sessionId,
      agentId,
      summary,
      'success',
      keyInsights,
      7,
      ['chat_deliberation', agentId, title.slice(0, 30)]
    );
  }
}

// Global Singleton Instance
export const sovereignAgentMemoryInstance = new SovereignAgentMemoryEngine();
