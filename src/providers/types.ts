export type ModelId =
  | 'deepseek-v3'
  | 'deepseek-coder'
  | 'claude-sonnet-4'
  | 'claude-opus-4'
  | 'gemini-2-flash'
  | 'gemini-2-pro'
  | 'gpt-4o'
  | 'qwen-coder-32b'
  | 'kimi-k2'
  | 'moonshot-v1-8k'
  | 'moonshot-v1-32k'
  | 'grok-3'
  | 'grok-3-fast'
  | 'grok-3-mini-fast'
  | 'gemini-1-5-flash'
  | 'gemini-1-5-pro'
  | 'groq-llama-70b'
  | 'groq-llama-8b'
  | 'groq-gpt-oss-120b'
  | 'groq-gpt-oss-20b';

export type ProviderId = 'anthropic' | 'deepseek' | 'openrouter' | 'gemini' | 'openai' | 'kimi' | 'grok' | 'groq';

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
  'deepseek-v3': {
    id: 'deepseek-v3',
    provider: 'deepseek',
    name: 'DeepSeek V3',
    inputPrice: 0.27,
    outputPrice: 1.10,
    contextWindow: 128000,
    capabilities: { coding: 9, reasoning: 8, speed: 8 },
  },
  'deepseek-coder': {
    id: 'deepseek-coder',
    provider: 'deepseek',
    name: 'DeepSeek Coder',
    inputPrice: 0.14,
    outputPrice: 0.28,
    contextWindow: 128000,
    capabilities: { coding: 9, reasoning: 7, speed: 9 },
  },
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
    inputPrice: 0.075,
    outputPrice: 0.30,
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
  'qwen-coder-32b': {
    id: 'qwen-coder-32b',
    provider: 'openrouter',
    name: 'Qwen 2.5 Coder 32B',
    inputPrice: 0.40,
    outputPrice: 1.20,
    contextWindow: 128000,
    capabilities: { coding: 8, reasoning: 7, speed: 8 },
  },
  'kimi-k2': {
    id: 'kimi-k2',
    provider: 'kimi',
    name: 'Kimi K2',
    inputPrice: 0.60,
    outputPrice: 2.50,
    contextWindow: 128000,
    capabilities: { coding: 8, reasoning: 8, speed: 9 },
  },
  'moonshot-v1-8k': {
    id: 'moonshot-v1-8k',
    provider: 'kimi',
    name: 'Moonshot v1 8k',
    inputPrice: 0.12,
    outputPrice: 0.12,
    contextWindow: 8000,
    capabilities: { coding: 7, reasoning: 7, speed: 10 },
  },
  'moonshot-v1-32k': {
    id: 'moonshot-v1-32k',
    provider: 'kimi',
    name: 'Moonshot v1 32k',
    inputPrice: 0.24,
    outputPrice: 0.24,
    contextWindow: 32000,
    capabilities: { coding: 7, reasoning: 7, speed: 10 },
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
};

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
  type: 'text' | 'tool_call' | 'tool_result';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
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
}

export interface CompletionResponse {
  content: string;
  model: ModelId;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
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
}
