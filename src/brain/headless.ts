/**
 * Headless runner for non-TUI entry points (mint "task", mint exec, mint agent).
 *
 * Iterates runBrain() to completion and returns a flat summary. Auto-resolves
 * approval gates using the caller-provided strategy so `mint "task"` doesn't
 * hang waiting for a TUI keystroke.
 */
import { runBrain } from './loop.js';
import type { AgentEvent, BrainResult, Mode } from './events.js';
import type { ModelId } from '../providers/types.js';

export interface HeadlessOptions {
  task: string;
  cwd: string;
  mode?: Mode;
  signal?: AbortSignal;
  sessionId?: string;
  model?: ModelId;
  reasoning?: boolean;
  /** Called for every event. Useful for CLI progress output. */
  onEvent?: (event: AgentEvent) => void;
  /** Approval strategy — default auto-approves everything (treat like `auto` mode). */
  approve?: (reason: 'tool' | 'diff' | 'iteration', payload: Record<string, unknown>) => boolean;
}

export interface HeadlessResult {
  result: BrainResult | null;
  events: AgentEvent[];
  error?: string;
  aborted: boolean;
}

export async function runHeadless(options: HeadlessOptions): Promise<HeadlessResult> {
  const events: AgentEvent[] = [];
  let result: BrainResult | null = null;
  let errorMsg: string | undefined;
  let aborted = false;

  const approve = options.approve ?? (() => true);

  try {
    for await (const event of runBrain({
      task: options.task,
      cwd: options.cwd,
      mode: options.mode,
      signal: options.signal,
      sessionId: options.sessionId,
      model: options.model,
      reasoning: options.reasoning,
    })) {
      events.push(event);
      options.onEvent?.(event);

      if (event.type === 'approval.needed') {
        // Resolve immediately; no TUI prompt in headless mode.
        event.resolve(approve(event.reason, event.payload));
      }
      if (event.type === 'error') {
        errorMsg = event.error;
        if (!event.recoverable) aborted = true;
      }
      if (event.type === 'done') {
        result = event.result;
      }
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return { result, events, error: errorMsg, aborted };
}
