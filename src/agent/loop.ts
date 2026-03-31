import { streamComplete } from '../providers/index.js';
import { streamAgent } from '../providers/index.js';
import { isModelAvailable } from '../providers/index.js';
import type { Message, AgentStreamChunk } from '../providers/types.js';
import type { ModelId } from '../providers/types.js';
import { TOOLS, executeTool, type ToolResult, type AgentOptions } from './tools.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentLoopChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  results?: ToolResult[];
  error?: string;
}

interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Extended message for agent use — carries tool call metadata
interface AgentMessage extends Message {
  toolCalls?: ToolCallRecord[];
  toolResults?: Array<{ toolCallId: string; content: string }>;
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

/**
 * The core agent loop. Streams LLM response → detects tool calls → executes them
 * → feeds results back → repeats until no more tool calls.
 *
 * Yields AgentLoopChunk events so callers can stream output progressively.
 */
export async function* agentLoop(
  task: string,
  options: AgentOptions & { systemPrompt?: string; maxIterations?: number }
): AsyncGenerator<AgentLoopChunk> {
  const messages: AgentMessage[] = [{ role: 'user', content: task }];
  const maxIterations = options.maxIterations ?? 20;

  // Resolve model with fallback
  let model: ModelId = 'deepseek-v3';
  if (options.model && isModelAvailable(options.model as ModelId)) {
    model = options.model as ModelId;
  } else if (!isModelAvailable('deepseek-v3')) {
    // fallback scan
    const fallbacks: ModelId[] = ['claude-sonnet-4', 'deepseek-coder'];
    for (const fb of fallbacks) {
      if (isModelAvailable(fb)) {
        model = fb;
        break;
      }
    }
  }

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (options.signal?.aborted) {
      yield { type: 'error', error: 'Aborted' };
      return;
    }

    let fullText = '';
    const toolCallsThisRound: ToolCallRecord[] = [];

    try {
      // Stream agent response with tool definitions
      for await (const chunk of streamAgent({
        model,
        messages: messages as Message[],
        systemPrompt: options.systemPrompt,
        tools: TOOLS,
        maxTokens: 8192,
        signal: options.signal,
      })) {
        if (chunk.type === 'text' && chunk.text) {
          fullText += chunk.text;
          yield { type: 'text', text: chunk.text };
        } else if (chunk.type === 'tool_call') {
          toolCallsThisRound.push({
            id: chunk.toolCallId ?? `tc_${Date.now()}_${toolCallsThisRound.length}`,
            name: chunk.toolName ?? 'unknown',
            input: chunk.toolInput ?? {},
          });
          yield {
            type: 'tool_call',
            toolName: chunk.toolName,
            toolInput: chunk.toolInput,
            toolCallId: chunk.toolCallId,
          };
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      yield { type: 'error', error: errMsg };
      return;
    }

    // If no tool calls, the agent is done
    if (toolCallsThisRound.length === 0) {
      break;
    }

    // Record assistant message with tool calls
    const assistantMsg: AgentMessage = {
      role: 'assistant',
      content: fullText,
      toolCalls: toolCallsThisRound,
    };
    messages.push(assistantMsg);

    // Execute all tool calls
    const toolResults: ToolResult[] = [];
    for (const tc of toolCallsThisRound) {
      if (options.signal?.aborted) break;
      const result = await executeTool(tc.name, tc.input, tc.id, options);
      toolResults.push(result);
    }

    yield { type: 'tool_result', results: toolResults };

    // Feed tool results back as a tool message
    const toolMsg: AgentMessage = {
      role: 'tool',
      content: '',
      toolResults: toolResults.map(r => ({ toolCallId: r.toolCallId, content: r.content })),
    };
    messages.push(toolMsg);
  }

  yield { type: 'done' };
}
