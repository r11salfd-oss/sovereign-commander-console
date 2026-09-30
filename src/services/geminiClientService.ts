/**
 * ============================================================================
 * SOVEREIGN GEMINI API CLIENT SERVICE (@google/genai >= 2.3.0)
 * Standards: gemini-api-dev (Interactions, Current Models, Deprecation Guards)
 * Chain Key ID: 360ea36c28e66d9d
 * ============================================================================
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Validated, Non-Deprecated Gemini Models (2026 Standards)
 * Strict rule: All gemini-1.5-* and gemini-2.0-* are deprecated.
 */
export const ALLOWED_GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-embedding-2',
  'gemini-embedding-001',
  'antigravity-preview-05-2026'
] as const;

export type SupportedGeminiModel = typeof ALLOWED_GEMINI_MODELS[number];

export interface GeminiRequestOptions {
  model?: SupportedGeminiModel | string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  previousInteractionId?: string;
  responseMimeType?: string;
  responseSchema?: Record<string, any>;
}

export interface GeminiResponseEnvelope<T = string> {
  success: boolean;
  model: string;
  data: T;
  interactionId?: string;
  latencyMs: number;
  tokensEstimated: number;
  error?: string;
  migratedFrom?: string;
}

/**
 * Auto-sanitizes deprecated models to current Gemini 3.x equivalents.
 */
export function sanitizeModelName(requestedModel?: string): { activeModel: string; wasMigrated: boolean; original?: string } {
  if (!requestedModel) {
    return { activeModel: 'gemini-3.8-flash', wasMigrated: false };
  }

  const modelLower = requestedModel.toLowerCase().trim();

  // Deprecated 1.5 and 2.0 series automatic migration
  if (
    modelLower.includes('gemini-1.5') || 
    modelLower.includes('gemini-2.0') || 
    modelLower.includes('gemini-2.5') ||
    modelLower.includes('gemini-pro-vision')
  ) {
    const target = modelLower.includes('pro') ? 'gemini-3.1-pro-preview' : 'gemini-3.8-flash';
    return { activeModel: target, wasMigrated: true, original: requestedModel };
  }

  // Active permitted models
  return { activeModel: requestedModel, wasMigrated: false };
}

/**
 * Core Sovereign Gemini Service
 */
export class SovereignGeminiService {
  private client: GoogleGenAI | null = null;
  private apiKey: string = '';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || process.env.Gemini_API || '';
    if (this.apiKey) {
      try {
        this.client = new GoogleGenAI({ apiKey: this.apiKey });
      } catch (err) {
        console.warn('[Gemini Service] Initialization warning:', err);
      }
    }
  }

  public getClient(): GoogleGenAI | null {
    if (!this.client && (process.env.GEMINI_API_KEY || process.env.Gemini_API)) {
      this.apiKey = process.env.GEMINI_API_KEY || process.env.Gemini_API || '';
      try {
        this.client = new GoogleGenAI({ apiKey: this.apiKey });
      } catch (e) {}
    }
    return this.client;
  }

  /**
   * Generates text content with automatic fallback and model deprecation handling
   */
  public async generateText(
    prompt: string,
    options: GeminiRequestOptions = {}
  ): Promise<GeminiResponseEnvelope<string>> {
    const start = Date.now();
    const { activeModel, wasMigrated, original } = sanitizeModelName(options.model);
    const client = this.getClient();

    if (!client) {
      return {
        success: false,
        model: activeModel,
        data: '',
        error: 'Gemini API Client is uninitialized. GEMINI_API_KEY environment variable is required.',
        latencyMs: Date.now() - start,
        tokensEstimated: 0,
        migratedFrom: wasMigrated ? original : undefined
      };
    }

    try {
      const contents: any[] = [{ role: 'user', parts: [{ text: prompt }] }];
      const config: any = {
        temperature: options.temperature ?? 0.4
      };

      if (options.systemInstruction) {
        config.systemInstruction = { parts: [{ text: options.systemInstruction }] };
      }
      if (options.maxOutputTokens) {
        config.maxOutputTokens = options.maxOutputTokens;
      }

      const response = await client.models.generateContent({
        model: activeModel,
        contents,
        config
      });

      const text = response.text || '';
      const estimatedTokens = Math.ceil((prompt.length + text.length) / 3.5);

      return {
        success: true,
        model: activeModel,
        data: text,
        latencyMs: Date.now() - start,
        tokensEstimated: estimatedTokens,
        migratedFrom: wasMigrated ? original : undefined
      };
    } catch (err: any) {
      return {
        success: false,
        model: activeModel,
        data: '',
        error: `Gemini execution failure: ${err.message || String(err)}`,
        latencyMs: Date.now() - start,
        tokensEstimated: 0,
        migratedFrom: wasMigrated ? original : undefined
      };
    }
  }

  /**
   * Multimodal vision inspection for screenshots and error diagrams
   */
  public async analyzeMultimodalVision(
    prompt: string,
    imageBase64: string,
    mimeType = 'image/png',
    options: GeminiRequestOptions = {}
  ): Promise<GeminiResponseEnvelope<string>> {
    const start = Date.now();
    const { activeModel, wasMigrated, original } = sanitizeModelName(options.model || 'gemini-3.8-flash');
    const client = this.getClient();

    if (!client) {
      return {
        success: false,
        model: activeModel,
        data: '',
        error: 'Gemini API Client uninitialized.',
        latencyMs: Date.now() - start,
        tokensEstimated: 0
      };
    }

    try {
      const cleanData = imageBase64.replace(/^data:[^;]+;base64,/, '');
      const contents: any[] = [
        {
          role: 'user',
          parts: [
            { inlineData: { data: cleanData, mimeType } },
            { text: prompt || 'Analyze this system diagram or screenshot in Arabic with concise engineering precision.' }
          ]
        }
      ];

      const config: any = {
        temperature: options.temperature ?? 0.2
      };
      if (options.systemInstruction) {
        config.systemInstruction = { parts: [{ text: options.systemInstruction }] };
      }

      const response = await client.models.generateContent({
        model: activeModel,
        contents,
        config
      });

      const text = response.text || '';
      return {
        success: true,
        model: activeModel,
        data: text,
        latencyMs: Date.now() - start,
        tokensEstimated: Math.ceil((prompt.length + text.length) / 3.5),
        migratedFrom: wasMigrated ? original : undefined
      };
    } catch (err: any) {
      return {
        success: false,
        model: activeModel,
        data: '',
        error: `Vision diagnosis error: ${err.message || String(err)}`,
        latencyMs: Date.now() - start,
        tokensEstimated: 0
      };
    }
  }

  /**
   * Generates structured schema-validated JSON
   */
  public async generateStructuredJson<T>(
    prompt: string,
    schema: Record<string, any>,
    options: GeminiRequestOptions = {}
  ): Promise<GeminiResponseEnvelope<T | null>> {
    const start = Date.now();
    const { activeModel, wasMigrated, original } = sanitizeModelName(options.model || 'gemini-3.8-flash');
    const client = this.getClient();

    if (!client) {
      return {
        success: false,
        model: activeModel,
        data: null,
        error: 'Gemini API Client uninitialized.',
        latencyMs: Date.now() - start,
        tokensEstimated: 0
      };
    }

    try {
      const contents = [{ role: 'user', parts: [{ text: prompt }] }];
      const config: any = {
        temperature: options.temperature ?? 0.1,
        responseMimeType: 'application/json',
        responseSchema: schema
      };

      if (options.systemInstruction) {
        config.systemInstruction = { parts: [{ text: options.systemInstruction }] };
      }

      const response = await client.models.generateContent({
        model: activeModel,
        contents,
        config
      });

      const rawText = response.text || '{}';
      const parsed: T = JSON.parse(rawText);

      return {
        success: true,
        model: activeModel,
        data: parsed,
        latencyMs: Date.now() - start,
        tokensEstimated: Math.ceil((prompt.length + rawText.length) / 3.5),
        migratedFrom: wasMigrated ? original : undefined
      };
    } catch (err: any) {
      return {
        success: false,
        model: activeModel,
        data: null,
        error: `Structured JSON parse failure: ${err.message || String(err)}`,
        latencyMs: Date.now() - start,
        tokensEstimated: 0
      };
    }
  }
}

// Global Singleton Instance
export const sovereignGeminiService = new SovereignGeminiService();
