/**
 * Mint Phase 1 Agent Loop — ties context engine + DeepSeek together.
 *
 * Flow:
 * 1. Load/build project index
 * 2. Search for relevant files
 * 3. Extract minimal context
 * 4. Classify complexity → pick model
 * 5. Build prompt
 * 6. Call DeepSeek
 * 7. Parse response (diffs, tool calls, questions)
 * 8. If tool call → execute, compress output, loop
 * 9. If diffs → return for application
 */
import { loadIndex, indexProject } from '../context/indexer.js';
import { searchRelevantFiles, extractKeywords } from '../context/search.js';
import { extractMinimalContext } from '../context/extractor.js';
import { classifyTaskComplexity, selectModel, type Complexity, type DeepSeekModel } from '../context/classifier.js';
import { buildPrompt, type Message } from '../context/prompt-builder.js';
import { callDeepSeek, streamDeepSeek, type LLMResponse, type DeepSeekModelId, type StreamChunk } from '../llm/deepseek.js';
import { estimateTokens } from '../context/budget.js';
import { execSync } from 'node:child_process';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TaskResult {
  success: boolean;
  diffs?: ParsedDiff[];
  applied?: boolean;
  message?: string;
  toolCalls?: ToolCallRecord[];
  cost: number;
  durationMs: number;
  tokensUsed: number;
  model: DeepSeekModelId;
  complexity: Complexity;
  filesSearched: number;
  filesLoaded: number;
  contextTokens: number;
}

export interface ParsedDiff {
  file: string;
  hunks: string;
  additions: number;
  deletions: number;
}

interface ToolCallRecord {
  tool: string;
  command: string;
  output: string;
}

export interface MintLoopCallbacks {
  onProgress?: (message: string) => void;
  onStream?: (text: string) => void;
  onToolCall?: (tool: string, command: string) => void;
}

export interface MintLoopOptions {
  cwd: string;
  forceModel?: DeepSeekModel;
  maxToolCalls?: number;
  stream?: boolean;
  signal?: AbortSignal;
  callbacks?: MintLoopCallbacks;
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

export async function runMintTask(
  task: string,
  options: MintLoopOptions,
): Promise<TaskResult> {
  const { cwd, forceModel, maxToolCalls = 5, callbacks, signal } = options;
  const conversationHistory: Message[] = [];
  const allToolCalls: ToolCallRecord[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  const startTime = Date.now();

  // 1. Load or build project index
  callbacks?.onProgress?.('Loading project index...');
  let index = await loadIndex(cwd);
  if (!index) {
    callbacks?.onProgress?.('Building project index...');
    index = await indexProject(cwd, {
      onProgress: (msg) => callbacks?.onProgress?.(msg),
    });
  }
  callbacks?.onProgress?.(`Index loaded: ${index.totalFiles} files`);

  // 2. Search for relevant files
  callbacks?.onProgress?.('Searching relevant files...');
  const relevantFiles = await searchRelevantFiles(cwd, task, index, { maxFiles: 8 });
  const filesSearched = Object.keys(index.files).length;
  callbacks?.onProgress?.(`Found ${relevantFiles.length} relevant files`);

  // 3. Extract minimal context from each file
  callbacks?.onProgress?.('Extracting context...');
  const keywords = extractKeywords(task);
  const fileContexts = await Promise.all(
    relevantFiles.map(f => {
      const fileInfo = index!.files[f.path];
      const symbols = fileInfo?.symbols ?? [];
      return extractMinimalContext(cwd, f.path, keywords, symbols);
    })
  );
  const contextTokens = fileContexts.reduce((sum, fc) => sum + fc.tokenEstimate, 0);
  callbacks?.onProgress?.(`Context: ${fileContexts.length} files, ~${contextTokens} tokens`);

  // 4. Classify complexity → pick model
  const complexity = classifyTaskComplexity(task, relevantFiles, index);
  const model = selectModel(complexity, forceModel);
  callbacks?.onProgress?.(`Complexity: ${complexity} → ${model}`);

  // 5. Build prompt
  const prompt = await buildPrompt(task, fileContexts, conversationHistory, index, cwd);
  totalTokens += prompt.estimatedTokens;

  // 6. Call DeepSeek
  callbacks?.onProgress?.(`Calling DeepSeek (${model})...`);
  let response: LLMResponse;

  if (options.stream && callbacks?.onStream) {
    // Streaming mode
    let fullContent = '';
    for await (const chunk of streamDeepSeek(prompt.systemPrompt, prompt.userMessage, {
      model,
      signal,
    })) {
      if (chunk.type === 'text' && chunk.text) {
        fullContent += chunk.text;
        callbacks.onStream(chunk.text);
      }
      if (chunk.type === 'done' && chunk.response) {
        response = chunk.response;
      }
    }
    response ??= {
      content: fullContent,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      durationMs: Date.now() - startTime,
      model,
    };
    // Detect empty response from stream
    if (!response.content && !fullContent) {
      return {
        success: false,
        message: 'DeepSeek returned an empty response. The model may be overloaded.',
        cost: totalCost,
        durationMs: Date.now() - startTime,
        tokensUsed: totalTokens,
        model,
        complexity,
        filesSearched,
        filesLoaded: fileContexts.length,
        contextTokens,
      };
    }
  } else {
    response = await callDeepSeek(prompt.systemPrompt, prompt.userMessage, {
      model,
      signal,
    });
  }

  totalCost += response.cost;
  totalTokens += response.inputTokens + response.outputTokens + (response.reasoningTokens ?? 0);

  // 7. Parse response
  let parsed = parseResponse(response.content);

  // 8. Tool call loop (max iterations)
  let toolCallCount = 0;
  while (parsed.type === 'tool_call' && toolCallCount < maxToolCalls) {
    toolCallCount++;
    const { tool, args } = parsed;

    callbacks?.onToolCall?.(tool, typeof args === 'string' ? args : JSON.stringify(args));
    callbacks?.onProgress?.(`Running tool: ${tool}...`);

    const toolOutput = await executeMintTool(tool, args, cwd);
    const compressed = compressMintToolOutput(tool, toolOutput);

    allToolCalls.push({ tool, command: typeof args === 'string' ? args : JSON.stringify(args), output: compressed });

    // Add to conversation history (strip reasoning_content!)
    conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });
    conversationHistory.push({
      role: 'user',
      content: `Tool output:\n${compressed}\n\nContinue with the original task.`,
    });

    // Re-build prompt with updated history and call again
    const newPrompt = await buildPrompt(task, fileContexts, conversationHistory, index, cwd);
    response = await callDeepSeek(newPrompt.systemPrompt, newPrompt.userMessage, { model, signal });
    totalCost += response.cost;
    totalTokens += response.inputTokens + response.outputTokens + (response.reasoningTokens ?? 0);

    parsed = parseResponse(response.content);
  }

  const durationMs = Date.now() - startTime;

  // 9. Return result
  if (parsed.type === 'diff') {
    return {
      success: true,
      diffs: parsed.diffs,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      cost: totalCost,
      durationMs,
      tokensUsed: totalTokens,
      model,
      complexity,
      filesSearched,
      filesLoaded: fileContexts.length,
      contextTokens,
    };
  }

  return {
    success: true,
    message: parsed.type === 'text' ? parsed.content : response.content,
    toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    cost: totalCost,
    durationMs,
    tokensUsed: totalTokens,
    model,
    complexity,
    filesSearched,
    filesLoaded: fileContexts.length,
    contextTokens,
  };
}

// ─── Response parser ────────────────────────────────────────────────────────

interface ParsedToolCall {
  type: 'tool_call';
  tool: string;
  args: string | Record<string, unknown>;
}

interface ParsedDiffs {
  type: 'diff';
  diffs: ParsedDiff[];
}

interface ParsedText {
  type: 'text';
  content: string;
}

type ParsedResponse = ParsedToolCall | ParsedDiffs | ParsedText;

function parseResponse(content: string): ParsedResponse {
  // Check for tool call JSON
  const toolCallMatch = content.match(/\{"tool"\s*:\s*"(\w+)"\s*,\s*"(?:command|files)"\s*:\s*(.+?)\}/s);
  if (toolCallMatch) {
    const tool = toolCallMatch[1];
    let args: string | Record<string, unknown>;
    try {
      args = JSON.parse(toolCallMatch[2]);
    } catch {
      args = toolCallMatch[2].replace(/^"(.*)"$/, '$1');
    }
    return { type: 'tool_call', tool, args };
  }

  // Check for unified diffs
  const diffBlocks = extractUnifiedDiffs(content);
  if (diffBlocks.length > 0) {
    return { type: 'diff', diffs: diffBlocks };
  }

  // Plain text response
  return { type: 'text', content };
}

function extractUnifiedDiffs(content: string): ParsedDiff[] {
  const diffs: ParsedDiff[] = [];

  // Match ```diff blocks
  const diffBlockRe = /```diff\n([\s\S]*?)```/g;
  let match;
  while ((match = diffBlockRe.exec(content)) !== null) {
    const block = match[1];
    const parsed = parseSingleDiff(block);
    if (parsed) diffs.push(parsed);
  }

  // Match raw unified diff format (--- a/file ... +++ b/file)
  if (diffs.length === 0) {
    const rawDiffRe = /^---\s+a\/(.+)\n\+\+\+\s+b\/(.+)\n(@@[\s\S]*?)(?=\n---\s+a\/|\n```|$)/gm;
    while ((match = rawDiffRe.exec(content)) !== null) {
      const file = match[2];
      const hunks = match[3];
      const additions = (hunks.match(/^\+[^+]/gm) || []).length;
      const deletions = (hunks.match(/^-[^-]/gm) || []).length;
      diffs.push({ file, hunks, additions, deletions });
    }
  }

  return diffs;
}

function parseSingleDiff(block: string): ParsedDiff | null {
  const lines = block.split('\n');
  let file = '';

  for (const line of lines) {
    if (line.startsWith('+++ b/') || line.startsWith('+++ ')) {
      file = line.replace(/^\+\+\+\s+(?:b\/)?/, '').trim();
      break;
    }
    // Also try to extract from --- a/ line
    if (line.startsWith('--- a/') || line.startsWith('--- ')) {
      file = line.replace(/^---\s+(?:a\/)?/, '').trim();
    }
  }

  if (!file || file === '/dev/null') return null;

  const additions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

  return { file, hunks: block, additions, deletions };
}

// ─── Tool execution ─────────────────────────────────────────────────────────

// Dangerous command patterns that should NEVER be executed from LLM output
const BLOCKED_BASH_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)\b/,  // rm -rf, rm -f
  /\bchmod\s+[0-7]{3,4}\b/,                // chmod 777
  /\bchown\b/,
  /\bcurl\s.*\|\s*(?:sh|bash)\b/,          // curl | sh
  /\bwget\s.*\|\s*(?:sh|bash)\b/,          // wget | sh
  /\bdd\s+if=/,                            // dd if=
  /\bmkfs\b/,
  /\b:\(\)\s*\{\s*:\|:\s*&\s*\}/,          // fork bomb
  />\s*\/etc\//,                            // redirect to /etc
  />\s*\/dev\//,                            // redirect to /dev
  /\bsudo\b/,
  /\bsu\s+-?\s/,
  /\beval\s/,
  /\bexec\s/,
  /\bkill\s+-9\b/,
];

function isBashCommandSafe(command: string): boolean {
  return !BLOCKED_BASH_PATTERNS.some(p => p.test(command));
}

async function executeMintTool(
  tool: string,
  args: string | Record<string, unknown> | string[],
  cwd: string,
): Promise<string> {
  try {
    if (tool === 'bash') {
      const command = typeof args === 'string' ? args : (args as Record<string, unknown>).command as string;
      if (!command) return 'Error: no command provided';
      if (!isBashCommandSafe(command)) {
        return `Error: blocked dangerous command: ${command.slice(0, 80)}`;
      }
      const output = execSync(command, {
        cwd,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 64 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output;
    }

    if (tool === 'read') {
      const { readFile } = await import('node:fs/promises');
      const { join, resolve, sep } = await import('node:path');
      const files = Array.isArray(args) ? args : (args as Record<string, unknown>).files as string[];
      if (!files || files.length === 0) return 'Error: no files specified';

      const cwdAbs = resolve(cwd);
      const results: string[] = [];
      for (const f of files.slice(0, 5)) {
        const fullPath = resolve(cwdAbs, f);
        if (!fullPath.startsWith(cwdAbs + sep) && fullPath !== cwdAbs) {
          results.push(`${f}: BLOCKED (outside project)`);
          continue;
        }
        try {
          const content = await readFile(fullPath, 'utf-8');
          results.push(`--- ${f} ---\n${content}`);
        } catch {
          results.push(`${f}: file not found`);
        }
      }
      return results.join('\n\n');
    }

    return `Unknown tool: ${tool}`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── Tool output compression ────────────────────────────────────────────────

function compressMintToolOutput(tool: string, output: string, maxTokens = 200): string {
  const tokenEst = estimateTokens(output);
  if (tokenEst <= maxTokens) return output;

  if (tool === 'bash') {
    // Try to detect test output
    if (output.includes('PASS') || output.includes('FAIL') || output.includes('Tests:')) {
      return compressTestOutput(output, maxTokens);
    }
    // Try to detect build output
    if (output.includes('error TS') || output.includes('ERROR') || output.includes('Build')) {
      return compressBuildOutput(output, maxTokens);
    }
  }

  // Generic truncation
  const maxChars = maxTokens * 4;
  return output.slice(0, maxChars) + `\n... (${output.split('\n').length} lines total, truncated)`;
}

function compressTestOutput(output: string, maxTokens: number): string {
  const lines = output.split('\n');
  const summary: string[] = [];

  // Find summary line
  const summaryLine = lines.find(l => /Tests?:\s*\d+/.test(l) || /\d+\s+pass/.test(l));
  if (summaryLine) summary.push(summaryLine.trim());

  // Extract failures
  const failLines = lines.filter(l => /FAIL|✗|✕|×|Error|failed/i.test(l));
  summary.push(...failLines.slice(0, 10).map(l => l.trim()));

  if (summary.length === 0) {
    const maxChars = maxTokens * 4;
    return output.slice(0, maxChars) + '\n... (truncated)';
  }
  return summary.join('\n');
}

function compressBuildOutput(output: string, maxTokens: number): string {
  const lines = output.split('\n');
  const errors = lines.filter(l => /error/i.test(l) && !/warning/i.test(l));
  const summary = lines.find(l => /\d+\s+error/i.test(l));

  const result: string[] = [];
  if (summary) result.push(summary.trim());
  result.push(...errors.slice(0, 15).map(l => l.trim()));

  if (result.length === 0) {
    const maxChars = maxTokens * 4;
    return output.slice(0, maxChars) + '\n... (truncated)';
  }
  return result.join('\n');
}
