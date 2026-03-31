import Anthropic from '@anthropic-ai/sdk';
import { Provider, CompletionRequest, CompletionResponse, ModelId, MODELS, AgentStreamChunk } from './types.js';
import { calculateCost } from './router.js';
import { config } from '../utils/config.js';

const MODEL_MAP: Partial<Record<ModelId, string>> = {
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
};

export class AnthropicProvider implements Provider {
  id = 'anthropic' as const;
  name = 'Anthropic';
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (this.client) return this.client;
    
    const apiKey = config.get('providers')?.anthropic;
    if (!apiKey) {
      throw new Error('Anthropic API key not configured. Run: axon config:set providers.anthropic <key>');
    }
    
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const client = this.getClient();
    const modelString = MODEL_MAP[request.model];
    
    if (!modelString) {
      throw new Error(`Model ${request.model} not supported by Anthropic provider`);
    }

    const startTime = Date.now();

    // Extract system message if present
    const systemMessage = request.messages.find(m => m.role === 'system');
    const otherMessages = request.messages.filter(m => m.role !== 'system');

    const response = await client.messages.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      system: systemMessage?.content,
      messages: otherMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const latency = Date.now() - startTime;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n');

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
      throw new Error(`Model ${request.model} not supported by Anthropic provider`);
    }

    const systemMessage = request.messages.find(m => m.role === 'system');
    const otherMessages = request.messages.filter(m => m.role !== 'system');

    const stream = client.messages.stream({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      system: systemMessage?.content,
      messages: otherMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    }, { signal: request.signal });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string };
        if (delta.type === 'text_delta' && delta.text) {
          yield delta.text;
        }
      }
    }
  }

  async *streamAgent(request: CompletionRequest): AsyncIterable<AgentStreamChunk> {
    const client = this.getClient();
    const modelString = MODEL_MAP[request.model];

    if (!modelString) {
      throw new Error(`Model ${request.model} not supported by Anthropic provider`);
    }

    const systemPrompt = request.systemPrompt ??
      request.messages.find(m => m.role === 'system')?.content;
    const otherMessages = request.messages.filter(m => m.role !== 'system');

    const anthropicMessages: Anthropic.MessageParam[] = otherMessages.map(m => {
      if (m.role === 'user') {
        return { role: 'user' as const, content: m.content };
      }
      const am = m as typeof m & { toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }> };
      if (am.toolCalls && am.toolCalls.length > 0) {
        const content: Anthropic.ContentBlock[] = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content } as Anthropic.TextBlock);
        }
        for (const tc of am.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          } as Anthropic.ToolUseBlock);
        }
        return { role: 'assistant' as const, content };
      }
      if (m.role === 'tool') {
        const tm = m as unknown as { toolResults: Array<{ toolCallId: string; content: string }> };
        return {
          role: 'user' as const,
          content: tm.toolResults.map(r => ({
            type: 'tool_result' as const,
            tool_use_id: r.toolCallId,
            content: r.content,
          })),
        };
      }
      return { role: 'assistant' as const, content: m.content };
    });

    const tools: Anthropic.Tool[] | undefined = request.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    const stream = client.messages.stream({
      model: modelString,
      max_tokens: request.maxTokens ?? 8192,
      system: systemPrompt,
      messages: anthropicMessages,
      tools,
    }, { signal: request.signal });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string };
        if (delta.type === 'text_delta' && delta.text) {
          yield { type: 'text', text: delta.text };
        }
      } else if (event.type === 'content_block_start') {
        // Tool use blocks are emitted when the content block starts
        const block = (event as unknown as { content_block?: Anthropic.ContentBlock }).content_block;
        if (block && block.type === 'tool_use') {
          yield {
            type: 'tool_call',
            toolName: block.name,
            toolInput: block.input as Record<string, unknown>,
            toolCallId: block.id,
          };
        }
      }
    }
  }
}

export const anthropicProvider = new AnthropicProvider();
