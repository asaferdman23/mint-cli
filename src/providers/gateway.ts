import type { Provider, CompletionRequest, CompletionResponse, AgentStreamChunk } from './types.js'

// Compiled in at build time via tsup define
const GATEWAY_URL = process.env.MINT_GATEWAY_URL ?? 'https://api.usemint.dev'
const GATEWAY_TOKEN = process.env.MINT_API_TOKEN ?? ''

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
    const systemMsg = req.messages.find(m => m.role === 'system')
    const chatMessages = req.messages.filter(m => m.role !== 'system')

    const res = await fetch(`${GATEWAY_URL}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        session_id: req.sessionId ?? 'cli',
        messages: chatMessages,
        system: systemMsg?.content,
      }),
      signal: req.signal,
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gateway error ${res.status}: ${body}`)
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
    const systemMsg = req.messages.find(m => m.role === 'system');
    const chatMessages = req.messages.filter(m => m.role !== 'system');

    const res = await fetch(`${GATEWAY_URL}/v1/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        session_id: req.sessionId ?? 'cli',
        messages: chatMessages,
        system: systemMsg?.content,
        tools: req.tools,
      }),
      signal: req.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gateway agent error ${res.status}: ${body}`);
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
            if (parsed.error) throw new Error(parsed.error);

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
