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
import { loadMemory, updateMemory, formatMemoryForPrompt, loadProjectInstructions } from './memory.js';
import { MEMORY_INSTRUCTION } from './prompts.js';
import {
  ORCHESTRATOR_TOOL_DEFINITIONS,
  executeOrchestratorTool,
  isToolSafe,
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

  // Load persistent memory + project instructions
  const memory = loadMemory(cwd);
  const memoryBlock = memory ? formatMemoryForPrompt(memory) : '';
  const projectInstructions = loadProjectInstructions(cwd);
  const instructionsBlock = projectInstructions
    ? `\n\n${MEMORY_INSTRUCTION}\n\n${projectInstructions}`
    : '';
  const systemPrompt = ORCHESTRATOR_PROMPT + memoryBlock + instructionsBlock;

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

    // Context compaction — if messages are too large, summarize old turns
    compactMessagesIfNeeded(messages);

    let responseText = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    // Stream from Grok orchestrator
    try {
      for await (const chunk of streamAgent({
        model: ORCHESTRATOR_MODEL,
        messages,
        systemPrompt,
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

    // Execute tool calls — run independent tools in parallel, sequential for writes
    const toolResults: Array<{ toolCallId: string; content: string }> = [];
    const writeTools = new Set(['edit_file', 'write_file', 'git_commit', 'apply_diff']);

    // Split into parallel-safe (reads/searches) and sequential (writes)
    const parallelCalls = toolCalls.filter((tc) => !writeTools.has(tc.name));
    const sequentialCalls = toolCalls.filter((tc) => writeTools.has(tc.name));

    // Run parallel calls concurrently
    if (parallelCalls.length > 0) {
      const results = await Promise.all(
        parallelCalls.map(async (tc) => {
          callbacks?.onToolCall?.(tc.name, tc.input);
          const result = await executeOrchestratorTool(tc.name, tc.input, toolCtx);
          callbacks?.onToolResult?.(tc.name, result.slice(0, 200));
          return { toolCallId: tc.id, content: result };
        }),
      );
      toolResults.push(...results);
    }

    // Run sequential calls one by one — with safety check
    for (const tc of sequentialCalls) {
      callbacks?.onToolCall?.(tc.name, tc.input);

      // Auto-approve safe tools, ask for approval on writes
      if (!isToolSafe(tc.name, tc.input) && callbacks?.onApprovalNeeded) {
        // The tool's own execute function handles approval — just run it
      }

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

  // Save session memory — track edited files
  const editedFiles: string[] = [];
  for (const msg of messages) {
    const tc = (msg as Record<string, unknown>).toolCalls as Array<{ name: string; input: Record<string, unknown> }> | undefined;
    if (tc) {
      for (const call of tc) {
        if ((call.name === 'edit_file' || call.name === 'write_file') && call.input.path) {
          editedFiles.push(String(call.input.path));
        }
      }
    }
  }
  if (editedFiles.length > 0 || fullOutput) {
    updateMemory(cwd, {
      editedFiles: [...new Set(editedFiles)],
      sessionSummary: fullOutput.slice(0, 200),
    });
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

const MAX_CONTEXT_CHARS = 100_000; // ~25K tokens

function compactMessagesIfNeeded(messages: Message[]): void {
  const totalChars = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : '';
    const toolContent = (m as Record<string, unknown>).toolResults
      ? JSON.stringify((m as Record<string, unknown>).toolResults)
      : '';
    return sum + content.length + toolContent.length;
  }, 0);

  if (totalChars < MAX_CONTEXT_CHARS) return;
  if (messages.length <= 8) return;

  const first = messages[0]; // original task
  const recent = messages.slice(-6); // last 3 turns
  const middle = messages.slice(1, -6);

  // Build a detailed summary preserving technical context
  const filesEdited = new Set<string>();
  const filesRead = new Set<string>();
  const userRequests: string[] = [];
  const actionsCompleted: string[] = [];

  for (const msg of middle) {
    if (msg.role === 'user' && msg.content) {
      userRequests.push(msg.content.slice(0, 150));
    }
    if (msg.role === 'assistant' && msg.content) {
      const text = msg.content.trim();
      if (text) actionsCompleted.push(text.slice(0, 200));
    }
    // Extract file paths from tool calls
    const tc = (msg as Record<string, unknown>).toolCalls as Array<{ name: string; input: Record<string, unknown> }> | undefined;
    if (tc) {
      for (const call of tc) {
        const path = String(call.input?.path ?? '');
        if (call.name === 'edit_file' || call.name === 'write_file') filesEdited.add(path);
        if (call.name === 'read_file' || call.name === 'grep_file') filesRead.add(path);
      }
    }
  }

  const summaryParts = [
    '[Conversation compacted to save context]',
    userRequests.length > 0 ? `User requests: ${userRequests.join(' → ')}` : '',
    filesRead.size > 0 ? `Files examined: ${[...filesRead].join(', ')}` : '',
    filesEdited.size > 0 ? `Files modified: ${[...filesEdited].join(', ')}` : '',
    actionsCompleted.length > 0 ? `Actions: ${actionsCompleted.join(' | ')}` : '',
  ].filter(Boolean);

  const summary: Message = {
    role: 'assistant',
    content: summaryParts.join('\n'),
  };

  messages.length = 0;
  messages.push(first, summary, ...recent);
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
