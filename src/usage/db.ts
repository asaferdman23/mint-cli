import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface UsageRecord {
  id: number;
  timestamp: number;
  sessionId: string;
  command: string;
  model: string;
  provider: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  opusCost: number;
  savedAmount: number;
  routingReason: string;
  taskPreview: string;
  latencyMs: number;
  costSonnet: number;
}

export interface UsageSummary {
  totalRequests: number;
  totalCost: number;
  totalOpusCost: number;
  totalSaved: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: Record<string, { requests: number; cost: number; inputTokens: number; outputTokens: number }>;
}

export interface SessionSummary {
  sessionId: string;
  timestamp: number;
  command: string;
  model: string;
  cost: number;
  savedAmount: number;
  taskPreview: string;
}

export class UsageDb {
  private db: Database.Database;

  constructor(dbPath: string = join(homedir(), '.mint', 'usage.db')) {
    const dir = join(dbPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp     INTEGER NOT NULL,
        sessionId     TEXT    NOT NULL,
        command       TEXT    NOT NULL DEFAULT 'chat',
        model         TEXT    NOT NULL,
        provider      TEXT    NOT NULL DEFAULT '',
        tier          TEXT    NOT NULL DEFAULT 'smart',
        inputTokens   INTEGER NOT NULL DEFAULT 0,
        outputTokens  INTEGER NOT NULL DEFAULT 0,
        cost          REAL    NOT NULL DEFAULT 0,
        opusCost      REAL    NOT NULL DEFAULT 0,
        savedAmount   REAL    NOT NULL DEFAULT 0,
        routingReason TEXT    NOT NULL DEFAULT '',
        taskPreview   TEXT    NOT NULL DEFAULT '',
        latencyMs     INTEGER NOT NULL DEFAULT 0,
        costSonnet    REAL    NOT NULL DEFAULT 0
      )
    `);
  }

  insert(record: Omit<UsageRecord, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO usage
        (timestamp, sessionId, command, model, provider, tier,
         inputTokens, outputTokens, cost, opusCost, savedAmount,
         routingReason, taskPreview, latencyMs, costSonnet)
      VALUES
        (@timestamp, @sessionId, @command, @model, @provider, @tier,
         @inputTokens, @outputTokens, @cost, @opusCost, @savedAmount,
         @routingReason, @taskPreview, @latencyMs, @costSonnet)
    `);
    stmt.run(record);
  }

  getAll(): UsageRecord[] {
    return this.db.prepare('SELECT * FROM usage ORDER BY timestamp DESC').all() as UsageRecord[];
  }

  getSummary(): UsageSummary {
    const rows = this.getAll();
    const byModel: UsageSummary['byModel'] = {};

    let totalRequests = 0;
    let totalCost = 0;
    let totalOpusCost = 0;
    let totalSaved = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const row of rows) {
      totalRequests++;
      totalCost += row.cost;
      totalOpusCost += row.opusCost;
      totalSaved += row.savedAmount;
      totalInputTokens += row.inputTokens;
      totalOutputTokens += row.outputTokens;

      if (!byModel[row.model]) {
        byModel[row.model] = { requests: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
      }
      byModel[row.model].requests++;
      byModel[row.model].cost += row.cost;
      byModel[row.model].inputTokens += row.inputTokens;
      byModel[row.model].outputTokens += row.outputTokens;
    }

    return { totalRequests, totalCost, totalOpusCost, totalSaved, totalInputTokens, totalOutputTokens, byModel };
  }

  getRecentSessions(limit: number): SessionSummary[] {
    const stmt = this.db.prepare(`
      SELECT sessionId, timestamp, command, model, cost, savedAmount, taskPreview
      FROM usage
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(limit) as SessionSummary[];
  }

  getTotalSaved(): number {
    const row = this.db.prepare('SELECT SUM(savedAmount) as total FROM usage').get() as { total: number | null };
    return row?.total ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
