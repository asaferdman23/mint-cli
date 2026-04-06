/**
 * DeepSeek V3.2 LLM client — supports both chat and reasoner modes.
 *
 * Uses OpenAI-compatible API at https://api.deepseek.com
 *
 * Models:
 * - deepseek-chat: Non-thinking mode, fast for simple/moderate tasks
 * - deepseek-reasoner: Thinking mode, better reasoning for complex tasks
 *
 * IMPORTANT quirks for deepseek-reasoner:
 * - Returns reasoning_content AND content in the response
 * - You MUST NOT send reasoning_content back in subsequent messages
 * - temperature/top_p/penalties are accepted but IGNORED by reasoner
 */
import OpenAI from 'openai';
import { config } from '../utils/config.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DeepSeekModelId = 'deepseek-chat' | 'deepseek-reasoner';

export interface LLMResponse {
  content: string;
  reasoningContent?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cost: number;
  durationMs: number;
  model: DeepSeekModelId;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  model?: DeepSeekModelId;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface StreamChunk {
  type: 'text' | 'reasoning' | 'done';
  text?: string;
  response?: LLMResponse;
}

// ─── Pricing (per 1M tokens) ────────────────────────────────────────────────

const PRICING = {
  'deepseek-chat': {
    input: 0.26,
    inputCacheHit: 0.07,
    output: 0.38,
  },
  'deepseek-reasoner': {
    input: 0.26,
    inputCacheHit: 0.07,
    output: 0.38,
    thinking: 0.86,
  },
} as const;

// ─── Connection mode ────────────────────────────────────────────────────────

type ConnectionMode = 'direct' | 'gateway';

function detectMode(): ConnectionMode {
  // Direct mode: user has their own DeepSeek key
  if (process.env.DEEPSEEK_API_KEY) return 'direct';
  const providers = config.get('providers') as Record<string, string> | undefined;
  if (providers?.deepseek) return 'direct';

  // Gateway mode: user is logged in → route through Railway gateway
  return 'gateway';
}

function getGatewayUrl(): string {
  return process.env.MINT_GATEWAY_URL ?? config.getGatewayUrl();
}

function getGatewayToken(): string {
  const gatewayToken = config.get('gatewayToken') as string | undefined;
  if (gatewayToken) return gatewayToken;

  const userToken = config.get('apiKey') as string | undefined;
  if (userToken) return userToken;

  const envToken = process.env.MINT_GATEWAY_TOKEN ?? process.env.MINT_API_TOKEN ?? '';
  if (envToken) return envToken;

  throw new Error(
    'Not authenticated. Run `mint login` or `mint signup`, or set DEEPSEEK_API_KEY for direct mode.'
  );
}

// ─── Direct client (OpenAI SDK → api.deepseek.com) ─────────────────────────

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;

  const envKey = process.env.DEEPSEEK_API_KEY;
  const providers = config.get('providers') as Record<string, string> | undefined;
  const apiKey = envKey || providers?.deepseek;

  if (!apiKey) {
    throw new Error('DeepSeek API key not found for direct mode.');
  }

  client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com',
  });
  return client;
}

// ─── Gateway call (SSE → your Railway server) ──────────────────────────────

async function callViaGateway(
  systemPrompt: string,
  userMessage: string,
  options: CallOptions = {},
): Promise<LLMResponse> {
  const startTime = Date.now();
  const gatewayUrl = getGatewayUrl();
  const token = getGatewayToken();

  const response = await fetch(`${gatewayUrl}/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: userMessage },
      ],
      system: systemPrompt,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new Error('Not authenticated. Run `mint login` or `mint signup`.');
    }
    throw new Error(`Gateway error ${response.status}: ${body}`);
  }

  // Parse SSE stream
  let fullContent = '';
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) fullContent += parsed.text;
          if (parsed.error) throw new Error(parsed.error);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const inputTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
  const outputTokens = Math.ceil(fullContent.length / 4);

  return {
    content: fullContent,
    inputTokens,
    outputTokens,
    cost: calculateCost('deepseek-chat', inputTokens, outputTokens),
    durationMs,
    model: 'deepseek-chat',
  };
}

async function* streamViaGateway(
  systemPrompt: string,
  userMessage: string,
  options: CallOptions = {},
): AsyncGenerator<StreamChunk> {
  const startTime = Date.now();
  const gatewayUrl = getGatewayUrl();
  const token = getGatewayToken();

  const response = await fetch(`${gatewayUrl}/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new Error('Not authenticated. Run `mint login` or `mint signup`.');
    }
    throw new Error(`Gateway error ${response.status}: ${body}`);
  }

  let fullContent = '';
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) {
            fullContent += parsed.text;
            yield { type: 'text', text: parsed.text };
          }
          if (parsed.error) throw new Error(parsed.error);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const inputTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
  const outputTokens = Math.ceil(fullContent.length / 4);

  yield {
    type: 'done',
    response: {
      content: fullContent,
      inputTokens,
      outputTokens,
      cost: calculateCost('deepseek-chat', inputTokens, outputTokens),
      durationMs,
      model: 'deepseek-chat',
    },
  };
}

function calculateCost(
  model: DeepSeekModelId,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number = 0,
): number {
  const pricing = PRICING[model];
  let cost = (inputTokens / 1_000_000) * pricing.input;
  cost += (outputTokens / 1_000_000) * pricing.output;
  if (model === 'deepseek-reasoner' && reasoningTokens > 0) {
    cost += (reasoningTokens / 1_000_000) * PRICING['deepseek-reasoner'].thinking;
  }
  return cost;
}

// ─── Non-streaming call ─────────────────────────────────────────────────────

export async function callDeepSeek(
  systemPrompt: string,
  userMessage: string,
  options: CallOptions = {},
): Promise<LLMResponse> {
  // Route through gateway if no local DeepSeek key
  if (detectMode() === 'gateway') {
    return callViaGateway(systemPrompt, userMessage, options);
  }

  const model = options.model ?? 'deepseek-chat';
  const client = getClient();
  const startTime = Date.now();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: options.maxTokens ?? 4096,
    ...(model === 'deepseek-chat' ? { temperature: options.temperature ?? 0 } : {}),
  }, { signal: options.signal });

  const durationMs = Date.now() - startTime;
  const choice = response.choices[0];
  const content = choice?.message?.content ?? '';

  // DeepSeek reasoner returns reasoning_content on the message object
  const reasoningContent = (choice?.message as unknown as Record<string, unknown>)?.reasoning_content as string | undefined;

  const usage = response.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  // Reasoning tokens are in completion_tokens_details for reasoner
  const reasoningTokens = (usage as unknown as {
    completion_tokens_details?: { reasoning_tokens?: number };
  })?.completion_tokens_details?.reasoning_tokens ?? 0;

  return {
    content,
    reasoningContent: reasoningContent || undefined,
    inputTokens,
    outputTokens,
    reasoningTokens: reasoningTokens || undefined,
    cost: calculateCost(model, inputTokens, outputTokens, reasoningTokens),
    durationMs,
    model,
  };
}

// ─── Streaming call ─────────────────────────────────────────────────────────

export async function* streamDeepSeek(
  systemPrompt: string,
  userMessage: string,
  options: CallOptions = {},
): AsyncGenerator<StreamChunk> {
  // Route through gateway if no local DeepSeek key
  if (detectMode() === 'gateway') {
    yield* streamViaGateway(systemPrompt, userMessage, options);
    return;
  }

  const model = options.model ?? 'deepseek-chat';
  const client = getClient();
  const startTime = Date.now();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const stream = await client.chat.completions.create({
    model,
    messages,
    max_tokens: options.maxTokens ?? 4096,
    ...(model === 'deepseek-chat' ? { temperature: options.temperature ?? 0 } : {}),
    stream: true,
  }, { signal: options.signal });

  let fullContent = '';
  let fullReasoning = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    // Regular content
    if (delta.content) {
      fullContent += delta.content;
      yield { type: 'text', text: delta.content };
    }

    // Reasoning content (reasoner model)
    const reasoningDelta = (delta as unknown as Record<string, unknown>)?.reasoning_content as string | undefined;
    if (reasoningDelta) {
      fullReasoning += reasoningDelta;
      yield { type: 'reasoning', text: reasoningDelta };
    }

    // Usage info from final chunk
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? 0;
      outputTokens = chunk.usage.completion_tokens ?? 0;
      const details = (chunk.usage as unknown as {
        completion_tokens_details?: { reasoning_tokens?: number };
      })?.completion_tokens_details;
      reasoningTokens = details?.reasoning_tokens ?? 0;
    }
  }

  const durationMs = Date.now() - startTime;

  yield {
    type: 'done',
    response: {
      content: fullContent,
      reasoningContent: fullReasoning || undefined,
      inputTokens,
      outputTokens,
      reasoningTokens: reasoningTokens || undefined,
      cost: calculateCost(model, inputTokens, outputTokens, reasoningTokens),
      durationMs,
      model,
    },
  };
}

// ─── Conversation call (for multi-turn with history) ────────────────────────

export async function callDeepSeekWithHistory(
  systemPrompt: string,
  messages: LLMMessage[],
  options: CallOptions = {},
): Promise<LLMResponse> {
  const model = options.model ?? 'deepseek-chat';
  const client = getClient();
  const startTime = Date.now();

  // Strip any reasoning_content from assistant messages (required by API)
  const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  const response = await client.chat.completions.create({
    model,
    messages: apiMessages,
    max_tokens: options.maxTokens ?? 4096,
    ...(model === 'deepseek-chat' ? { temperature: options.temperature ?? 0 } : {}),
  }, { signal: options.signal });

  const durationMs = Date.now() - startTime;
  const choice = response.choices[0];
  const content = choice?.message?.content ?? '';
  const reasoningContent = (choice?.message as unknown as Record<string, unknown>)?.reasoning_content as string | undefined;

  const usage = response.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const reasoningTokens = (usage as unknown as {
    completion_tokens_details?: { reasoning_tokens?: number };
  })?.completion_tokens_details?.reasoning_tokens ?? 0;

  return {
    content,
    reasoningContent: reasoningContent || undefined,
    inputTokens,
    outputTokens,
    reasoningTokens: reasoningTokens || undefined,
    cost: calculateCost(model, inputTokens, outputTokens, reasoningTokens),
    durationMs,
    model,
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export { PRICING };
