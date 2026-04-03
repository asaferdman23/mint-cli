/**
 * ARCHITECT agent — creates a structured implementation plan.
 *
 * Only runs for moderate/complex tasks. Gets the task + relevant file
 * contents and outputs JSON: either a single plan or split subtasks.
 */
import { complete } from '../providers/index.js';
import { calculateCost } from '../providers/router.js';
import { compressContext } from '../context/compress.js';
import { getTier } from '../providers/tiers.js';
import { estimateTokens } from '../context/budget.js';
import { ARCHITECT_PROMPT } from './prompts/architect.js';
import { selectAgentModel } from './model-selector.js';
import { detectSpecialist } from './specialists/index.js';
import type { SpecialistType } from './specialists/types.js';
import type { AgentInput, ArchitectOutput, TaskComplexity, Subtask } from './types.js';

/**
 * Parse the architect's JSON response into a typed ArchitectOutput shape.
 * Exported for testing.
 */
export function parseArchitectResponse(text: string): Pick<ArchitectOutput, 'type' | 'plan' | 'subtasks'> {
  try {
    // Try to extract JSON from the response (model may wrap in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { type?: string; plan?: string; subtasks?: unknown[]; reason?: string };

      if (parsed.type === 'single' && typeof parsed.plan === 'string') {
        return { type: 'single', plan: parsed.plan };
      }

      if (parsed.type === 'split' && Array.isArray(parsed.subtasks)) {
        const subtasks: Subtask[] = parsed.subtasks.map((s: unknown) => {
          const subtask = s as Record<string, unknown>;
          const relevantFiles = Array.isArray(subtask.relevantFiles)
            ? (subtask.relevantFiles as unknown[]).map(String)
            : [];
          const dependsOn = Array.isArray(subtask.dependsOn)
            ? (subtask.dependsOn as unknown[]).map(String).filter(Boolean)
            : undefined;
          const entryFiles = Array.isArray(subtask.entryFiles)
            ? (subtask.entryFiles as unknown[]).map(String).filter(Boolean)
            : (relevantFiles.length > 0 ? relevantFiles.slice(0, 3) : undefined);
          const scopeDirectory = typeof subtask.scopeDirectory === 'string' && subtask.scopeDirectory.trim().length > 0
            ? subtask.scopeDirectory.trim()
            : deriveScopeDirectory(relevantFiles);
          const researchSummary = typeof subtask.researchSummary === 'string' && subtask.researchSummary.trim().length > 0
            ? subtask.researchSummary.trim()
            : buildDefaultResearchSummary(relevantFiles, subtask.description, subtask.plan);
          const builderBrief = typeof subtask.builderBrief === 'string' && subtask.builderBrief.trim().length > 0
            ? subtask.builderBrief.trim()
            : buildDefaultBuilderBrief(scopeDirectory, entryFiles, subtask.plan);
          const writeTargets = Array.isArray(subtask.writeTargets)
            ? (subtask.writeTargets as unknown[]).map(String).filter(Boolean)
            : (relevantFiles.length > 0 ? [...relevantFiles] : undefined);
          const verificationTargets = Array.isArray(subtask.verificationTargets)
            ? (subtask.verificationTargets as unknown[]).map(String).filter(Boolean)
            : undefined;
          const specialist = (typeof subtask.specialist === 'string' && isSpecialistType(subtask.specialist))
            ? subtask.specialist
            : detectSpecialist(relevantFiles);
          return {
            id: String(subtask.id ?? ''),
            description: String(subtask.description ?? ''),
            relevantFiles,
            plan: String(subtask.plan ?? ''),
            specialist,
            ...(scopeDirectory ? { scopeDirectory } : {}),
            ...(entryFiles && entryFiles.length > 0 ? { entryFiles } : {}),
            ...(researchSummary ? { researchSummary } : {}),
            ...(builderBrief ? { builderBrief } : {}),
            ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
            ...(writeTargets && writeTargets.length > 0 ? { writeTargets } : {}),
            ...(verificationTargets && verificationTargets.length > 0 ? { verificationTargets } : {}),
          };
        });
        return { type: 'split', subtasks };
      }
    }
  } catch { /* parse failed — fall through to fallback */ }

  // Fallback: treat raw response as single plan
  return { type: 'single', plan: text };
}

const SPECIALIST_TYPES = new Set(['frontend', 'backend', 'database', 'testing', 'devops', 'docs', 'general']);

function isSpecialistType(value: string): value is SpecialistType {
  return SPECIALIST_TYPES.has(value);
}

function deriveScopeDirectory(files: string[]): string | undefined {
  if (files.length === 0) return undefined;

  const splitPaths = files
    .map((file) => file.split('/').filter(Boolean))
    .filter((segments) => segments.length > 1);
  if (splitPaths.length === 0) return undefined;

  const first = splitPaths[0];
  const shared: string[] = [];
  for (let index = 0; index < first.length - 1; index++) {
    const segment = first[index];
    if (splitPaths.every((parts) => parts[index] === segment)) {
      shared.push(segment);
      continue;
    }
    break;
  }

  if (shared.length > 0) {
    return shared.join('/');
  }

  const fallback = first.slice(0, -1).join('/');
  return fallback || undefined;
}

function buildDefaultResearchSummary(
  files: string[],
  description: unknown,
  plan: unknown,
): string | undefined {
  const scope = files.length > 0 ? files.join(', ') : 'the assigned scope';
  const descriptionText = typeof description === 'string' && description.trim().length > 0
    ? description.trim()
    : 'the requested task';
  const planText = typeof plan === 'string' && plan.trim().length > 0
    ? plan.trim()
    : 'Follow the assigned files and existing local patterns.';

  return `Focus on ${scope}. This subtask covers ${descriptionText}. ${planText}`;
}

function buildDefaultBuilderBrief(
  scopeDirectory: string | undefined,
  entryFiles: string[] | undefined,
  plan: unknown,
): string | undefined {
  const orderedFiles = entryFiles && entryFiles.length > 0
    ? entryFiles.join(', ')
    : 'the assigned files';
  const start = scopeDirectory
    ? `Start in ${scopeDirectory}.`
    : 'Start in the assigned scope.';
  const planText = typeof plan === 'string' && plan.trim().length > 0
    ? plan.trim()
    : 'Follow the existing local implementation patterns.';

  return `${start} Read ${orderedFiles} first. ${planText}`;
}

export async function runArchitect(
  input: AgentInput,
  complexity: TaskComplexity,
): Promise<ArchitectOutput> {
  const startTime = Date.now();
  const { task, signal, searchResults = [] } = input;
  const model = selectAgentModel('architect', complexity);
  const tier = getTier(model);

  // Build context: compressed file contents
  const fileEntries = searchResults.map(r => ({
    path: r.path,
    content: r.content,
    language: r.language,
  }));
  const { files: compressed } = compressContext(fileEntries, tier);

  let fileContext = '';
  let tokenBudget = 4000;
  for (const f of compressed) {
    const block = `<file path="${f.path}">\n${f.content}\n</file>\n`;
    const tokens = estimateTokens(block);
    if (tokens > tokenBudget) break;
    fileContext += block;
    tokenBudget -= tokens;
  }

  const userMessage = fileContext
    ? `Task: ${task}\n\nRelevant files:\n${fileContext}`
    : `Task: ${task}`;

  const response = await complete({
    model,
    messages: [
      { role: 'system', content: ARCHITECT_PROMPT },
      { role: 'user', content: userMessage },
    ],
    maxTokens: 1500,
    temperature: 0.3,
    signal,
  });

  const duration = Date.now() - startTime;
  const cost = calculateCost(model, response.usage.inputTokens, response.usage.outputTokens);

  const parsed = parseArchitectResponse(response.content);

  return {
    result: response.content,
    type: parsed.type,
    plan: parsed.plan,
    subtasks: parsed.subtasks,
    model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cost: cost.total,
    duration,
  };
}
