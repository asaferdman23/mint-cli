import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { selectTarget } from '../router.js'
import { groqStreamRaw } from '../providers/groq.js'
import { deepseekStreamRaw } from '../providers/deepseek.js'
import { grokStreamRaw } from '../providers/grok.js'
import { mistralStreamRaw } from '../providers/mistral.js'
import { log } from '../logger.js'
import type { Message, ToolDefinition } from '../types.js'

interface AgentRequest {
  session_id: string
  messages: Message[]
  system?: string
  tools?: ToolDefinition[]
}

export const agentRoute = new Hono()

agentRoute.post('/agent', async (c) => {
  const requestId = uuid()
  const body = await c.req.json<AgentRequest>()
  const { session_id, messages, system, tools } = body

  if (!messages?.length) return c.json({ error: 'messages required' }, 400)

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const contextTokens = messages.reduce((s, m) => s + Math.ceil((m.content?.length ?? 0) / 4), 0)

  const { target } = selectTarget(lastUserMsg ?? '', contextTokens)

  log({ event: 'agent_routing', request_id: requestId, session_id, model: target.modelLabel })

  // Build messages with optional system prompt
  const allMessages: Message[] = [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    ...messages,
  ]

  // Select raw stream function (returns raw SSE JSON, preserving tool_calls)
  const streamFn =
    target.provider === 'groq' ? groqStreamRaw :
    target.provider === 'deepseek' ? deepseekStreamRaw :
    target.provider === 'mistral' ? mistralStreamRaw :
    grokStreamRaw

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const gen = streamFn(target.model, allMessages, tools, undefined)
        for await (const rawJson of gen) {
          // Forward raw OpenAI SSE chunk to client
          controller.enqueue(new TextEncoder().encode(`data: ${rawJson}\n\n`))
        }
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Request-Id': requestId,
      'X-Model': target.modelLabel,
    }
  })
})
