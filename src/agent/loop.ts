import { streamAgent } from '../providers/index.js';
import { isModelAvailable } from '../providers/index.js';
import type { Message, AgentStreamChunk } from '../providers/types.js';
import type { ModelId } from '../providers/types.js';
import { isConcurrencySafeTool, toolRequiresApproval } from '../tools/index.js';
import {
  TOOLS,
  executeTool,
  getAgentToolDefinitions,
  type ToolResult,
  type AgentOptions,
} from './tools.js';

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
interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
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
  options: AgentOptions & { systemPrompt?: string; maxIterations?: number; maxTokens?: number; providerOptions?: Record<string, unknown> }
): AsyncGenerator<AgentLoopChunk> {
  const messages: AgentMessage[] = [{ role: 'user', content: task }];
  const maxIterations = options.maxIterations ?? 40;
  const toolDefinitions = options.toolNames
    ? getAgentToolDefinitions(options.toolNames)
    : TOOLS;

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
        tools: toolDefinitions,
        maxTokens: options.maxTokens ?? 16384,
        signal: options.signal,
        providerOptions: options.providerOptions,
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

    const hasApprovalGatedCall = toolCallsThisRound.some((toolCall) =>
      toolRequiresApproval(toolCall.name, toolCall.input)
    );

    if (
      hasApprovalGatedCall &&
      options.mode !== 'yolo' &&
      options.mode !== 'auto' &&
      options.onIterationApprovalNeeded
    ) {
      const approved = await options.onIterationApprovalNeeded(
        iteration + 1,
        toolCallsThisRound.map((toolCall) => ({ name: toolCall.name, input: toolCall.input })),
      );

      if (!approved) {
        const rejectedResults: ToolResult[] = toolCallsThisRound.map((toolCall) => ({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: `[REJECTED] User denied executing ${toolCall.name} in iteration ${iteration + 1}.`,
          isError: true,
        }));

        yield { type: 'tool_result', results: rejectedResults };

        const toolMsg: AgentMessage = {
          role: 'tool',
          content: '',
          toolResults: rejectedResults.map((result) => ({
            toolCallId: result.toolCallId,
            content: result.content,
          })),
        };
        messages.push(toolMsg);
        continue;
      }
    }

    const toolResults = await executeToolCalls(toolCallsThisRound, options);

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

async function executeToolCalls(
  toolCalls: ToolCallRecord[],
  options: AgentOptions,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (let index = 0; index < toolCalls.length;) {
    if (options.signal?.aborted) break;

    const current = toolCalls[index];
    if (!isConcurrencySafeTool(current.name)) {
      results.push(await executeTool(current.name, current.input, current.id, options));
      index += 1;
      continue;
    }

    const batch: ToolCallRecord[] = [];
    while (index < toolCalls.length && isConcurrencySafeTool(toolCalls[index]!.name)) {
      batch.push(toolCalls[index]!);
      index += 1;
    }

    const batchResults = await Promise.all(
      batch.map((toolCall) => executeTool(toolCall.name, toolCall.input, toolCall.id, options)),
    );
    results.push(...batchResults);
  }

  return results;
}
