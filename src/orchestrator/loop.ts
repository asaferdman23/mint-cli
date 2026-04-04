/**
 * Single Orchestrator Loop — the core of Mint CLI v2.
 *
 * One continuous Grok 4.1 Fast conversation with tool calling.
 * The orchestrator plans and thinks. Tools execute.
 * write_code dispatches to DeepSeek for actual code generation.
 * Everything else is pure code ($0).
 */
import { streamAgent } from '../providers/index.js';
import { ORCHESTRATOR_PROMPT } from './prompts.js';
import {
  ORCHESTRATOR_TOOL_DEFINITIONS,
  executeOrchestratorTool,
  getWriteCodeCost,
  resetWriteCodeCost,
  type OrchestratorToolContext,
} from './tools.js';
import type { ModelId, Message, AgentStreamChunk } from '../providers/types.js';
import { MODELS } from '../providers/types.js';

const ORCHESTRATOR_MODEL: ModelId = 'grok-4.1-fast';
const MAX_ITERATIONS = 20;

export interface OrchestratorResult {
  output: string;
  orchestratorModel: ModelId;
  orchestratorCost: number;
  writeCodeCost: number;
  totalCost: number;
  iterations: number;
  duration: number;
  /** The full messages array — pass this back as history for follow-up turns. */
  messages: Message[];
}

export interface OrchestratorCallbacks {
  onLog?: (message: string) => void;
  onText?: (text: string) => void;
  onToolCall?: (toolName: string, input: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: string) => void;
  onApprovalNeeded?: (description: string) => Promise<boolean>;
}

export async function runOrchestrator(
  task: string,
  cwd: string,
  callbacks?: OrchestratorCallbacks,
  signal?: AbortSignal,
  /** Previous conversation messages — pass OrchestratorResult.messages from the last turn. */
  previousMessages?: Message[],
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  resetWriteCodeCost();

  const messages: Message[] = [
    ...(previousMessages ?? []),
    { role: 'user', content: task },
  ];

  const toolCtx: OrchestratorToolContext = {
    cwd,
    onLog: callbacks?.onLog,
    onApprovalNeeded: callbacks?.onApprovalNeeded,
  };

  let fullOutput = '';
  let iterations = 0;
  let orchestratorInputTokens = 0;
  let orchestratorOutputTokens = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal?.aborted) break;
    iterations = i + 1;

    let responseText = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    // Stream from Grok orchestrator
    try {
      for await (const chunk of streamAgent({
        model: ORCHESTRATOR_MODEL,
        messages,
        systemPrompt: ORCHESTRATOR_PROMPT,
        tools: ORCHESTRATOR_TOOL_DEFINITIONS,
        maxTokens: 4096,
        signal,
        providerOptions: { reasoning: true },
      })) {
        if (chunk.type === 'text' && chunk.text) {
          responseText += chunk.text;
          callbacks?.onText?.(chunk.text);
        } else if (chunk.type === 'tool_call') {
          toolCalls.push({
            id: chunk.toolCallId ?? `tc_${Date.now()}_${toolCalls.length}`,
            name: chunk.toolName ?? 'unknown',
            input: chunk.toolInput ?? {},
          });
          callbacks?.onToolCall?.(chunk.toolName ?? 'unknown', chunk.toolInput ?? {});
        }
      }
    } catch (err) {
      const errMsg = formatError(err);
      callbacks?.onLog?.(`${errMsg}`);
      fullOutput += `\n${errMsg}`;
      break;
    }

    // Rough token tracking
    const turnInputTokens = Math.ceil(JSON.stringify(messages).length / 4);
    const turnOutputTokens = Math.ceil(responseText.length / 4);
    orchestratorInputTokens += turnInputTokens;
    orchestratorOutputTokens += turnOutputTokens;

    // No tool calls → orchestrator is done
    if (toolCalls.length === 0) {
      fullOutput += responseText;
      break;
    }

    // Record assistant message with tool calls (using the format openai-agent-format.ts expects)
    messages.push({
      role: 'assistant',
      content: responseText,
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
    } as unknown as Message);

    // Execute tool calls and collect results
    const toolResults: Array<{ toolCallId: string; content: string }> = [];
    for (const tc of toolCalls) {
      callbacks?.onLog?.(`tool: ${tc.name}`);
      const result = await executeOrchestratorTool(tc.name, tc.input, toolCtx);
      callbacks?.onToolResult?.(tc.name, result.slice(0, 200));
      toolResults.push({ toolCallId: tc.id, content: result });
    }

    messages.push({
      role: 'tool',
      content: '',
      toolResults,
    } as unknown as Message);
  }

  // Calculate costs
  const modelInfo = MODELS[ORCHESTRATOR_MODEL];
  const orchestratorCost = modelInfo
    ? (orchestratorInputTokens / 1_000_000) * modelInfo.inputPrice +
      (orchestratorOutputTokens / 1_000_000) * modelInfo.outputPrice
    : 0;
  const writeCodeCost = getWriteCodeCost();

  return {
    output: fullOutput,
    orchestratorModel: ORCHESTRATOR_MODEL,
    orchestratorCost,
    writeCodeCost,
    totalCost: orchestratorCost + writeCodeCost,
    iterations,
    duration: Date.now() - startTime,
    messages,
  };
}

function formatError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err);

  // Gateway errors
  if (raw.includes('401') || raw.includes('Unauthorized')) return 'Gateway auth failed. Run `mint login` or check your API keys.';
  if (raw.includes('429') || raw.includes('rate')) return 'Rate limited. Waiting a moment before retrying...';
  if (raw.includes('500') || raw.includes('Internal server')) return 'Gateway error. The provider may be temporarily unavailable.';
  if (raw.includes('timeout') || raw.includes('ETIMEDOUT')) return 'Request timed out. Check your network connection.';
  if (raw.includes('ECONNREFUSED')) return 'Cannot reach the gateway. Is it running?';
  if (raw.includes('fetch failed') || raw.includes('ENOTFOUND')) return 'Network error. Check your internet connection.';
  if (raw.includes('No provider')) return 'No API key configured. Run `mint config:set providers.deepseek <key>` or `mint login`.';

  // Keep it short and readable
  return raw.length > 200 ? raw.slice(0, 200) + '...' : raw;
}
