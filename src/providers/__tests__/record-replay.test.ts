/**
 * Unit tests for the record/replay primitive.
 *
 * The full cost-regression replay suite needs recorded fixtures from a live
 * gateway (run with `MINT_RECORD=1 mint "..."`). These tests exercise the
 * mechanism in isolation — round-trip a known set of chunks through record →
 * replay and assert the chunks come out identical.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordStream,
  replayStream,
  listFixtures,
  readFixtureMeta,
  isRecording,
  isReplaying,
} from '../record-replay.js';
import type { AgentStreamChunk, CompletionRequest } from '../types.js';

async function* synthStream(chunks: AgentStreamChunk[]): AsyncIterable<AgentStreamChunk> {
  for (const c of chunks) yield c;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe('record-replay', () => {
  const originalCwd = process.cwd();
  const originalRecord = process.env.MINT_RECORD;
  const originalReplay = process.env.MINT_REPLAY;
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'mint-rec-'));
    process.chdir(workDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
    if (originalRecord === undefined) delete process.env.MINT_RECORD;
    else process.env.MINT_RECORD = originalRecord;
    if (originalReplay === undefined) delete process.env.MINT_REPLAY;
    else process.env.MINT_REPLAY = originalReplay;
  });

  it('isRecording / isReplaying read env vars', () => {
    delete process.env.MINT_RECORD;
    delete process.env.MINT_REPLAY;
    expect(isRecording()).toBe(false);
    expect(isReplaying()).toBe(false);

    process.env.MINT_RECORD = '1';
    expect(isRecording()).toBe(true);

    process.env.MINT_REPLAY = '/tmp/x';
    expect(isReplaying()).toBe(true);
  });

  it('round-trips chunks via record → replay', async () => {
    const request: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: 'you are mint',
    };
    const chunks: AgentStreamChunk[] = [
      { type: 'text', text: 'hi' },
      { type: 'tool_call', toolName: 'read_file', toolInput: { path: 'x' }, toolCallId: 'tc_1' },
      { type: 'text', text: ' there' },
    ];

    const recorded = await collect(recordStream(request, synthStream(chunks)));
    expect(recorded).toEqual(chunks);

    const fixtures = listFixtures();
    expect(fixtures).toHaveLength(1);

    const meta = readFixtureMeta(fixtures[0]);
    expect(meta?.model).toBe('claude-sonnet-4');
    expect(meta?.taskPreview).toContain('hello');

    process.env.MINT_REPLAY = join(workDir, 'test', 'fixtures', 'recordings');
    const replayed = await collect(replayStream(request));
    expect(replayed).toEqual(chunks);
  });

  it('throws when replay fixture is missing', async () => {
    process.env.MINT_REPLAY = join(workDir, 'no-such-dir');
    const request: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'no fixture' }],
    };
    await expect(collect(replayStream(request))).rejects.toThrow(/no fixture/i);
  });

  it('hashes are deterministic for identical requests', async () => {
    const request: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'same' }],
    };
    await collect(recordStream(request, synthStream([{ type: 'text', text: 'a' }])));
    await collect(recordStream(request, synthStream([{ type: 'text', text: 'b' }])));

    // Re-recording the same request key should overwrite, not accumulate.
    expect(listFixtures()).toHaveLength(1);

    process.env.MINT_REPLAY = join(workDir, 'test', 'fixtures', 'recordings');
    const replayed = await collect(replayStream(request));
    // The second recording wins.
    expect(replayed).toEqual([{ type: 'text', text: 'b' }]);
  });

  it('different models produce different fixture files', async () => {
    const a: CompletionRequest = { model: 'claude-sonnet-4', messages: [{ role: 'user', content: 'x' }] };
    const b: CompletionRequest = { model: 'gemini-2-pro', messages: [{ role: 'user', content: 'x' }] };

    await collect(recordStream(a, synthStream([{ type: 'text', text: 'a' }])));
    await collect(recordStream(b, synthStream([{ type: 'text', text: 'b' }])));

    expect(listFixtures()).toHaveLength(2);
  });

  // Sanity check: existsSync isn't accidentally re-exported, just a guard.
  it('fixture files are created on the first chunk', async () => {
    const request: CompletionRequest = {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'sanity' }],
    };
    await collect(recordStream(request, synthStream([{ type: 'text', text: '·' }])));
    const dir = join(workDir, 'test', 'fixtures', 'recordings');
    expect(existsSync(dir)).toBe(true);
  });
});
