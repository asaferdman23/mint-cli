/**
 * Typed memory SQLite layer (PR4 — L3 project memory).
 *
 * Path: `<cwd>/.mint/memory.sqlite`. Parallel to `outcomes.sqlite`; this store
 * holds the typed Memory union described in `yes-lets-plan-ths-zesty-sutherland.md`:
 *
 *   preferences | facts | decisions | episodes | open_questions
 *
 * Conventions mirror `outcomes.ts`:
 *   - WAL mode + synchronous=NORMAL
 *   - schema_version PRAGMA via `PRAGMA user_version`
 *   - dedupe via UNIQUE(normalized_key) on preferences + facts
 *   - BEGIN IMMEDIATE for any write that contends across mint processes
 *   - secret denylist enforced at the `write()` boundary
 */
import Database, { type Database as Db } from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BM25Index, tokenize } from './bm25.js';
import { containsSecret } from './redact.js';

export const MEMORY_SCHEMA_VERSION = 1;

// ─── Public types ───────────────────────────────────────────────────────────

export type MemoryKind =
  | 'preference'
  | 'fact'
  | 'decision'
  | 'episode'
  | 'open_question';

export interface PreferenceMemory {
  kind: 'preference';
  text: string;
  confidence?: number;
  lastSeen?: number;
}

export interface FactMemory {
  kind: 'fact';
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  lastSeen?: number;
}

export interface DecisionMemory {
  kind: 'decision';
  turn: number;
  rationale: string;
  files: string[];
}

export interface EpisodeMemory {
  kind: 'episode';
  turn: number;
  userTask: string;
  outcome: 'success' | 'partial' | 'reverted';
  filesTouched: string[];
}

export interface OpenQuestionMemory {
  kind: 'open_question';
  text: string;
  resolvedAt?: number | null;
}

export type Memory =
  | PreferenceMemory
  | FactMemory
  | DecisionMemory
  | EpisodeMemory
  | OpenQuestionMemory;

export interface WriteResult {
  action: 'insert' | 'increment' | 'replace' | 'rejected';
}

/** Optional telemetry hook fired after each `write()`. Sync, best-effort —
 *  callers must not throw. Used by `loop.ts` to forward `memory.write` events
 *  into the trace JSONL. */
export type MemoryWriteCallback = (event: {
  kind: MemoryKind;
  action: WriteResult['action'];
}) => void;

export interface MemoryStoreOptions {
  /** Override clock — tests inject this. */
  nowFn?: () => number;
  /** Telemetry hook fired after every `write()` (including rejections). */
  onWrite?: MemoryWriteCallback;
}

export interface QueryInput {
  kinds?: MemoryKind[];
  k?: number;
  /** When provided, hybrid-score memories against this query text via BM25 +
   *  recency (+ confidence for preferences/facts). Absent → pure recency. */
  query?: string;
  /** Half-life for recency decay in days. Default: 14. */
  halfLifeDays?: number;
}

/** Scored memory row — the QueryRow plus the fused score and per-component
 *  breakdown. Used by `queryScored()` and forwarded into the `memory.retrieved`
 *  trace event so `mint trace --memory` can show why a memory ranked where it
 *  did. */
export interface ScoredMemory {
  memory: QueryRow;
  /** Reciprocal-rank-fused score across components. Higher = more relevant. */
  score: number;
  /** Per-component raw values for diagnostics. bm25 only present when a query
   *  was provided; confidence only present for preferences/facts. */
  components: { bm25?: number; recency: number; confidence?: number };
}

export interface QueryRow {
  id: number;
  kind: MemoryKind;
  /** Flat text suitable for prompt injection. */
  text: string;
  confidence: number;
  lastSeen: number;
}

const ALL_KINDS: MemoryKind[] = [
  'preference',
  'fact',
  'decision',
  'episode',
  'open_question',
];

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Normalization ─────────────────────────────────────────────────────────

function normalizeText(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}

function memoryHasSecret(m: Memory): boolean {
  switch (m.kind) {
    case 'preference':
      return containsSecret(m.text);
    case 'fact':
      return (
        containsSecret(m.subject) ||
        containsSecret(m.predicate) ||
        containsSecret(m.object)
      );
    case 'decision':
      return containsSecret(m.rationale);
    case 'episode':
      return containsSecret(m.userTask);
    case 'open_question':
      return containsSecret(m.text);
  }
}

// ─── Store ─────────────────────────────────────────────────────────────────

/** Standalone migration runner — exposed so launch-time tooling and tests can
 *  verify migrations apply without instantiating a MemoryStore. Always called
 *  by the MemoryStore constructor before any other DDL. Memories outlive the
 *  binary that wrote them, so future schema changes add another `if (current
 *  < N)` block here and bump `MEMORY_SCHEMA_VERSION`. */
export function runMigrations(db: Db): void {
  const row = db.pragma('user_version', { simple: true }) as number;
  const current = typeof row === 'number' ? row : 0;

  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        normalized_key TEXT UNIQUE NOT NULL,
        text TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        hit_count INTEGER NOT NULL DEFAULT 1,
        last_seen INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pref_last_seen ON preferences(last_seen);

      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        normalized_key TEXT UNIQUE NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        last_seen INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fact_last_seen ON facts(last_seen);

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn INTEGER NOT NULL,
        rationale TEXT NOT NULL,
        files TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dec_created ON decisions(created_at);

      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn INTEGER NOT NULL,
        user_task TEXT NOT NULL,
        outcome TEXT NOT NULL,
        files_touched TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ep_created ON episodes(created_at);

      CREATE TABLE IF NOT EXISTS open_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        raised_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_oq_raised ON open_questions(raised_at);
    `);
    db.pragma(`user_version = 1`);
  }
  // Future migrations: `if (current < 2) { ... db.pragma('user_version = 2'); }`
}

export class MemoryStore {
  private readonly db: Db;
  private readonly nowFn: () => number;
  private readonly onWrite?: MemoryWriteCallback;

  constructor(
    dbPath: string,
    optionsOrNowFn: MemoryStoreOptions | (() => number) = {},
  ) {
    const dir = join(dbPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    // Back-compat: accept either `(path, nowFn)` (legacy test signature) or
    // `(path, { nowFn?, onWrite? })`. Detect a bare function for the old shape.
    if (typeof optionsOrNowFn === 'function') {
      this.nowFn = optionsOrNowFn;
    } else {
      this.nowFn = optionsOrNowFn.nowFn ?? (() => Date.now());
      this.onWrite = optionsOrNowFn.onWrite;
    }

    this.migrate();
  }

  private migrate(): void {
    runMigrations(this.db);
  }

  /** Schema version PRAGMA (exposed for tests). */
  schemaVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number;
  }

  /**
   * Write a memory. Secrets cause a hard rejection. Dedupe rules:
   *   preference/fact: collision on normalized_key → confidence += 0.1
   *                    (clamped 1.0), hit_count++, last_seen = now → 'increment'
   *   fact same subject+predicate, different object → 'replace' if new.conf > old.
   *   decision/episode/open_question: insert-only (history rows).
   */
  async write(kind: MemoryKind, payload: Memory): Promise<WriteResult> {
    const result = await this.writeInner(kind, payload);
    if (this.onWrite) {
      try {
        this.onWrite({ kind, action: result.action });
      } catch {
        /* telemetry must never break a write */
      }
    }
    return result;
  }

  private async writeInner(kind: MemoryKind, payload: Memory): Promise<WriteResult> {
    if (payload.kind !== kind) {
      // Defensive — the loop wires kind from the payload itself, but if a
      // caller diverges we'd silently mis-route. Treat as rejected.
      return { action: 'rejected' };
    }
    if (memoryHasSecret(payload)) return { action: 'rejected' };

    const now = this.nowFn();

    switch (payload.kind) {
      case 'preference':
        return this.writePreference(payload, now);
      case 'fact':
        return this.writeFact(payload, now);
      case 'decision':
        return this.writeDecision(payload, now);
      case 'episode':
        return this.writeEpisode(payload, now);
      case 'open_question':
        return this.writeOpenQuestion(payload, now);
    }
  }

  private writePreference(p: PreferenceMemory, now: number): WriteResult {
    const key = normalizeText(p.text);
    if (!key) return { action: 'rejected' };
    const conf = clamp01(p.confidence ?? 0.5);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db
        .prepare('SELECT id, confidence, hit_count FROM preferences WHERE normalized_key = ?')
        .get(key) as { id: number; confidence: number; hit_count: number } | undefined;

      let action: WriteResult['action'];
      if (existing) {
        const newConf = clamp01(existing.confidence + 0.1);
        this.db
          .prepare(
            'UPDATE preferences SET confidence = ?, hit_count = hit_count + 1, last_seen = ? WHERE id = ?',
          )
          .run(newConf, now, existing.id);
        action = 'increment';
      } else {
        this.db
          .prepare(
            'INSERT INTO preferences (normalized_key, text, confidence, hit_count, last_seen, created_at) VALUES (?, ?, ?, 1, ?, ?)',
          )
          .run(key, p.text, conf, now, now);
        action = 'insert';
      }
      this.db.exec('COMMIT');
      return { action };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  private writeFact(f: FactMemory, now: number): WriteResult {
    const sub = normalizeText(f.subject);
    const pred = normalizeText(f.predicate);
    if (!sub || !pred) return { action: 'rejected' };
    const key = `${sub}||${pred}`;
    const conf = clamp01(f.confidence ?? 0.5);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db
        .prepare(
          'SELECT id, object, confidence FROM facts WHERE normalized_key = ?',
        )
        .get(key) as { id: number; object: string; confidence: number } | undefined;

      let action: WriteResult['action'];
      if (existing) {
        const sameObject = normalizeText(existing.object) === normalizeText(f.object);
        if (sameObject) {
          const newConf = clamp01(existing.confidence + 0.1);
          this.db
            .prepare(
              'UPDATE facts SET confidence = ?, last_seen = ? WHERE id = ?',
            )
            .run(newConf, now, existing.id);
          action = 'increment';
        } else if (conf > existing.confidence) {
          this.db
            .prepare(
              'UPDATE facts SET object = ?, confidence = ?, last_seen = ? WHERE id = ?',
            )
            .run(f.object, conf, now, existing.id);
          action = 'replace';
        } else {
          // Conflicting fact with lower confidence — drop on the floor.
          action = 'rejected';
        }
      } else {
        this.db
          .prepare(
            'INSERT INTO facts (normalized_key, subject, predicate, object, confidence, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(key, f.subject, f.predicate, f.object, conf, now, now);
        action = 'insert';
      }
      this.db.exec('COMMIT');
      return { action };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  private writeDecision(d: DecisionMemory, now: number): WriteResult {
    this.db
      .prepare(
        'INSERT INTO decisions (turn, rationale, files, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(d.turn, d.rationale, JSON.stringify(d.files ?? []), now);
    return { action: 'insert' };
  }

  private writeEpisode(e: EpisodeMemory, now: number): WriteResult {
    this.db
      .prepare(
        'INSERT INTO episodes (turn, user_task, outcome, files_touched, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(e.turn, e.userTask, e.outcome, JSON.stringify(e.filesTouched ?? []), now);
    return { action: 'insert' };
  }

  private writeOpenQuestion(q: OpenQuestionMemory, now: number): WriteResult {
    this.db
      .prepare(
        'INSERT INTO open_questions (text, raised_at, resolved_at) VALUES (?, ?, ?)',
      )
      .run(q.text, now, q.resolvedAt ?? null);
    return { action: 'insert' };
  }

  /**
   * Recency-only query for v1 (BM25 hybrid lands in a later PR).
   * Returns up to `k` per requested kind, ordered most-recent first.
   */
  async query(input: QueryInput = {}): Promise<QueryRow[]> {
    const kinds = input.kinds ?? ALL_KINDS;
    const k = input.k ?? 10;
    const out: QueryRow[] = [];

    for (const kind of kinds) {
      switch (kind) {
        case 'preference': {
          const rows = this.db
            .prepare(
              'SELECT id, text, confidence, last_seen FROM preferences ORDER BY last_seen DESC LIMIT ?',
            )
            .all(k) as Array<{ id: number; text: string; confidence: number; last_seen: number }>;
          for (const r of rows) {
            out.push({
              id: r.id,
              kind: 'preference',
              text: r.text,
              confidence: r.confidence,
              lastSeen: r.last_seen,
            });
          }
          break;
        }
        case 'fact': {
          const rows = this.db
            .prepare(
              'SELECT id, subject, predicate, object, confidence, last_seen FROM facts ORDER BY last_seen DESC LIMIT ?',
            )
            .all(k) as Array<{
            id: number;
            subject: string;
            predicate: string;
            object: string;
            confidence: number;
            last_seen: number;
          }>;
          for (const r of rows) {
            out.push({
              id: r.id,
              kind: 'fact',
              text: `${r.subject} ${r.predicate} ${r.object}`,
              confidence: r.confidence,
              lastSeen: r.last_seen,
            });
          }
          break;
        }
        case 'decision': {
          const rows = this.db
            .prepare(
              'SELECT id, rationale, created_at FROM decisions ORDER BY created_at DESC LIMIT ?',
            )
            .all(k) as Array<{ id: number; rationale: string; created_at: number }>;
          for (const r of rows) {
            out.push({
              id: r.id,
              kind: 'decision',
              text: r.rationale,
              confidence: 1,
              lastSeen: r.created_at,
            });
          }
          break;
        }
        case 'episode': {
          const rows = this.db
            .prepare(
              'SELECT id, user_task, outcome, created_at FROM episodes ORDER BY created_at DESC LIMIT ?',
            )
            .all(k) as Array<{ id: number; user_task: string; outcome: string; created_at: number }>;
          for (const r of rows) {
            out.push({
              id: r.id,
              kind: 'episode',
              text: `${r.user_task} → ${r.outcome}`,
              confidence: 1,
              lastSeen: r.created_at,
            });
          }
          break;
        }
        case 'open_question': {
          const rows = this.db
            .prepare(
              'SELECT id, text, raised_at FROM open_questions WHERE resolved_at IS NULL ORDER BY raised_at DESC LIMIT ?',
            )
            .all(k) as Array<{ id: number; text: string; raised_at: number }>;
          for (const r of rows) {
            out.push({
              id: r.id,
              kind: 'open_question',
              text: r.text,
              confidence: 1,
              lastSeen: r.raised_at,
            });
          }
          break;
        }
      }
    }
    // Within the result set, sort overall by recency so the prompt gets the
    // freshest signal first.
    out.sort((a, b) => b.lastSeen - a.lastSeen);
    return out;
  }

  /**
   * Hybrid-scored query. Pulls candidates per kind (most-recent ordered, same
   * as `query()`), then ranks them by reciprocal rank fusion across:
   *   - BM25 over the memory's flat text (only when `input.query` is provided)
   *   - recency: exponential decay with `halfLifeDays` (default 14)
   *   - confidence: pass-through, preferences/facts only
   *
   * RRF: `score = Σ 1/(K + rank)` with K=60, matching `retriever.ts`. Components
   * that don't apply to a kind (e.g. confidence on episodes) are simply skipped
   * — no zero-padding.
   *
   * Cost: per-call BM25 index build over the candidate pool. Memory volumes are
   * tiny (≤ ~200 entries per kind) so we don't bother caching. Bench: ~1ms for
   * 200 preferences on an M-series Mac (verified in store.test.ts).
   *
   * When `input.query` is omitted, falls back to pure-recency ordering — i.e.
   * the same shape as `query()` but with `ScoredMemory` envelopes.
   */
  async queryScored(input: QueryInput = {}): Promise<ScoredMemory[]> {
    const halfLifeMs = (input.halfLifeDays ?? 14) * 86400_000;
    const rows = await this.query(input);
    if (rows.length === 0) return [];

    const now = this.nowFn();
    const recency = (r: QueryRow): number =>
      Math.pow(0.5, (now - r.lastSeen) / halfLifeMs);
    const hasConfidence = (r: QueryRow): boolean =>
      r.kind === 'preference' || r.kind === 'fact';

    // No query text → recency-only fallback (still RRF-style for a stable shape).
    if (!input.query || !input.query.trim()) {
      const out: ScoredMemory[] = rows.map((memory) => {
        const rec = recency(memory);
        const components: ScoredMemory['components'] = { recency: rec };
        if (hasConfidence(memory)) components.confidence = memory.confidence;
        return { memory, score: rec, components };
      });
      out.sort((a, b) => b.score - a.score);
      return out;
    }

    // BM25 over the candidate pool. We synthesize one document per row using
    // its flat text — same string surface as what we'd inject into the prompt.
    const docs = rows.map((r) => ({ path: String(r.id), tokens: tokenize(r.text), summary: '' }));
    const bm25 = new BM25Index(docs);
    const bm25Hits = bm25.search(input.query, rows.length);
    const bm25RawByPath = new Map<string, number>();
    for (const h of bm25Hits) bm25RawByPath.set(h.path, h.score);

    // Per-component ranked lists. Each list is `[id, rank]` ordered descending
    // by that component's raw value. Ties are broken by insertion order — fine
    // for our scales.
    const rankList = (
      pairs: Array<{ id: number; value: number }>,
    ): Map<number, number> => {
      const sorted = [...pairs].sort((a, b) => b.value - a.value);
      const ranks = new Map<number, number>();
      for (let i = 0; i < sorted.length; i++) ranks.set(sorted[i].id, i + 1);
      return ranks;
    };

    const bm25Ranks = rankList(
      rows.map((r) => ({ id: r.id, value: bm25RawByPath.get(String(r.id)) ?? 0 })),
    );
    const recencyRanks = rankList(rows.map((r) => ({ id: r.id, value: recency(r) })));
    const confidenceRows = rows.filter(hasConfidence);
    const confidenceRanks = rankList(
      confidenceRows.map((r) => ({ id: r.id, value: r.confidence })),
    );

    const K = 60;
    const out: ScoredMemory[] = rows.map((memory) => {
      const bm25Raw = bm25RawByPath.get(String(memory.id)) ?? 0;
      const rec = recency(memory);
      let score = 0;
      // BM25 only contributes when the term actually hit (raw > 0). A zero
      // BM25 row shouldn't earn RRF credit just for existing — that would
      // collapse the ranking back into pure recency.
      if (bm25Raw > 0) {
        const r = bm25Ranks.get(memory.id);
        if (r) score += 1 / (K + r);
      }
      const rr = recencyRanks.get(memory.id);
      if (rr) score += 1 / (K + rr);
      if (hasConfidence(memory)) {
        const cr = confidenceRanks.get(memory.id);
        if (cr) score += 1 / (K + cr);
      }
      const components: ScoredMemory['components'] = { recency: rec };
      if (bm25Raw > 0) components.bm25 = bm25Raw;
      if (hasConfidence(memory)) components.confidence = memory.confidence;
      return { memory, score, components };
    });

    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /** Delete a memory by numeric id. Tries every kind table; returns true if a
   *  row was removed. Used by the `/forget` slash command. */
  deleteById(id: number): boolean {
    const tables = ['preferences', 'facts', 'decisions', 'episodes', 'open_questions'];
    for (const t of tables) {
      const r = this.db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id);
      if (Number(r.changes ?? 0) > 0) return true;
    }
    return false;
  }

  /** Count rows across all tables. Used by `/memory clear` dry-run. */
  count(): number {
    const tables = ['preferences', 'facts', 'decisions', 'episodes', 'open_questions'];
    let total = 0;
    for (const t of tables) {
      const r = this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
      total += r.n;
    }
    return total;
  }

  /** Delete every row across all tables. Returns total rows removed.
   *  Caller is responsible for any UX confirmation gating. */
  clearAll(): number {
    const tables = ['preferences', 'facts', 'decisions', 'episodes', 'open_questions'];
    let total = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of tables) {
        const r = this.db.prepare(`DELETE FROM ${t}`).run();
        total += Number(r.changes ?? 0);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
    return total;
  }

  /** Drop low-confidence stale preferences. Returns count removed. */
  async evict(): Promise<{ removed: number }> {
    const cutoff = this.nowFn() - STALE_MS;
    const result = this.db
      .prepare('DELETE FROM preferences WHERE confidence < 0.3 AND last_seen < ?')
      .run(cutoff);
    return { removed: Number(result.changes ?? 0) };
  }

  close(): void {
    this.db.close();
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/** Open (or create) the L3 memory store at `<cwd>/.mint/memory.sqlite`.
 *  If `options.path` is supplied, that absolute path is used directly and the
 *  `<cwd>/.mint/` resolution is skipped — this is how `openUserMemoryStore`
 *  shares the underlying SQLite layer for the L4 user-global store. */
export function openMemoryStore(
  cwd: string,
  options?: { path?: string; onWrite?: MemoryWriteCallback },
): MemoryStore {
  const path = options?.path ?? join(cwd, '.mint', 'memory.sqlite');
  return new MemoryStore(path, { onWrite: options?.onWrite });
}

/** Open (or create) the L4 user-global memory store at `~/.mint/memory.sqlite`.
 *  Shares the same schema as the project store; isolation between the two is
 *  purely by file path (different SQLite files, no shared rows). */
export function openUserMemoryStore(options?: {
  onWrite?: MemoryWriteCallback;
}): MemoryStore {
  const path = join(homedir(), '.mint', 'memory.sqlite');
  return new MemoryStore(path, { onWrite: options?.onWrite });
}
