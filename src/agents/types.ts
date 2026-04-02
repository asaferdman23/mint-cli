import type { ModelId } from '../providers/types.js';
import type { SearchResult } from '../context/search.js';
import type { SpecialistType } from './specialists/types.js';

export type AgentRole = 'scout' | 'architect' | 'builder' | 'reviewer';
export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';

export interface AgentInput {
  task: string;
  cwd: string;
  signal?: AbortSignal;
  /** Search results from the scout phase. */
  searchResults?: SearchResult[];
  /** Output from the previous agent in the pipeline. */
  previousOutput?: string;
  /** Conversation history for multi-turn. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentOutput {
  result: string;
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
}

export interface ScoutOutput extends AgentOutput {
  complexity: TaskComplexity;
  relevantFiles: SearchResult[];
  fileSummary: string;
}

export interface Subtask {
  id: string;
  description: string;
  relevantFiles: string[];  // file paths for this subtask only
  plan: string;
  specialist: SpecialistType;
  dependsOn?: string[];
  writeTargets?: string[];
  verificationTargets?: string[];
}

export interface ArchitectOutput extends AgentOutput {
  type: 'single' | 'split';
  plan?: string;        // for type='single'
  subtasks?: Subtask[]; // for type='split'
}

export interface BuilderOutput extends AgentOutput {
  response: string;
}

export interface SubtaskBuilderResult {
  subtaskId: string;
  response: string;
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
}

export interface ReviewerOutput extends AgentOutput {
  approved: boolean;
  feedback: string;
  subtaskFeedback?: Record<string, string>; // subtaskId -> specific feedback for retry
}

export interface PipelinePhase {
  agent: AgentRole;
  output: AgentOutput;
}

export interface MultiAgentResult {
  phases: PipelinePhase[];
  finalResponse: string;
  totalCost: number;
  totalDuration: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  model: ModelId;
  filesSearched: string[];
  complexity: TaskComplexity;
}
