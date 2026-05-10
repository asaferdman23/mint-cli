import type { Provider, CompletionRequest, CompletionResponse, AgentStreamChunk } from './types.js'
import { config } from '../utils/config.js'
import {
  buildOpenAICompatibleAgentMessages,
  buildOpenAICompatibleToolDefinitions,
  getCombinedSystemPrompt,
} from './openai-agent-format.js'

const AUTH_HELP =
  'Run `mint login` for a personal token, or for local testing set a shared gateway token with `mint config:set gatewayToken <token>`.'

function getGatewayUrl(): string {
  return process.env.MINT_GATEWAY_URL ?? config.getGatewayUrl()
}

function getToken(): string {
  const gatewayToken = config.get('gatewayToken')
  if (gatewayToken) return gatewayToken as string

  const userToken = config.get('apiKey')
  if (userToken) return userToken as string

  const envToken = process.env.MINT_GATEWAY_TOKEN ?? process.env.MINT_API_TOKEN ?? ''
  if (envToken) return envToken

  throw new Error(`Mint Gateway auth is not configured. ${AUTH_HELP}`)
}

// Status codes where a retry is likely to succeed (transient gateway / upstream hiccups).
// We only retry before any stream chunks have been yielded — once the user sees text,
// a retry would replay the start and confuse the session.
const RETRYABLE_STATUS = new Set([500, 502, 503, 504])

/**
 * Make a POST request to the gateway with up to N retries on network errors and
 * 5xx responses. Only safe to call before you start consuming the stream body.
 *
 * Each retry waits `backoffMs * 2^attempt` to back off gently.
 */
async function postWithRetry(
  url: string,
  init: RequestInit,
  opts: { maxRetries?: number; backoffMs?: number; onRetry?: (attempt: number, reason: string) => void } = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 2
  const backoffMs = opts.backoffMs ?? 500

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) {
        return res
      }
      // Drain the body so we don't leak the connection, then retry.
      lastError = new Error(`HTTP ${res.status}`)
      await res.text().catch(() => {})
      if (attempt < maxRetries) {
        opts.onRetry?.(attempt + 1, `gateway returned ${res.status}`)
        await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt))
        continue
      }
      return res
    } catch (err) {
      // Network error (DNS, connection refused, reset, etc.) — retry.
      // AbortError is user-initiated; bail out immediately.
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))
      if (isAbort) throw err
      lastError = err
      if (attempt < maxRetries) {
        const msg = err instanceof Error ? err.message : String(err)
        opts.onRetry?.(attempt + 1, `network error: ${msg}`)
        await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt))
        continue
      }
      throw err
    }
  }
  // Exhausted retries on a retryable status; return the (failed) last response.
  // Callers will check .ok and surface the error to the user.
  throw lastError ?? new Error('Gateway request failed after retries')
}

function buildGatewayError(kind: 'chat' | 'agent', status: number, body: string): Error {
  if (status === 401) {
    return new Error(`Gateway ${kind} error 401: Unauthorized. ${AUTH_HELP}`)
  }

  if (status === 429) {
    // Parse error body for quota info
    try {
      const data = JSON.parse(body)
      if (data.error?.includes('quota') || data.error?.includes('limit')) {
        return new Error(
          `You've used all your free requests.\n\n` +
          `To continue:\n` +
          `  • Upgrade to Pro: https://usemint.dev/upgrade\n` +
          `  • Add your own API keys: mint config:set providers.deepseek <key>\n` +
          `  • Check quota: mint quota`
        )
      }
    } catch {
      // Fall through to generic 429
    }
    return new Error(`Gateway ${kind} error 429: Rate limit exceeded. Run 'mint quota' to check your usage.`)
  }

  return new Error(`Gateway ${kind} error ${status}: ${body}`)
}

export const gatewayProvider: Provider = {
  id: 'groq', // reported provider — gateway decides actual provider
  name: 'Mint Gateway',

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const chunks: string[] = []
    for await (const chunk of this.streamComplete!(req)) {
      chunks.push(chunk)
    }
    const content = chunks.join('')
    const inputTokens = Math.ceil(req.messages.reduce((s, m) => s + m.content.length, 0) / 4)
    const outputTokens = Math.ceil(content.length / 4)
    return {
      content,
      model: req.model,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      cost: { input: 0, output: 0, total: 0 },
      latency: 0,
    }
  },

  async *streamComplete(req: CompletionRequest): AsyncIterable<string> {
    const chatMessages = req.messages.filter(m => m.role !== 'system')
    const systemPrompt = getCombinedSystemPrompt(req)

    const res = await postWithRetry(`${getGatewayUrl()}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        session_id: req.sessionId ?? 'cli',
        messages: chatMessages,
        system: systemPrompt,
      }),
      signal: req.signal,
    })

    if (!res.ok) {
      const body = await res.text()
      throw buildGatewayError('chat', res.status, body)
    }

    if (!res.body) throw new Error('No response body from gateway')

    const decoder = new TextDecoder()
    const reader = res.body.getReader()

    try {
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') return
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) throw new Error(parsed.error)
            if (parsed.text) yield parsed.text
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  },

  async *streamAgent(req: CompletionRequest): AsyncIterable<AgentStreamChunk> {
    const systemPrompt = getCombinedSystemPrompt(req);
    const chatMessages = buildOpenAICompatibleAgentMessages(req)
      .filter((message) => message.role !== 'system');
    const tools = buildOpenAICompatibleToolDefinitions(req.tools);

    const res = await postWithRetry(`${getGatewayUrl()}/v1/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        session_id: req.sessionId ?? 'cli',
        messages: chatMessages,
        system: systemPrompt,
        tools,
      }),
      signal: req.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw buildGatewayError('agent', res.status, body);
    }

    if (!res.body) throw new Error('No response body from gateway agent');

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    const toolCallAccs = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));

            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              yield { type: 'text', text: delta.content };
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallAccs.has(idx)) {
                  toolCallAccs.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' });
                }
                const acc = toolCallAccs.get(idx)!;
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.arguments += tc.function.arguments;
              }
            }

            const finish = parsed.choices?.[0]?.finish_reason;
            if (finish === 'tool_calls' || finish === 'stop') {
              for (const [, acc] of toolCallAccs) {
                // Skip tool calls the provider never named — downstream would
                // route them to "unknown" and silently fail.
                if (!acc.name || !acc.name.trim()) continue;
                let parsedInput: Record<string, unknown> = {};
                try {
                  parsedInput = JSON.parse(acc.arguments || '{}');
                } catch {
                  // Malformed JSON args — skip the call rather than passing raw
                  // string that the tool can't handle.
                  continue;
                }
                yield { type: 'tool_call', toolName: acc.name, toolInput: parsedInput, toolCallId: acc.id };
              }
              toolCallAccs.clear();
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
}
