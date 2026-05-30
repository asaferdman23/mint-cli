import Anthropic from '@anthropic-ai/sdk';
import { Provider, CompletionRequest, CompletionResponse, ModelId, MODELS, AgentStreamChunk } from './types.js';
import { calculateCost } from './router.js';
import { config } from '../utils/config.js';

const MODEL_MAP: Partial<Record<ModelId, string>> = {
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
};

/**
 * Prompt-cache marker shape Anthropic expects. We attach this to the system
 * block and the tools array so the static prefix of every request is billed
 * at ~10% of the fresh-token price after the first turn.
 *
 * We mark the LAST tool only — the SDK caches "everything up to and
 * including" the marker, so a single trailing marker covers the full tools
 * array without bloating the request.
 *
 * PR8: when `MINT_ANTHROPIC_CACHE_1H=1` (or config `anthropic.cache1h` is
 * true), we opt into the `extended-cache-ttl-2025-04-11` beta by sending the
 * `anthropic-beta` header and setting `ttl: "1h"` on every cache_control
 * block. The 1-hour beta is useful for paused sessions: 5-min TTL races a
 * lunch break and the user pays the full cache-write cost on resume.
 * Pricing: 1h writes ~2× the 5-min write cost, reads remain ~10% of fresh
 * tokens. See https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 * for current numbers.
 */
const CACHE_EPHEMERAL = { type: 'ephemeral' as const };
const CACHE_EPHEMERAL_1H = { type: 'ephemeral' as const, ttl: '1h' as const };
const EXTENDED_CACHE_TTL_BETA = 'extended-cache-ttl-2025-04-11';

/** True if the env var explicitly disables prompt caching (escape hatch).
 *  This wins over the 1h opt-in below — disable beats enable. */
function cachingDisabled(): boolean {
  return process.env.MINT_DISABLE_ANTHROPIC_CACHE === '1';
}

/** True if the 1-hour extended cache TTL beta should be requested. Honors
 *  the env flag first, then the persistent config key for parity with how
 *  other Mint feature flags work. Ignored when caching is disabled. */
function cache1hEnabled(): boolean {
  if (cachingDisabled()) return false;
  if (process.env.MINT_ANTHROPIC_CACHE_1H === '1') return true;
  try {
    return config.get('anthropic')?.cache1h === true;
  } catch {
    return false;
  }
}

/** The cache_control object emitted on every block, parameterized by the
 *  current 1h opt-in state. */
function cacheMarker(): typeof CACHE_EPHEMERAL | typeof CACHE_EPHEMERAL_1H {
  return cache1hEnabled() ? CACHE_EPHEMERAL_1H : CACHE_EPHEMERAL;
}

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

    // Wrap system as a cacheable block when present. Anthropic bills the
    // marked prefix at ~10% on subsequent calls within ~5 minutes (or 1h
    // when the extended-cache-ttl-2025-04-11 beta is opted in).
    const marker = cacheMarker();
    const systemParam = systemMessage?.content && !cachingDisabled()
      ? [{ type: 'text' as const, text: systemMessage.content, cache_control: marker }]
      : systemMessage?.content;

    const response = await client.messages.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      system: systemParam,
      messages: otherMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    }, cache1hEnabled() ? { headers: { 'anthropic-beta': EXTENDED_CACHE_TTL_BETA } } : undefined);

    const latency = Date.now() - startTime;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    // Cache stats are only present when prompt caching is in play.
    const cacheCreationTokens = (response.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;
    const cacheReadTokens = (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;

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
        cacheCreationInputTokens: cacheCreationTokens || undefined,
        cacheReadInputTokens: cacheReadTokens || undefined,
      },
      cost: calculateCost(request.model, inputTokens, outputTokens, {
        cacheCreationInputTokens: cacheCreationTokens,
        cacheReadInputTokens: cacheReadTokens,
      }),
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

    // Cache-budget math. Anthropic allows max 4 `cache_control: ephemeral`
    // breakpoints per request. Allocation when systemTiers is in play:
    //   1× base (always present)         + 1× project (if AGENT.md or MINT.md exists)
    // + 1× dynamic (if retrieved files or deep-plan)
    // + 1× tools (last tool, always when tools present)
    // = up to 4 breakpoints, exactly at the SDK ceiling.
    //
    // If a compaction `cacheBoundary` ALSO fires on a message AND all three
    // system tiers are populated, we would land at 5 → over the limit. The
    // system tiers are the more stable signal (project + base survive every
    // turn; the compaction summary only helps until the next compaction), so
    // we drop the message-level cache_control in that case.
    const tiers = request.systemTiers;
    const tierCount = tiers
      ? 1 + (tiers.project ? 1 : 0) + (tiers.dynamic ? 1 : 0)
      : 0;
    const suppressMessageCacheBoundary = !cachingDisabled() && tierCount >= 3;
    const marker = cacheMarker();

    const anthropicMessages: Anthropic.MessageParam[] = otherMessages.map(m => {
      if (m.role === 'user') {
        // Honor cacheBoundary on user messages too — Anthropic doesn't
        // restrict cache_control to a particular role. Suppressed when the
        // system-tier budget already consumes 3 breakpoints (see comment above).
        if (m.cacheBoundary && !cachingDisabled() && !suppressMessageCacheBoundary) {
          return {
            role: 'user' as const,
            content: [{ type: 'text' as const, text: m.content, cache_control: marker }],
          } as Anthropic.MessageParam;
        }
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
      // Plain assistant message (typically the compaction summary). Honor
      // cacheBoundary so the historical context becomes a second cache
      // breakpoint after the summary — unless we'd blow the 4-breakpoint
      // budget (see suppressMessageCacheBoundary above).
      if (m.cacheBoundary && !cachingDisabled() && !suppressMessageCacheBoundary) {
        return {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: m.content, cache_control: marker }],
        } as Anthropic.MessageParam;
      }
      return { role: 'assistant' as const, content: m.content };
    });

    const tools: Anthropic.Tool[] | undefined = request.tools?.map((t, i, arr) => {
      const tool: Anthropic.Tool = {
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      };
      // Tag the LAST tool so Anthropic caches the entire tools array prefix.
      // Tool schemas are static across a session so this is pure savings.
      if (i === arr.length - 1 && !cachingDisabled()) {
        (tool as unknown as { cache_control?: typeof marker }).cache_control = marker;
      }
      return tool;
    });

    // System prompt as cacheable block(s). When `systemTiers` is supplied we
    // emit one text block per non-null tier, each with its own cache_control
    // marker — yielding up to 3 system breakpoints (base + project + dynamic)
    // ordered from most-stable to most-dynamic so prefix caching survives
    // turn-to-turn churn in the dynamic block.
    let systemParam: unknown;
    if (cachingDisabled()) {
      // Escape hatch: send as plain string with no markers anywhere.
      systemParam = tiers
        ? [tiers.base, tiers.project, tiers.dynamic].filter((s): s is string => !!s).join('\n\n')
        : systemPrompt;
    } else if (tiers) {
      const blocks: Array<{ type: 'text'; text: string; cache_control: typeof marker }> = [
        { type: 'text', text: tiers.base, cache_control: marker },
      ];
      if (tiers.project) {
        blocks.push({ type: 'text', text: tiers.project, cache_control: marker });
      }
      if (tiers.dynamic) {
        blocks.push({ type: 'text', text: tiers.dynamic, cache_control: marker });
      }
      systemParam = blocks;
    } else if (systemPrompt) {
      systemParam = [{ type: 'text' as const, text: systemPrompt, cache_control: marker }];
    } else {
      systemParam = undefined;
    }

    const useCache1h = cache1hEnabled();
    const stream = client.messages.stream({
      model: modelString,
      max_tokens: request.maxTokens ?? 8192,
      system: systemParam as unknown as string,
      messages: anthropicMessages,
      tools,
    }, {
      signal: request.signal,
      ...(useCache1h ? { headers: { 'anthropic-beta': EXTENDED_CACHE_TTL_BETA } } : {}),
    });

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

    // Emit a final usage chunk with the real cached/fresh token split. The
    // SDK's finalMessage() resolves once the stream completes; usage there
    // is the authoritative count (Anthropic doesn't include cache stats in
    // any of the streaming deltas).
    try {
      const final = await stream.finalMessage();
      const u = final.usage as {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      yield {
        type: 'usage',
        usage: {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
        },
      };
    } catch {
      // finalMessage() can throw on aborted streams; usage is best-effort.
    }
  }
}

export const anthropicProvider = new AnthropicProvider();
