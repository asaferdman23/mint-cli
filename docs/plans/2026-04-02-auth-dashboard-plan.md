# Auth + Dashboard + 401 Bug Fix Implementation Plan

> **For Claude:** REQUIRED: Follow this plan task-by-task using TDD where applicable.
> **Design:** Inline in this document (no separate design doc needed for MVP speed).

**Goal:** Add email/password signup with per-user API tokens, build an admin dashboard in the landing page, upgrade gateway auth to per-user tokens, add `mint login`/`mint signup` CLI commands, and fix the 401 build-time token bug.

**Architecture:** Extend the existing Hono gateway with auth routes (`/auth/*`) and dashboard API routes (`/api/*`). Add `users`, `api_tokens`, and `sessions` tables to the existing PostgreSQL database. Convert the landing page from static HTML to a Vite+React SPA (single `index.html` entry with client-side routing). CLI stores per-user token via `Conf` (already used). Gateway middleware upgraded to validate per-user tokens from the `api_tokens` table.

**Tech Stack:**
- Gateway: Hono (existing), `bcryptjs` for password hashing, `jose` for JWT session tokens, PostgreSQL (existing)
- Dashboard: Vite + React + Tailwind CSS (new SPA in `landing/` directory, replaces static HTML)
- CLI: Commander (existing) + `Conf` (existing) for token storage

**Prerequisites:**
- PostgreSQL on Railway (already exists)
- Gateway deployed on Railway (already exists)
- Landing page hosted (already exists)

---

## Relevant Codebase Files

### Patterns to Follow
- `packages/gateway/src/index.ts` (lines 1-37) - Hono app setup, middleware pattern, route mounting
- `packages/gateway/src/db.ts` (lines 1-67) - Schema init pattern, Pool singleton, query helpers
- `packages/gateway/src/routes/admin.ts` (lines 1-31) - Route module pattern with bearer auth
- `src/providers/gateway.ts` (lines 1-5) - Build-time token injection (THE BUG)
- `src/utils/config.ts` (lines 1-97) - Conf-based config with schema, auth helpers
- `src/cli/commands/auth.ts` (lines 1-151) - Existing auth commands (SSO-based, needs rewrite)
- `src/cli/index.ts` (lines 1-60) - CLI command registration pattern
- `tsup.config.ts` (lines 1-22) - Build-time defines (needs MINT_API_TOKEN removal)
- `landing/index.html` (1658 lines) - Current static landing page with design system variables

### Configuration Files
- `packages/gateway/package.json` - Gateway deps (needs bcryptjs, jose)
- `package.json` - CLI deps (no new deps needed)
- `tsup.config.ts` - Build config (needs MINT_API_TOKEN define removal)

### Design System (from landing/index.html CSS variables)
```css
--bg: #07090d;  --surface: #0c1018;  --surface-2: #121922;
--cyan: #00d4ff; --orange: #ff6535; --green: #00d46a;
--text: #c8dae8; --text-bright: #eef4fa; --text-muted: #4d6a82;
--font-display: 'Oxanium'; --font-mono: 'Fira Code'; --font-body: 'DM Sans';
```

---

## ADR: Dashboard Tech Stack

**Context:** Landing is currently a 1658-line static HTML file. Need to add multi-page dashboard with auth state, API calls, and routing.

**Decision:** Convert to Vite + React SPA in `landing/` directory.

**Consequences:**
- **Positive:** Fast to set up, React for dynamic UI, Tailwind for rapid styling matching existing design system, SPA routing for dashboard pages, same deploy target (static build output)
- **Negative:** Adds build step to landing; heavier than static HTML
- **Alternatives Considered:**
  - Keep static HTML + vanilla JS: Too painful for dashboard complexity (forms, tables, state management, auth flow)
  - Next.js: Overkill for this, adds SSR complexity, different deploy model
  - Separate dashboard app: More infra, split domain, harder to share design tokens

---

## ADR: Auth Strategy

**Context:** Need user accounts with email/password. Speed is priority. GTM plan says first 50 users free.

**Decision:** Email/password with bcrypt hashing. Gateway issues JWT access tokens (short-lived, 24h) + API tokens (long-lived, for CLI). No OAuth/SSO in MVP.

**Consequences:**
- **Positive:** Simple, fast to build, no external auth provider dependency, no cost
- **Negative:** No social login, no MFA in MVP, must handle password reset ourselves
- **Alternatives Considered:**
  - Auth0/Clerk: Adds external dependency + cost, slower to integrate, overkill for 10-50 users
  - SSO only (current stub): No SSO provider exists yet, dead code
  - Magic link: Requires email service (SendGrid/etc), more infra

---

## Functionality Flows

### User Flow: Sign Up (Web)
1. User visits landing page, clicks "Get Started"
2. User enters email + password on signup form
3. System validates (email format, password >= 8 chars)
4. System creates user record (bcrypt hash), generates API token
5. System returns JWT + API token
6. Dashboard stores JWT in localStorage, shows dashboard
7. User copies API token for CLI use

### User Flow: Sign Up (CLI)
1. User runs `mint signup`
2. CLI prompts for email + password (interactive)
3. CLI calls `POST /auth/signup` on gateway
4. Gateway creates user, returns JWT + API token
5. CLI stores API token in Conf (`~/.config/mint-cli/config.json`)
6. User is authenticated, can use `mint` commands

### User Flow: Login (CLI)
1. User runs `mint login`
2. CLI prompts for email + password
3. CLI calls `POST /auth/login` on gateway
4. Gateway validates credentials, returns JWT + API token
5. CLI stores API token in Conf
6. User is authenticated

### User Flow: Login (Web)
1. User visits landing page, clicks "Login"
2. User enters email + password
3. System validates credentials
4. Dashboard stores JWT, redirects to dashboard

### Admin Flow: Dashboard
1. User opens dashboard (authenticated)
2. Sees overview: total requests, total cost, active sessions
3. Can view session history (existing data from `requests` table)
4. Can view/regenerate API tokens
5. Can update settings (default model, etc.)
6. (Future) Team management, billing

### System Flow: Authenticated API Request
1. CLI sends request with `Authorization: Bearer {api_token}`
2. Gateway middleware looks up token in `api_tokens` table
3. If valid: attach `user_id` to request context, proceed
4. If invalid/missing: return 401
5. Request recorded in `requests` table with `user_id`

---

## Database Schema

### New Tables

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,           -- UUID
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,              -- bcrypt
  name          TEXT,
  plan          TEXT NOT NULL DEFAULT 'free', -- free|pro|team
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- API tokens (long-lived, for CLI/API access)
CREATE TABLE IF NOT EXISTS api_tokens (
  id            TEXT PRIMARY KEY,           -- UUID
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,              -- SHA-256 hash of the actual token
  token_prefix  TEXT NOT NULL,              -- First 8 chars for identification (e.g., "mint_abc1")
  name          TEXT NOT NULL DEFAULT 'default',
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ                -- NULL = active, set = revoked
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- Web sessions (JWT-based, stored for revocation)
CREATE TABLE IF NOT EXISTS web_sessions (
  id            TEXT PRIMARY KEY,           -- UUID
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);
```

### Modified Tables

```sql
-- Add user_id to requests table
ALTER TABLE requests ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
```

---

## Phase 1: Gateway Auth Backend (Estimated: 3-4 hours)

> **Exit Criteria:** `POST /auth/signup` creates user + returns token. `POST /auth/login` validates credentials. Gateway middleware validates per-user tokens. All testable via curl.

### Task 1.1: Database Schema Migration

**Files:**
- Modify: `packages/gateway/src/db.ts`

**Step 1:** Add new tables to `initSchema()`

Add after the existing `errors` table creation in `initSchema()` (after line 66):

```typescript
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
```

**Step 2:** Add query helpers for users and tokens

Add to `db.ts` exports:

```typescript
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
```

**Step 3:** Verify gateway builds

Run: `cd packages/gateway && npx tsc --noEmit`
Expected: No new type errors

**Step 4:** Commit

```bash
git add packages/gateway/src/db.ts
git commit -m "feat(gateway): add users, api_tokens, web_sessions tables and query helpers"
```

---

### Task 1.2: Auth Utilities (Password Hashing, Token Generation, JWT)

**Files:**
- Create: `packages/gateway/src/auth.ts`

**Step 1:** Install dependencies

```bash
cd packages/gateway && npm install bcryptjs jose && npm install -D @types/bcryptjs
```

**Step 2:** Create auth utilities

```typescript
import { hash, compare } from 'bcryptjs'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { randomBytes, createHash } from 'node:crypto'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'mint-dev-secret-change-in-prod')
const SALT_ROUNDS = 10

// Password hashing
export async function hashPassword(password: string): Promise<string> {
  return hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return compare(password, hash)
}

// API token generation (format: mint_xxxxxxxxxxxx)
export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString('hex')
  const token = `mint_${raw}`
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const prefix = token.slice(0, 12) // "mint_xxxxxxx"
  return { token, hash: tokenHash, prefix }
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// JWT for web sessions
export interface JwtPayload extends JWTPayload {
  sub: string    // user_id
  email: string
}

export async function createJwt(userId: string, email: string): Promise<string> {
  return new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET)
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as JwtPayload
  } catch {
    return null
  }
}

// Input validation
export function validateEmail(email: string): string | null {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!re.test(email)) return 'Invalid email format'
  return null
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters'
  return null
}
```

**Step 3:** Verify builds

Run: `cd packages/gateway && npx tsc --noEmit`
Expected: PASS

**Step 4:** Commit

```bash
git add packages/gateway/src/auth.ts packages/gateway/package.json packages/gateway/package-lock.json
git commit -m "feat(gateway): add auth utilities — bcrypt, JWT, API token generation"
```

---

### Task 1.3: Auth Routes (Signup, Login, Token Management)

**Files:**
- Create: `packages/gateway/src/routes/auth.ts`
- Modify: `packages/gateway/src/index.ts` (mount routes)

**Step 1:** Create auth routes

```typescript
import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import {
  hashPassword, verifyPassword, generateApiToken,
  createJwt, verifyJwt, validateEmail, validatePassword,
  type JwtPayload
} from '../auth.js'
import {
  createUser, getUserByEmail, getUserById,
  createApiToken, getUserTokens, revokeApiToken, getUserStats, getUserSessions, getUserRequestHistory
} from '../db.js'

export const authRoute = new Hono()

// POST /auth/signup — create account + get tokens
authRoute.post('/signup', async (c) => {
  const body = await c.req.json<{ email: string; password: string; name?: string }>()

  const emailErr = validateEmail(body.email)
  if (emailErr) return c.json({ error: emailErr }, 400)

  const passErr = validatePassword(body.password)
  if (passErr) return c.json({ error: passErr }, 400)

  // Check if email already exists
  const existing = await getUserByEmail(body.email)
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  const userId = uuid()
  const passwordHash = await hashPassword(body.password)

  await createUser({ id: userId, email: body.email, password_hash: passwordHash, name: body.name })

  // Generate API token
  const { token, hash, prefix } = generateApiToken()
  await createApiToken({ id: uuid(), user_id: userId, token_hash: hash, token_prefix: prefix })

  // Generate JWT for web session
  const jwt = await createJwt(userId, body.email)

  return c.json({
    user: { id: userId, email: body.email, name: body.name ?? null },
    api_token: token,  // Only returned once at creation
    jwt,
  }, 201)
})

// POST /auth/login — authenticate + get tokens
authRoute.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>()

  const user = await getUserByEmail(body.email)
  if (!user) return c.json({ error: 'Invalid email or password' }, 401)

  const valid = await verifyPassword(body.password, user.password_hash)
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401)

  // Generate new JWT
  const jwt = await createJwt(user.id, user.email)

  return c.json({
    user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
    jwt,
  })
})

// --- Protected routes (require JWT) ---

// Middleware: verify JWT for /auth/me and /auth/tokens/*
const jwtAuth = async (c: any, next: any) => {
  const auth = c.req.header('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)

  const payload = await verifyJwt(auth.slice(7))
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401)

  c.set('userId', payload.sub)
  c.set('userEmail', payload.email)
  await next()
}

// GET /auth/me — current user info
authRoute.get('/me', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const user = await getUserById(userId)
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json({ user })
})

// GET /auth/tokens — list user's API tokens
authRoute.get('/tokens', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const tokens = await getUserTokens(userId)
  return c.json({ tokens })
})

// POST /auth/tokens — create new API token
authRoute.post('/tokens', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json<{ name?: string }>().catch(() => ({}))
  const { token, hash, prefix } = generateApiToken()
  await createApiToken({ id: uuid(), user_id: userId, token_hash: hash, token_prefix: prefix, name: (body as any).name })
  return c.json({ token, prefix }, 201)
})

// DELETE /auth/tokens/:id — revoke a token
authRoute.delete('/tokens/:id', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const tokenId = c.req.param('id')
  const revoked = await revokeApiToken(tokenId, userId)
  if (!revoked) return c.json({ error: 'Token not found or already revoked' }, 404)
  return c.json({ ok: true })
})

// --- Dashboard API routes (JWT-protected) ---

// GET /auth/stats — user usage statistics
authRoute.get('/stats', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const stats = await getUserStats(userId)
  return c.json({ stats })
})

// GET /auth/sessions — user session history
authRoute.get('/sessions', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const limit = Number(c.req.query('limit') ?? 20)
  const sessions = await getUserSessions(userId, limit)
  return c.json({ sessions })
})

// GET /auth/history — user request history
authRoute.get('/history', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const limit = Number(c.req.query('limit') ?? 50)
  const history = await getUserRequestHistory(userId, limit)
  return c.json({ history })
})
```

**Step 2:** Mount auth routes in gateway index

In `packages/gateway/src/index.ts`, add import and route:

```typescript
import { authRoute } from './routes/auth.js'
```

Mount BEFORE the `/v1/*` middleware (auth routes should not require the old shared token):

```typescript
app.route('/auth', authRoute)
```

**Step 3:** Add CORS middleware for dashboard

Install: `cd packages/gateway && npm install @hono/cors`

In `packages/gateway/src/index.ts`, add at top:

```typescript
import { cors } from 'hono/cors'
```

Add before routes:

```typescript
app.use('/*', cors({
  origin: ['http://localhost:5173', 'https://usemint.dev', 'https://www.usemint.dev'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}))
```

**Step 4:** Verify builds

Run: `cd packages/gateway && npx tsc --noEmit`
Expected: PASS

**Step 5:** Commit

```bash
git add packages/gateway/src/routes/auth.ts packages/gateway/src/index.ts packages/gateway/package.json
git commit -m "feat(gateway): add auth routes — signup, login, token CRUD, dashboard API"
```

---

### Task 1.4: Upgrade Gateway Middleware (Per-User Tokens)

**Files:**
- Modify: `packages/gateway/src/index.ts`

**Step 1:** Replace shared-token middleware with per-user token lookup

Replace the existing `/v1/*` middleware in `index.ts`:

```typescript
import { hashApiToken } from './auth.js'
import { getApiTokenByHash, touchApiToken } from './db.js'

// Legacy shared token for backward compat during migration
const LEGACY_TOKEN = process.env.MINT_API_TOKEN ?? ''

app.use('/v1/*', async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized — missing Bearer token' }, 401)
  }
  const token = auth.slice(7)

  // 1. Check per-user API token
  const tokenHash = hashApiToken(token)
  const apiToken = await getApiTokenByHash(tokenHash)

  if (apiToken && !apiToken.revoked_at) {
    c.set('userId', apiToken.user_id)
    c.set('tokenId', apiToken.id)
    // Fire-and-forget: update last_used_at
    touchApiToken(apiToken.id).catch(() => {})
    await next()
    return
  }

  // 2. Fallback: legacy shared token (remove after migration)
  if (LEGACY_TOKEN && token === LEGACY_TOKEN) {
    c.set('userId', 'legacy')
    await next()
    return
  }

  return c.json({ error: 'Unauthorized — invalid token' }, 401)
})
```

**Step 2:** Update `insertRequest` calls to include `user_id`

In `packages/gateway/src/routes/chat.ts` and `packages/gateway/src/routes/agent.ts`, wherever `insertRequest` is called, add:

```typescript
user_id: c.get('userId') ?? null
```

Note: This requires reading the route files to find exact insertion points. The `insertRequest` function signature in `db.ts` also needs `user_id` added:

In `db.ts` `insertRequest`, add `user_id?: string` to the row parameter, and include it in the query:

```typescript
export async function insertRequest(row: {
  id: string; session_id: string; model: string; provider: string;
  task_type: string; input_tok: number; output_tok: number;
  cost_actual: number; cost_sonnet: number; latency_ms: number; error?: string;
  user_id?: string  // NEW
}): Promise<void> {
  await getPool().query(
    `INSERT INTO requests (id,session_id,model,provider,task_type,input_tok,output_tok,cost_actual,cost_sonnet,latency_ms,error,user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [row.id, row.session_id, row.model, row.provider, row.task_type,
     row.input_tok, row.output_tok, row.cost_actual, row.cost_sonnet,
     row.latency_ms, row.error ?? null, row.user_id ?? null]
  )
}
```

**Step 3:** Verify builds

Run: `cd packages/gateway && npx tsc --noEmit`
Expected: PASS

**Step 4:** Test with curl (manual verification after deploy)

```bash
# Signup
curl -X POST https://api.usemint.dev/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'
# Expected: 201 with {user, api_token, jwt}

# Use API token
curl https://api.usemint.dev/v1/chat \
  -H "Authorization: Bearer mint_..." \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test","messages":[{"role":"user","content":"hi"}]}'
# Expected: 200 streaming response
```

**Step 5:** Commit

```bash
git add packages/gateway/src/
git commit -m "feat(gateway): per-user API token auth middleware with legacy fallback"
```

---

## Phase 2: CLI Auth Commands + 401 Bug Fix (Estimated: 2-3 hours)

> **Exit Criteria:** `mint signup`, `mint login`, `mint whoami` work end-to-end. CLI reads token from Conf instead of build-time env. 401 bug is fixed.

### Task 2.1: Fix 401 Bug — Remove Build-Time Token, Use Runtime Config

**Files:**
- Modify: `tsup.config.ts` (lines 16-17)
- Modify: `src/providers/gateway.ts` (lines 4-5)

**Step 1:** Remove `MINT_API_TOKEN` from tsup defines

In `tsup.config.ts`, change the `define` block:

```typescript
define: {
  'process.env.MINT_GATEWAY_URL': JSON.stringify(process.env.MINT_GATEWAY_URL ?? 'https://api.usemint.dev'),
  // REMOVED: MINT_API_TOKEN no longer compiled in — read from config at runtime
},
```

**Step 2:** Update gateway provider to read token from config at runtime

In `src/providers/gateway.ts`, replace lines 1-5:

```typescript
import type { Provider, CompletionRequest, CompletionResponse, AgentStreamChunk } from './types.js'
import { config } from '../utils/config.js'

const GATEWAY_URL = process.env.MINT_GATEWAY_URL ?? 'https://api.usemint.dev'

function getToken(): string {
  // 1. User's personal API token from `mint login` / `mint signup`
  const userToken = config.get('apiKey')
  if (userToken) return userToken

  // 2. Environment variable (for CI, self-hosted, etc.)
  return process.env.MINT_API_TOKEN ?? ''
}
```

**Step 3:** Replace all `GATEWAY_TOKEN` references with `getToken()` calls

In `streamComplete` and `streamAgent` methods, replace:
```typescript
'Authorization': `Bearer ${GATEWAY_TOKEN}`,
```
with:
```typescript
'Authorization': `Bearer ${getToken()}`,
```

There are exactly 2 occurrences: line 35 (streamComplete) and line 99 (streamAgent).

Also remove the old `const GATEWAY_TOKEN = ...` line.

**Step 4:** Verify build

Run: `npm run build`
Expected: PASS, `dist/cli/index.js` created without hardcoded empty token

Verify the token is NOT baked in:
```bash
grep "MINT_API_TOKEN" dist/cli/index.js
# Expected: no matches (or just the process.env fallback)
```

**Step 5:** Commit

```bash
git add tsup.config.ts src/providers/gateway.ts
git commit -m "fix: read API token from config at runtime instead of build-time injection (fixes 401)"
```

---

### Task 2.2: Rewrite CLI Auth Commands

**Files:**
- Modify: `src/cli/commands/auth.ts` (full rewrite)
- Modify: `src/utils/config.ts` (minor additions)

**Step 1:** Update config with gateway URL helper

Add to `src/utils/config.ts`:

```typescript
export function getGatewayUrl(): string {
  return conf.get('apiBaseUrl') ?? 'https://api.usemint.dev'
}
```

And add to the exported `config` object:

```typescript
export const config = {
  get,
  set,
  setAll,
  clear,
  getConfig,
  isAuthenticated,
  getConfigPath,
  getGatewayUrl,  // NEW
};
```

**Step 2:** Rewrite `src/cli/commands/auth.ts`

```typescript
import chalk from 'chalk';
import boxen from 'boxen';
import { createInterface } from 'node:readline';
import { config } from '../../utils/config.js';

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    // Disable echo for password input
    if (process.stdin.isTTY) process.stdin.setRawMode?.(true);
    process.stdout.write(question);
    let password = '';
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (c === '\u007f' || c === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit(1);
      } else {
        password += c;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

export async function signup(): Promise<void> {
  if (config.isAuthenticated()) {
    console.log(chalk.yellow('Already logged in. Run `mint logout` first.'));
    return;
  }

  console.log(chalk.bold.cyan('\n  Create your Mint account\n'));

  const email = await prompt('  Email: ');
  const password = await promptHidden('  Password (min 8 chars): ');
  const name = await prompt('  Name (optional): ');

  if (!email || !password) {
    console.log(chalk.red('\n  Email and password are required.'));
    return;
  }

  if (password.length < 8) {
    console.log(chalk.red('\n  Password must be at least 8 characters.'));
    return;
  }

  const gatewayUrl = config.getGatewayUrl();

  try {
    const res = await fetch(`${gatewayUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: name || undefined }),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      console.log(chalk.red(`\n  Signup failed: ${data.error || res.statusText}`));
      return;
    }

    // Store credentials
    config.setAll({
      apiKey: data.api_token,
      userId: data.user.id,
      email: data.user.email,
    });

    console.log(boxen(
      `${chalk.bold.green('Account created!')}\n\n` +
      `Email: ${chalk.cyan(data.user.email)}\n` +
      `API Token: ${chalk.dim(data.api_token.slice(0, 20))}...\n\n` +
      `${chalk.dim('Token saved. You can now use mint commands.')}`,
      { padding: 1, borderColor: 'green', borderStyle: 'round' }
    ));
  } catch (err) {
    console.log(chalk.red(`\n  Network error: ${(err as Error).message}`));
  }
}

export async function login(): Promise<void> {
  if (config.isAuthenticated()) {
    const email = config.get('email');
    console.log(chalk.yellow(`Already logged in as ${email}`));
    console.log(chalk.dim('Run `mint logout` to switch accounts'));
    return;
  }

  console.log(chalk.bold.cyan('\n  Login to Mint\n'));

  const email = await prompt('  Email: ');
  const password = await promptHidden('  Password: ');

  if (!email || !password) {
    console.log(chalk.red('\n  Email and password are required.'));
    return;
  }

  const gatewayUrl = config.getGatewayUrl();

  try {
    const res = await fetch(`${gatewayUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      console.log(chalk.red(`\n  Login failed: ${data.error || res.statusText}`));
      return;
    }

    // Login returns JWT but we need an API token for CLI use
    // Request a new API token using the JWT
    const tokenRes = await fetch(`${gatewayUrl}/auth/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${data.jwt}`,
      },
      body: JSON.stringify({ name: 'cli' }),
    });

    const tokenData = await tokenRes.json() as any;

    if (!tokenRes.ok) {
      console.log(chalk.red(`\n  Failed to create API token: ${tokenData.error}`));
      return;
    }

    // Store credentials
    config.setAll({
      apiKey: tokenData.token,
      userId: data.user.id,
      email: data.user.email,
    });

    console.log(chalk.green(`\n  Logged in as ${data.user.email}`));
  } catch (err) {
    console.log(chalk.red(`\n  Network error: ${(err as Error).message}`));
  }
}

export async function logout(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(chalk.yellow('Not currently logged in'));
    return;
  }

  const email = config.get('email');
  config.clear();
  console.log(chalk.green(`Logged out from ${email}`));
}

export async function whoami(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(chalk.yellow('Not logged in'));
    console.log(chalk.dim('Run `mint login` or `mint signup` to authenticate'));
    return;
  }

  const email = config.get('email');
  const configPath = config.getConfigPath();

  console.log(boxen(
    `${chalk.bold('Current User')}\n\n` +
    `Email: ${chalk.cyan(email)}\n` +
    `Config: ${chalk.dim(configPath)}`,
    { padding: 1, borderColor: 'green', borderStyle: 'round' }
  ));
}
```

**Step 3:** Register `mint signup` command in CLI

In `src/cli/index.ts`, add the import of `signup`:

```typescript
import { login, logout, whoami, signup } from './commands/auth.js';
```

Add the signup command registration:

```typescript
program
  .command('signup')
  .description('Create a new Mint account')
  .action(signup);
```

**Step 4:** Fix existing references from "axon" to "mint" in auth commands

The current auth.ts references `axon` in several places. The rewrite above fixes this.

**Step 5:** Verify build

Run: `npm run build`
Expected: PASS

**Step 6:** Commit

```bash
git add src/cli/commands/auth.ts src/cli/index.ts src/utils/config.ts
git commit -m "feat(cli): rewrite auth commands — mint signup, mint login with email/password"
```

---

## Phase 3: Dashboard SPA (Estimated: 4-6 hours)

> **Exit Criteria:** Landing page includes login/signup forms, authenticated users see dashboard with usage stats, session history, and token management.

### Task 3.1: Initialize Vite + React Project in `landing/`

**Files:**
- Modify: `landing/` directory (replace static HTML with Vite project)
- Keep: `landing/mint_logo.png` and any other static assets

**Step 1:** Back up existing landing page

```bash
cp landing/index.html landing/index-static-backup.html
```

**Step 2:** Initialize Vite project

```bash
cd landing
npm create vite@latest . -- --template react-ts
# When prompted about existing files, choose to overwrite
npm install
npm install react-router-dom
npm install -D tailwindcss @tailwindcss/vite
```

**Step 3:** Configure Tailwind

In `landing/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

In `landing/src/index.css`:

```css
@import "tailwindcss";

/* Mint design tokens */
:root {
  --bg: #07090d;
  --surface: #0c1018;
  --surface-2: #121922;
  --surface-3: #192230;
  --border: #1c2b3a;
  --border-hi: #263d52;
  --cyan: #00d4ff;
  --cyan-2: #00a8cc;
  --orange: #ff6535;
  --green: #00d46a;
  --red: #ff4444;
  --text: #c8dae8;
  --text-muted: #4d6a82;
  --text-bright: #eef4fa;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: 'DM Sans', sans-serif;
}
```

**Step 4:** Commit scaffold

```bash
git add landing/
git commit -m "feat(landing): scaffold Vite + React + Tailwind dashboard app"
```

---

### Task 3.2: Auth Context + API Client

**Files:**
- Create: `landing/src/lib/api.ts`
- Create: `landing/src/lib/auth.tsx`

**Step 1:** Create API client

`landing/src/lib/api.ts`:

```typescript
const API_URL = import.meta.env.VITE_API_URL || 'https://api.usemint.dev'

class ApiClient {
  private jwt: string | null = null

  setJwt(jwt: string | null) {
    this.jwt = jwt
    if (jwt) {
      localStorage.setItem('mint_jwt', jwt)
    } else {
      localStorage.removeItem('mint_jwt')
    }
  }

  getJwt(): string | null {
    if (!this.jwt) {
      this.jwt = localStorage.getItem('mint_jwt')
    }
    return this.jwt
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const jwt = this.getJwt()
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        ...options.headers,
      },
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data as T
  }

  // Auth
  async signup(email: string, password: string, name?: string) {
    return this.request<{
      user: { id: string; email: string; name: string | null }
      api_token: string
      jwt: string
    }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    })
  }

  async login(email: string, password: string) {
    return this.request<{
      user: { id: string; email: string; name: string | null; plan: string }
      jwt: string
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  async getMe() {
    return this.request<{ user: { id: string; email: string; name: string | null; plan: string; created_at: string } }>('/auth/me')
  }

  // Dashboard data
  async getStats() {
    return this.request<{ stats: { total_requests: number; total_cost: number; total_input_tok: number; total_output_tok: number } }>('/auth/stats')
  }

  async getSessions(limit = 20) {
    return this.request<{ sessions: Array<{ session_id: string; request_count: number; total_cost: number; first_ts: string; last_ts: string }> }>(`/auth/sessions?limit=${limit}`)
  }

  async getHistory(limit = 50) {
    return this.request<{ history: unknown[] }>(`/auth/history?limit=${limit}`)
  }

  // Tokens
  async getTokens() {
    return this.request<{ tokens: Array<{ id: string; token_prefix: string; name: string; last_used_at: string | null; created_at: string; revoked_at: string | null }> }>('/auth/tokens')
  }

  async createToken(name?: string) {
    return this.request<{ token: string; prefix: string }>('/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async revokeToken(id: string) {
    return this.request<{ ok: boolean }>(`/auth/tokens/${id}`, { method: 'DELETE' })
  }
}

export const api = new ApiClient()
```

**Step 2:** Create auth context

`landing/src/lib/auth.tsx`:

```tsx
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { api } from './api'

interface User {
  id: string
  email: string
  name: string | null
  plan?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name?: string) => Promise<string> // returns api_token
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Check for existing session on mount
  useEffect(() => {
    const jwt = api.getJwt()
    if (jwt) {
      api.getMe()
        .then((data) => setUser(data.user))
        .catch(() => {
          api.setJwt(null)
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const loginFn = async (email: string, password: string) => {
    const data = await api.login(email, password)
    api.setJwt(data.jwt)
    setUser(data.user)
  }

  const signupFn = async (email: string, password: string, name?: string) => {
    const data = await api.signup(email, password, name)
    api.setJwt(data.jwt)
    setUser(data.user)
    return data.api_token
  }

  const logoutFn = () => {
    api.setJwt(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login: loginFn, signup: signupFn, logout: logoutFn }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

**Step 3:** Commit

```bash
git add landing/src/lib/
git commit -m "feat(landing): add API client and auth context with JWT session management"
```

---

### Task 3.3: Dashboard Pages

**Files:**
- Create: `landing/src/pages/Landing.tsx` (public landing page content)
- Create: `landing/src/pages/Login.tsx`
- Create: `landing/src/pages/Signup.tsx`
- Create: `landing/src/pages/Dashboard.tsx` (overview with stats)
- Create: `landing/src/pages/Sessions.tsx` (session history)
- Create: `landing/src/pages/Tokens.tsx` (API token management)
- Create: `landing/src/pages/Settings.tsx` (user settings)
- Create: `landing/src/components/DashboardLayout.tsx`
- Modify: `landing/src/App.tsx`

**Implementation Notes:**

The landing page (`Landing.tsx`) should replicate the key content from the existing `landing/index.html`:
- Hero section with "Mint" branding
- Feature highlights
- CTA buttons pointing to `/signup`
- Reuse the CSS variables and design tokens

`DashboardLayout.tsx` should have:
- Sidebar with navigation: Overview, Sessions, Tokens, Settings
- Header with user email + logout button
- Dark theme matching the existing design system

`Dashboard.tsx` (Overview) should show:
- 4 stat cards: Total Requests, Total Cost, Total Input Tokens, Total Output Tokens
- Recent sessions list (last 10)
- Quick action: Copy API token

`Sessions.tsx`:
- Table of sessions with columns: Session ID (truncated), Requests, Cost, First/Last timestamp
- Click to expand session details

`Tokens.tsx`:
- List of API tokens with: Prefix, Name, Last Used, Created, Status (active/revoked)
- Create new token button
- Revoke button per token
- Copy token modal (shown only once at creation)

`Settings.tsx`:
- User info (email, name, plan)
- (Future: change password, billing)

**Step 1:** Create all page components (implementation details for each page are straightforward React components using the `api` client and `useAuth` hook from Task 3.2).

**Step 2:** Set up routing in `App.tsx`:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Dashboard } from './pages/Dashboard'
import { Sessions } from './pages/Sessions'
import { Tokens } from './pages/Tokens'
import { Settings } from './pages/Settings'
import { DashboardLayout } from './components/DashboardLayout'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (!user) return <Navigate to="/login" />
  return <>{children}</>
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/tokens" element={<Tokens />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
```

**Step 3:** Verify dev server

Run: `cd landing && npm run dev`
Expected: Vite dev server at localhost:5173, pages render

**Step 4:** Commit

```bash
git add landing/src/
git commit -m "feat(landing): add dashboard pages — overview, sessions, tokens, settings with auth routing"
```

---

### Task 3.4: Build + Deploy Configuration

**Files:**
- Create: `landing/.env` (local dev)
- Create: `landing/.env.production`
- Modify: `landing/vite.config.ts` if needed

**Step 1:** Environment files

`landing/.env`:
```
VITE_API_URL=http://localhost:3000
```

`landing/.env.production`:
```
VITE_API_URL=https://api.usemint.dev
```

**Step 2:** Verify production build

```bash
cd landing && npm run build
```
Expected: `landing/dist/` directory with static files

**Step 3:** Commit

```bash
git add landing/.env landing/.env.production
git commit -m "feat(landing): add environment config for local dev and production API URLs"
```

---

## Phase 4: Integration + Polish (Estimated: 2-3 hours)

> **Exit Criteria:** Full flow works end-to-end: signup on web, copy token, use in CLI. CLI signup works. Dashboard shows real usage data.

### Task 4.1: Wire User ID Through Gateway Routes

**Files:**
- Modify: `packages/gateway/src/routes/chat.ts`
- Modify: `packages/gateway/src/routes/agent.ts`

For each route, pass `user_id: c.get('userId')` to `insertRequest()`. This requires reading both files to find exact locations.

**Step 1:** Read and update chat route
**Step 2:** Read and update agent route
**Step 3:** Verify gateway builds

```bash
cd packages/gateway && npx tsc --noEmit
```

**Step 4:** Commit

```bash
git add packages/gateway/src/routes/
git commit -m "feat(gateway): pass user_id through chat and agent routes to request records"
```

---

### Task 4.2: Admin Route Upgrade (Optional — Keep Legacy + Add User-Scoped)

**Files:**
- Modify: `packages/gateway/src/routes/admin.ts`

Update admin route to also support JWT-authenticated access for user-scoped session viewing. Keep legacy token auth for backward compat.

---

### Task 4.3: End-to-End Verification

**Manual Test Plan:**

1. **Gateway deploy:** Push gateway changes to Railway
2. **Web signup:** Visit landing, sign up, verify dashboard loads
3. **Web login:** Log out, log back in, verify dashboard loads
4. **API token copy:** Copy token from dashboard or signup flow
5. **CLI signup:** `mint signup` — verify account creation + token stored
6. **CLI login:** `mint login` — verify auth + token stored
7. **CLI use:** `mint "hello"` — verify request goes through gateway with per-user token
8. **Dashboard stats:** After CLI use, refresh dashboard — verify request appears in stats
9. **Token management:** Create new token on web, revoke old token, verify CLI needs new token
10. **Legacy compat:** Verify `MINT_API_TOKEN` env var still works for existing deploys

---

## Risk Assessment

| Risk | P | I | Score | Mitigation |
|------|---|---|-------|------------|
| JWT secret not set in prod | 3 | 5 | 15 | Add JWT_SECRET to Railway env vars; fail-open warning in logs |
| Password stored insecurely | 1 | 5 | 5 | bcrypt with 10 rounds (industry standard) |
| CORS blocks dashboard API calls | 3 | 3 | 9 | CORS middleware with explicit origins; test locally first |
| Landing page conversion breaks SEO | 2 | 3 | 6 | Vite SPA still serves same HTML shell; meta tags preserved |
| Token leaked in logs | 2 | 4 | 8 | Never log full tokens; use token_prefix for identification |
| Legacy token removal breaks existing users | 2 | 4 | 8 | Keep legacy fallback for 2 weeks; log deprecation warning |
| Database migration fails on existing data | 2 | 3 | 6 | All new columns are nullable or have defaults; IF NOT EXISTS guards |

---

## File Map Summary

### New Files
| File | Purpose |
|------|---------|
| `packages/gateway/src/auth.ts` | Password hashing, JWT, API token generation |
| `packages/gateway/src/routes/auth.ts` | Auth routes (signup, login, tokens, dashboard API) |
| `landing/src/lib/api.ts` | API client for dashboard |
| `landing/src/lib/auth.tsx` | Auth context provider + hook |
| `landing/src/pages/Landing.tsx` | Public landing page |
| `landing/src/pages/Login.tsx` | Login form |
| `landing/src/pages/Signup.tsx` | Signup form |
| `landing/src/pages/Dashboard.tsx` | Dashboard overview |
| `landing/src/pages/Sessions.tsx` | Session history |
| `landing/src/pages/Tokens.tsx` | API token management |
| `landing/src/pages/Settings.tsx` | User settings |
| `landing/src/components/DashboardLayout.tsx` | Dashboard shell with sidebar |

### Modified Files
| File | Change |
|------|--------|
| `packages/gateway/src/db.ts` | Add users/tokens/sessions tables + query helpers |
| `packages/gateway/src/index.ts` | Mount auth routes, CORS, per-user middleware |
| `packages/gateway/src/routes/chat.ts` | Pass user_id to insertRequest |
| `packages/gateway/src/routes/agent.ts` | Pass user_id to insertRequest |
| `packages/gateway/package.json` | Add bcryptjs, jose deps |
| `tsup.config.ts` | Remove MINT_API_TOKEN define |
| `src/providers/gateway.ts` | Runtime token from config |
| `src/cli/commands/auth.ts` | Rewrite: email/password signup + login |
| `src/cli/index.ts` | Add `mint signup` command |
| `src/utils/config.ts` | Add getGatewayUrl helper |
| `landing/` | Convert from static HTML to Vite+React SPA |

---

## Estimated Total Effort

| Phase | Estimated Time | Priority |
|-------|---------------|----------|
| Phase 1: Gateway Auth Backend | 3-4 hours | P0 (blocking) |
| Phase 2: CLI Auth + 401 Fix | 2-3 hours | P0 (blocking) |
| Phase 3: Dashboard SPA | 4-6 hours | P1 (ship same day) |
| Phase 4: Integration + Polish | 2-3 hours | P1 (ship same day) |
| **Total** | **11-16 hours** | **1-2 dev days** |

---

## Success Criteria

- [ ] User can sign up with email/password via web and CLI
- [ ] User can log in and receive a personal API token
- [ ] CLI reads token from local config (not build-time env)
- [ ] Gateway validates per-user tokens
- [ ] Dashboard shows usage stats, session history
- [ ] Dashboard supports token management (create, view, revoke)
- [ ] Legacy shared token still works (backward compat)
- [ ] 401 bug is fixed (CLI works without build-time token)
- [ ] All gateway routes record user_id
