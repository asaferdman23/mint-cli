import { Provider, ModelId, MODELS, CompletionRequest, CompletionResponse, AgentStreamChunk } from './types.js';
import { anthropicProvider } from './anthropic.js';
import { deepseekProvider } from './deepseek.js';
import { kimiProvider } from './kimi.js';
import { grokProvider } from './grok.js';
import { groqProvider } from './groq.js';
import { qwenProvider } from './qwen.js';
import { geminiProvider } from './gemini.js';

// Registry of all providers
const providers: Map<string, Provider> = new Map([
  ['anthropic', anthropicProvider],
  ['deepseek', deepseekProvider],
  ['kimi', kimiProvider],
  ['grok', grokProvider],
  ['groq', groqProvider],
  ['openrouter', qwenProvider],
  ['gemini', geminiProvider],
]);

export function getProvider(modelId: ModelId): Provider {
  const modelInfo = MODELS[modelId];
  if (!modelInfo) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const provider = providers.get(modelInfo.provider);
  if (!provider) {
    throw new Error(`Provider ${modelInfo.provider} not available`);
  }

  return provider;
}

export async function complete(request: CompletionRequest): Promise<CompletionResponse> {
  const provider = getProvider(request.model);
  return provider.complete(request);
}

export async function* streamComplete(request: CompletionRequest): AsyncIterable<string> {
  const provider = getProvider(request.model);
  if (!provider.streamComplete) {
    throw new Error(`Provider ${provider.id} does not support streaming`);
  }
  yield* provider.streamComplete(request);
}

export async function* streamAgent(request: CompletionRequest): AsyncIterable<AgentStreamChunk> {
  const provider = getProvider(request.model);
  const p = provider as Provider & { streamAgent?: (r: CompletionRequest) => AsyncIterable<AgentStreamChunk> };
  if (!p.streamAgent) {
    throw new Error(`Provider ${provider.id} does not support agent streaming`);
  }
  yield* p.streamAgent(request);
}

export function isModelAvailable(modelId: ModelId): boolean {
  const modelInfo = MODELS[modelId];
  return modelInfo ? providers.has(modelInfo.provider) : false;
}

export function listProviders(): Provider[] {
  return Array.from(providers.values());
}

export function listModels(): Array<{ id: ModelId; provider: string; name: string }> {
  return Object.entries(MODELS).map(([id, info]) => ({
    id: id as ModelId,
    provider: info.provider,
    name: info.name,
  }));
}
