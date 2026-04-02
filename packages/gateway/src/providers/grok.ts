import { openAIStream, openAIStreamRaw, type StreamOptions } from './stream.js'
import type { Message, ToolDefinition } from '../types.js'

const BASE_URL = 'https://api.x.ai/v1'

export function grokStream(model: string, messages: Message[], signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = process.env.GROK_API_KEY ?? ''
  if (!apiKey) throw new Error('GROK_API_KEY not set')
  const opts: StreamOptions = { baseURL: BASE_URL, apiKey, model, messages, signal }
  return openAIStream(opts)
}

export function grokStreamRaw(model: string, messages: Message[], tools?: ToolDefinition[], signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = process.env.GROK_API_KEY ?? ''
  if (!apiKey) throw new Error('GROK_API_KEY not set')
  return openAIStreamRaw({ baseURL: BASE_URL, apiKey, model, messages, signal, tools, tool_choice: 'auto' })
}
