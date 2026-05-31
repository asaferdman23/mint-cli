/**
 * Outcomes store — persistent memory of every brain run.
 *
 * Each completed runBrain() call appends one row. The classifier and
 * retriever read from this store to inform future decisions:
 *   - Near-identical past tasks → seed classifier with priors
 *   - Successful model/kind combos → tune the routing table (via mint tune)
 *
 * Path: <cwd>/.mint/outcomes.sqlite
 */
import Database, { type Database as Db } from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Complexity, TaskKind } from '../events.js';
import type { ModelId } from '../../providers/types.js';

export interface OutcomeRow {
  id: number;
  ts: number;
  sessionId: string;
  task: string;
  taskHash: string;
  kind: TaskKind;
  complexity: Complexity;
  planJson: string | null;
  filesTouched: string[];
  model: ModelId;
  fallbackModel: ModelId | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  toolCalls: number;
  iterations: number;
  success: boolean;
  userAccepted: -1 | 0 | 1;
  embedding: Buffer | null;
  /** Recorded classifier feature vector (used by `mint tune`). */
  classifierFeatures: Record<string, number> | null;
  /** Power-user quality judgment: 'good' | 'meh' | 'bad' | null. Set via
   *  `mint rate <sessionId>` or the `mint bench` inline prompt. */
  userRating: string | null;
  /** Optional one-liner explaining the rating. */
  ratingNote: string | null;
  /** Multi-axis efficiency telemetry (2026-05-31). */
  toolsArrayTokensAvg: number | null;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  compactionCount: number;
}

export interface RecordOutcomeInput {
  sessionId: string;
  task: string;
  kind: TaskKind;
  complexity: Complexity;
  plan?: unknown;
  filesTouched: string[];
  model: ModelId;
  fallbackModel?: ModelId;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  toolCalls: number;
  iterations: number;
  success: boolean;
  /** -1 unknown, 0 rejected, 1 accepted. */
  userAccepted?: -1 | 0 | 1;
  /** Raw f32 embedding for the task description, if available. */
  embedding?: Float32Array;
  /** Classifier feature vector at the moment of routing (for `mint tune`). */
  classifierFeatures?: Record<string, number>;
  /** Avg tools-array token footprint per turn (constant within a session). */
  toolsArrayTokensAvg?: number;
  /** Sum of cache-read tokens across the session (Anthropic + others). */
  cacheReadTokens?: number;
  /** Sum of cache-write tokens across the session. */
  cacheCreationTokens?: number;
  /** Number of compaction events fired during the session. */
  compactionCount?: number;
}

export function hashTask(task: string): string {
  return createHash('sha256').update(task.trim().toLowerCase()).digest('hex').slice(0, 16);
}

export class OutcomesStore {
  private readonly db: Db;
  private readonly insertStmt;
  private readonly similarStmt;
  private readonly recentStmt;
  private readonly pruneStmt;
  private readonly countStmt;

  constructor(dbPath: string) {
    const dir = join(dbPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outcomes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        task TEXT NOT NULL,
        task_hash TEXT NOT NULL,
        kind TEXT NOT NULL,
        complexity TEXT NOT NULL,
        plan_json TEXT,
        files_touched TEXT NOT NULL,
        model TEXT NOT NULL,
        fallback_model TEXT,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        iterations INTEGER NOT NULL DEFAULT 0,
        success INTEGER NOT NULL DEFAULT 0,
        user_accepted INTEGER NOT NULL DEFAULT -1,
        embedding BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_task_hash ON outcomes(task_hash);
      CREATE INDEX IF NOT EXISTS idx_kind ON outcomes(kind);
      CREATE INDEX IF NOT EXISTS idx_ts ON outcomes(ts);
    `);

    // Schema migrations. SQLite has no ALTER TABLE IF NOT EXISTS so we
    // check table_info and only add columns that aren't already present.
    // Each migration is best-effort and idempotent.
    try {
      const cols = this.db.prepare(`PRAGMA table_info(outcomes)`).all() as Array<{ name: string }>;
      const has = (name: string): boolean => cols.some((c) => c.name === name);
      if (!has('classifier_features')) {
        this.db.exec(`ALTER TABLE outcomes ADD COLUMN classifier_features TEXT`);
      }
      // 2026-05-30: user judgment for `mint tune` to weight by quality, not
      // just the auto-flagged "didn't crash" success boolean. rating is one
      // of: 'good' | 'meh' | 'bad'; note is optional one-liner.
      if (!has('user_rating')) {
        this.db.exec(`ALTER TABLE outcomes ADD COLUMN user_rating TEXT`);
      }
      if (!has('rating_note')) {
        this.db.exec(`ALTER TABLE outcomes ADD COLUMN rating_note TEXT`);
      }
      // 2026-05-31: multi-axis token efficiency telemetry. Stored as
      // aggregates per session so `mint audit` can report without re-parsing
      // every trace JSONL.
      if (!has('tools_array_tokens_avg')) {
        this.db.exec(`ALTER TABLE outcomes ADD COLUMN tools_array_tokens_avg INTEGER`);
      }
      if (!has('cache_read_tokens')) {
        this.db.exec(`ALTER TABLE outcomes ADD COLUMN cache_read_tokens INTEGER DEFAULT 0`);
      }
      if (!has('cache_creation_tokens')) {
        this.db.exec(`ALTER TABLE outcomes ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0`);
      }
      if (!has('compaction_count')) {
        this.db.exec(`ALTER TABLE outcomes ADD COLUMN compaction_count INTEGER DEFAULT 0`);
      }
    } catch {
      /* migration is best-effort — schema may already be ahead of us */
    }

    this.insertStmt = this.db.prepare(`
      INSERT INTO outcomes (
        ts, session_id, task, task_hash, kind, complexity, plan_json, files_touched,
        model, fallback_model, tokens_in, tokens_out, cost_usd, duration_ms,
        tool_calls, iterations, success, user_accepted, embedding, classifier_features,
        tools_array_tokens_avg, cache_read_tokens, cache_creation_tokens, compaction_count
      ) VALUES (
        @ts, @sessionId, @task, @taskHash, @kind, @complexity, @planJson, @filesTouched,
        @model, @fallbackModel, @tokensIn, @tokensOut, @costUsd, @durationMs,
        @toolCalls, @iterations, @success, @userAccepted, @embedding, @classifierFeatures,
        @toolsArrayTokensAvg, @cacheReadTokens, @cacheCreationTokens, @compactionCount
      )
    `);

    this.similarStmt = this.db.prepare(`
      SELECT * FROM outcomes
      WHERE task_hash = ? OR task LIKE ?
      ORDER BY ts DESC
      LIMIT ?
    `);

    this.recentStmt = this.db.prepare(`
      SELECT * FROM outcomes ORDER BY ts DESC LIMIT ?
    `);

    this.pruneStmt = this.db.prepare(`
      DELETE FROM outcomes
      WHERE id IN (
        SELECT id FROM outcomes ORDER BY ts DESC LIMIT -1 OFFSET ?
      )
    `);

    this.countStmt = this.db.prepare(`SELECT COUNT(*) AS n FROM outcomes`);
  }

  record(input: RecordOutcomeInput): number {
    const row = {
      ts: Date.now(),
      sessionId: input.sessionId,
      task: input.task,
      taskHash: hashTask(input.task),
      kind: input.kind,
      complexity: input.complexity,
      planJson: input.plan ? JSON.stringify(input.plan) : null,
      filesTouched: JSON.stringify(input.filesTouched ?? []),
      model: input.model,
      fallbackModel: input.fallbackModel ?? null,
      tokensIn: input.tokensIn | 0,
      tokensOut: input.tokensOut | 0,
      costUsd: input.costUsd,
      durationMs: input.durationMs | 0,
      toolCalls: input.toolCalls | 0,
      iterations: input.iterations | 0,
      success: input.success ? 1 : 0,
      userAccepted: input.userAccepted ?? -1,
      embedding: input.embedding ? Buffer.from(input.embedding.buffer) : null,
      classifierFeatures: input.classifierFeatures ? JSON.stringify(input.classifierFeatures) : null,
      toolsArrayTokensAvg: input.toolsArrayTokensAvg ?? null,
      cacheReadTokens: input.cacheReadTokens ?? 0,
      cacheCreationTokens: input.cacheCreationTokens ?? 0,
      compactionCount: input.compactionCount ?? 0,
    };
    const result = this.insertStmt.run(row);
    return Number(result.lastInsertRowid);
  }

  /** Find up to `limit` past outcomes matching the task (exact hash or substring). */
  findSimilar(task: string, limit = 5): OutcomeRow[] {
    const hash = hashTask(task);
    const substr = `%${task.slice(0, 40).replace(/[%_]/g, ' ')}%`;
    const rows = this.similarStmt.all(hash, substr, limit) as RawRow[];
    return rows.map(rowToOutcome);
  }

  recent(limit = 20): OutcomeRow[] {
    const rows = this.recentStmt.all(limit) as RawRow[];
    return rows.map(rowToOutcome);
  }

  /** Keep only the most recent `maxRows` rows. */
  prune(maxRows = 10_000): void {
    this.pruneStmt.run(maxRows);
  }

  /** Attach a user rating to the most recent outcome for this session. Returns
   *  true when a row was updated. Idempotent — re-rating the same session
   *  overwrites. Rating values are not validated here; bench / CLI commands
   *  enforce 'good' | 'meh' | 'bad' at the entry point. */
  setUserRating(sessionId: string, rating: string, note?: string): boolean {
    const stmt = this.db.prepare(
      `UPDATE outcomes SET user_rating = ?, rating_note = ?
       WHERE id = (SELECT id FROM outcomes WHERE session_id = ? ORDER BY ts DESC LIMIT 1)`,
    );
    const info = stmt.run(rating, note ?? null, sessionId);
    return info.changes > 0;
  }

  count(): number {
    const r = this.countStmt.get() as { n: number };
    return r.n;
  }

  close(): void {
    this.db.close();
  }
}

interface RawRow {
  id: number;
  ts: number;
  session_id: string;
  task: string;
  task_hash: string;
  kind: string;
  complexity: string;
  plan_json: string | null;
  files_touched: string;
  model: string;
  fallback_model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number;
  tool_calls: number;
  iterations: number;
  success: number;
  user_accepted: number;
  embedding: Buffer | null;
  classifier_features: string | null;
  user_rating: string | null;
  rating_note: string | null;
  tools_array_tokens_avg: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  compaction_count: number | null;
}

function rowToOutcome(r: RawRow): OutcomeRow {
  let filesTouched: string[] = [];
  try {
    filesTouched = JSON.parse(r.files_touched);
  } catch {
    /* keep empty */
  }
  let classifierFeatures: Record<string, number> | null = null;
  if (r.classifier_features) {
    try {
      classifierFeatures = JSON.parse(r.classifier_features) as Record<string, number>;
    } catch {
      classifierFeatures = null;
    }
  }
  return {
    id: r.id,
    ts: r.ts,
    sessionId: r.session_id,
    task: r.task,
    taskHash: r.task_hash,
    kind: r.kind as TaskKind,
    complexity: r.complexity as Complexity,
    planJson: r.plan_json,
    filesTouched,
    model: r.model as ModelId,
    fallbackModel: (r.fallback_model ?? null) as ModelId | null,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costUsd: r.cost_usd,
    durationMs: r.duration_ms,
    toolCalls: r.tool_calls,
    iterations: r.iterations,
    success: r.success === 1,
    userAccepted: (r.user_accepted as -1 | 0 | 1) ?? -1,
    embedding: r.embedding,
    classifierFeatures,
    userRating: r.user_rating ?? null,
    ratingNote: r.rating_note ?? null,
    toolsArrayTokensAvg: r.tools_array_tokens_avg ?? null,
    cacheReadTokens: r.cache_read_tokens ?? 0,
    cacheCreationTokens: r.cache_creation_tokens ?? 0,
    compactionCount: r.compaction_count ?? 0,
  };
}

/**
 * Open (or create) the outcomes store for the given cwd.
 *
 * Recovers from SQLite corruption (partial writes from a hard crash, disk
 * full mid-write, file truncated). If the first open fails with a database
 * error, we move the bad file aside and create a fresh one. Outcomes are a
 * cache — losing history is acceptable; losing the ability to run is not.
 */
export function openOutcomesStore(cwd: string): OutcomesStore {
  const path = join(cwd, '.mint', 'outcomes.sqlite');
  try {
    return new OutcomesStore(path);
  } catch (err) {
    // Typical errors: "SQLITE_NOTADB", "database disk image is malformed"
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      if (fs.existsSync(path)) {
        const backupPath = `${path}.corrupted-${Date.now()}`;
        fs.renameSync(path, backupPath);
        process.stderr.write(
          `[mint] Outcomes DB corrupted (${(err as Error).message}). Moved to:\n       ${backupPath}\n`
        );
      }
    } catch {
      // If we can't even move the file, fall through and hope the second
      // open succeeds (unlikely but graceful).
    }
    return new OutcomesStore(path);
  }
}
