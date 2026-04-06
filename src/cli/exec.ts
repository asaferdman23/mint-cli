/**
 * Headless exec mode — runs a task with NO interactive TUI.
 *
 * Outputs structured JSON to stdout, progress to stderr.
 * Designed for agent integration (OpenClaw, LangChain, scripts).
 *
 * Usage:
 *   mint exec "fix the auth bug"           → JSON with diffs (not applied)
 *   mint exec --apply "fix the auth bug"   → JSON + auto-apply diffs
 *   mint exec --think "complex refactor"   → Force deepseek-reasoner
 *   mint exec --fast "rename variable"     → Force deepseek-chat
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { runMintTask, type TaskResult, type ParsedDiff, type MintLoopOptions } from '../agent/mint-loop.js';
import type { DeepSeekModel } from '../context/classifier.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecOptions {
  task: string;
  apply?: boolean;
  think?: boolean;
  fast?: boolean;
  maxToolCalls?: number;
  workdir?: string;
}

export interface ExecResult {
  success: boolean;
  task: string;
  complexity: string;
  model: string;
  diffs?: Array<{
    file: string;
    hunks: string;
    additions: number;
    deletions: number;
  }>;
  applied?: boolean;
  message?: string;
  toolCalls?: Array<{
    tool: string;
    command: string;
    output: string;
  }>;
  stats: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    durationMs: number;
    filesSearched: number;
    filesLoaded: number;
    contextTokens: number;
  };
  error?: string;
}

// ─── Progress to stderr ─────────────────────────────────────────────────────

function progress(msg: string): void {
  process.stderr.write(`[mint] ${msg}\n`);
}

// ─── Main exec function ─────────────────────────────────────────────────────

export async function runExec(options: ExecOptions): Promise<ExecResult> {
  const cwd = options.workdir ?? process.cwd();
  const forceModel: DeepSeekModel | undefined = options.think
    ? 'deepseek-reasoner'
    : options.fast
      ? 'deepseek-chat'
      : undefined;

  try {
    const loopOptions: MintLoopOptions = {
      cwd,
      forceModel,
      maxToolCalls: options.maxToolCalls ?? 5,
      stream: false,
      callbacks: {
        onProgress: progress,
        onToolCall: (tool, cmd) => progress(`Tool: ${tool} ${cmd.slice(0, 80)}`),
      },
    };

    const result = await runMintTask(options.task, loopOptions);

    // Apply diffs if requested
    let applied = false;
    if (options.apply && result.diffs && result.diffs.length > 0) {
      applyExecDiffs(result.diffs, cwd);
      applied = true;
      progress(`Applied changes to ${result.diffs.length} file(s)`);
    }

    progress(`Done in ${(result.durationMs / 1000).toFixed(1)}s · $${result.cost.toFixed(4)}`);

    return {
      success: true,
      task: options.task,
      complexity: result.complexity,
      model: result.model,
      diffs: result.diffs,
      applied: options.apply ? applied : undefined,
      message: result.message,
      toolCalls: result.toolCalls,
      stats: {
        inputTokens: result.contextTokens,
        outputTokens: result.tokensUsed - result.contextTokens,
        cost: result.cost,
        durationMs: result.durationMs,
        filesSearched: result.filesSearched,
        filesLoaded: result.filesLoaded,
        contextTokens: result.contextTokens,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    progress(`Error: ${errorMsg}`);
    return {
      success: false,
      task: options.task,
      complexity: 'unknown',
      model: 'unknown',
      stats: {
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        durationMs: 0,
        filesSearched: 0,
        filesLoaded: 0,
        contextTokens: 0,
      },
      error: errorMsg,
    };
  }
}

// ─── Diff application (shared) ──────────────────────────────────────────────

export function applyExecDiffs(diffs: ParsedDiff[], cwd: string): void {
  const cwdAbs = resolve(cwd);

  for (const diff of diffs) {
    const fullPath = resolve(cwdAbs, diff.file);
    if (!fullPath.startsWith(cwdAbs + sep) && fullPath !== cwdAbs) {
      progress(`Blocked path outside project: ${diff.file}`);
      continue;
    }

    try {
      // Parse hunks and apply changes
      const hunkLines = diff.hunks.split('\n');
      const removeLines: string[] = [];
      const addLines: string[] = [];

      for (const line of hunkLines) {
        if (line.startsWith('-') && !line.startsWith('---')) {
          removeLines.push(line.slice(1));
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          addLines.push(line.slice(1));
        }
      }

      if (removeLines.length === 0 && addLines.length > 0) {
        // New file
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, addLines.join('\n') + '\n', 'utf-8');
        progress(`Created ${diff.file}`);
        continue;
      }

      // Edit existing file
      const current = readFileSync(fullPath, 'utf-8');
      const oldBlock = removeLines.join('\n');
      const newBlock = addLines.join('\n');

      if (current.includes(oldBlock)) {
        writeFileSync(fullPath, current.replace(oldBlock, newBlock), 'utf-8');
        progress(`Modified ${diff.file}`);
      } else {
        progress(`Could not apply diff to ${diff.file} (text not found)`);
      }
    } catch (err) {
      progress(`Error applying to ${diff.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
