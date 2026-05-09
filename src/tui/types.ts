// src/tui/types.ts
// These types used to come from the legacy pipeline; inlined after the
// deletes so the TUI stays independent of the removed pipeline module.

export type PhaseName = 'SCOUT' | 'ARCHITECT' | 'BUILDER' | 'REVIEWER';
export type PhaseStatus = 'pending' | 'active' | 'done' | 'skipped';

export type PipelineTaskStatus =
  | 'pending'
  | 'queued'
  | 'blocked'
  | 'running'
  | 'waiting_approval'
  | 'done'
  | 'retry'
  | 'failed';

export interface SubtaskData {
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
  recentLogs?: string[];
}

export interface PipelinePhaseData {
  name: PhaseName;
  status: PhaseStatus;
  model?: string;
  duration?: number;
  cost?: number;
  summary?: string;
  streamingContent?: string;
  /** Subtasks for parallel builder phases. */
  subtasks?: SubtaskData[];
}

export interface ContextChip {
  label: string;
  color: string;
}
