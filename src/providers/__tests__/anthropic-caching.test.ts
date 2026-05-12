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
      stream: vi.fn((args: unknown) => {
        capturedStreamArgs = args;
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
    delete process.env.MINT_DISABLE_ANTHROPIC_CACHE;
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
