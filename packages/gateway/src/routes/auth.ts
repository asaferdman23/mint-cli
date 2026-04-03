import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import {
  hashPassword, verifyPassword, generateApiToken,
  createJwt, verifyJwt,
  validateEmail, validatePassword,
  type JwtPayload
} from '../auth.js'
import {
  createUser, getUserByEmail, getUserById,
  createApiToken, getUserTokens, revokeApiToken,
  getUserStats, getUserSessions, getUserRequestHistory
} from '../db.js'
import type { AppEnv } from '../types.js'

export const authRoute = new Hono<AppEnv>()

// POST /auth/signup — create account + get tokens
authRoute.post('/signup', async (c) => {
  const body = await c.req.json<{ email: string; password: string; name?: string }>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

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
  const body = await c.req.json<{ email: string; password: string }>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

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

// Middleware: verify JWT for protected routes
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
  const limit = Math.min(Math.max(1, Number(c.req.query('limit')) || 20), 200)
  const sessions = await getUserSessions(userId, limit)
  return c.json({ sessions })
})

// GET /auth/history — user request history
authRoute.get('/history', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const limit = Math.min(Math.max(1, Number(c.req.query('limit')) || 50), 200)
  const history = await getUserRequestHistory(userId, limit)
  return c.json({ history })
})
