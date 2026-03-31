import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import { agentLoop, type AgentLoopChunk } from './loop.js';
import type { AgentOptions, AgentMode } from './tools.js';
import { buildContextPack } from '../context/pack.js';
import type { ModelId } from '../providers/types.js';
import { MODELS } from '../providers/types.js';
import { getTier } from '../providers/tiers.js';
import { selectModelWithReason } from '../providers/router.js';
import { createUsageTracker, calculateOpusCost } from '../usage/tracker.js';

// ─── System Prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(cwd: string): string {
  const homeDir = os.homedir();
  const platform = process.platform;
  return `You are Mint, an expert AI coding agent running in a terminal.

<environment>
  <cwd>${cwd}</cwd>
  <home>${homeDir}</home>
  <platform>${platform}</platform>
</environment>

<capabilities>
You have access to these tools:
- bash: Execute shell commands (with 30s timeout and 64KB output cap)
- read_file: Read file contents
- write_file: Create or overwrite files
- edit_file: Replace exact text in a file
- find_files: Find files by glob pattern
- grep_files: Search file contents with regex
</capabilities>

<rules>
1. Think step-by-step before acting. Plan before coding.
2. Use read_file before editing — never edit blindly.
3. Use edit_file for targeted changes, write_file only for new files or full rewrites.
4. After making changes, verify with bash (run tests, build, lint).
5. Keep changes minimal and focused on the task.
6. If a command fails, analyze the error and try again with a fix.
7. When done, summarize what you accomplished.
</rules>`;
}

// ─── Enriched system prompt ────────────────────────────────────────────────────

export async function buildEnrichedSystemPrompt(
  task: string,
  cwd: string,
  modelId: ModelId,
): Promise<string> {
  const base = buildSystemPrompt(cwd);
  try {
    const pack = await buildContextPack(cwd, modelId, task);
    return pack.systemContext + '\n\n' + base;
  } catch {
    // Context pack failed (e.g. not a git repo) — fall back to base prompt
    return base;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RunAgentOptions {
  model?: string;
  cwd?: string;
  signal?: AbortSignal;
  verbose?: boolean;
  onChunk?: (chunk: AgentLoopChunk) => void;
  mode?: AgentMode;
  onApprovalNeeded?: (toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>;
  onDiffProposed?: (path: string, diff: string) => Promise<boolean>;
}

/**
 * Run the coding agent on a task description.
 * Streams output to stdout by default, or calls onChunk for custom rendering.
 */
export async function runAgent(task: string, options: RunAgentOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const resolvedModel = (options.model ?? 'deepseek-v3') as ModelId;
  const systemPrompt = await buildEnrichedSystemPrompt(task, cwd, resolvedModel);

  const agentOptions: AgentOptions = {
    cwd,
    model: options.model,
    signal: options.signal,
    verbose: options.verbose ?? false,
    mode: options.mode,
    onApprovalNeeded: options.onApprovalNeeded,
    onDiffProposed: options.onDiffProposed,
  };

  const onChunk = options.onChunk ?? defaultRenderer;
  const tracker = createUsageTracker(Date.now().toString(36), 'agent');
  const routing = selectModelWithReason(task);
  let accumulatedOutput = '';

  for await (const chunk of agentLoop(task, { ...agentOptions, systemPrompt })) {
    onChunk(chunk);
    if (chunk.type === 'text' && chunk.text) {
      accumulatedOutput += chunk.text;
    }
    if (chunk.type === 'done') {
      const inputTokens = Math.ceil(task.length / 4);
      const outputTokens = Math.ceil(accumulatedOutput.length / 4);
      const modelInfo = MODELS[resolvedModel];
      const cost = modelInfo
        ? (inputTokens / 1_000_000) * modelInfo.inputPrice + (outputTokens / 1_000_000) * modelInfo.outputPrice
        : 0;
      const opusCost = calculateOpusCost(inputTokens, outputTokens);
      tracker.track({
        model: resolvedModel,
        provider: modelInfo?.provider ?? 'unknown',
        tier: getTier(resolvedModel),
        inputTokens,
        outputTokens,
        cost,
        opusCost,
        savedAmount: Math.max(0, opusCost - cost),
        routingReason: routing.reason,
        taskPreview: task,
      });
      break;
    }
    if (chunk.type === 'error') {
      break;
    }
  }
}

// ─── Default Terminal Renderer ────────────────────────────────────────────────

function defaultRenderer(chunk: AgentLoopChunk): void {
  switch (chunk.type) {
    case 'text':
      if (chunk.text) {
        process.stdout.write(chunk.text);
      }
      break;

    case 'tool_call':
      process.stdout.write('\n');
      process.stdout.write(
        chalk.cyan(`\n  [tool] ${chunk.toolName}`) +
        chalk.gray(` ${JSON.stringify(chunk.toolInput ?? {}).slice(0, 120)}`) +
        '\n'
      );
      break;

    case 'tool_result':
      if (chunk.results) {
        for (const result of chunk.results) {
          const preview = result.content.slice(0, 200).replace(/\n/g, ' ');
          const color = result.isError ? chalk.red : chalk.green;
          process.stdout.write(
            color(`  [result] ${result.toolName}: `) +
            chalk.gray(preview) +
            '\n'
          );
        }
      }
      break;

    case 'done':
      process.stdout.write('\n');
      break;

    case 'error':
      process.stderr.write(chalk.red(`\n[agent error] ${chunk.error}\n`));
      break;
  }
}
