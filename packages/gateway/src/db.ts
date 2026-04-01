import { Pool } from 'pg'

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL })
  }
  return pool
}

export async function initSchema(): Promise<void> {
  const db = getPool()
  await db.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
      model         TEXT NOT NULL,
      provider      TEXT NOT NULL,
      task_type     TEXT NOT NULL,
      input_tok     INTEGER NOT NULL DEFAULT 0,
      output_tok    INTEGER NOT NULL DEFAULT 0,
      cost_actual   REAL NOT NULL DEFAULT 0,
      cost_sonnet   REAL NOT NULL DEFAULT 0,
      latency_ms    INTEGER NOT NULL DEFAULT 0,
      error         TEXT
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id            TEXT PRIMARY KEY,
      request_id    TEXT REFERENCES requests(id),
      session_id    TEXT NOT NULL,
      ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
      tool_name     TEXT NOT NULL,
      tool_input    JSONB,
      approved      BOOLEAN,
      success       BOOLEAN NOT NULL,
      duration_ms   INTEGER NOT NULL DEFAULT 0,
      error         TEXT
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS routing_decisions (
      id            TEXT PRIMARY KEY,
      request_id    TEXT REFERENCES requests(id),
      ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
      prompt_preview TEXT NOT NULL,
      classified_as TEXT NOT NULL,
      selected_model TEXT NOT NULL,
      reason        TEXT NOT NULL,
      savings_pct   INTEGER NOT NULL DEFAULT 0
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS errors (
      id            TEXT PRIMARY KEY,
      request_id    TEXT,
      session_id    TEXT,
      ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
      error_type    TEXT NOT NULL,
      message       TEXT NOT NULL,
      stack         TEXT
    )
  `)
}

export async function insertRequest(row: {
  id: string; session_id: string; model: string; provider: string;
  task_type: string; input_tok: number; output_tok: number;
  cost_actual: number; cost_sonnet: number; latency_ms: number; error?: string
}): Promise<void> {
  await getPool().query(
    `INSERT INTO requests (id,session_id,model,provider,task_type,input_tok,output_tok,cost_actual,cost_sonnet,latency_ms,error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [row.id, row.session_id, row.model, row.provider, row.task_type,
     row.input_tok, row.output_tok, row.cost_actual, row.cost_sonnet,
     row.latency_ms, row.error ?? null]
  )
}

export async function insertRoutingDecision(row: {
  id: string; request_id: string; prompt_preview: string;
  classified_as: string; selected_model: string; reason: string; savings_pct: number
}): Promise<void> {
  await getPool().query(
    `INSERT INTO routing_decisions (id,request_id,prompt_preview,classified_as,selected_model,reason,savings_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [row.id, row.request_id, row.prompt_preview, row.classified_as,
     row.selected_model, row.reason, row.savings_pct]
  )
}

export async function insertError(row: {
  id: string; request_id?: string; session_id?: string;
  error_type: string; message: string; stack?: string
}): Promise<void> {
  await getPool().query(
    `INSERT INTO errors (id,request_id,session_id,error_type,message,stack)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [row.id, row.request_id ?? null, row.session_id ?? null,
     row.error_type, row.message, row.stack ?? null]
  )
}

export async function getSessionEvents(sessionId: string): Promise<{
  requests: unknown[]; routing_decisions: unknown[]; tool_calls: unknown[]; errors: unknown[]
}> {
  const db = getPool()
  const [req, rd, tc, err] = await Promise.all([
    db.query('SELECT * FROM requests WHERE session_id=$1 ORDER BY ts', [sessionId]),
    db.query('SELECT * FROM routing_decisions WHERE request_id IN (SELECT id FROM requests WHERE session_id=$1) ORDER BY ts', [sessionId]),
    db.query('SELECT * FROM tool_calls WHERE session_id=$1 ORDER BY ts', [sessionId]),
    db.query('SELECT * FROM errors WHERE session_id=$1 ORDER BY ts', [sessionId]),
  ])
  return { requests: req.rows, routing_decisions: rd.rows, tool_calls: tc.rows, errors: err.rows }
}
