/**
 * Trace command — PR7 retrieval log rendering.
 *
 * Synthesizes a JSONL trace containing a `memory.retrieved` event and asserts
 * `mint trace <id> --memory` surfaces the per-turn retrieved memories with
 * fused scores. Falls back to the live-stores dump when retrieval events are
 * absent (covered indirectly by the existing trace behaviour).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { runTraceReplay } from '../trace.js';

const tempDirs: string[] = [];
const ORIGINAL_HOME = process.env.HOME;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), 'mint-trace-home-'));
  tempDirs.push(home);
  process.env.HOME = home;
  // os.homedir() resolves via $HOME on POSIX, so this redirects ~/.mint/traces.
  void homedir; // referenced for clarity
  mkdirSync(join(home, '.mint', 'traces'), { recursive: true });
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  process.env.HOME = ORIGINAL_HOME;
});

function writeTrace(id: string, lines: object[]): string {
  const path = join(process.env.HOME!, '.mint', 'traces', `${id}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return path;
}

describe('mint trace --memory (PR7)', () => {
  it('renders memory.retrieved entries with fused scores', async () => {
    const id = 'pr7-test-session';
    const ts = 1_700_000_000_000;
    writeTrace(id, [
      {
        type: 'session.start',
        sessionId: id,
        ts,
        mode: 'diff',
        task: 'now do the same in App.tsx',
        cwd: '/tmp/repo',
      },
      {
        type: 'memory.retrieved',
        sessionId: id,
        ts: ts + 100,
        task: 'now do the same in App.tsx',
        memories: [
          {
            id: 1,
            kind: 'preference',
            text: 'user prefers vitest over jest',
            score: 0.0492,
            components: { bm25: 1.2, recency: 0.98, confidence: 0.6 },
          },
          {
            id: 2,
            kind: 'fact',
            text: 'InputBox.tsx owns keymap',
            score: 0.031,
            components: { bm25: 0.4, recency: 0.7, confidence: 0.5 },
          },
        ],
      },
      {
        type: 'done',
        sessionId: id,
        ts: ts + 200,
        result: {
          output: '',
          model: 'sonnet',
          totalCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 200,
          iterations: 1,
          toolCalls: 0,
          filesTouched: [],
          success: true,
        },
      },
    ]);

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    try {
      await runTraceReplay(id, { withMemory: true });
    } finally {
      spy.mockRestore();
    }

    const out = logs.join('\n');
    expect(out).toContain('Memory retrieval log');
    expect(out).toContain('Retrieval 1');
    expect(out).toContain('preference');
    expect(out).toContain('user prefers vitest over jest');
    expect(out).toContain('InputBox.tsx owns keymap');
    // Score is formatted to 3 decimals.
    expect(out).toMatch(/0\.04[0-9]/);
  });

  it('falls back with note when no memory.retrieved events present', async () => {
    const id = 'pr7-no-retrieval';
    const ts = 1_700_000_000_000;
    writeTrace(id, [
      {
        type: 'session.start',
        sessionId: id,
        ts,
        mode: 'diff',
        task: 'hello',
        cwd: '/tmp/repo',
      },
      {
        type: 'done',
        sessionId: id,
        ts: ts + 50,
        result: {
          output: '',
          model: 'sonnet',
          totalCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 50,
          iterations: 1,
          toolCalls: 0,
          filesTouched: [],
          success: true,
        },
      },
    ]);

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    try {
      await runTraceReplay(id, { withMemory: true });
    } finally {
      spy.mockRestore();
    }

    const out = logs.join('\n');
    expect(out).toContain('retrieval log not present');
  });
});
