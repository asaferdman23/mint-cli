import type { Message, ToolDefinition } from '../types.js'

export type StreamOptions = {
  baseURL: string
  apiKey: string
  model: string
  messages: Message[]
  signal?: AbortSignal
  tools?: ToolDefinition[]
  tool_choice?: 'auto' | 'none'
}

/**
 * Calls an OpenAI-compatible /chat/completions endpoint with stream=true.
 * Yields text chunks as they arrive.
 */
export async function* openAIStream(opts: StreamOptions): AsyncGenerator<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
    body.tool_choice = opts.tool_choice ?? 'auto'
  }

  const res = await fetch(`${opts.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Provider error ${res.status}: ${body}`)
  }

  if (!res.body) throw new Error('No response body')

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
          const text = parsed?.choices?.[0]?.delta?.content
          if (text) yield text
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Raw SSE passthrough — yields the raw `data: {...}` lines from the provider.
 * Used for agent mode where the CLI needs to see tool_calls, not just text.
 */
export async function* openAIStreamRaw(opts: StreamOptions): AsyncGenerator<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
    body.tool_choice = opts.tool_choice ?? 'auto'
  }

  const res = await fetch(`${opts.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Provider error ${res.status}: ${text}`)
  }

  if (!res.body) throw new Error('No response body')

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
        // Yield the raw JSON — let the client parse tool_calls
        yield data
      }
    }
  } finally {
    reader.releaseLock()
  }
}
