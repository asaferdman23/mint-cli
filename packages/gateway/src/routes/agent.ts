import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { selectTarget, FALLBACK, type ProviderTarget } from '../router.js'
import { groqStreamRaw } from '../providers/groq.js'
import { deepseekStreamRaw } from '../providers/deepseek.js'
import { grokStreamRaw } from '../providers/grok.js'
import { mistralStreamRaw } from '../providers/mistral.js'
import { kimiStreamRaw } from '../providers/kimi.js'
import { log } from '../logger.js'
import type { Message, ToolDefinition, AppEnv } from '../types.js'

interface AgentRequest {
  session_id: string
  messages: Message[]
  system?: string
  tools?: ToolDefinition[]
}

export const agentRoute = new Hono<AppEnv>()

function getRawStreamForTarget(target: ProviderTarget) {
  return target.provider === 'groq' ? groqStreamRaw :
    target.provider === 'deepseek' ? deepseekStreamRaw :
    target.provider === 'kimi' ? kimiStreamRaw :
    target.provider === 'mistral' ? mistralStreamRaw :
    grokStreamRaw
}

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

  const startMs = Date.now()
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  const stream = new ReadableStream({
    async start(controller) {
      let sentAnyChunks = false
      let outputChars = 0
      try {
        const gen = getRawStreamForTarget(target)(target.model, allMessages, tools, undefined)
        for await (const rawJson of gen) {
          sentAnyChunks = true
          outputChars += rawJson.length
          controller.enqueue(new TextEncoder().encode(`data: ${rawJson}\n\n`))
        }
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)

        if (!sentAnyChunks && target.provider !== FALLBACK.provider) {
          try {
            log({
              event: 'agent_fallback',
              request_id: requestId,
              session_id,
              from_model: target.modelLabel,
              to_model: FALLBACK.modelLabel,
              reason: msg,
            })
            const fallbackGen = getRawStreamForTarget(FALLBACK)(FALLBACK.model, allMessages, tools, undefined)
            for await (const rawJson of fallbackGen) {
              controller.enqueue(new TextEncoder().encode(`data: ${rawJson}\n\n`))
            }
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
            return
          } catch (fallbackErr) {
            const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: fallbackMsg })}\n\n`))
            return
          }
        }

        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
      } finally {
        const durationMs = Date.now() - startMs
        const tokensIn = Math.ceil((allMessages.map(m => m.content ?? '').join('').length) / 4)
        const tokensOut = Math.ceil(outputChars / 16) // raw SSE is ~4x the actual text
        const cost = (tokensIn / 1_000_000) * target.inputPrice + (tokensOut / 1_000_000) * target.outputPrice
        log({
          event: 'task',
          request_id: requestId,
          session_id,
          ip,
          model: target.modelLabel,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost,
          duration_ms: durationMs,
          success: sentAnyChunks,
          error: null,
        })
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
