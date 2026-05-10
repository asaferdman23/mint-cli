/**
 * Real token counter backed by tiktoken's cl100k_base encoding.
 *
 * Replaces char/4 heuristic scattered across the codebase. Every model that
 * isn't a raw OpenAI model uses cl100k_base as a fast, deterministic proxy —
 * it over-estimates DeepSeek/Grok/Gemini by ~5% which is fine for budgeting.
 *
 * Encoders are cached at module scope; first call pays ~80ms cold-start.
 */
import { get_encoding, type Tiktoken } from 'tiktoken';
import type { ModelId } from '../providers/types.js';
import { MODELS } from '../providers/types.js';

let sharedEncoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!sharedEncoder) {
    sharedEncoder = get_encoding('cl100k_base');
  }
  return sharedEncoder;
}

/** Free the native encoder (call on shutdown if lifecycle matters). */
export function disposeEncoder(): void {
  if (sharedEncoder) {
    sharedEncoder.free();
    sharedEncoder = null;
  }
}

/** Count tokens in `text` using cl100k_base. Returns 0 for empty strings. */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return getEncoder().encode(text).length;
  } catch {
    // Fallback to char/4 if tiktoken fails (rare — binary input, etc.)
    return Math.ceil(text.length / 4);
  }
}

/** Count tokens across a list of strings or message-shaped objects. */
export function countTokensMany(items: Array<string | { content?: string | null }>): number {
  let total = 0;
  for (const item of items) {
    const text = typeof item === 'string' ? item : item.content ?? '';
    total += countTokens(text);
  }
  return total;
}

/** Convert token usage to USD using the price table in providers/types.ts.
 *  Returns 0 (never NaN) when inputs are non-finite or the model is unknown —
 *  callers render cost in the UI and NaN display looks broken. */
export function approxCostUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const info = MODELS[model];
  if (!info) return 0;
  const safeInput = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const safeOutput = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  const cost = (safeInput / 1_000_000) * info.inputPrice + (safeOutput / 1_000_000) * info.outputPrice;
  return Number.isFinite(cost) ? cost : 0;
}

/**
 * Running token budget — track usage and know when to compact.
 *
 * Usage:
 *   const budget = new TokenBudget('grok-4.1-fast', { compactRatio: 0.6 });
 *   budget.add(countTokens(userTurn));
 *   if (budget.shouldCompact()) ...
 */
export interface TokenBudgetOptions {
  /** Fraction of the context window at which `shouldCompact()` flips true. Default 0.6. */
  compactRatio?: number;
  /** Hard ceiling for input context (overrides model.contextWindow if smaller). */
  maxInputTokens?: number;
}

export class TokenBudget {
  readonly model: ModelId;
  readonly contextWindow: number;
  readonly maxInputTokens: number;
  readonly compactAt: number;
  private consumed = 0;

  constructor(model: ModelId, options: TokenBudgetOptions = {}) {
    this.model = model;
    const info = MODELS[model];
    this.contextWindow = info?.contextWindow ?? 128_000;
    this.maxInputTokens = Math.min(
      options.maxInputTokens ?? this.contextWindow,
      this.contextWindow,
    );
    this.compactAt = Math.floor(this.maxInputTokens * (options.compactRatio ?? 0.6));
  }

  add(tokens: number): void {
    this.consumed += Math.max(0, tokens);
  }

  reset(tokens = 0): void {
    this.consumed = Math.max(0, tokens);
  }

  get used(): number {
    return this.consumed;
  }

  get remaining(): number {
    return Math.max(0, this.maxInputTokens - this.consumed);
  }

  shouldCompact(): boolean {
    return this.consumed >= this.compactAt;
  }

  /** 40% of window by default — the retrieval packing budget for context files. */
  retrievalBudget(fraction = 0.4): number {
    return Math.floor(this.maxInputTokens * fraction);
  }
}
