import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { selectTarget, FALLBACK } from '../router.js'
import { groqStream } from '../providers/groq.js'
import { deepseekStream } from '../providers/deepseek.js'
import { grokStream } from '../providers/grok.js'
import { mistralStream } from '../providers/mistral.js'
import { kimiStream } from '../providers/kimi.js'
import { insertRequest, insertRoutingDecision, insertError } from '../db.js'
import { log, logError } from '../logger.js'
import type { ChatRequest, Message, AppEnv } from '../types.js'

// Sonnet 4.6 pricing for savings calculation
const SONNET_INPUT  = 3.0   // per 1M
const SONNET_OUTPUT = 15.0

function calcCost(inputTok: number, outputTok: number, inputPrice: number, outputPrice: number): number {
  return (inputTok / 1_000_000) * inputPrice + (outputTok / 1_000_000) * outputPrice
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export const chatRoute = new Hono<AppEnv>()

chatRoute.post('/chat', async (c) => {
  const requestId = uuid()
  const userId = c.get('userId')
  const body = await c.req.json<ChatRequest>()
  const { session_id, messages, system } = body

  if (!messages?.length) return c.json({ error: 'messages required' }, 400)

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const contextTokens = messages.reduce((s, m) => s + estimateTokens(m.content ?? ''), 0)

  const { target, reason, savingsPct } = selectTarget(lastUserMsg, contextTokens)

  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  log({ event: 'routing', request_id: requestId, session_id, ip, task_type: target.tier, model: target.modelLabel, reason, savings_pct: savingsPct })

  // Persist routing decision (fire and forget — don't block stream)
  insertRoutingDecision({
    id: uuid(),
    request_id: requestId,
    prompt_preview: lastUserMsg.slice(0, 120),
    classified_as: target.tier,
    selected_model: target.modelLabel,
    reason,
    savings_pct: savingsPct,
  }).catch(() => {})

  // Build messages with optional system prompt
  const allMessages: Message[] = [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    ...messages,
  ]

  // Select provider stream function
  const streamFn =
    target.provider === 'groq' ? groqStream :
    target.provider === 'deepseek' ? deepseekStream :
    target.provider === 'kimi' ? kimiStream :
    target.provider === 'mistral' ? mistralStream :
    grokStream

  const startMs = Date.now()
  let fullText = ''
  let streamError: string | undefined

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const gen = streamFn(target.model, allMessages, undefined)
        for await (const chunk of gen) {
          fullText += chunk
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
        }
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      } catch (err) {
        streamError = err instanceof Error ? err.message : String(err)

        // Try fallback to groq-llama-70b
        try {
          const fallbackGen = groqStream(FALLBACK.model, allMessages, undefined)
          for await (const chunk of fallbackGen) {
            fullText += chunk
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: chunk, fallback: true })}\n\n`))
          }
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          streamError = undefined
        } catch (fallbackErr) {
          const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
          logError({ request_id: requestId, session_id, error_type: 'fallback_failed', message: msg })
          await insertError({ id: uuid(), request_id: requestId, session_id, error_type: 'fallback_failed', message: msg })
        }
      } finally {
        const latencyMs = Date.now() - startMs
        const inputTok = estimateTokens(allMessages.map(m => m.content).join(''))
        const outputTok = estimateTokens(fullText)
        const costActual = calcCost(inputTok, outputTok, target.inputPrice, target.outputPrice)
        const costSonnet = calcCost(inputTok, outputTok, SONNET_INPUT, SONNET_OUTPUT)

        log({ event: 'task', request_id: requestId, session_id, ip, model: target.modelLabel, tokens_in: inputTok, tokens_out: outputTok, cost: costActual, duration_ms: latencyMs, success: !streamError, error: streamError ?? null })

        insertRequest({
          id: requestId, session_id, model: target.modelLabel, provider: target.provider,
          task_type: target.tier, input_tok: inputTok, output_tok: outputTok,
          cost_actual: costActual, cost_sonnet: costSonnet, latency_ms: latencyMs,
          error: streamError,
          user_id: userId ?? undefined,
        }).catch(() => {})

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
