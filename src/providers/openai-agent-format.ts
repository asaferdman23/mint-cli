import type OpenAI from 'openai';
import type { CompletionRequest } from './types.js';

type AgentMessage = {
  role: string;
  content: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  toolResults?: Array<{ toolCallId: string; content: string }>;
};

export function getCombinedSystemPrompt(request: CompletionRequest): string | undefined {
  const parts: string[] = [];

  if (request.systemPrompt?.trim()) {
    parts.push(request.systemPrompt.trim());
  }

  for (const message of request.messages) {
    if (message.role === 'system' && message.content.trim()) {
      parts.push(message.content.trim());
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

export function buildOpenAICompatibleAgentMessages(
  request: CompletionRequest,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  const systemPrompt = getCombinedSystemPrompt(request);

  if (systemPrompt) {
    out.push({ role: 'system', content: systemPrompt });
  }

  for (const message of request.messages) {
    const agentMessage = message as AgentMessage;

    if (message.role === 'system') {
      continue;
    }

    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      if (agentMessage.toolCalls && agentMessage.toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: agentMessage.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function' as const,
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.input),
            },
          })),
        });
      } else {
        out.push({ role: 'assistant', content: message.content });
      }
      continue;
    }

    if (message.role === 'tool' && agentMessage.toolResults) {
      for (const result of agentMessage.toolResults) {
        out.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.toolCallId,
        });
      }
    }
  }

  return out;
}

export function buildOpenAICompatibleToolDefinitions(
  tools: CompletionRequest['tools'],
): OpenAI.Chat.ChatCompletionTool[] | undefined {
  return tools?.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}
