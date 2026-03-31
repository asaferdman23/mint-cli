// src/providers/openai-compatible.ts
import OpenAI from 'openai';
import type { Provider, CompletionRequest, CompletionResponse, ModelId, AgentStreamChunk } from './types.js';
import { calculateCost } from './router.js';
import { config } from '../utils/config.js';

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
  readonly id: string;
  readonly name: string;
  private client: OpenAI | null = null;
  private cfg: OpenAICompatibleConfig;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.providerId;
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
    const response = await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      messages,
    });

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

    const stream = await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      messages,
      stream: true,
    }, { signal: request.signal });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  async *streamAgent(request: CompletionRequest): AsyncIterable<AgentStreamChunk> {
    const client = this.getClient();
    const modelString = this.resolveModel(request.model);
    const messages = buildOAIAgentMessages(request);

    const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = request.tools?.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const stream = await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 8192,
      temperature: request.temperature ?? 0.7,
      messages,
      tools,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      stream: true,
    }, { signal: request.signal });

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

type AgentMessage = {
  role: string;
  content: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  toolResults?: Array<{ toolCallId: string; content: string }>;
};

function buildOAIAgentMessages(request: CompletionRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (request.systemPrompt) out.push({ role: 'system', content: request.systemPrompt });

  for (const m of request.messages) {
    const am = m as AgentMessage;
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (am.toolCalls && am.toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: am.toolCalls.map(tc => ({
            id: tc.id, type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    } else if (m.role === 'tool') {
      const results = am.toolResults;
      if (results) {
        for (const r of results) {
          out.push({ role: 'tool', content: r.content, tool_call_id: r.toolCallId });
        }
      }
    }
  }
  return out;
}
