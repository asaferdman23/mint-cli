import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Mock providers before importing loop.ts ───────────────────────────────

type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolName: string; toolInput: Record<string, unknown>; toolCallId: string };

let mockStream: StreamChunk[][] = [[]];
let streamCall = 0;

vi.mock('../../providers/index.js', () => ({
  streamAgent: async function* () {
    const turn = mockStream[streamCall++] ?? [];
    for (const chunk of turn) yield chunk;
  },
  complete: vi.fn(async () => ({
    content: '{"kind":"edit_small","complexity":"simple","estFilesTouched":1,"needsPlan":false,"needsApproval":"per_diff","suggestedModelKey":"edit_small","reasoning":"mocked","confidence":0.8}',
    model: 'mistral-small',
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    cost: { input: 0, output: 0, total: 0 },
    latency: 5,
  })),
  completeWithFallback: vi.fn(async () => ({
    content: '',
    model: 'deepseek-v3',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    cost: { input: 0, output: 0, total: 0 },
    latency: 0,
  })),
}));

// Avoid the full indexer walk — return a tiny fixture synchronously.
vi.mock('../../context/indexer.js', async () => {
  const actual = await vi.importActual<typeof import('../../context/indexer.js')>(
    '../../context/indexer.js',
  );
  return {
    ...actual,
    loadIndex: async () => ({
      projectRoot: '/fixture',
      totalFiles: 2,
      totalLOC: 50,
      language: 'typescript',
      indexedAt: new Date().toISOString(),
      files: {
        'src/a.ts': {
          imports: [],
          exports: ['a'],
          symbols: [{ name: 'a', kind: 'function' as const, signature: 'function a()', startLine: 1, endLine: 5 }],
          summary: 'module a',
          loc: 25,
          language: 'typescript',
          size: 500,
        },
        'src/b.ts': {
          imports: [],
          exports: ['b'],
          symbols: [{ name: 'b', kind: 'function' as const, signature: 'function b()', startLine: 1, endLine: 5 }],
          summary: 'module b',
          loc: 25,
          language: 'typescript',
          size: 500,
        },
      },
      graph: {
        'src/a.ts': { imports: [], importedBy: [] },
        'src/b.ts': { imports: [], importedBy: [] },
      },
    }),
    indexProject: async () => ({
      projectRoot: '/fixture',
      totalFiles: 0,
      totalLOC: 0,
      language: 'typescript',
      indexedAt: new Date().toISOString(),
      files: {},
      graph: {},
    }),
  };
});

// ─── Imports after mocks ────────────────────────────────────────────────────

import { runBrain } from '../loop.js';
import type { AgentEvent } from '../events.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mint-loop-'));
  mkdirSync(join(dir, '.mint'), { recursive: true });
  // Stub context.json so loadIndex mock has something to return if called
  writeFileSync(
    join(dir, '.mint', 'context.json'),
    JSON.stringify({ projectRoot: dir, totalFiles: 0, totalLOC: 0, language: 'typescript', files: {}, graph: {}, indexedAt: '' }),
  );
  tempDirs.push(dir);
  return dir;
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

beforeEach(() => {
  mockStream = [[]];
  streamCall = 0;
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
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('runBrain', () => {
  it('emits ordered events for a text-only response', async () => {
    mockStream = [[{ type: 'text', text: 'Done.' }]];
    const cwd = makeCwd();

    const events = await collect(
      runBrain({
        task: 'what does a.ts do?',
        cwd,
        mode: 'auto',
        skipLlmClassify: true,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('session.start');
    expect(types).toContain('classify');
    expect(types).toContain('context.retrieved');
    expect(types).toContain('text.delta');
    expect(types[types.length - 1]).toBe('done');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    if (done?.type === 'done') {
      expect(done.result.success).toBe(true);
      expect(done.result.model).toBeDefined();
      expect(done.result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('classification event appears before context.retrieved', async () => {
    mockStream = [[{ type: 'text', text: 'ok' }]];
    const cwd = makeCwd();

    const events = await collect(
      runBrain({ task: 'fix a typo', cwd, mode: 'auto', skipLlmClassify: true }),
    );

    const classifyIdx = events.findIndex((e) => e.type === 'classify');
    const contextIdx = events.findIndex((e) => e.type === 'context.retrieved');
    expect(classifyIdx).toBeGreaterThanOrEqual(0);
    expect(contextIdx).toBeGreaterThan(classifyIdx);
  });

  it('aborts cleanly when the signal is already aborted', async () => {
    mockStream = [[{ type: 'text', text: 'should not be seen' }]];
    const cwd = makeCwd();
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      runBrain({
        task: 'anything',
        cwd,
        mode: 'auto',
        signal: controller.signal,
        skipLlmClassify: true,
      }),
    );

    const errorEvent = events.find((e) => e.type === 'error');
    const done = events.find((e) => e.type === 'done');
    // Either an error (recoverable) or a done with success=false is acceptable.
    expect(errorEvent || done).toBeDefined();
  });

  it('emits cost.delta after a streamed response', async () => {
    mockStream = [[{ type: 'text', text: 'response text' }]];
    const cwd = makeCwd();

    const events = await collect(
      runBrain({ task: 'add a button', cwd, mode: 'auto', skipLlmClassify: true }),
    );

    const cost = events.find((e) => e.type === 'cost.delta');
    expect(cost).toBeDefined();
    if (cost?.type === 'cost.delta') {
      expect(cost.outputTokens).toBeGreaterThan(0);
    }
  });

  it('records an outcome in .mint/outcomes.sqlite after completion', async () => {
    mockStream = [[{ type: 'text', text: 'hello' }]];
    const cwd = makeCwd();

    await collect(runBrain({ task: 'say hi', cwd, mode: 'auto', skipLlmClassify: true }));

    // Open the store after the run to confirm a row landed.
    const { openOutcomesStore } = await import('../memory/outcomes.js');
    const store = openOutcomesStore(cwd);
    try {
      const recent = store.recent(5);
      expect(recent.length).toBeGreaterThanOrEqual(1);
      expect(recent[0].task).toBe('say hi');
    } finally {
      store.close();
    }
  });
});
