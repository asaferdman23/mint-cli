import { Provider, ModelId, MODELS, CompletionRequest, CompletionResponse, AgentStreamChunk } from './types.js';
import { config } from '../utils/config.js';
import { anthropicProvider } from './anthropic.js';
import { deepseekProvider } from './deepseek.js';
import { kimiProvider } from './kimi.js';
import { grokProvider } from './grok.js';
import { groqProvider } from './groq.js';
import { mistralProvider } from './mistral.js';
import { qwenProvider } from './qwen.js';
import { geminiProvider } from './gemini.js';
import { gatewayProvider } from './gateway.js';
import { isRecording, isReplaying, recordStream, replayStream } from './record-replay.js';

// Per-model fallback chain — used by completeWithFallback / streamAgent when
// a provider returns a retryable error. Keep this in sync with MODELS.
const FALLBACK_CHAIN: Partial<Record<ModelId, ModelId[]>> = {
  'mistral-small': ['groq-llama-70b', 'deepseek-v3'],
  'deepseek-v3': ['groq-llama-70b', 'mistral-small'],
  'deepseek-coder': ['deepseek-v3', 'groq-llama-70b'],
  'grok-4-beta': ['grok-4.1-fast', 'deepseek-v3'],
  'grok-4.1-fast': ['deepseek-v3', 'groq-llama-70b'],
  'grok-3': ['grok-4-beta', 'deepseek-v3'],
  'grok-3-fast': ['grok-3', 'deepseek-v3'],
  'grok-3-mini-fast': ['mistral-small', 'deepseek-v3'],
  'groq-llama-70b': ['deepseek-v3', 'mistral-small'],
  'groq-llama-8b': ['mistral-small', 'groq-llama-70b'],
  'groq-gpt-oss-120b': ['deepseek-v3', 'groq-llama-70b'],
  'groq-gpt-oss-20b': ['mistral-small', 'deepseek-v3'],
  'claude-sonnet-4': ['deepseek-v3', 'groq-llama-70b'],
  'claude-opus-4': ['claude-sonnet-4', 'deepseek-v3'],
  'gemini-2-flash': ['mistral-small', 'deepseek-v3'],
  'gemini-2-pro': ['gemini-2-flash', 'deepseek-v3'],
  'gemini-1-5-flash': ['mistral-small', 'deepseek-v3'],
  'gemini-1-5-pro': ['gemini-2-pro', 'deepseek-v3'],
  'gpt-4o': ['deepseek-v3', 'groq-llama-70b'],
  'qwen-coder-32b': ['deepseek-v3', 'groq-llama-70b'],
  'kimi-k2': ['deepseek-v3', 'groq-llama-70b'],
  'moonshot-v1-8k': ['mistral-small', 'deepseek-v3'],
  'moonshot-v1-32k': ['moonshot-v1-8k', 'deepseek-v3'],
};

function getFallbacks(model: ModelId): ModelId[] {
  return FALLBACK_CHAIN[model] ?? ['deepseek-v3', 'groq-llama-70b'];
}

// Registry of all providers — typed as Provider so the discriminated union of
// provider instances doesn't force TS to narrow to one concrete class.
const providers: Map<string, Provider> = new Map<string, Provider>([
  ['anthropic', anthropicProvider],
  ['deepseek', deepseekProvider],
  ['kimi', kimiProvider],
  ['grok', grokProvider],
  ['groq', groqProvider],
  ['mistral', mistralProvider],
  ['openrouter', qwenProvider],
  ['gemini', geminiProvider],
]);

export function getProvider(modelId: ModelId): Provider {
  // If a direct BYOK key is configured for this model's provider, use it directly.
  // Otherwise fall back to the Mint Gateway.
  const modelInfo = MODELS[modelId];
  if (modelInfo) {
    const directProvider = providers.get(modelInfo.provider);
    if (directProvider && hasProviderKey(modelInfo.provider)) {
      return directProvider;
    }
  }
  return gatewayProvider;
}

function hasProviderKey(providerId: string): boolean {
  try {
    const providerKeys = config.get('providers') as Record<string, string> | undefined;
    return !!providerKeys?.[providerId];
  } catch {
    return false;
  }
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

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes('429') || err.message.includes('500') ||
    err.message.includes('timeout') || err.message.includes('ECONNREFUSED') ||
    err.message.includes('402') || /insufficient balance/i.test(err.message);
}

export async function completeWithFallback(request: CompletionRequest): Promise<CompletionResponse> {
  const models: ModelId[] = [request.model, ...getFallbacks(request.model)];

  for (const model of models) {
    try {
      const provider = getProvider(model);
      const result = await provider.complete({ ...request, model });
      return result;
    } catch (err) {
      if (!isRetryableError(err) || model === models[models.length - 1]) {
        throw err;
      }
      console.error(`[fallback] ${model} failed, trying next...`);
    }
  }
  throw new Error('All providers failed');
}

export async function* streamCompleteWithFallback(request: CompletionRequest): AsyncIterable<string> {
  const models: ModelId[] = [request.model, ...getFallbacks(request.model)];

  for (const model of models) {
    try {
      const provider = getProvider(model);
      if (!provider.streamComplete) {
        throw new Error(`Provider ${provider.id} does not support streaming`);
      }
      yield* provider.streamComplete({ ...request, model });
      return; // success — stop trying fallbacks
    } catch (err) {
      if (!isRetryableError(err) || model === models[models.length - 1]) {
        throw err;
      }
      console.error(`[fallback] ${model} failed, trying next...`);
    }
  }
  throw new Error('All providers failed');
}

export async function* streamAgent(request: CompletionRequest): AsyncIterable<AgentStreamChunk> {
  // Replay short-circuits everything: tests pin behaviour without ever hitting
  // a provider. Recording wraps the live stream below.
  if (isReplaying()) {
    yield* replayStream(request);
    return;
  }

  // Agent streaming requires tool-call support (OpenAI function calling format).
  // The gateway doesn't support this — only direct providers do.
  // Try: 1) direct provider for requested model, 2) any direct provider with a key, 3) error.

  type AgentProvider = Provider & { streamAgent: (r: CompletionRequest) => AsyncIterable<AgentStreamChunk> };

  const hasAgent = (p: Provider): p is AgentProvider =>
    typeof (p as AgentProvider).streamAgent === 'function';

  const candidates: Array<{ label: string; request: CompletionRequest; provider: AgentProvider }> = [];

  const pushCandidate = (label: string, model: ModelId, provider: Provider | undefined) => {
    if (!provider || !hasAgent(provider)) return;
    if (candidates.some((candidate) => candidate.label === label)) return;
    candidates.push({
      label,
      request: { ...request, model },
      provider,
    });
  };

  // Try the requested model's direct provider first
  const modelInfo = MODELS[request.model];
  if (modelInfo) {
    const directProvider = providers.get(modelInfo.provider);
    if (directProvider && hasProviderKey(modelInfo.provider) && hasAgent(directProvider)) {
      pushCandidate(`${modelInfo.provider}/${request.model}`, request.model, directProvider);
    }
  }

  // Try fallback models that have direct keys
  const fallbacks = getFallbacks(request.model);
  for (const fallbackModel of fallbacks) {
    const fbInfo = MODELS[fallbackModel];
    if (!fbInfo) continue;
    const fbProvider = providers.get(fbInfo.provider);
    if (fbProvider && hasProviderKey(fbInfo.provider) && hasAgent(fbProvider)) {
      pushCandidate(`${fbInfo.provider}/${fallbackModel}`, fallbackModel, fbProvider);
    }
  }

  // Last resort: try any provider that has a key and supports agent streaming
  for (const [providerId, provider] of providers) {
    if (hasProviderKey(providerId) && hasAgent(provider)) {
      // Find any model this provider supports
      const anyModel = Object.entries(MODELS).find(([, info]) => info.provider === providerId);
      if (anyModel) {
        pushCandidate(`${providerId}/${anyModel[0]}`, anyModel[0] as ModelId, provider);
      }
    }
  }

  if (candidates.length > 0) {
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index]!;
      let emittedAny = false;

      try {
        if (index > 0) {
          console.error(`[agent] Falling back to ${candidate.label}`);
        }

        const live = candidate.provider.streamAgent(candidate.request);
        const stream = isRecording() ? recordStream(candidate.request, live) : live;
        for await (const chunk of stream) {
          emittedAny = true;
          yield chunk;
        }
        return;
      } catch (err) {
        const isLast = index === candidates.length - 1;
        if (emittedAny || !isRetryableError(err) || isLast) {
          throw err;
        }
        console.error(`[agent] ${candidate.label} failed, trying next...`);
      }
    }
  }

  // Fall back to the gateway — it supports agent streaming via /v1/agent
  if (hasAgent(gatewayProvider)) {
    // silent — gateway fallback is expected behavior
    const live = gatewayProvider.streamAgent(request);
    const stream = isRecording() ? recordStream(request, live) : live;
    yield* stream;
    return;
  }

  throw new Error(
    'No provider with a direct API key supports agent mode. ' +
    'Add a key with: mint config:set providers.deepseek <key>'
  );
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
