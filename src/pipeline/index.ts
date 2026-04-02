/**
 * Core pipeline entry point.
 *
 * Delegates to the multi-agent pipeline (Scout → Architect → Builder → Reviewer).
 * Both one-shot CLI and interactive TUI consume this.
 */
import { runAgentPipeline } from '../agents/index.js';
import type {
  PipelineChunk,
  PipelineResult,
  PipelineOptions,
  ParsedDiff,
} from './types.js';

export type { PipelineChunk, PipelineResult, PipelineOptions, ParsedDiff };
export { parseDiffs, hasDiffs } from './diff-parser.js';
export { formatDiffs, formatCostSummary, formatRawUnifiedDiff } from './diff-display.js';

/**
 * Run the pipeline as a streaming generator.
 *
 * Yields PipelineChunks as agents complete:
 *   phase-start → phase-done → text (many) → done
 */
export async function* runPipeline(
  task: string,
  options: PipelineOptions,
): AsyncGenerator<PipelineChunk> {
  yield* runAgentPipeline(task, options);
}

/**
 * One-shot pipeline — collects the full result without streaming.
 */
export async function collectPipeline(
  task: string,
  options: PipelineOptions,
): Promise<PipelineResult> {
  let result: PipelineResult | undefined;

  for await (const chunk of runPipeline(task, options)) {
    if (chunk.type === 'done' && chunk.result) {
      result = chunk.result;
    }
    if (chunk.type === 'error') {
      throw new Error(chunk.error);
    }
  }

  if (!result) {
    throw new Error('Pipeline completed without producing a result');
  }

  return result;
}
