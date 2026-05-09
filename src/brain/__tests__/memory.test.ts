import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectIndex } from '../../context/indexer.js';

import { OutcomesStore, hashTask } from '../memory/outcomes.js';
import { buildBM25Index, tokenize } from '../memory/bm25.js';
import { retrieve } from '../memory/retriever.js';
import { TokenBudget } from '../tokens.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mint-brain-'));
  mkdirSync(join(dir, '.mint'), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

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

function fixtureIndex(): ProjectIndex {
  const mkSymbol = (name: string, signature: string) => ({
    name,
    kind: 'function' as const,
    signature,
    startLine: 1,
    endLine: 10,
  });

  return {
    projectRoot: '/fixture',
    totalFiles: 4,
    totalLOC: 400,
    language: 'typescript',
    indexedAt: new Date().toISOString(),
    files: {
      'src/auth/login.ts': {
        imports: ['../utils/hash'],
        exports: ['loginUser'],
        symbols: [mkSymbol('loginUser', 'async function loginUser(email, password)')],
        summary: 'User authentication login flow with email and password',
        loc: 120,
        language: 'typescript',
        size: 3000,
      },
      'src/auth/logout.ts': {
        imports: [],
        exports: ['logoutUser'],
        symbols: [mkSymbol('logoutUser', 'function logoutUser(sessionId)')],
        summary: 'Clears session token',
        loc: 30,
        language: 'typescript',
        size: 800,
      },
      'src/ui/Header.tsx': {
        imports: ['react'],
        exports: ['Header'],
        symbols: [mkSymbol('Header', 'function Header()')],
        summary: 'App header component with navigation links',
        loc: 60,
        language: 'typescript',
        size: 1500,
      },
      'src/utils/hash.ts': {
        imports: [],
        exports: ['hashPassword'],
        symbols: [mkSymbol('hashPassword', 'function hashPassword(plain)')],
        summary: 'Password hashing utilities using argon2',
        loc: 40,
        language: 'typescript',
        size: 1000,
      },
    },
    graph: {
      'src/auth/login.ts': { imports: ['src/utils/hash.ts'], importedBy: [] },
      'src/utils/hash.ts': { imports: [], importedBy: ['src/auth/login.ts'] },
      'src/auth/logout.ts': { imports: [], importedBy: [] },
      'src/ui/Header.tsx': { imports: [], importedBy: [] },
    },
  };
}

// ─── Outcomes ──────────────────────────────────────────────────────────────

describe('OutcomesStore', () => {
  it('round-trips an outcome row', () => {
    const dir = makeTempDir();
    const store = new OutcomesStore(join(dir, '.mint', 'outcomes.sqlite'));

    const id = store.record({
      sessionId: 'sess-1',
      task: 'fix the auth bug',
      kind: 'debug',
      complexity: 'simple',
      filesTouched: ['src/auth/login.ts'],
      model: 'deepseek-v3',
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.0012,
      durationMs: 4500,
      toolCalls: 3,
      iterations: 2,
      success: true,
      userAccepted: 1,
    });

    expect(id).toBeGreaterThan(0);

    const recent = store.recent(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].task).toBe('fix the auth bug');
    expect(recent[0].filesTouched).toEqual(['src/auth/login.ts']);
    expect(recent[0].success).toBe(true);
    expect(recent[0].userAccepted).toBe(1);
    expect(recent[0].kind).toBe('debug');

    store.close();
  });

  it('finds similar tasks by hash and substring', () => {
    const dir = makeTempDir();
    const store = new OutcomesStore(join(dir, '.mint', 'outcomes.sqlite'));

    store.record({
      sessionId: 's1',
      task: 'refactor the auth module',
      kind: 'refactor',
      complexity: 'complex',
      filesTouched: [],
      model: 'kimi-k2',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      durationMs: 0,
      toolCalls: 0,
      iterations: 0,
      success: true,
    });
    store.record({
      sessionId: 's2',
      task: 'fix css in header',
      kind: 'edit_small',
      complexity: 'trivial',
      filesTouched: [],
      model: 'deepseek-v3',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      durationMs: 0,
      toolCalls: 0,
      iterations: 0,
      success: true,
    });

    const exact = store.findSimilar('refactor the auth module');
    expect(exact.length).toBeGreaterThanOrEqual(1);
    expect(exact[0].taskHash).toBe(hashTask('refactor the auth module'));

    const substring = store.findSimilar('refactor the auth');
    expect(substring.length).toBeGreaterThanOrEqual(1);
    expect(substring[0].task).toContain('refactor');

    store.close();
  });

  it('prunes to a maximum row count', () => {
    const dir = makeTempDir();
    const store = new OutcomesStore(join(dir, '.mint', 'outcomes.sqlite'));

    for (let i = 0; i < 5; i++) {
      store.record({
        sessionId: `s${i}`,
        task: `task ${i}`,
        kind: 'edit_small',
        complexity: 'simple',
        filesTouched: [],
        model: 'deepseek-v3',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        durationMs: 0,
        toolCalls: 0,
        iterations: 0,
        success: true,
      });
    }
    expect(store.count()).toBe(5);

    store.prune(2);
    expect(store.count()).toBe(2);

    store.close();
  });
});

// ─── Tokenizer ─────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('splits identifiers on camelCase and separators', () => {
    const tokens = tokenize('useAgentEvents in src/tui/hooks/useAgentEvents.ts');
    // "use" is filtered as a stop-word — the meaningful camelCase fragments
    // make it through.
    expect(tokens).toContain('agent');
    expect(tokens).toContain('events');
    expect(tokens).toContain('tui');
    expect(tokens).toContain('hooks');
  });

  it('drops stop words and short tokens', () => {
    const tokens = tokenize('the a an of and is to fix');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('a');
    expect(tokens).not.toContain('fix'); // stop-word for our classifier domain
  });
});

// ─── BM25 ──────────────────────────────────────────────────────────────────

describe('BM25Index', () => {
  it('ranks auth files above unrelated files for an auth query', () => {
    const index = fixtureIndex();
    const bm25 = buildBM25Index(index);
    const hits = bm25.search('login authentication password', 10);
    expect(hits.length).toBeGreaterThan(0);
    // The login file should appear above the header file.
    const paths = hits.map((h) => h.path);
    const loginIdx = paths.indexOf('src/auth/login.ts');
    const headerIdx = paths.indexOf('src/ui/Header.tsx');
    expect(loginIdx).toBeGreaterThanOrEqual(0);
    // Header is either absent (preferred) or ranked after login.
    if (headerIdx >= 0) {
      expect(loginIdx).toBeLessThan(headerIdx);
    }
  });

  it('returns empty for an empty query', () => {
    const bm25 = buildBM25Index(fixtureIndex());
    expect(bm25.search('', 10)).toHaveLength(0);
  });
});

// ─── Retriever ─────────────────────────────────────────────────────────────

describe('retrieve', () => {
  it('returns BM25 hits + graph expansion when embeddings are absent', async () => {
    const index = fixtureIndex();
    const bm25 = buildBM25Index(index);
    const budget = new TokenBudget('deepseek-v3');

    const result = await retrieve(
      { task: 'fix login password flow', budget, maxFiles: 5 },
      { index, bm25 },
    );

    expect(result.files.length).toBeGreaterThan(0);
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('src/auth/login.ts');
    // Graph expansion should pull in hash.ts (imported by login.ts).
    expect(paths).toContain('src/utils/hash.ts');

    // Source tags are correct.
    const login = result.files.find((f) => f.path === 'src/auth/login.ts')!;
    expect(['bm25', 'fusion']).toContain(login.source);
  });

  it('respects the file cap', async () => {
    const index = fixtureIndex();
    const bm25 = buildBM25Index(index);
    const budget = new TokenBudget('deepseek-v3');

    const result = await retrieve(
      { task: 'auth', budget, maxFiles: 2 },
      { index, bm25 },
    );

    expect(result.files.length).toBeLessThanOrEqual(2);
  });

  it('surfaces past outcomes when a store is provided', async () => {
    const dir = makeTempDir();
    const store = new OutcomesStore(join(dir, '.mint', 'outcomes.sqlite'));
    store.record({
      sessionId: 's1',
      task: 'fix login password flow',
      kind: 'debug',
      complexity: 'moderate',
      filesTouched: ['src/auth/login.ts'],
      model: 'deepseek-v3',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      durationMs: 0,
      toolCalls: 0,
      iterations: 0,
      success: true,
    });

    const index = fixtureIndex();
    const bm25 = buildBM25Index(index);
    const budget = new TokenBudget('deepseek-v3');

    const result = await retrieve(
      { task: 'fix login password flow', budget },
      { index, bm25, outcomes: store },
    );

    expect(result.outcomes.length).toBeGreaterThan(0);
    expect(result.outcomes[0].kind).toBe('debug');
    store.close();
  });
});
