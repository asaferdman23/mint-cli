import OpenAI from 'openai';
import { Provider, CompletionRequest, CompletionResponse, ModelId, AgentStreamChunk } from './types.js';
import { calculateCost } from './router.js';
import { config } from '../utils/config.js';

const MODEL_MAP: Partial<Record<ModelId, string>> = {
  'deepseek-v3': 'deepseek-chat',
  'deepseek-coder': 'deepseek-coder',
};

export class DeepSeekProvider implements Provider {
  id = 'deepseek' as const;
  name = 'DeepSeek';
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (this.client) return this.client;
    
    const apiKey = config.get('providers')?.deepseek;
    if (!apiKey) {
      throw new Error('DeepSeek API key not configured. Run: axon config:set providers.deepseek <key>');
    }
    
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
    });
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const client = this.getClient();
    const modelString = MODEL_MAP[request.model];
    
    if (!modelString) {
      throw new Error(`Model ${request.model} not supported by DeepSeek provider`);
    }

    const startTime = Date.now();

    const response = await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })) as OpenAI.Chat.ChatCompletionMessageParam[],
    });

    const latency = Date.now() - startTime;
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const content = response.choices[0]?.message?.content ?? '';

    return {
      content,
      model: request.model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost: calculateCost(request.model, inputTokens, outputTokens),
      latency,
    };
  }

  async *streamComplete(request: CompletionRequest): AsyncIterable<string> {
    const client = this.getClient();
    const modelString = MODEL_MAP[request.model];

    if (!modelString) {
      throw new Error(`Model ${request.model} not supported by DeepSeek provider`);
    }

    const stream = await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })) as OpenAI.Chat.ChatCompletionMessageParam[],
      stream: true,
    }, { signal: request.signal });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  async *streamAgent(request: CompletionRequest): AsyncIterable<AgentStreamChunk> {
    const client = this.getClient();
    const modelString = MODEL_MAP[request.model];

    if (!modelString) {
      throw new Error(`Model ${request.model} not supported by DeepSeek provider`);
    }

    // Build messages array, injecting systemPrompt as system message if provided
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    for (const m of request.messages) {
      if (m.role === 'system') {
        messages.push({ role: 'system', content: m.content });
      } else if (m.role === 'user') {
        messages.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        const am = m as typeof m & { toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>; toolResults?: Array<{ toolCallId: string; content: string }> };
        if (am.toolCalls && am.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: m.content || null,
            tool_calls: am.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.input) },
            })),
          });
        } else {
          messages.push({ role: 'assistant', content: m.content });
        }
      } else if (m.role === 'tool') {
        const tm = m as typeof m & { toolResults?: Array<{ toolCallId: string; content: string }> };
        const results = (tm as unknown as { toolResults: Array<{ toolCallId: string; content: string }> }).toolResults;
        if (results) {
          for (const r of results) {
            messages.push({ role: 'tool', content: r.content, tool_call_id: r.toolCallId });
          }
        } else {
          // Skip tool-role messages without toolResults — invalid API payload
        }
      }
    }

    const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = request.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
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

    // Collect streaming tool call fragments
    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Text content
      if (delta.content) {
        yield { type: 'text', text: delta.content };
      }

      // Tool call streaming
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

      // When stream finishes, emit accumulated tool calls
      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason === 'tool_calls' || finishReason === 'stop') {
        for (const [, acc] of toolCallAccumulators) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(acc.arguments || '{}');
          } catch {
            parsedInput = { raw: acc.arguments };
          }
          yield {
            type: 'tool_call',
            toolName: acc.name,
            toolInput: parsedInput,
            toolCallId: acc.id,
          };
        }
        toolCallAccumulators.clear();
      }
    }
  }
}

export const deepseekProvider = new DeepSeekProvider();
