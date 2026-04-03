import type { ModelId } from '../providers/types.js';
import type { AgentMode } from '../agent/tools.js';

/** A single file diff parsed from the LLM response. */
export interface ParsedDiff {
  filePath: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

export type PipelinePhaseName = 'SCOUT' | 'ARCHITECT' | 'BUILDER' | 'REVIEWER';
export type PipelineTaskStatus =
  | 'pending'
  | 'queued'
  | 'blocked'
  | 'running'
  | 'waiting_approval'
  | 'done'
  | 'retry'
  | 'failed';

export interface PipelineTaskInfo {
  taskId: string;
  subtaskId?: string;
  parentTaskId?: string;
  phase: PipelinePhaseName;
  role: 'scout' | 'architect' | 'builder' | 'reviewer';
  title: string;
  description: string;
  status: PipelineTaskStatus;
  progressSummary?: string;
  blockedBy?: string[];
  isBackground?: boolean;
  requiresApproval?: boolean;
  model?: string;
  startedAt?: number;
  duration?: number;
  cost?: number;
  attempt?: number;
  dependsOn?: string[];
  writeTargets?: string[];
  verificationTargets?: string[];
  outputPath?: string;
  transcriptPath?: string;
  transcriptName?: string;
  allowedTools?: string[];
}

/** Chunk emitted during streaming pipeline execution. */
export interface PipelineChunk {
  type:
    | 'search'
    | 'context'
    | 'clarification'
    | 'phase-start'
    | 'phase-done'
    | 'task-start'
    | 'task-progress'
    | 'task-log'
    | 'task-done'
    | 'task-failed'
    | 'task-notification'
    | 'text'
    | 'done'
    | 'error';
  /** Streaming text from the model. */
  text?: string;
  /** Files found during search phase. */
  filesFound?: string[];
  /** Context token count after compression. */
  contextTokens?: number;
  /** Phase name (for phase-start, phase-done). */
  phase?: PipelinePhaseName;
  /** Model used by this phase. */
  phaseModel?: string;
  /** Phase summary (for phase-done). */
  phaseSummary?: string;
  /** Phase duration in ms (for phase-done). */
  phaseDuration?: number;
  /** Phase cost in dollars (for phase-done). */
  phaseCost?: number;
  /** Final result (only on type: 'done'). */
  result?: PipelineResult;
  /** Error message (only on type: 'error'). */
  error?: string;
  /** Clarifying questions (for type: 'clarification'). */
  questions?: string[];
  /** Subtask info for parallel builders. */
  subtasks?: SubtaskInfo[];
  /** Task-level event payload. */
  task?: PipelineTaskInfo;
  /** Optional log payload for task-log events. */
  log?: string;
}

export interface SubtaskInfo {
  id: string;
  description: string;
  status: PipelineTaskStatus;
  startedAt?: number;
  duration?: number;
  cost?: number;
  taskId?: string;
  parentTaskId?: string;
  role?: 'scout' | 'architect' | 'builder' | 'reviewer';
  title?: string;
  progressSummary?: string;
  blockedBy?: string[];
  requiresApproval?: boolean;
  isBackground?: boolean;
  model?: string;
  attempt?: number;
  dependsOn?: string[];
  writeTargets?: string[];
  verificationTargets?: string[];
  transcriptPath?: string;
  transcriptName?: string;
}

/** Final result after pipeline completes. */
export interface PipelineResult {
  /** Full model response text. */
  response: string;
  /** Diffs parsed from the response. */
  diffs: ParsedDiff[];
  /** Files included in context. */
  filesSearched: string[];
  /** Model used. */
  model: ModelId;
  /** Cost in dollars. */
  cost: number;
  /** Estimated input tokens. */
  inputTokens: number;
  /** Estimated output tokens. */
  outputTokens: number;
  /** Wall-clock duration in ms. */
  duration: number;
  /** What Claude Opus would have cost. */
  opusCost: number;
}

export interface PipelineOptions {
  cwd: string;
  model?: ModelId;
  signal?: AbortSignal;
  /** Conversation history for TUI mode. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  agentMode?: AgentMode;
  onApprovalNeeded?: (toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>;
  onDiffProposed?: (path: string, diff: string) => Promise<boolean>;
  onIterationApprovalNeeded?: (
    iteration: number,
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
  ) => Promise<boolean>;
  /**
   * Called in plan mode when the pipeline has clarifying questions.
   * Return the user's free-form answer — it will be injected into the task.
   */
  onClarificationNeeded?: (questions: string[]) => Promise<string>;
}
