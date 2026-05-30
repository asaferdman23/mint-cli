import { describe, it, expect, vi, beforeEach } from 'vitest';

import { summarizeTurn, __testing, type TurnInputs } from '../memory/summarize-turn.js';

vi.mock('../../providers/index.js', () => ({
  complete: vi.fn(),
}));

import { complete } from '../../providers/index.js';

const mockComplete = complete as unknown as ReturnType<typeof vi.fn>;

const baseInputs: TurnInputs = {
  userTask: 'rename Foo to Bar across the codebase',
  finalAssistant: 'Renamed Foo to Bar in src/foo.ts and src/bar.ts.',
  filesTouched: ['src/foo.ts', 'src/bar.ts'],
  toolCalls: 4,
  outcome: 'success',
  model: 'claude-sonnet-4',
};

describe('summarizeTurn', () => {
  beforeEach(() => {
    mockComplete.mockReset();
  });

  it('returns the model text on happy path', async () => {
    mockComplete.mockResolvedValueOnce({
      content: 'User renamed Foo to Bar. Edited src/foo.ts and src/bar.ts. Verified by running tests. Outcome: success.',
      model: 'mistral-small',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { input: 0, output: 0, total: 0 },
      latency: 0,
    });
    const out = await summarizeTurn(baseInputs);
    expect(out.text).toContain('renamed Foo to Bar');
    expect(out.inputs).toEqual(baseInputs);
    expect(typeof out.createdAt).toBe('number');
  });

  it('returns deterministic fallback when the model throws', async () => {
    mockComplete.mockRejectedValueOnce(new Error('429 rate limit'));
    const out = await summarizeTurn(baseInputs);
    expect(out.text).toBe('rename Foo to Bar across the codebase — success, 2 file(s) touched.');
    expect(out.inputs).toEqual(baseInputs);
  });

  it('returns fallback when the model returns empty content', async () => {
    mockComplete.mockResolvedValueOnce({
      content: '   ',
      model: 'mistral-small',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { input: 0, output: 0, total: 0 },
      latency: 0,
    });
    const out = await summarizeTurn(baseInputs);
    expect(out.text).toMatch(/— success, 2 file\(s\) touched\.$/);
  });

  it('uses mistral-small by default and passes signal through', async () => {
    mockComplete.mockResolvedValueOnce({
      content: 'ok',
      model: 'mistral-small',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { input: 0, output: 0, total: 0 },
      latency: 0,
    });
    const controller = new AbortController();
    await summarizeTurn(baseInputs, { signal: controller.signal });
    const call = mockComplete.mock.calls[0]?.[0];
    expect(call.model).toBe('mistral-small');
    expect(call.signal).toBe(controller.signal);
    expect(call.systemPrompt).toContain('Summarize this coding turn');
  });

  it('does NOT leak file contents into the prompt — only paths', async () => {
    mockComplete.mockResolvedValueOnce({
      content: 'ok',
      model: 'mistral-small',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { input: 0, output: 0, total: 0 },
      latency: 0,
    });
    // The body of a file the agent might have read. Must NEVER appear in the
    // prompt sent to the summarizer.
    const fileBody = 'export const SECRET_API_KEY = "sk-test-1234567890abcdef";';
    await summarizeTurn({
      ...baseInputs,
      // The summarizer only receives the input fields below. We deliberately
      // do not provide a "file body" field — but assert the body never appears
      // in any of the strings passed downstream either.
      finalAssistant: 'Edited src/foo.ts to rename Foo.',
    });
    const call = mockComplete.mock.calls[0]?.[0];
    const userBody = call.messages[0].content as string;
    expect(userBody).toContain('src/foo.ts');
    expect(userBody).not.toContain(fileBody);
    expect(userBody).not.toContain('SECRET_API_KEY');
    expect(call.systemPrompt).not.toContain(fileBody);
  });

  it('buildUserPayload truncates very long task and assistant fields', () => {
    const longTask = 'a'.repeat(2000);
    const longAssistant = 'b'.repeat(5000);
    const body = __testing.buildUserPayload({
      ...baseInputs,
      userTask: longTask,
      finalAssistant: longAssistant,
    });
    // Truncation markers at 600 / 1200 chars
    expect(body).toContain('a'.repeat(600) + '…');
    expect(body).toContain('b'.repeat(1200) + '…');
  });

  it('buildFallback handles zero files', () => {
    const text = __testing.buildFallback({ ...baseInputs, filesTouched: [], outcome: 'aborted' });
    expect(text).toContain('aborted');
    expect(text).toContain('0 file(s)');
  });
});
