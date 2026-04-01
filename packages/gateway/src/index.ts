import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chatRoute } from './routes/chat.js'
import { adminRoute } from './routes/admin.js'
import { initSchema } from './db.js'

const app = new Hono()

const TOKEN = process.env.MINT_API_TOKEN ?? ''

app.use('/v1/*', async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  if (!TOKEN || auth !== `Bearer ${TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

app.get('/health', (c) => c.json({ ok: true }))
app.route('/v1', chatRoute)
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
