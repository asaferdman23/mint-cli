import { openAIStream, type StreamOptions } from './stream.js'
import type { Message } from '../types.js'

const BASE_URL = 'https://api.groq.com/openai/v1'

export function groqStream(model: string, messages: Message[], signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = process.env.GROQ_API_KEY ?? ''
  if (!apiKey) throw new Error('GROQ_API_KEY not set')
  const opts: StreamOptions = { baseURL: BASE_URL, apiKey, model, messages, signal }
  return openAIStream(opts)
}
