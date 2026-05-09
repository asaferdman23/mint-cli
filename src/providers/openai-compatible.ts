// src/providers/openai-compatible.ts
import OpenAI from 'openai';
import type {
  Provider,
  ProviderId,
  CompletionRequest,
  CompletionResponse,
  ModelId,
  AgentStreamChunk,
} from './types.js';
import { calculateCost } from './router.js';
import { config } from '../utils/config.js';
import {
  buildOpenAICompatibleAgentMessages,
  buildOpenAICompatibleToolDefinitions,
} from './openai-agent-format.js';

export interface OpenAICompatibleConfig {
  providerId: string;
  providerName: string;
  baseURL: string;
  /** Dot-path into config store, e.g. "providers.kimi" */
  apiKeyConfigPath: string;
  /** Map from our ModelId to the actual API model string */
  modelMap: Partial<Record<ModelId, string>>;
}

export class OpenAICompatibleProvider implements Provider {
  readonly id: ProviderId;
  readonly name: string;
  private client: OpenAI | null = null;
  private cfg: OpenAICompatibleConfig;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.providerId as ProviderId;
    this.name = cfg.providerName;
    this.cfg = cfg;
  }

  private getClient(): OpenAI {
    if (this.client) return this.client;
    const [section, key] = this.cfg.apiKeyConfigPath.split('.') as [string, string];
    const sectionData = config.get(section as never) as Record<string, string> | undefined;
    const apiKey = sectionData?.[key];
    if (!apiKey) {
      throw new Error(
        `${this.cfg.providerName} API key not configured. Run: axon config:set ${this.cfg.apiKeyConfigPath} <key>`
      );
    }
    this.client = new OpenAI({ apiKey, baseURL: this.cfg.baseURL });
    return this.client;
  }

  private resolveModel(modelId: ModelId): string {
    const mapped = this.cfg.modelMap[modelId];
    if (!mapped) {
      throw new Error(`Model ${modelId} not supported by ${this.cfg.providerName} provider`);
    }
    return mapped;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const client = this.getClient();
    const modelString = this.resolveModel(request.model);
    const startTime = Date.now();

    const messages = buildOAIMessages(request);
    const response = (await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      messages,
      stream: false,
      ...request.providerOptions as Record<string, unknown>,
    } as Parameters<typeof client.chat.completions.create>[0])) as OpenAI.Chat.ChatCompletion;

    const latency = Date.now() - startTime;
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const content = response.choices[0]?.message?.content ?? '';

    return {
      content,
      model: request.model,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      cost: calculateCost(request.model, inputTokens, outputTokens),
      latency,
    };
  }

  async *streamComplete(request: CompletionRequest): AsyncIterable<string> {
    const client = this.getClient();
    const modelString = this.resolveModel(request.model);
    const messages = buildOAIMessages(request);

    const stream = (await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      messages,
      stream: true,
      ...request.providerOptions as Record<string, unknown>,
    } as Parameters<typeof client.chat.completions.create>[0], { signal: request.signal })) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  async *streamAgent(request: CompletionRequest): AsyncIterable<AgentStreamChunk> {
    const client = this.getClient();
    const modelString = this.resolveModel(request.model);
    const messages = buildOpenAICompatibleAgentMessages(request);
    const tools = buildOpenAICompatibleToolDefinitions(request.tools);

    const stream = (await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 8192,
      temperature: request.temperature ?? 0.7,
      messages,
      tools,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      stream: true,
      ...request.providerOptions as Record<string, unknown>,
    } as Parameters<typeof client.chat.completions.create>[0], { signal: request.signal })) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;

    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) yield { type: 'text', text: delta.content };

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallAccumulators.has(idx)) {
            toolCallAccumulators.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' });
          }
          const acc = toolCallAccumulators.get(idx)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }

      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason === 'tool_calls' || finishReason === 'stop') {
        for (const [, acc] of toolCallAccumulators) {
          let parsedInput: Record<string, unknown> = {};
          try { parsedInput = JSON.parse(acc.arguments || '{}'); }
          catch { parsedInput = { raw: acc.arguments }; }
          yield { type: 'tool_call', toolName: acc.name, toolInput: parsedInput, toolCallId: acc.id };
        }
        toolCallAccumulators.clear();
      }
    }
  }
}

// ─── Message builders ────────────────────────────────────────────────────────

function buildOAIMessages(request: CompletionRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (request.systemPrompt) out.push({ role: 'system', content: request.systemPrompt });
  for (const m of request.messages) {
    out.push({ role: m.role as 'user' | 'assistant' | 'system', content: m.content });
  }
  return out;
}
