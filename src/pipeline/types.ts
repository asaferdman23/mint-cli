import type { ModelId } from '../providers/types.js';

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

/** Chunk emitted during streaming pipeline execution. */
export interface PipelineChunk {
  type: 'search' | 'context' | 'phase-start' | 'phase-done' | 'text' | 'done' | 'error';
  /** Streaming text from the model. */
  text?: string;
  /** Files found during search phase. */
  filesFound?: string[];
  /** Context token count after compression. */
  contextTokens?: number;
  /** Phase name (for phase-start, phase-done). */
  phase?: 'SCOUT' | 'ARCHITECT' | 'BUILDER' | 'REVIEWER';
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
}
