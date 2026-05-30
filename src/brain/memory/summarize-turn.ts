/**
 * Per-turn summarizer for L2 session memory (PR3).
 *
 * Generates a one-paragraph plain-prose summary of a completed brain turn so
 * follow-up prompts in the same session can see continuity ("now do the same
 * in App.tsx" must know what "the same" was). Strictly:
 *
 *   - cheap model (mistral-small, matching `compact.ts`)
 *   - no file contents in the prompt — only paths
 *   - failure returns a deterministic fallback string, never throws
 *
 * This file is also the seed for PR4's typed-memory extractor: the same call
 * site will fan out a second JSON-shaped extraction once that lands.
 */
import { complete } from '../../providers/index.js';
import type { ModelId } from '../../providers/types.js';

export interface TurnInputs {
  userTask: string;
  finalAssistant: string;
  filesTouched: string[];
  toolCalls: number;
  outcome: 'success' | 'partial' | 'aborted';
  model: string;
}

export interface TurnSummary {
  /** Compact one-paragraph summary, ~3-5 sentences, ≤ ~200 tokens. */
  text: string;
  /** Source turn data — kept for future PRs that extract typed memories. */
  inputs: TurnInputs;
  createdAt: number;
}

const DEFAULT_MODEL: ModelId = 'mistral-small';

const SYSTEM_PROMPT =
  "Summarize this coding turn in 3-5 sentences. Include: what the user asked, what files changed (paths only, no content), key decisions, outcome. Output plain prose, no markdown headers, no bullets, no preamble like 'In this turn'. ≤ 200 tokens.";

/** Build the user-side payload for the summarizer. Intentionally only contains
 *  the strings + paths from TurnInputs — never any file body or tool output. */
function buildUserPayload(inputs: TurnInputs): string {
  const truncatedTask = inputs.userTask.length > 600 ? `${inputs.userTask.slice(0, 600)}…` : inputs.userTask;
  const truncatedAssistant =
    inputs.finalAssistant.length > 1200
      ? `${inputs.finalAssistant.slice(0, 1200)}…`
      : inputs.finalAssistant;
  const filesLine =
    inputs.filesTouched.length === 0
      ? '(no files touched)'
      : inputs.filesTouched.join(', ');
  return [
    `User task: ${truncatedTask}`,
    `Files touched: ${filesLine}`,
    `Tool calls: ${inputs.toolCalls}`,
    `Outcome: ${inputs.outcome}`,
    `Model: ${inputs.model}`,
    `Final assistant message: ${truncatedAssistant}`,
  ].join('\n');
}

function buildFallback(inputs: TurnInputs): string {
  const head = inputs.userTask.replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${head} — ${inputs.outcome}, ${inputs.filesTouched.length} file(s) touched.`;
}

export async function summarizeTurn(
  inputs: TurnInputs,
  options?: { signal?: AbortSignal; model?: ModelId },
): Promise<TurnSummary> {
  const createdAt = Date.now();
  const model = options?.model ?? DEFAULT_MODEL;

  try {
    const response = await complete({
      model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPayload(inputs) }],
      maxTokens: 256,
      temperature: 0,
      signal: options?.signal,
    });
    const text = response.content.trim();
    if (!text) {
      return { text: buildFallback(inputs), inputs, createdAt };
    }
    return { text, inputs, createdAt };
  } catch {
    return { text: buildFallback(inputs), inputs, createdAt };
  }
}

/** Exported for tests that want to verify the prompt body never contains file
 *  contents. */
export const __testing = { buildUserPayload, buildFallback, SYSTEM_PROMPT };
