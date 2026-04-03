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

  // --- Waitlist ---
  await db.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id         TEXT PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // --- Auth tables ---
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT,
      plan          TEXT NOT NULL DEFAULT 'free',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash    TEXT NOT NULL,
      token_prefix  TEXT NOT NULL,
      name          TEXT NOT NULL DEFAULT 'default',
      last_used_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at    TIMESTAMPTZ
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id)`)
  await db.query(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at    TIMESTAMPTZ NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at    TIMESTAMPTZ
    )
  `)
  // Add user_id to requests if not exists
  await db.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id)`)
}

export async function insertRequest(row: {
  id: string; session_id: string; model: string; provider: string;
  task_type: string; input_tok: number; output_tok: number;
  cost_actual: number; cost_sonnet: number; latency_ms: number; error?: string;
  user_id?: string
}): Promise<void> {
  await getPool().query(
    `INSERT INTO requests (id,session_id,model,provider,task_type,input_tok,output_tok,cost_actual,cost_sonnet,latency_ms,error,user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [row.id, row.session_id, row.model, row.provider, row.task_type,
     row.input_tok, row.output_tok, row.cost_actual, row.cost_sonnet,
     row.latency_ms, row.error ?? null, row.user_id ?? null]
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

// --- Auth query helpers ---

export async function createUser(row: {
  id: string; email: string; password_hash: string; name?: string
}): Promise<void> {
  await getPool().query(
    `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
    [row.id, row.email, row.password_hash, row.name ?? null]
  )
}

export async function getUserByEmail(email: string): Promise<{
  id: string; email: string; password_hash: string; name: string | null; plan: string; created_at: string
} | null> {
  const res = await getPool().query('SELECT * FROM users WHERE email = $1', [email])
  return res.rows[0] ?? null
}

export async function getUserById(id: string): Promise<{
  id: string; email: string; name: string | null; plan: string; created_at: string
} | null> {
  const res = await getPool().query('SELECT id, email, name, plan, created_at FROM users WHERE id = $1', [id])
  return res.rows[0] ?? null
}

export async function createApiToken(row: {
  id: string; user_id: string; token_hash: string; token_prefix: string; name?: string
}): Promise<void> {
  await getPool().query(
    `INSERT INTO api_tokens (id, user_id, token_hash, token_prefix, name) VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.user_id, row.token_hash, row.token_prefix, row.name ?? 'default']
  )
}

export async function getApiTokenByHash(tokenHash: string): Promise<{
  id: string; user_id: string; token_prefix: string; name: string; revoked_at: string | null
} | null> {
  const res = await getPool().query(
    'SELECT id, user_id, token_prefix, name, revoked_at FROM api_tokens WHERE token_hash = $1',
    [tokenHash]
  )
  return res.rows[0] ?? null
}

export async function touchApiToken(tokenId: string): Promise<void> {
  await getPool().query(
    'UPDATE api_tokens SET last_used_at = now() WHERE id = $1',
    [tokenId]
  )
}

export async function getUserTokens(userId: string): Promise<Array<{
  id: string; token_prefix: string; name: string; last_used_at: string | null; created_at: string; revoked_at: string | null
}>> {
  const res = await getPool().query(
    'SELECT id, token_prefix, name, last_used_at, created_at, revoked_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  )
  return res.rows
}

export async function revokeApiToken(tokenId: string, userId: string): Promise<boolean> {
  const res = await getPool().query(
    'UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [tokenId, userId]
  )
  return (res.rowCount ?? 0) > 0
}

// Dashboard queries
export async function getUserStats(userId: string): Promise<{
  total_requests: number; total_cost: number; total_input_tok: number; total_output_tok: number
}> {
  const res = await getPool().query(
    `SELECT COUNT(*) as total_requests,
            COALESCE(SUM(cost_actual), 0) as total_cost,
            COALESCE(SUM(input_tok), 0) as total_input_tok,
            COALESCE(SUM(output_tok), 0) as total_output_tok
     FROM requests WHERE user_id = $1`,
    [userId]
  )
  return res.rows[0]
}

export async function getUserSessions(userId: string, limit: number = 20): Promise<Array<{
  session_id: string; request_count: number; total_cost: number; first_ts: string; last_ts: string
}>> {
  const res = await getPool().query(
    `SELECT session_id,
            COUNT(*) as request_count,
            COALESCE(SUM(cost_actual), 0) as total_cost,
            MIN(ts) as first_ts,
            MAX(ts) as last_ts
     FROM requests WHERE user_id = $1
     GROUP BY session_id
     ORDER BY MAX(ts) DESC
     LIMIT $2`,
    [userId, limit]
  )
  return res.rows
}

export async function getUserRequestHistory(userId: string, limit: number = 50): Promise<unknown[]> {
  const res = await getPool().query(
    `SELECT id, session_id, ts, model, provider, task_type, input_tok, output_tok, cost_actual, cost_sonnet, latency_ms, error
     FROM requests WHERE user_id = $1 ORDER BY ts DESC LIMIT $2`,
    [userId, limit]
  )
  return res.rows
}
