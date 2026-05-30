/**
 * Verifies the Anthropic provider sends `cache_control: ephemeral` markers
 * on the system block and the last tool definition, and that cache stats
 * from the final message propagate through as a `usage` chunk.
 *
 * We can't make a real network call from CI without an API key, so we mock
 * the Anthropic SDK and capture the outbound request shape. This is the
 * durable verification gate for P1 of the Phase-4 plan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the args passed to messages.stream so we can introspect them.
let capturedStreamArgs: unknown = null;
let capturedStreamOptions: unknown = null;
let nextFinalUsage = {
  input_tokens: 12,
  output_tokens: 34,
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 5000,
};

function makeMockStream() {
  async function* iter() {
    // No deltas — we only care about request shape + final usage.
  }
  const stream = iter() as AsyncGenerator<unknown> & {
    finalMessage: () => Promise<{ usage: typeof nextFinalUsage }>;
  };
  stream.finalMessage = async () => ({ usage: nextFinalUsage });
  return stream;
}

// Mock the Anthropic SDK before importing the provider.
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: 'ok' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 80,
          cache_read_input_tokens: 200,
        },
      })),
      stream: vi.fn((args: unknown, opts: unknown) => {
        capturedStreamArgs = args;
        capturedStreamOptions = opts;
        return makeMockStream();
      }),
    };
  }
  return { default: MockAnthropic };
});

// Mock the config so getClient() doesn't throw on a missing API key.
vi.mock('../../utils/config.js', () => ({
  config: {
    get: (key: string) => (key === 'providers' ? { anthropic: 'sk-test' } : undefined),
    getPath: () => undefined,
    set: vi.fn(),
  },
}));

import { anthropicProvider } from '../anthropic.js';
import type { CompletionRequest, AgentStreamChunk } from '../types.js';

async function drain(iter: AsyncIterable<AgentStreamChunk>): Promise<AgentStreamChunk[]> {
  const out: AgentStreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('AnthropicProvider — prompt caching', () => {
  beforeEach(() => {
    capturedStreamArgs = null;
    capturedStreamOptions = null;
    delete process.env.MINT_DISABLE_ANTHROPIC_CACHE;
    delete process.env.MINT_ANTHROPIC_CACHE_1H;
  });

  it('streamAgent marks the system block with cache_control: ephemeral', async () => {
    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'you are a helpful coding agent',
      tools: [
        { name: 'read_file', description: 'read a file', input_schema: { type: 'object', properties: {} } },
        { name: 'write_file', description: 'write a file', input_schema: { type: 'object', properties: {} } },
      ],
    };

    await drain(anthropicProvider.streamAgent(req));

    expect(capturedStreamArgs).toBeTruthy();
    const args = capturedStreamArgs as { system: Array<{ type: string; text: string; cache_control: { type: string } }> };
    expect(Array.isArray(args.system)).toBe(true);
    expect(args.system[0]).toMatchObject({
      type: 'text',
      text: 'you are a helpful coding agent',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('streamAgent marks ONLY the last tool with cache_control: ephemeral', async () => {
    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'sys',
      tools: [
        { name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } },
        { name: 'b', description: 'b', input_schema: { type: 'object', properties: {} } },
        { name: 'c', description: 'c', input_schema: { type: 'object', properties: {} } },
      ],
    };

    await drain(anthropicProvider.streamAgent(req));

    const args = capturedStreamArgs as { tools: Array<{ name: string; cache_control?: { type: string } }> };
    expect(args.tools).toHaveLength(3);
    expect(args.tools[0].cache_control).toBeUndefined();
    expect(args.tools[1].cache_control).toBeUndefined();
    expect(args.tools[2].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('streamAgent emits a final usage chunk with cache token counts', async () => {
    nextFinalUsage = {
      input_tokens: 12,
      output_tokens: 34,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 5000,
    };

    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'sys',
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };

    const chunks = await drain(anthropicProvider.streamAgent(req));
    const usageChunk = chunks.find((c) => c.type === 'usage');
    expect(usageChunk).toBeDefined();
    expect(usageChunk?.usage).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 5000,
    });
  });

  // ── PR8: 1-hour extended-cache-ttl beta ────────────────────────────────
  it('PR8: env unset → no anthropic-beta header, no ttl on cache_control', async () => {
    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'sys',
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };
    await drain(anthropicProvider.streamAgent(req));
    const opts = capturedStreamOptions as { headers?: Record<string, string> } | undefined;
    const headers = opts?.headers ?? {};
    expect(headers['anthropic-beta']).toBeUndefined();
    const args = capturedStreamArgs as {
      system: Array<{ cache_control: { type: string; ttl?: string } }>;
      tools: Array<{ cache_control?: { type: string; ttl?: string } }>;
    };
    expect(args.system[0].cache_control.ttl).toBeUndefined();
    expect(args.tools[0].cache_control?.ttl).toBeUndefined();
  });

  it('PR8: MINT_ANTHROPIC_CACHE_1H=1 → header sent + every cache_control has ttl 1h', async () => {
    process.env.MINT_ANTHROPIC_CACHE_1H = '1';
    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [
        { role: 'assistant', content: 'SUMMARY', cacheBoundary: true },
        { role: 'user', content: 'next' },
      ],
      systemTiers: { base: 'B', project: 'P', dynamic: null },
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };
    await drain(anthropicProvider.streamAgent(req));
    const opts = capturedStreamOptions as { headers?: Record<string, string> };
    expect(opts.headers?.['anthropic-beta']).toBe('extended-cache-ttl-2025-04-11');
    const args = capturedStreamArgs as {
      system: Array<{ cache_control: { type: string; ttl?: string } }>;
      messages: Array<{ role: string; content: unknown }>;
      tools: Array<{ cache_control?: { type: string; ttl?: string } }>;
    };
    for (const block of args.system) {
      expect(block.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    }
    const summary = args.messages.find((m) => m.role === 'assistant')!;
    expect(Array.isArray(summary.content)).toBe(true);
    const summaryBlock = (summary.content as Array<{ cache_control: { ttl?: string } }>)[0];
    expect(summaryBlock.cache_control.ttl).toBe('1h');
    expect(args.tools[0].cache_control?.ttl).toBe('1h');
  });

  it('PR8: MINT_DISABLE_ANTHROPIC_CACHE=1 beats MINT_ANTHROPIC_CACHE_1H=1 (disable wins)', async () => {
    process.env.MINT_DISABLE_ANTHROPIC_CACHE = '1';
    process.env.MINT_ANTHROPIC_CACHE_1H = '1';
    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'sys',
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };
    await drain(anthropicProvider.streamAgent(req));
    const opts = capturedStreamOptions as { headers?: Record<string, string> } | undefined;
    // No beta header when caching is disabled wholesale.
    expect(opts?.headers?.['anthropic-beta']).toBeUndefined();
    const args = capturedStreamArgs as {
      system: unknown;
      tools: Array<{ cache_control?: unknown }>;
    };
    // No caching at all — system flattens to a plain string, no tool marker.
    expect(typeof args.system).toBe('string');
    expect(args.tools[0].cache_control).toBeUndefined();
  });

  it('streamAgent with systemTiers emits a 3-element system array, each with cache_control', async () => {
    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemTiers: {
        base: 'BASE_BLOCK',
        project: 'PROJECT_BLOCK',
        dynamic: 'DYNAMIC_BLOCK',
      },
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };

    await drain(anthropicProvider.streamAgent(req));

    const args = capturedStreamArgs as {
      system: Array<{ type: string; text: string; cache_control: { type: string } }>;
    };
    expect(Array.isArray(args.system)).toBe(true);
    expect(args.system).toHaveLength(3);
    expect(args.system[0]).toMatchObject({ type: 'text', text: 'BASE_BLOCK', cache_control: { type: 'ephemeral' } });
    expect(args.system[1]).toMatchObject({ type: 'text', text: 'PROJECT_BLOCK', cache_control: { type: 'ephemeral' } });
    expect(args.system[2]).toMatchObject({ type: 'text', text: 'DYNAMIC_BLOCK', cache_control: { type: 'ephemeral' } });
  });

  it('streamAgent with systemTiers omits null tiers from the system array', async () => {
    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemTiers: { base: 'BASE', project: null, dynamic: null },
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };

    await drain(anthropicProvider.streamAgent(req));

    const args = capturedStreamArgs as { system: Array<{ text: string }> };
    expect(args.system).toHaveLength(1);
    expect(args.system[0].text).toBe('BASE');
  });

  it('streamAgent suppresses message-level cacheBoundary when all 3 system tiers are present (4-breakpoint budget)', async () => {
    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [
        { role: 'assistant', content: 'SUMMARY', cacheBoundary: true },
        { role: 'user', content: 'next' },
      ],
      systemTiers: { base: 'B', project: 'P', dynamic: 'D' },
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };

    await drain(anthropicProvider.streamAgent(req));

    const args = capturedStreamArgs as {
      messages: Array<{ role: string; content: unknown }>;
    };
    // The assistant summary should be sent as a plain string (no cache_control)
    // because the 3 system tiers + last-tool marker already consume the 4
    // breakpoint budget.
    const summary = args.messages.find((m) => m.role === 'assistant')!;
    expect(typeof summary.content).toBe('string');
    expect(summary.content).toBe('SUMMARY');
  });

  it('streamAgent honors message cacheBoundary when systemTiers has < 3 populated tiers', async () => {
    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [
        { role: 'assistant', content: 'SUMMARY', cacheBoundary: true },
        { role: 'user', content: 'next' },
      ],
      systemTiers: { base: 'B', project: null, dynamic: null },
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };

    await drain(anthropicProvider.streamAgent(req));

    const args = capturedStreamArgs as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const summary = args.messages.find((m) => m.role === 'assistant')!;
    // Cache budget: 1 system + 1 message + 1 tool = 3 → message marker kept.
    expect(Array.isArray(summary.content)).toBe(true);
  });

  it('MINT_DISABLE_ANTHROPIC_CACHE=1 strips cache markers even with systemTiers set', async () => {
    process.env.MINT_DISABLE_ANTHROPIC_CACHE = '1';

    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemTiers: { base: 'B', project: 'P', dynamic: 'D' },
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };

    await drain(anthropicProvider.streamAgent(req));

    const args = capturedStreamArgs as {
      system: unknown;
      tools: Array<{ cache_control?: unknown }>;
    };
    // With caching disabled, system flattens to a plain string and tools lose markers.
    expect(typeof args.system).toBe('string');
    expect(args.system).toBe('B\n\nP\n\nD');
    expect(args.tools[0].cache_control).toBeUndefined();
  });

  // ── Prefix stability: the keystone for end-to-end cache hits ─────────────
  // Anthropic prefix caching only fires if the bytes up to a cache_control
  // marker are IDENTICAL across requests. A regression where someone injects
  // a Date.now() / random / per-turn id into the base or project tier would
  // silently drop the cache hit rate to 0 and the audit would only catch it
  // after a session has run. This test pins the invariant directly.
  it('two streamAgent calls with the same systemTiers produce byte-identical system bytes', async () => {
    const tiers = {
      base: 'BASE_BLOCK',
      project: 'PROJECT_BLOCK',
      dynamic: 'DYNAMIC_BLOCK',
    };
    const tools = [{ name: 'a', description: 'a', input_schema: { type: 'object' as const, properties: {} } }];

    const req1: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'turn 1' }],
      systemTiers: tiers,
      tools,
    };
    await drain(anthropicProvider.streamAgent(req1));
    const sys1 = JSON.stringify((capturedStreamArgs as { system: unknown }).system);
    const tools1 = JSON.stringify((capturedStreamArgs as { tools: unknown }).tools);

    const req2: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [
        { role: 'user', content: 'turn 1' },
        { role: 'assistant', content: 'fine' },
        { role: 'user', content: 'turn 2 — different user content' },
      ],
      systemTiers: tiers, // same tiers → cache prefix MUST stay stable
      tools,
    };
    await drain(anthropicProvider.streamAgent(req2));
    const sys2 = JSON.stringify((capturedStreamArgs as { system: unknown }).system);
    const tools2 = JSON.stringify((capturedStreamArgs as { tools: unknown }).tools);

    // Bytes must be identical. If this fails, Anthropic's prefix cache will
    // miss on every "second turn" of every session — exactly the bug pattern
    // that just hit Claude Code (token inflation from broken caching).
    expect(sys2).toBe(sys1);
    expect(tools2).toBe(tools1);
  });

  it('MINT_DISABLE_ANTHROPIC_CACHE=1 strips cache markers', async () => {
    process.env.MINT_DISABLE_ANTHROPIC_CACHE = '1';

    const req: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'sys',
      tools: [{ name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } }],
    };

    await drain(anthropicProvider.streamAgent(req));

    const args = capturedStreamArgs as {
      system: unknown;
      tools: Array<{ cache_control?: unknown }>;
    };
    // System falls back to a plain string when caching is disabled.
    expect(typeof args.system).toBe('string');
    expect(args.tools[0].cache_control).toBeUndefined();
  });
});
