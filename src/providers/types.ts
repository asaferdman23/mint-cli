/**
 * Enterprise model fleet (2026-05-12+):
 * Removed DeepSeek, Kimi/Moonshot, Qwen for Chinese-origin compliance.
 * Allowed providers are US/EU only.
 */
export type ModelId =
  | 'claude-sonnet-4'
  | 'claude-opus-4'
  | 'gemini-2-flash'
  | 'gemini-2-pro'
  | 'gpt-4o'
  | 'grok-3'
  | 'grok-3-fast'
  | 'grok-3-mini-fast'
  | 'gemini-1-5-flash'
  | 'gemini-1-5-pro'
  | 'groq-llama-70b'
  | 'groq-llama-8b'
  | 'groq-gpt-oss-120b'
  | 'groq-gpt-oss-20b'
  | 'grok-4-beta'
  | 'grok-4.1-fast'
  | 'mistral-small';

export type ProviderId = 'anthropic' | 'gemini' | 'openai' | 'grok' | 'groq' | 'mistral';

export interface ModelInfo {
  id: ModelId;
  provider: ProviderId;
  name: string;
  inputPrice: number;  // per 1M tokens
  outputPrice: number; // per 1M tokens
  contextWindow: number;
  capabilities: {
    coding: number;     // 1-10
    reasoning: number;  // 1-10
    speed: number;      // 1-10
  };
}

export const MODELS: Record<ModelId, ModelInfo> = {
  'claude-sonnet-4': {
    id: 'claude-sonnet-4',
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    inputPrice: 3.0,
    outputPrice: 15.0,
    contextWindow: 200000,
    capabilities: { coding: 9, reasoning: 9, speed: 7 },
  },
  'claude-opus-4': {
    id: 'claude-opus-4',
    provider: 'anthropic',
    name: 'Claude Opus 4',
    inputPrice: 15.0,
    outputPrice: 75.0,
    contextWindow: 200000,
    capabilities: { coding: 10, reasoning: 10, speed: 5 },
  },
  'gemini-2-flash': {
    id: 'gemini-2-flash',
    provider: 'gemini',
    name: 'Gemini 2.0 Flash',
    inputPrice: 0.10,
    outputPrice: 0.40,
    contextWindow: 1000000,
    capabilities: { coding: 7, reasoning: 7, speed: 10 },
  },
  'gemini-2-pro': {
    id: 'gemini-2-pro',
    provider: 'gemini',
    name: 'Gemini 2.0 Pro',
    inputPrice: 1.25,
    outputPrice: 5.0,
    contextWindow: 1000000,
    capabilities: { coding: 8, reasoning: 9, speed: 7 },
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    inputPrice: 2.5,
    outputPrice: 10.0,
    contextWindow: 128000,
    capabilities: { coding: 8, reasoning: 8, speed: 8 },
  },
  'grok-3': {
    id: 'grok-3',
    provider: 'grok',
    name: 'Grok 3',
    inputPrice: 3.0,
    outputPrice: 15.0,
    contextWindow: 131072,
    capabilities: { coding: 9, reasoning: 9, speed: 7 },
  },
  'grok-3-fast': {
    id: 'grok-3-fast',
    provider: 'grok',
    name: 'Grok 3 Fast',
    inputPrice: 5.0,
    outputPrice: 25.0,
    contextWindow: 131072,
    capabilities: { coding: 8, reasoning: 8, speed: 10 },
  },
  'grok-3-mini-fast': {
    id: 'grok-3-mini-fast',
    provider: 'grok',
    name: 'Grok 3 Mini Fast',
    inputPrice: 0.60,
    outputPrice: 4.0,
    contextWindow: 131072,
    capabilities: { coding: 7, reasoning: 8, speed: 10 },
  },
  'gemini-1-5-flash': {
    id: 'gemini-1-5-flash',
    provider: 'gemini',
    name: 'Gemini 1.5 Flash',
    inputPrice: 0.075,
    outputPrice: 0.30,
    contextWindow: 1000000,
    capabilities: { coding: 7, reasoning: 7, speed: 10 },
  },
  'gemini-1-5-pro': {
    id: 'gemini-1-5-pro',
    provider: 'gemini',
    name: 'Gemini 1.5 Pro',
    inputPrice: 1.25,
    outputPrice: 5.0,
    contextWindow: 2000000,
    capabilities: { coding: 8, reasoning: 9, speed: 7 },
  },
  'groq-llama-70b': {
    id: 'groq-llama-70b',
    provider: 'groq',
    name: 'Llama 3.3 70B (Groq)',
    inputPrice: 0.59,
    outputPrice: 0.79,
    contextWindow: 128000,
    capabilities: { coding: 8, reasoning: 7, speed: 10 },
  },
  'groq-llama-8b': {
    id: 'groq-llama-8b',
    provider: 'groq',
    name: 'Llama 3.1 8B (Groq)',
    inputPrice: 0.05,
    outputPrice: 0.08,
    contextWindow: 128000,
    capabilities: { coding: 6, reasoning: 6, speed: 10 },
  },
  'groq-gpt-oss-120b': {
    id: 'groq-gpt-oss-120b',
    provider: 'groq',
    name: 'GPT OSS 120B (Groq)',
    inputPrice: 0.15,
    outputPrice: 0.60,
    contextWindow: 128000,
    capabilities: { coding: 8, reasoning: 8, speed: 9 },
  },
  'groq-gpt-oss-20b': {
    id: 'groq-gpt-oss-20b',
    provider: 'groq',
    name: 'GPT OSS 20B (Groq)',
    inputPrice: 0.075,
    outputPrice: 0.30,
    contextWindow: 128000,
    capabilities: { coding: 7, reasoning: 7, speed: 10 },
  },
  'grok-4-beta': {
    id: 'grok-4-beta',
    provider: 'grok',
    name: 'Grok 4.2 Beta',
    inputPrice: 2.0,
    outputPrice: 6.0,
    contextWindow: 131072,
    capabilities: { coding: 9, reasoning: 10, speed: 7 },
  },
  'grok-4.1-fast': {
    id: 'grok-4.1-fast',
    provider: 'grok',
    name: 'Grok 4.1 Fast (Reasoning)',
    inputPrice: 0.20,
    outputPrice: 0.50,
    contextWindow: 131072,
    capabilities: { coding: 8, reasoning: 9, speed: 10 },
  },
  'mistral-small': {
    id: 'mistral-small',
    provider: 'mistral',
    name: 'Mistral Small 4',
    inputPrice: 0.15,
    outputPrice: 0.60,
    contextWindow: 32768,
    capabilities: { coding: 7, reasoning: 6, speed: 10 },
  },
};

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /**
   * Marks this message as a cache breakpoint for prompt-caching providers.
   * Today only the compaction summary sets this (see brain/compact.ts).
   * Anthropic translates it to a `cache_control: ephemeral` marker on the
   * message's content block so the historical context cached after the
   * summary survives across turns.
   */
  cacheBoundary?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface AgentStreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'usage';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  /** Final usage payload — emitted once per stream by providers that
   *  expose token counts (Anthropic does, others may not). */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

export interface CompletionRequest {
  model: ModelId;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  sessionId?: string;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  /** Provider-specific options (e.g. Grok reasoning toggle, Mistral reasoning_effort). */
  providerOptions?: Record<string, unknown>;
}

export interface CompletionResponse {
  content: string;
  model: ModelId;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** Tokens billed at the cache-write tier (~125% of fresh on Anthropic). */
    cacheCreationInputTokens?: number;
    /** Tokens billed at the cache-read tier (~10% of fresh on Anthropic). */
    cacheReadInputTokens?: number;
  };
  cost: {
    input: number;
    output: number;
    total: number;
  };
  latency: number; // ms
}

export interface Provider {
  id: ProviderId;
  name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  streamComplete?(request: CompletionRequest): AsyncIterable<string>;
  streamAgent?(request: CompletionRequest): AsyncIterable<AgentStreamChunk>;
}
