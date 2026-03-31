// src/context/budget.ts
export { CONTEXT_BUDGETS, getTier, getBudget, type ContextTier } from '../providers/tiers.js';

/**
 * Rough token estimate: 4 chars ≈ 1 token.
 * Use tiktoken for accurate counts when performance allows.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to approximately maxTokens tokens.
 * Preserves first `keepRatio` fraction if text must be cut.
 */
export function truncateToTokens(text: string, maxTokens: number, keepRatio = 0.9): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const keepChars = Math.floor(maxChars * keepRatio);
  return text.slice(0, keepChars) + `\n... [truncated: ${Math.ceil((text.length - keepChars) / 4)} tokens omitted]`;
}
