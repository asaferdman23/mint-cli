// src/providers/tiers.ts
import type { ModelId } from './types.js';

export type ContextTier = 'apex' | 'smart' | 'fast' | 'ultra';

/**
 * Model tier classification.
 * - APEX:  Claude Opus, GPT-4o, Gemini 1.5 Pro — full context, no compression
 * - SMART: Claude Sonnet, DeepSeek-V3, Grok-3, Gemini 2 Pro — light compression
 * - FAST:  Kimi K2, Grok-3-fast, Gemini Flash, Qwen-Coder, Groq 70B — heavy compression
 * - ULTRA: Groq 8B, Moonshot 8k — max compression, skeleton context only
 */
export const MODEL_TIERS: Record<ModelId, ContextTier> = {
  'claude-opus-4':        'apex',
  'gpt-4o':               'apex',
  'gemini-2-pro':         'apex',
  'gemini-1-5-pro':       'apex',
  'claude-sonnet-4':      'smart',
  'deepseek-v3':          'smart',
  'grok-3':               'smart',
  'gemini-2-flash':       'smart',
  'kimi-k2':              'fast',
  'grok-3-fast':          'fast',
  'grok-3-mini-fast':     'fast',
  'gemini-1-5-flash':     'fast',
  'qwen-coder-32b':       'fast',
  'groq-llama-70b':       'fast',
  'deepseek-coder':       'fast',
  'moonshot-v1-32k':      'ultra',
  'moonshot-v1-8k':       'ultra',
  'groq-llama-8b':        'ultra',
  'groq-gpt-oss-120b':   'fast',
  'groq-gpt-oss-20b':    'ultra',
  'grok-4-beta':          'apex',
  'grok-4.1-fast':        'smart',
  'mistral-small':        'ultra',
};

/** Maximum context tokens to send to the model (reserve the rest for output). */
export const CONTEXT_BUDGETS: Record<ContextTier, { maxContextTokens: number; reservedOutputTokens: number }> = {
  apex:  { maxContextTokens: 180_000, reservedOutputTokens: 20_000 },
  smart: { maxContextTokens:  60_000, reservedOutputTokens:  8_000 },
  fast:  { maxContextTokens:  20_000, reservedOutputTokens:  4_000 },
  ultra: { maxContextTokens:   8_000, reservedOutputTokens:  2_000 },
};

export function getTier(modelId: ModelId): ContextTier {
  return MODEL_TIERS[modelId] ?? 'fast';
}

export function getBudget(modelId: ModelId) {
  return CONTEXT_BUDGETS[getTier(modelId)];
}
