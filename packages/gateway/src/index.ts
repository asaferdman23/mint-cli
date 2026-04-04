import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { chatRoute } from './routes/chat.js'
import { agentRoute } from './routes/agent.js'
import { adminRoute } from './routes/admin.js'
import { authRoute } from './routes/auth.js'
import { initSchema, getApiTokenByHash, touchApiToken, getPool } from './db.js'
import { hashApiToken } from './auth.js'
import type { AppEnv } from './types.js'

const app = new Hono<AppEnv>()

// CORS for dashboard origins
app.use('/*', cors({
  origin: ['http://localhost:5173', 'https://usemint.dev', 'https://www.usemint.dev'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}))

app.get('/health', (c) => c.json({ ok: true }))

// Analytics: track mint init calls (public, no auth)
app.post('/track', async (c) => {
  try {
    const body = await c.req.json<{ event: string; [key: string]: unknown }>()
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const { log } = await import('./logger.js')
    log({ ...body, ip })
  } catch { /* ignore */ }
  return c.json({ ok: true })
})

// Waitlist (public, no auth)
app.post('/waitlist', async (c) => {
  const body = await c.req.json<{ email: string }>().catch(() => null)
  if (!body?.email) return c.json({ error: 'email required' }, 400)
  const email = body.email.toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'invalid email' }, 400)
  try {
    await getPool().query(
      `INSERT INTO waitlist (id, email) VALUES (gen_random_uuid(), $1) ON CONFLICT (email) DO NOTHING`,
      [email]
    )
  } catch { /* ignore */ }
  return c.json({ ok: true })
})

// Auth routes (no API token required — these handle their own auth)
app.route('/auth', authRoute)

// Legacy shared token for backward compat during migration
const LEGACY_TOKEN = process.env.MINT_API_TOKEN ?? ''

// Per-user API token middleware for /v1/* routes
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
    touchApiToken(apiToken.id).catch(err => console.error(JSON.stringify({ event: 'touch_token_error', message: err.message })))
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

app.route('/v1', chatRoute)
app.route('/v1', agentRoute)
app.route('/admin', adminRoute)

const port = Number(process.env.PORT ?? 3000)

;(async () => {
  try {
    await initSchema()
    console.log(JSON.stringify({ event: 'schema_ready' }))
  } catch (err) {
    console.error(JSON.stringify({ event: 'schema_error', message: err instanceof Error ? err.message : String(err) }))
  }
  serve({ fetch: app.fetch, port }, () => {
    console.log(JSON.stringify({ event: 'server_start', port }))
  })
})()
