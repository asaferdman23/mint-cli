/**
 * REVIEWER agent — verifies the builder's output.
 *
 * Only runs for moderate/complex tasks.
 * Accepts combined diffs from all builders and per-subtask IDs.
 * Outputs per-subtask feedback for targeted retries.
 */
import { complete } from '../providers/index.js';
import { calculateCost } from '../providers/router.js';
import { REVIEWER_PROMPT } from './prompts/reviewer.js';
import { selectAgentModel } from './model-selector.js';
import type { AgentInput, ReviewerOutput, TaskComplexity } from './types.js';

/**
 * Parse reviewer response JSON into typed shape.
 * Exported for testing.
 */
export function parseReviewerResponseFull(
  text: string,
): { approved: boolean; feedback: string; subtaskFeedback: Record<string, string> } {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        approved?: unknown;
        feedback?: unknown;
        subtaskFeedback?: unknown;
      };
      return {
        approved: parsed.approved === true,
        feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
        subtaskFeedback: (parsed.subtaskFeedback && typeof parsed.subtaskFeedback === 'object' && !Array.isArray(parsed.subtaskFeedback))
          ? (parsed.subtaskFeedback as Record<string, string>)
          : {},
      };
    }
  } catch { /* parse failed */ }

  // Fallback: detect approval from raw text
  const approved = /approved["']?\s*:\s*true/i.test(text);
  return { approved, feedback: text.slice(0, 200), subtaskFeedback: {} };
}

export async function runReviewer(
  input: AgentInput,
  complexity: TaskComplexity,
  allDiffs: string,
  subtaskIds: string[] = [],
): Promise<ReviewerOutput> {
  const startTime = Date.now();
  const { task, signal } = input;
  const model = selectAgentModel('reviewer', complexity);

  // Pass full diffs up to 8000 chars
  const diffsSlice = allDiffs.slice(0, 8000);

  let userContent = `Original task: ${task}\n\nProposed changes:\n${diffsSlice}`;
  if (subtaskIds.length > 1) {
    userContent += `\n\nSubtask IDs to evaluate: ${subtaskIds.join(', ')}`;
  }

  const response = await complete({
    model,
    messages: [
      { role: 'system', content: REVIEWER_PROMPT },
      { role: 'user', content: userContent },
    ],
    maxTokens: 600,
    temperature: 0,
    signal,
  });

  const duration = Date.now() - startTime;
  const cost = calculateCost(model, response.usage.inputTokens, response.usage.outputTokens);
  const parsed = parseReviewerResponseFull(response.content);

  return {
    result: response.content,
    approved: parsed.approved,
    feedback: parsed.feedback,
    subtaskFeedback: parsed.subtaskFeedback,
    model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cost: cost.total,
    duration,
  };
}
