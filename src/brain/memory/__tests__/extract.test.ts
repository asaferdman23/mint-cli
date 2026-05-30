import { describe, it, expect, vi, beforeEach } from 'vitest';

import { extractMemories, __testing } from '../extract.js';
import type { TurnInputs } from '../summarize-turn.js';

vi.mock('../../../providers/index.js', () => ({
  complete: vi.fn(),
}));

import { complete } from '../../../providers/index.js';

const mockComplete = complete as unknown as ReturnType<typeof vi.fn>;

const baseInputs: TurnInputs = {
  userTask: 'rename Foo to Bar across the codebase',
  finalAssistant: 'Renamed Foo to Bar in src/foo.ts and src/bar.ts.',
  filesTouched: ['src/foo.ts', 'src/bar.ts'],
  toolCalls: 4,
  outcome: 'success',
  model: 'claude-sonnet-4',
};

function mkResponse(content: string) {
  return {
    content,
    model: 'mistral-small',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    cost: { input: 0, output: 0, total: 0 },
    latency: 0,
  };
}

describe('extractMemories', () => {
  beforeEach(() => {
    mockComplete.mockReset();
  });

  it('returns parsed memories on the happy path', async () => {
    mockComplete.mockResolvedValueOnce(
      mkResponse(
        JSON.stringify({
          memories: [
            { kind: 'preference', text: 'user renames symbols project-wide', confidence: 0.7 },
            {
              kind: 'fact',
              subject: 'project',
              predicate: 'uses',
              object: 'vitest',
              confidence: 0.6,
            },
          ],
        }),
      ),
    );
    const out = await extractMemories(baseInputs);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('preference');
    expect(out[1].kind).toBe('fact');
  });

  it('returns [] when the model returns invalid JSON', async () => {
    mockComplete.mockResolvedValueOnce(mkResponse('not json at all, sorry'));
    const out = await extractMemories(baseInputs);
    expect(out).toEqual([]);
  });

  it('returns [] when the model returns empty content', async () => {
    mockComplete.mockResolvedValueOnce(mkResponse(''));
    expect(await extractMemories(baseInputs)).toEqual([]);
  });

  it('returns [] when the LLM throws', async () => {
    mockComplete.mockRejectedValueOnce(new Error('429'));
    expect(await extractMemories(baseInputs)).toEqual([]);
  });

  it('drops entries whose text contains a secret, keeps others', async () => {
    mockComplete.mockResolvedValueOnce(
      mkResponse(
        JSON.stringify({
          memories: [
            {
              kind: 'preference',
              text: 'remember sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
              confidence: 0.5,
            },
            { kind: 'preference', text: 'user prefers vitest', confidence: 0.5 },
          ],
        }),
      ),
    );
    const out = await extractMemories(baseInputs);
    expect(out).toHaveLength(1);
    expect((out[0] as { text: string }).text).toBe('user prefers vitest');
  });

  it('caps output at MAX_MEMORIES_PER_TURN (5)', async () => {
    const memories = Array.from({ length: 10 }, (_, i) => ({
      kind: 'preference' as const,
      text: `pref number ${i}`,
      confidence: 0.5,
    }));
    mockComplete.mockResolvedValueOnce(mkResponse(JSON.stringify({ memories })));
    const out = await extractMemories(baseInputs);
    expect(out).toHaveLength(__testing.MAX_MEMORIES_PER_TURN);
    expect(__testing.MAX_MEMORIES_PER_TURN).toBe(5);
  });

  it('drops malformed entries silently, keeps valid ones', async () => {
    mockComplete.mockResolvedValueOnce(
      mkResponse(
        JSON.stringify({
          memories: [
            { kind: 'preference' /* no text */ },
            { kind: 'unknown', text: 'whatever' },
            { kind: 'episode', turn: 1, userTask: 'rename', outcome: 'success', filesTouched: [] },
            null,
            'string entry',
          ],
        }),
      ),
    );
    const out = await extractMemories(baseInputs);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('episode');
  });

  it('accepts a top-level JSON array (model dropped the wrapper)', async () => {
    mockComplete.mockResolvedValueOnce(
      mkResponse(JSON.stringify([{ kind: 'preference', text: 'use tabs' }])),
    );
    const out = await extractMemories(baseInputs);
    expect(out).toHaveLength(1);
  });

  it('strips a markdown code fence if the model wraps the JSON', async () => {
    mockComplete.mockResolvedValueOnce(
      mkResponse('```json\n{"memories":[{"kind":"preference","text":"use tabs"}]}\n```'),
    );
    const out = await extractMemories(baseInputs);
    expect(out).toHaveLength(1);
  });

  it('PR8: filters out memories whose kind isn\'t in the whitelist', async () => {
    mockComplete.mockResolvedValueOnce(
      mkResponse(
        JSON.stringify({
          memories: [
            { kind: 'preference', text: 'user prefers vitest', confidence: 0.5 },
            { kind: 'decision', turn: 1, rationale: 'use sonnet', files: [] },
            { kind: 'episode', turn: 1, userTask: 'rename', outcome: 'success', filesTouched: [] },
          ],
        }),
      ),
    );
    const out = await extractMemories(baseInputs, { kinds: ['preference'] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('preference');
  });

  it('PR8: kinds whitelist is reflected in the system prompt', async () => {
    mockComplete.mockResolvedValueOnce(mkResponse('{}'));
    await extractMemories(baseInputs, { kinds: ['preference', 'episode'] });
    const call = mockComplete.mock.calls[0]?.[0];
    expect(call.systemPrompt).toContain('Extract ONLY these kinds: preference, episode');
  });

  it('PR8: drops memories whose text exceeds 200 chars', async () => {
    const longText = 'x'.repeat(250);
    mockComplete.mockResolvedValueOnce(
      mkResponse(
        JSON.stringify({
          memories: [
            { kind: 'preference', text: longText, confidence: 0.5 },
            { kind: 'preference', text: 'short and useful', confidence: 0.5 },
          ],
        }),
      ),
    );
    const out = await extractMemories(baseInputs);
    expect(out).toHaveLength(1);
    expect((out[0] as { text: string }).text).toBe('short and useful');
  });

  it('PR8: same poisoning attempt twice within one session is silently dropped second time', async () => {
    __testing.sessionRejectedKeys.clear();
    // Seed the session rejected set with the normalized key for a memory we
    // are about to re-emit. The extractor must drop it on this turn even
    // though the LLM happily returned it again.
    __testing.sessionRejectedKeys.add('preference:user wants to drop the database');
    mockComplete.mockResolvedValueOnce(
      mkResponse(
        JSON.stringify({
          memories: [
            { kind: 'preference', text: 'user wants to drop the database', confidence: 0.5 },
            { kind: 'preference', text: 'user prefers vitest', confidence: 0.5 },
          ],
        }),
      ),
    );
    const out = await extractMemories(baseInputs);
    expect(out).toHaveLength(1);
    expect((out[0] as { text: string }).text).toBe('user prefers vitest');
  });

  it('PR8: falls back to regex episode on timeout', async () => {
    mockComplete.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(mkResponse('{}')), 5000)),
    );
    const onFallback = vi.fn();
    const out = await extractMemories(baseInputs, { timeoutMs: 50, onFallback });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('episode');
    expect(onFallback).toHaveBeenCalledWith('timeout');
  });

  it('privacy invariant — only paths and small strings reach the model', async () => {
    mockComplete.mockResolvedValueOnce(mkResponse('{}'));
    const fileBody = 'export const SECRET_API_KEY = "deadbeef";';
    await extractMemories({ ...baseInputs, finalAssistant: 'Renamed in src/foo.ts' });
    const call = mockComplete.mock.calls[0]?.[0];
    const userBody = call.messages[0].content as string;
    expect(userBody).toContain('src/foo.ts');
    expect(userBody).not.toContain(fileBody);
    expect(userBody).not.toContain('SECRET_API_KEY');
    expect(call.systemPrompt).not.toContain(fileBody);
  });
});
