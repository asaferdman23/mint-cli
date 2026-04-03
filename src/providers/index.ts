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

// Registry of all providers
const providers: Map<string, Provider> = new Map([
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
  const { getFallbacks } = await import('../agents/model-selector.js');
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
  const { getFallbacks } = await import('../agents/model-selector.js');
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
  const { getFallbacks } = await import('../agents/model-selector.js');
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

        for await (const chunk of candidate.provider.streamAgent(candidate.request)) {
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
    console.error(`[agent] No direct keys found, using Mint Gateway`);
    yield* gatewayProvider.streamAgent(request);
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
