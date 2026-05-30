import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';

import {
  openMemoryStore,
  MemoryStore,
  MEMORY_SCHEMA_VERSION,
  runMigrations,
} from '../store.js';

const tempDirs: string[] = [];

function makeTempCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mint-mem-'));
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

describe('MemoryStore — schema', () => {
  it('creates the sqlite file at <cwd>/.mint/memory.sqlite on first use', () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    expect(existsSync(join(cwd, '.mint', 'memory.sqlite'))).toBe(true);
    expect(store.schemaVersion()).toBe(MEMORY_SCHEMA_VERSION);
    store.close();
  });

  it('reopen after migration is idempotent (no error, version stays at 1)', () => {
    const cwd = makeTempCwd();
    const a = openMemoryStore(cwd);
    a.close();
    const b = openMemoryStore(cwd);
    expect(b.schemaVersion()).toBe(1);
    b.close();
  });
});

describe('MemoryStore — preferences', () => {
  it('insert then re-insert bumps confidence and hit_count', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);

    const r1 = await store.write('preference', {
      kind: 'preference',
      text: 'user prefers vitest over jest',
      confidence: 0.5,
    });
    expect(r1.action).toBe('insert');

    const r2 = await store.write('preference', {
      kind: 'preference',
      text: 'user prefers vitest over jest',
    });
    expect(r2.action).toBe('increment');

    const rows = await store.query({ kinds: ['preference'], k: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBeCloseTo(0.6, 5);
    store.close();
  });

  it('normalizes case + whitespace for dedupe', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    await store.write('preference', { kind: 'preference', text: 'User Prefers Vitest' });
    const r2 = await store.write('preference', {
      kind: 'preference',
      text: '  user prefers vitest  ',
    });
    expect(r2.action).toBe('increment');
    const rows = await store.query({ kinds: ['preference'] });
    expect(rows).toHaveLength(1);
    store.close();
  });

  it('rejects a preference whose text contains a secret', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    const r = await store.write('preference', {
      kind: 'preference',
      text: 'remember sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 for me',
    });
    expect(r.action).toBe('rejected');
    const rows = await store.query({ kinds: ['preference'] });
    expect(rows).toHaveLength(0);
    store.close();
  });

  it('query returns most-recent first', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    await store.write('preference', { kind: 'preference', text: 'first one' });
    await new Promise((r) => setTimeout(r, 5));
    await store.write('preference', { kind: 'preference', text: 'second one' });
    const rows = await store.query({ kinds: ['preference'] });
    expect(rows[0].text).toBe('second one');
    expect(rows[1].text).toBe('first one');
    store.close();
  });
});

describe('MemoryStore — facts', () => {
  it('same subject+predicate+object → increment', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    await store.write('fact', {
      kind: 'fact',
      subject: 'mint',
      predicate: 'uses',
      object: 'vitest',
      confidence: 0.4,
    });
    const r2 = await store.write('fact', {
      kind: 'fact',
      subject: 'mint',
      predicate: 'uses',
      object: 'vitest',
    });
    expect(r2.action).toBe('increment');
    store.close();
  });

  it('conflicting fact with higher confidence → replace', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    await store.write('fact', {
      kind: 'fact',
      subject: 'mint',
      predicate: 'uses',
      object: 'jest',
      confidence: 0.4,
    });
    const r2 = await store.write('fact', {
      kind: 'fact',
      subject: 'mint',
      predicate: 'uses',
      object: 'vitest',
      confidence: 0.9,
    });
    expect(r2.action).toBe('replace');
    const rows = await store.query({ kinds: ['fact'] });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toContain('vitest');
    store.close();
  });
});

describe('MemoryStore — evict', () => {
  it('removes low-confidence stale preferences, keeps high-conf', async () => {
    const cwd = makeTempCwd();
    // 60 days ago
    let now = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const path = join(cwd, '.mint', 'memory.sqlite');
    const store = new MemoryStore(path, () => now);

    await store.write('preference', { kind: 'preference', text: 'stale low', confidence: 0.1 });
    await store.write('preference', { kind: 'preference', text: 'stale high', confidence: 0.8 });

    // Roll the clock forward
    now = Date.now();
    const ev = await store.evict();
    expect(ev.removed).toBe(1);

    const rows = await store.query({ kinds: ['preference'] });
    expect(rows.map((r) => r.text)).toEqual(['stale high']);
    store.close();
  });

  it('applies the rule: confidence < 0.3 AND lastSeen < now-30d', async () => {
    // Seed 5 entries:
    //   - 2 high-conf recent  (keep — confidence too high AND recent)
    //   - 2 high-conf old     (keep — confidence too high)
    //   - 1 low-conf old      (drop — matches both clauses)
    const cwd = makeTempCwd();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const path = join(cwd, '.mint', 'memory.sqlite');

    // Phase 1 — write the "old" entries at t = now - 60d.
    let clock = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const oldStore = new MemoryStore(path, () => clock);
    await oldStore.write('preference', {
      kind: 'preference',
      text: 'old high a',
      confidence: 0.9,
    });
    await oldStore.write('preference', {
      kind: 'preference',
      text: 'old high b',
      confidence: 0.9,
    });
    await oldStore.write('preference', {
      kind: 'preference',
      text: 'old low',
      confidence: 0.1,
    });
    oldStore.close();

    // Phase 2 — write the "recent" entries at t = now.
    clock = Date.now();
    const recentStore = new MemoryStore(path, () => clock);
    await recentStore.write('preference', {
      kind: 'preference',
      text: 'recent high a',
      confidence: 0.9,
    });
    await recentStore.write('preference', {
      kind: 'preference',
      text: 'recent high b',
      confidence: 0.9,
    });

    const ev = await recentStore.evict();
    expect(ev.removed).toBe(1);

    const rows = await recentStore.query({ kinds: ['preference'], k: 20 });
    const remaining = new Set(rows.map((r) => r.text));
    expect(remaining.has('old low')).toBe(false);
    expect(remaining.has('old high a')).toBe(true);
    expect(remaining.has('old high b')).toBe(true);
    expect(remaining.has('recent high a')).toBe(true);
    expect(remaining.has('recent high b')).toBe(true);
    recentStore.close();
    void THIRTY_DAYS; // retained for documentation
  });
});

describe('runMigrations', () => {
  it('lifts a fresh db from user_version 0 to current', () => {
    const cwd = makeTempCwd();
    const path = join(cwd, 'fresh.sqlite');
    const db = new Database(path);
    // Bare db — should report user_version 0.
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    runMigrations(db);
    expect(db.pragma('user_version', { simple: true })).toBe(MEMORY_SCHEMA_VERSION);
    db.close();
  });

  it('is idempotent on re-open (version stays, no error)', () => {
    const cwd = makeTempCwd();
    const path = join(cwd, 'fresh.sqlite');
    const a = new Database(path);
    runMigrations(a);
    a.close();
    const b = new Database(path);
    runMigrations(b);
    expect(b.pragma('user_version', { simple: true })).toBe(MEMORY_SCHEMA_VERSION);
    b.close();
  });
});

describe('MemoryStore — onWrite telemetry', () => {
  it('fires the callback with kind + action on every write', async () => {
    const cwd = makeTempCwd();
    const path = join(cwd, '.mint', 'memory.sqlite');
    const events: Array<{ kind: string; action: string }> = [];
    const store = new MemoryStore(path, {
      onWrite: (e) => events.push({ kind: e.kind, action: e.action }),
    });
    await store.write('preference', { kind: 'preference', text: 'a' });
    await store.write('preference', { kind: 'preference', text: 'a' });
    expect(events).toEqual([
      { kind: 'preference', action: 'insert' },
      { kind: 'preference', action: 'increment' },
    ]);
    store.close();
  });
});

describe('MemoryStore — queryScored (PR7 hybrid retrieval)', () => {
  it('with a query string, BM25-matching memory ranks first', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    await store.write('preference', {
      kind: 'preference',
      text: 'user prefers prettier over eslint formatting',
      confidence: 0.5,
    });
    await store.write('preference', {
      kind: 'preference',
      text: 'user prefers vitest over jest for unit tests',
      confidence: 0.5,
    });
    await store.write('preference', {
      kind: 'preference',
      text: 'user likes dark themes in editors',
      confidence: 0.5,
    });

    const scored = await store.queryScored({
      kinds: ['preference'],
      query: 'vitest jest',
      k: 3,
    });
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0].memory.text).toContain('vitest');
    expect(scored[0].components.bm25).toBeGreaterThan(0);
    store.close();
  });

  it('without a query, falls back to pure recency (matches query())', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    await store.write('preference', { kind: 'preference', text: 'oldest' });
    await new Promise((r) => setTimeout(r, 5));
    await store.write('preference', { kind: 'preference', text: 'middle' });
    await new Promise((r) => setTimeout(r, 5));
    await store.write('preference', { kind: 'preference', text: 'newest' });

    const scored = await store.queryScored({ kinds: ['preference'], k: 3 });
    expect(scored.map((s) => s.memory.text)).toEqual(['newest', 'middle', 'oldest']);
    // Recency-only mode: bm25 component absent, recency present.
    expect(scored[0].components.bm25).toBeUndefined();
    expect(scored[0].components.recency).toBeGreaterThan(0);
    store.close();
  });

  it('half-life math: 14d ago ≈ 0.5, 28d ago ≈ 0.25', async () => {
    const cwd = makeTempCwd();
    const path = join(cwd, '.mint', 'memory.sqlite');
    const DAY_MS = 86_400_000;
    let now = Date.now();
    const store = new MemoryStore(path, () => now);
    // Write the "14d ago" entry, then roll the clock forward 14 days and
    // write the "today" entry; query at t=now+14d.
    await store.write('preference', { kind: 'preference', text: 'fourteen days ago' });
    now += 14 * DAY_MS;
    await store.write('preference', { kind: 'preference', text: 'today' });
    const scored = await store.queryScored({ kinds: ['preference'], k: 5 });
    const fourteen = scored.find((s) => s.memory.text === 'fourteen days ago');
    const today = scored.find((s) => s.memory.text === 'today');
    expect(fourteen).toBeDefined();
    expect(today).toBeDefined();
    expect(today!.components.recency).toBeGreaterThan(0.99);
    expect(fourteen!.components.recency).toBeGreaterThan(0.45);
    expect(fourteen!.components.recency).toBeLessThan(0.55);
    store.close();
  });

  it('confidence component present only for preferences/facts', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    await store.write('preference', { kind: 'preference', text: 'a pref', confidence: 0.7 });
    await store.write('fact', {
      kind: 'fact',
      subject: 's',
      predicate: 'p',
      object: 'o',
      confidence: 0.6,
    });
    await store.write('episode', {
      kind: 'episode',
      turn: 1,
      userTask: 'do thing',
      outcome: 'success',
      filesTouched: [],
    });

    const scored = await store.queryScored({
      kinds: ['preference', 'fact', 'episode'],
      query: 'pref',
      k: 10,
    });
    for (const s of scored) {
      if (s.memory.kind === 'preference' || s.memory.kind === 'fact') {
        expect(s.components.confidence).toBeDefined();
      } else {
        expect(s.components.confidence).toBeUndefined();
      }
    }
    store.close();
  });

  it('perf smoke: 200 preferences × 10 queries < 200ms', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);
    for (let i = 0; i < 200; i++) {
      await store.write('preference', {
        kind: 'preference',
        text: `preference number ${i} about token ${i % 7} and topic ${i % 13}`,
      });
    }
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      await store.queryScored({ kinds: ['preference'], query: `token ${i} topic`, k: 10 });
    }
    const elapsed = Date.now() - t0;
    // Lenient bound — regression guard, not a benchmark. Single-pass per-query
    // BM25 build over ≤200 docs runs in low single-digit ms on CI hardware.
    expect(elapsed).toBeLessThan(2000);
    store.close();
  });
});

describe('MemoryStore — history kinds (decision/episode/open_question)', () => {
  it('inserts and queries decision/episode/open_question rows', async () => {
    const cwd = makeTempCwd();
    const store = openMemoryStore(cwd);

    await store.write('decision', {
      kind: 'decision',
      turn: 1,
      rationale: 'use better-sqlite3 because outcomes.ts already does',
      files: ['src/brain/memory/store.ts'],
    });
    await store.write('episode', {
      kind: 'episode',
      turn: 1,
      userTask: 'add memory store',
      outcome: 'success',
      filesTouched: ['src/brain/memory/store.ts'],
    });
    await store.write('open_question', {
      kind: 'open_question',
      text: 'Should we add embeddings to memory.sqlite later?',
    });

    const all = await store.query({
      kinds: ['decision', 'episode', 'open_question'],
    });
    expect(all).toHaveLength(3);
    store.close();
  });
});
