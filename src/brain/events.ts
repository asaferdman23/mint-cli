/**
 * Unified event stream for the Mint brain agent.
 *
 * Every caller (TUI, `mint exec`, tests) subscribes to this one union.
 * Retires AgentLoopChunk, OrchestratorCallbacks, PipelineChunk, MintLoopCallbacks.
 */
import type { ModelId } from '../providers/types.js';

export type TaskKind =
  | 'question'
  | 'edit_small'
  | 'edit_multi'
  | 'refactor'
  | 'debug'
  | 'scaffold'
  | 'review'
  | 'explain';

export type Complexity = 'trivial' | 'simple' | 'moderate' | 'complex';

export type Mode = 'plan' | 'diff' | 'auto' | 'yolo';

export type PhaseName = 'scout' | 'plan' | 'build' | 'review';

export interface PlanStep {
  id: string;
  description: string;
  filesHint?: string[];
}

export interface RetrievedFile {
  path: string;
  score: number;
  summary?: string;
  source: 'bm25' | 'embedding' | 'fusion' | 'graph' | 'pinned';
}

export interface OutcomeMatch {
  taskPreview: string;
  kind: TaskKind;
  complexity: Complexity;
  success: boolean;
  costUsd: number;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Array<{ type: 'context' | 'add' | 'remove'; content: string }>;
}

export interface BrainResult {
  output: string;
  model: ModelId;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  iterations: number;
  toolCalls: number;
  filesTouched: string[];
  success: boolean;
}

export type ApprovalReason = 'tool' | 'diff' | 'iteration';

export type AgentEvent =
  | { type: 'session.start'; sessionId: string; mode: Mode; task: string; cwd: string; ts: number }
  | {
      type: 'classify';
      sessionId: string;
      kind: TaskKind;
      complexity: Complexity;
      model: ModelId;
      estFilesTouched: number;
      needsPlan: boolean;
      needsApproval: 'none' | 'per_diff' | 'per_tool';
      confidence: number;
      reasoning: string;
      source: 'llm' | 'fallback' | 'precheck';
      ts: number;
    }
  | {
      type: 'context.retrieved';
      sessionId: string;
      files: RetrievedFile[];
      skills: string[];
      examples: string[];
      outcomesMatched: OutcomeMatch[];
      tokenBudget: number;
      tokensUsed: number;
      ts: number;
    }
  | { type: 'plan.draft'; sessionId: string; steps: PlanStep[]; ts: number }
  | { type: 'text.delta'; sessionId: string; text: string; ts: number }
  | {
      type: 'tool.call';
      sessionId: string;
      id: string;
      name: string;
      input: Record<string, unknown>;
      iteration: number;
      ts: number;
    }
  | {
      type: 'tool.result';
      sessionId: string;
      id: string;
      ok: boolean;
      output: string;
      tokens: number;
      durationMs: number;
      ts: number;
    }
  | {
      type: 'approval.needed';
      sessionId: string;
      reason: ApprovalReason;
      payload: Record<string, unknown>;
      resolve: (ok: boolean) => void;
      ts: number;
    }
  | { type: 'diff.proposed'; sessionId: string; file: string; hunks: Hunk[]; ts: number }
  | {
      type: 'diff.applied';
      sessionId: string;
      file: string;
      additions: number;
      deletions: number;
      ts: number;
    }
  | {
      type: 'compact';
      sessionId: string;
      reason: 'tokens' | 'iteration';
      beforeTokens: number;
      afterTokens: number;
      ts: number;
    }
  | {
      type: 'cost.delta';
      sessionId: string;
      model: ModelId;
      inputTokens: number;
      outputTokens: number;
      usd: number;
      ts: number;
    }
  | {
      type: 'phase';
      sessionId: string;
      name: PhaseName;
      status: 'start' | 'end';
      durationMs?: number;
      ts: number;
    }
  | { type: 'warn'; sessionId: string; message: string; ts: number }
  | { type: 'error'; sessionId: string; error: string; recoverable: boolean; ts: number }
  | { type: 'done'; sessionId: string; result: BrainResult; ts: number };

export type AgentEventType = AgentEvent['type'];

/**
 * Distributive Omit — preserves the discriminated-union branches.
 * `Omit<AgentEvent, 'sessionId' | 'ts'>` collapses to the intersection of
 * shared keys; `DistributiveOmit` applies Omit per branch so callers can
 * construct any single branch with literal object syntax.
 */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type AgentEventInit = DistributiveOmit<AgentEvent, 'sessionId' | 'ts'>;

export function isEventType<T extends AgentEventType>(
  event: AgentEvent,
  type: T,
): event is Extract<AgentEvent, { type: T }> {
  return event.type === type;
}

/**
 * Strip non-serializable fields (e.g. the `resolve` closure on approval.needed)
 * before persisting or sending over IPC.
 */
export function serializableEvent(event: AgentEvent): Record<string, unknown> {
  if (event.type === 'approval.needed') {
    const { resolve: _resolve, ...rest } = event;
    return rest;
  }
  return event as unknown as Record<string, unknown>;
}
