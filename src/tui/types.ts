// src/tui/types.ts

export type PhaseName = 'SCOUT' | 'ARCHITECT' | 'BUILDER' | 'REVIEWER';
export type PhaseStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface PipelinePhaseData {
  name: PhaseName;
  status: PhaseStatus;
  model?: string;
  duration?: number;
  cost?: number;
  summary?: string;
  streamingContent?: string;
}

export interface ContextChip {
  label: string;
  color: string;
}
