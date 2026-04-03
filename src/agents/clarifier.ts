/**
 * Clarifier — generates SMART clarifying questions based on what's missing.
 *
 * NEVER asks about things the project files already answer (framework, stack, structure).
 * ONLY asks about things the agent can't figure out by reading the code:
 * business context, audience, content, design preferences.
 */
import { complete } from '../providers/index.js';
import { selectAgentModel } from './model-selector.js';

const CLARIFIER_PROMPT = `You are a task clarifier. Read the user's prompt and ask ONLY about what's genuinely unclear.

Rules:
- Ask about what YOU need to know to do THIS task well. No templates, no categories.
- Never ask about technical choices the code already answers (framework, language, file structure — the agent reads files itself).
- If the prompt is clear enough to act on, return [] (empty array — no questions needed).
- Modifications to existing work ("make it darker", "fix the form") need ZERO questions — just do it.
- Max 2 questions. Fewer is better. Zero is best if the prompt is clear.

Return ONLY a valid JSON array of question strings. Empty array [] if no questions needed.`;

export async function generateClarifyingQuestions(
  task: string,
  signal?: AbortSignal,
  projectContext?: string,
): Promise<string[]> {
  const model = selectAgentModel('scout', 'simple');

  const userMessage = projectContext
    ? `Task: ${task}\n\nProject context:\n${projectContext}`
    : `Task: ${task}`;

  try {
    const response = await complete({
      model,
      messages: [
        { role: 'system', content: CLARIFIER_PROMPT },
        { role: 'user', content: userMessage },
      ],
      maxTokens: 200,
      temperature: 0.3,
      signal,
    });

    const jsonMatch = response.content.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as unknown[];
      return parsed.map(String).filter(Boolean).slice(0, 2);
    }
  } catch {
    // On any failure, return no questions — never block the pipeline
  }
  return [];
}
