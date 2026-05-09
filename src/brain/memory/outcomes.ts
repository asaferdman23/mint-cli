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

    this.insertStmt = this.db.prepare(`
      INSERT INTO outcomes (
        ts, session_id, task, task_hash, kind, complexity, plan_json, files_touched,
        model, fallback_model, tokens_in, tokens_out, cost_usd, duration_ms,
        tool_calls, iterations, success, user_accepted, embedding
      ) VALUES (
        @ts, @sessionId, @task, @taskHash, @kind, @complexity, @planJson, @filesTouched,
        @model, @fallbackModel, @tokensIn, @tokensOut, @costUsd, @durationMs,
        @toolCalls, @iterations, @success, @userAccepted, @embedding
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
}

function rowToOutcome(r: RawRow): OutcomeRow {
  let filesTouched: string[] = [];
  try {
    filesTouched = JSON.parse(r.files_touched);
  } catch {
    /* keep empty */
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
  };
}

/** Open (or create) the outcomes store for the given cwd. */
export function openOutcomesStore(cwd: string): OutcomesStore {
  const path = join(cwd, '.mint', 'outcomes.sqlite');
  return new OutcomesStore(path);
}
