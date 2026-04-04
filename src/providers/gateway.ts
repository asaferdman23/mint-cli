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

function buildGatewayError(kind: 'chat' | 'agent', status: number, body: string): Error {
  if (status === 401) {
    return new Error(`Gateway ${kind} error 401: Unauthorized. ${AUTH_HELP}`)
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

    const res = await fetch(`${getGatewayUrl()}/v1/chat`, {
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

    const res = await fetch(`${getGatewayUrl()}/v1/agent`, {
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
                let parsedInput: Record<string, unknown> = {};
                try { parsedInput = JSON.parse(acc.arguments || '{}'); }
                catch { parsedInput = { raw: acc.arguments }; }
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
