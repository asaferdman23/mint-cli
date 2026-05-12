/**
 * P5 — Cache-aware compaction.
 *
 * Two invariants we want to lock in:
 *   1. `system` block + `tools` array are byte-identical across many turns
 *      so the primary cache breakpoint never moves.
 *   2. A message with `cacheBoundary: true` (set by brain/compact.ts on the
 *      compaction summary) is serialized as a content-block array with
 *      `cache_control: ephemeral` — establishing a second cache breakpoint
 *      so post-compaction sessions keep paying cache rates for the
 *      historical summary, not just system + tools.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let capturedStreamArgs: unknown[] = [];

function makeMockStream() {
  async function* iter() {
    /* no chunks */
  }
  const stream = iter() as AsyncGenerator<unknown> & {
    finalMessage: () => Promise<{ usage: Record<string, number> }>;
  };
  stream.finalMessage = async () => ({
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
  return stream;
}

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn(),
      stream: vi.fn((args: unknown) => {
        capturedStreamArgs.push(args);
        return makeMockStream();
      }),
    };
  }
  return { default: MockAnthropic };
});

vi.mock('../../utils/config.js', () => ({
  config: {
    get: (key: string) => (key === 'providers' ? { anthropic: 'sk-test' } : undefined),
    set: vi.fn(),
  },
}));

import { anthropicProvider } from '../anthropic.js';
import type { CompletionRequest, Message, AgentStreamChunk } from '../types.js';

async function drain(iter: AsyncIterable<AgentStreamChunk>): Promise<void> {
  for await (const _ of iter) {
    /* discard */
  }
}

function baseRequest(messages: Message[]): CompletionRequest {
  return {
    model: 'claude-sonnet-4',
    systemPrompt: 'you are a helpful coding agent — stable instructions',
    tools: [
      { name: 'read_file', description: 'read', input_schema: { type: 'object', properties: {} } },
      { name: 'write_file', description: 'write', input_schema: { type: 'object', properties: {} } },
      { name: 'bash', description: 'shell', input_schema: { type: 'object', properties: {} } },
    ],
    messages,
  };
}

describe('cache-aware compaction (P5)', () => {
  beforeEach(() => {
    capturedStreamArgs = [];
    delete process.env.MINT_DISABLE_ANTHROPIC_CACHE;
  });

  it('keeps `system` and `tools` byte-identical across 30 turns', async () => {
    // Simulate growing conversation history; system + tools should never
    // change because compaction only rewrites the messages array.
    for (let turn = 0; turn < 30; turn++) {
      const messages: Message[] = [];
      for (let i = 0; i <= turn; i++) {
        messages.push({ role: 'user', content: `turn ${i} user` });
        messages.push({ role: 'assistant', content: `turn ${i} reply` });
      }
      await drain(anthropicProvider.streamAgent(baseRequest(messages)));
    }

    expect(capturedStreamArgs).toHaveLength(30);
    const first = capturedStreamArgs[0] as { system: unknown; tools: unknown };
    const firstSystemJson = JSON.stringify(first.system);
    const firstToolsJson = JSON.stringify(first.tools);

    for (let i = 1; i < capturedStreamArgs.length; i++) {
      const args = capturedStreamArgs[i] as { system: unknown; tools: unknown };
      expect(JSON.stringify(args.system)).toBe(firstSystemJson);
      expect(JSON.stringify(args.tools)).toBe(firstToolsJson);
    }
  });

  it('translates cacheBoundary on an assistant message to cache_control: ephemeral', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'the original task' },
      // Synthesized compaction summary — what brain/compact.ts produces.
      { role: 'assistant', content: '<<summary of dropped turns>>', cacheBoundary: true },
      { role: 'user', content: 'follow-up question' },
    ];

    await drain(anthropicProvider.streamAgent(baseRequest(messages)));

    expect(capturedStreamArgs).toHaveLength(1);
    const args = capturedStreamArgs[0] as {
      messages: Array<{ role: string; content: unknown }>;
    };

    // Original user task should still be a plain string.
    expect(typeof args.messages[0].content).toBe('string');

    // Compaction summary should be a content-block array with cache_control.
    const summary = args.messages[1];
    expect(Array.isArray(summary.content)).toBe(true);
    const blocks = summary.content as Array<{ type: string; text: string; cache_control?: { type: string } }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'text',
      text: '<<summary of dropped turns>>',
      cache_control: { type: 'ephemeral' },
    });

    // Follow-up user message stays a plain string.
    expect(typeof args.messages[2].content).toBe('string');
  });

  it('MINT_DISABLE_ANTHROPIC_CACHE=1 strips the message-level marker too', async () => {
    process.env.MINT_DISABLE_ANTHROPIC_CACHE = '1';

    const messages: Message[] = [
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'summary', cacheBoundary: true },
    ];

    await drain(anthropicProvider.streamAgent(baseRequest(messages)));

    const args = capturedStreamArgs[0] as {
      messages: Array<{ content: unknown }>;
    };
    // With caching disabled, the summary falls back to a plain string.
    expect(typeof args.messages[1].content).toBe('string');
  });
});
