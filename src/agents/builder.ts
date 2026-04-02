/**
 * BUILDER agent — generates code changes as unified diffs.
 *
 * Gets the task + plan (from architect) + relevant files.
 * Streams response for progressive TUI rendering.
 *
 * In isolated mode (subtask parallel builds):
 * - Uses only the provided searchResults (no global files)
 * - Skips conversation history (each subtask is independent)
 */
import { streamComplete } from '../providers/index.js';
import { calculateCost } from '../providers/router.js';
import { compressContext } from '../context/compress.js';
import { getTier, getBudget } from '../providers/tiers.js';
import { estimateTokens } from '../context/budget.js';
import { loadProjectRules, formatProjectRulesForPrompt } from '../context/project-rules.js';
import { BUILDER_PROMPT } from './prompts/builder.js';
import { getSpecialist } from './specialists/index.js';
import { selectAgentModel } from './model-selector.js';
import { loadSkills, getSkillsForSpecialist } from '../context/skills.js';
import type { SpecialistType } from './specialists/types.js';
import type { AgentInput, BuilderOutput, TaskComplexity } from './types.js';
import type { Message } from '../providers/types.js';

export interface BuilderOptions {
  /** When true: skip history, use only provided searchResults (subtask mode). */
  isolated?: boolean;
  /** Streaming text callback. */
  onText?: (text: string) => void;
  /** Specialist type — uses specialist-specific system prompt + matching skills. */
  specialist?: SpecialistType;
}

export async function runBuilder(
  input: AgentInput,
  complexity: TaskComplexity,
  plan: string | undefined,
  options?: BuilderOptions,
): Promise<BuilderOutput> {
  const startTime = Date.now();
  const { task, cwd, signal, searchResults = [], history = [] } = input;
  const isolated = options?.isolated ?? false;
  const model = selectAgentModel('builder', complexity);
  const tier = getTier(model);

  // Build system prompt with file context
  const parts: string[] = [];

  // Project rules
  try {
    const rules = await loadProjectRules(cwd);
    if (rules) parts.push(formatProjectRulesForPrompt(rules));
  } catch { /* no rules */ }

  // Use specialist prompt if specified, otherwise default BUILDER_PROMPT
  const specialistType = options?.specialist;
  if (specialistType) {
    const specialist = getSpecialist(specialistType);
    parts.push(specialist.systemPrompt);
  } else {
    parts.push(BUILDER_PROMPT);
  }

  // Append matching skills from .mint/skills/
  try {
    const skills = loadSkills(cwd);
    if (skills.length > 0) {
      const matching = getSkillsForSpecialist(skills, specialistType ?? 'general');
      if (matching.length > 0) {
        const skillBlocks = matching.map(s => `<skill name="${s.name}">\n${s.content}\n</skill>`);
        parts.push(`\n<skills>\n${skillBlocks.join('\n\n')}\n</skills>`);
      }
    }
  } catch { /* no skills */ }

  // Include project file tree from index (always — lets the model answer structural questions)
  // Skip in isolated mode to keep the prompt focused on the subtask files.
  if (!isolated) {
    try {
      const { loadIndex } = await import('../context/index.js');
      const index = await loadIndex(cwd);
      if (index && index.totalFiles > 0) {
        const fileList = Object.keys(index.files).sort().join('\n');
        parts.push(`\n<project_tree totalFiles="${index.totalFiles}" language="${index.language}">\n${fileList}\n</project_tree>`);
      }
    } catch { /* no index */ }
  }

  // Compress and include relevant files
  const fileEntries = searchResults.map(r => ({
    path: r.path,
    content: r.content,
    language: r.language,
  }));
  const { files: compressed } = compressContext(fileEntries, tier);

  const overhead = estimateTokens(parts.join('\n'));
  let fileBudget = Math.min(6000, 8000 - overhead);
  const fileBlocks: string[] = [];

  for (const f of compressed) {
    const block = `<file path="${f.path}">\n${f.content}\n</file>`;
    const tokens = estimateTokens(block);
    if (tokens > fileBudget) break;
    fileBlocks.push(block);
    fileBudget -= tokens;
  }

  if (fileBlocks.length > 0) {
    parts.push(`\n<context files="${fileBlocks.length}">\n${fileBlocks.join('\n\n')}\n</context>`);
  }

  const systemPrompt = parts.join('\n');

  // Build messages
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history only in non-isolated mode (single-task / multi-turn TUI)
  if (!isolated) {
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // User message: task + plan
  let userContent = task;
  if (plan) {
    userContent = `Task: ${task}\n\nImplementation plan:\n${plan}\n\nNow implement the plan. Output unified diffs for all changes.`;
  }
  messages.push({ role: 'user', content: userContent });

  // Stream response
  let fullResponse = '';
  for await (const chunk of streamComplete({ model, messages, signal })) {
    fullResponse += chunk;
    options?.onText?.(chunk);
  }

  const duration = Date.now() - startTime;
  const inputTokens = Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4);
  const outputTokens = Math.ceil(fullResponse.length / 4);
  const cost = calculateCost(model, inputTokens, outputTokens);

  return {
    result: fullResponse,
    response: fullResponse,
    model,
    inputTokens,
    outputTokens,
    cost: cost.total,
    duration,
  };
}
