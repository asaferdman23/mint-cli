export type BuilderTaskIntent = 'analysis' | 'change';

const CHANGE_HINTS =
  /\b(fix|change|update|edit|modify|add|remove|delete|implement|build|create|refactor|rewrite|wire|connect|integrate|rename|move|patch|apply|make)\b/i;

const ANALYSIS_HINTS =
  /\b(review|scan|audit|inspect|analy[sz]e|check|look at|explore|understand|explain|compare|assess|evaluate|what can (?:we|i) improve|what should|what do you think|where is|find)\b/i;

export function inferBuilderTaskIntent(task: string): BuilderTaskIntent {
  const normalized = task.trim();
  if (!normalized) return 'analysis';

  const hasChangeHint = CHANGE_HINTS.test(normalized);
  const hasAnalysisHint = ANALYSIS_HINTS.test(normalized) || normalized.includes('?');

  if (hasAnalysisHint && !hasChangeHint) {
    return 'analysis';
  }

  return 'change';
}
