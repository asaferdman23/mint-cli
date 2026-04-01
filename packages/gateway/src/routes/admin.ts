import { Hono } from 'hono'
import { getSessionEvents } from '../db.js'

const TOKEN = process.env.MINT_API_TOKEN ?? ''

export const adminRoute = new Hono()

// Same bearer token auth as v1 routes
adminRoute.use('/*', async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  if (!TOKEN || auth !== `Bearer ${TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

adminRoute.get('/session/:id', async (c) => {
  const sessionId = c.req.param('id')
  const events = await getSessionEvents(sessionId)

  const requests = events.requests as Array<{ cost_actual: number; input_tok: number; output_tok: number }>
  const summary = {
    total_cost: requests.reduce((s, r) => s + (r.cost_actual ?? 0), 0),
    total_tokens: requests.reduce((s, r) => s + (r.input_tok ?? 0) + (r.output_tok ?? 0), 0),
    requests: requests.length,
    tool_calls: (events.tool_calls as unknown[]).length,
  }

  return c.json({ session_id: sessionId, ...events, summary })
})
