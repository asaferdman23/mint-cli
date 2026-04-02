import { openAIStream, openAIStreamRaw, type StreamOptions } from './stream.js'
import type { Message, ToolDefinition } from '../types.js'

const BASE_URL = 'https://api.deepseek.com/v1'

export function deepseekStream(model: string, messages: Message[], signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set')
  const opts: StreamOptions = { baseURL: BASE_URL, apiKey, model, messages, signal }
  return openAIStream(opts)
}

export function deepseekStreamRaw(model: string, messages: Message[], tools?: ToolDefinition[], signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set')
  return openAIStreamRaw({ baseURL: BASE_URL, apiKey, model, messages, signal, tools, tool_choice: 'auto' })
}
