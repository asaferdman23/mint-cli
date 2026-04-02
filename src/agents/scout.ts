/**
 * SCOUT agent — classifies task complexity and finds relevant files.
 *
 * Uses the cheapest model (Groq 8B) for classification,
 * then runs searchRelevantFiles() with the extracted keywords.
 */
import { complete } from '../providers/index.js';
import { calculateCost } from '../providers/router.js';
import { loadIndex, indexProject, searchRelevantFiles } from '../context/index.js';
import { SCOUT_PROMPT } from './prompts/scout.js';
import { selectAgentModel } from './model-selector.js';
import type { AgentInput, ScoutOutput, TaskComplexity } from './types.js';

// Fast heuristic classification — avoids an LLM call for obvious cases
const TRIVIAL_PATTERNS = /^(hey|hi|hello|thanks|ok|yes|no|help|what|how)\b/i;
const COMPLEX_PATTERNS = /\b(architect|redesign|migrate|rewrite|refactor.*entire|new system|multi.?file)\b/i;
const MODERATE_PATTERNS = /\b(fix all|all.*bugs|multiple.*fix|several.*change|each.*file|both.*files|security.*bugs)\b/i;

export function classifyTaskHeuristically(task: string): TaskComplexity | undefined {
  if (TRIVIAL_PATTERNS.test(task) && task.length < 30) {
    return 'trivial';
  }
  if (COMPLEX_PATTERNS.test(task)) {
    return 'complex';
  }
  if (MODERATE_PATTERNS.test(task)) {
    return 'moderate';
  }
  if (task.length < 80) {
    return 'simple';
  }
  return undefined;
}

export async function runScout(input: AgentInput): Promise<ScoutOutput> {
  const startTime = Date.now();
  const { task, cwd, signal } = input;

  // ── Fast-path: heuristic classification (no LLM call) ────────────────────
  let complexity: TaskComplexity = 'moderate';
  let usedLLM = false;

  const heuristicComplexity = classifyTaskHeuristically(task);
  if (heuristicComplexity) {
    complexity = heuristicComplexity;
  } else {
    // ── LLM classification for ambiguous tasks ───────────────────────────
    try {
      const model = selectAgentModel('scout', 'simple');
      const response = await complete({
        model,
        messages: [
          { role: 'system', content: SCOUT_PROMPT },
          { role: 'user', content: task },
        ],
        maxTokens: 200,
        temperature: 0,
        signal,
      });

      const parsed = parseScoutResponse(response.content);
      complexity = parsed.complexity;
      usedLLM = true;
    } catch {
      // LLM failed — fall back to heuristic
      complexity = 'moderate';
    }
  }

  // ── Search for relevant files ────────────────────────────────────────────
  let relevantFiles: ScoutOutput['relevantFiles'] = [];

  if (complexity !== 'trivial') {
    try {
      let index = await loadIndex(cwd);
      if (!index || index.totalFiles === 0) {
        index = await indexProject(cwd);
      }
      if (index && index.totalFiles > 0) {
        const maxFiles = complexity === 'complex' ? 12 : complexity === 'moderate' ? 8 : 5;
        relevantFiles = await searchRelevantFiles(cwd, task, index, { maxFiles });
      }
    } catch {
      // No files — builder will work without context
    }

    // Fallback grep
    if (relevantFiles.length === 0) {
      try {
        const { gatherRelevantFilesFallback } = await import('../pipeline/fallback-search.js');
        relevantFiles = await gatherRelevantFilesFallback(cwd, task);
      } catch { /* proceed without files */ }
    }
  }

  const duration = Date.now() - startTime;
  const fileSummary = relevantFiles.length > 0
    ? `${relevantFiles.length} files: ${relevantFiles.map(f => f.path).join(', ')}`
    : 'no files found';

  return {
    result: `complexity=${complexity}, ${fileSummary}`,
    complexity,
    relevantFiles,
    fileSummary,
    model: usedLLM ? selectAgentModel('scout', 'simple') : 'groq-llama-8b',
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    duration,
  };
}

export function parseScoutResponse(text: string): { complexity: TaskComplexity } {
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const valid: TaskComplexity[] = ['trivial', 'simple', 'moderate', 'complex'];
      if (valid.includes(parsed.complexity)) {
        return { complexity: parsed.complexity };
      }
    }
  } catch { /* parse failed */ }

  // Fallback: keyword detection in the raw text
  if (/trivial/i.test(text)) return { complexity: 'trivial' };
  if (/complex/i.test(text)) return { complexity: 'complex' };
  if (/moderate/i.test(text)) return { complexity: 'moderate' };
  return { complexity: 'simple' };
}
