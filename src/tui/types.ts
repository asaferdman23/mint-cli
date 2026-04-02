// src/tui/types.ts
import type { PipelinePhaseName, PipelineTaskStatus } from '../pipeline/types.js';

export type PhaseName = PipelinePhaseName;
export type PhaseStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface SubtaskData {
  id: string;
  description: string;
  status: PipelineTaskStatus;
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
