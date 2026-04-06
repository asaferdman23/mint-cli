/**
 * Task complexity classifier — decides which DeepSeek model to use.
 *
 * Runs BEFORE the LLM call, no LLM needed.
 * Simple/Moderate → deepseek-chat (fast, non-thinking)
 * Complex → deepseek-reasoner (thinking mode)
 */
import type { ProjectIndex } from './indexer.js';
import type { SearchResult } from './search.js';

export type Complexity = 'simple' | 'moderate' | 'complex';

export type DeepSeekModel = 'deepseek-chat' | 'deepseek-reasoner';

const SIMPLE_KEYWORDS = [
  'rename', 'typo', 'import', 'string', 'config', 'env',
  'comment', 'log', 'print', 'format', 'lint', 'type',
  'export', 'move', 'delete', 'remove line',
];

const COMPLEX_KEYWORDS = [
  'redesign', 'migrate', 'architect', 'performance',
  'security', 'vulnerability', 'optimize', 'rewrite',
  'refactor entire', 'cross-cutting', 'race condition',
  'deadlock', 'memory leak', 'concurrency',
];

export function classifyTaskComplexity(
  task: string,
  relevantFiles: SearchResult[],
  index: ProjectIndex,
): Complexity {
  const taskLower = task.toLowerCase();
  const fileCount = relevantFiles.length;

  // Check for explicit complexity signals
  const hasComplexKeyword = COMPLEX_KEYWORDS.some(kw => taskLower.includes(kw));
  const hasSimpleKeyword = SIMPLE_KEYWORDS.some(kw => taskLower.includes(kw));

  // Estimate context size
  const totalTokens = relevantFiles.reduce((sum, f) => sum + Math.ceil(f.content.length / 4), 0);

  // Complex: many files, complex keywords, or large context
  if (hasComplexKeyword || fileCount >= 7 || totalTokens > 10000) {
    return 'complex';
  }

  // Simple: few files, simple keywords, small context
  if (hasSimpleKeyword && fileCount <= 2 && totalTokens < 3000) {
    return 'simple';
  }

  if (fileCount < 3 && totalTokens < 3000) {
    return 'simple';
  }

  // Default: moderate
  return 'moderate';
}

export function selectModel(
  complexity: Complexity,
  forceModel?: DeepSeekModel,
): DeepSeekModel {
  if (forceModel) return forceModel;
  return complexity === 'complex' ? 'deepseek-reasoner' : 'deepseek-chat';
}
