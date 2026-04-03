import { openAIStream, openAIStreamRaw, type StreamOptions } from './stream.js'
import type { Message, ToolDefinition } from '../types.js'

const BASE_URL = 'https://api.moonshot.cn/v1'

export function kimiStream(model: string, messages: Message[], signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = process.env.KIMI_API ?? ''
  if (!apiKey) throw new Error('KIMI_API not set')
  const opts: StreamOptions = { baseURL: BASE_URL, apiKey, model, messages, signal }
  return openAIStream(opts)
}

export function kimiStreamRaw(model: string, messages: Message[], tools?: ToolDefinition[], signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = process.env.KIMI_API ?? ''
  if (!apiKey) throw new Error('KIMI_API not set')
  return openAIStreamRaw({ baseURL: BASE_URL, apiKey, model, messages, signal, tools, tool_choice: 'auto' })
}
