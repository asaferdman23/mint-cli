import { openAIStream, type StreamOptions } from './stream.js'
import type { Message } from '../types.js'

const BASE_URL = 'https://api.deepseek.com/v1'

export function deepseekStream(model: string, messages: Message[], signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set')
  const opts: StreamOptions = { baseURL: BASE_URL, apiKey, model, messages, signal }
  return openAIStream(opts)
}
