/**
 * Headless exec mode — runs a task with NO interactive TUI.
 *
 * Outputs structured JSON to stdout, progress to stderr. Designed for agent
 * integration (scripts, CI, other orchestrators). All execution goes through
 * the brain; the JSON shape is preserved for byte-compat with existing callers.
 */
import { runHeadless } from '../brain/index.js';
import type { ModelId } from '../providers/types.js';

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

function progress(msg: string): void {
  process.stderr.write(`[mint] ${msg}\n`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

export async function runExec(options: ExecOptions): Promise<ExecResult> {
  const cwd = options.workdir ?? process.cwd();

  try {
    const { result, error } = await runHeadless({
      task: options.task,
      cwd,
      mode: options.apply ? 'auto' : 'plan',
      reasoning: options.think ? true : options.fast ? false : undefined,
      onEvent: (event) => {
        switch (event.type) {
          case 'classify':
            progress(`classify ${event.kind}/${event.complexity} → ${event.model}`);
            break;
          case 'tool.call':
            progress(`tool ${event.name}`);
            break;
          case 'diff.applied':
            progress(`applied ${event.file} (+${event.additions} -${event.deletions})`);
            break;
        }
      },
    });

    if (error || !result) {
      return {
        success: false,
        task: options.task,
        complexity: 'unknown',
        model: 'unknown',
        stats: emptyStats(),
        error: error ?? 'brain produced no result',
      };
    }

    try {
      const { trackBrainRun } = await import('../usage/tracker.js');
      trackBrainRun({
        sessionId: Date.now().toString(36),
        task: options.task,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.totalCostUsd,
        durationMs: result.durationMs,
      });
    } catch {
      /* best-effort */
    }

    return {
      success: result.success,
      task: options.task,
      complexity: 'brain',
      model: result.model,
      diffs: result.filesTouched.map((file) => ({
        file,
        hunks: '',
        additions: 0,
        deletions: 0,
      })),
      applied: options.apply,
      message: result.output || undefined,
      stats: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.totalCostUsd,
        durationMs: result.durationMs,
        filesSearched: 0,
        filesLoaded: 0,
        contextTokens: 0,
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
      stats: emptyStats(),
      error: errorMsg,
    };
  }
}

function emptyStats(): ExecResult['stats'] {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    durationMs: 0,
    filesSearched: 0,
    filesLoaded: 0,
    contextTokens: 0,
  };
}
