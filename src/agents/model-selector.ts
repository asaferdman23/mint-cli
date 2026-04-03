/**
 * Model selection matrix — picks the cheapest model that can handle the job.
 *
 * Each agent gets a different model based on task complexity:
 * - Scout: fast+cheap (just classification + file search)
 * - Architect: reasoning-heavy (planning)
 * - Builder: coding-optimized (code generation)
 * - Reviewer: moderate (verification)
 */
import type { ModelId } from '../providers/types.js';
import type { AgentRole, TaskComplexity } from './types.js';

const MODEL_MATRIX: Record<AgentRole, Record<TaskComplexity, ModelId>> = {
  scout: {
    trivial:  'mistral-small',    // $0.15/$0.60 — fast matching, scout is 90% grep
    simple:   'mistral-small',
    moderate: 'mistral-small',
    complex:  'deepseek-v3',      // complex scout needs better file relevance
  },
  architect: {
    trivial:  'mistral-small',    // trivial never reaches architect
    simple:   'grok-4.1-fast',    // $0.20/$0.50 — reasoning OFF for simple planning
    moderate: 'grok-4.1-fast',    // $0.20/$0.50 — reasoning ON for deep planning (same price!)
    complex:  'grok-4-beta',      // $2/$6 — strongest reasoning for hard problems
  },
  builder: {
    trivial:  'mistral-small',    // fast + cheap for trivial one-liners
    simple:   'deepseek-v3',      // $0.28/$0.42 — solid coder
    moderate: 'kimi-k2',          // $0.60/$2.50 — best coder, 128k context
    complex:  'kimi-k2',          // best coder for complex multi-file work
  },
  reviewer: {
    trivial:  'mistral-small',    // $0.15/$0.60 — fast pattern matching
    simple:   'mistral-small',    // reviewer needs SPEED not intelligence
    moderate: 'mistral-small',    // fast + cheap, catches obvious bugs
    complex:  'deepseek-v3',      // complex review needs more depth
  },
  explore: {
    trivial:  'mistral-small',
    simple:   'mistral-small',
    moderate: 'mistral-small',
    complex:  'mistral-small',
  },
  plan: {
    trivial:  'mistral-small',
    simple:   'grok-4.1-fast',
    moderate: 'grok-4.1-fast',
    complex:  'grok-4-beta',
  },
  verify: {
    trivial:  'mistral-small',
    simple:   'mistral-small',
    moderate: 'mistral-small',
    complex:  'deepseek-v3',
  },
};

const FALLBACK_CHAIN: Record<ModelId, ModelId[]> = {
  'mistral-small': ['groq-llama-70b', 'deepseek-v3'],
  'deepseek-v3': ['groq-llama-70b', 'mistral-small'],
  'grok-4-beta': ['grok-4.1-fast', 'deepseek-v3'],
  'grok-4.1-fast': ['deepseek-v3', 'groq-llama-70b'],
  'groq-llama-70b': ['deepseek-v3', 'mistral-small'],
  'groq-llama-8b': ['mistral-small', 'groq-llama-70b'],
  'claude-sonnet-4': ['deepseek-v3', 'groq-llama-70b'],
  'claude-opus-4': ['claude-sonnet-4', 'deepseek-v3'],
  'gemini-2-flash': ['mistral-small', 'deepseek-v3'],
  'gemini-2-pro': ['gemini-2-flash', 'deepseek-v3'],
  'gpt-4o': ['deepseek-v3', 'groq-llama-70b'],
  'qwen-coder-32b': ['deepseek-v3', 'groq-llama-70b'],
  'kimi-k2': ['deepseek-v3', 'groq-llama-70b'],
  'moonshot-v1-8k': ['mistral-small', 'deepseek-v3'],
  'moonshot-v1-32k': ['moonshot-v1-8k', 'deepseek-v3'],
  'grok-3': ['grok-4-beta', 'deepseek-v3'],
  'grok-3-fast': ['grok-3', 'deepseek-v3'],
  'grok-3-mini-fast': ['mistral-small', 'deepseek-v3'],
  'gemini-1-5-flash': ['mistral-small', 'deepseek-v3'],
  'gemini-1-5-pro': ['gemini-2-pro', 'deepseek-v3'],
  'groq-gpt-oss-120b': ['deepseek-v3', 'groq-llama-70b'],
  'groq-gpt-oss-20b': ['mistral-small', 'deepseek-v3'],
  'deepseek-coder': ['deepseek-v3', 'groq-llama-70b'],
};

export function selectAgentModel(role: AgentRole, complexity: TaskComplexity, gateMode?: string): ModelId {
  const base = MODEL_MATRIX[role][complexity];
  // direct_builder already proved scope is narrow — cap at deepseek-v3 to save cost
  if (role === 'builder' && (gateMode === 'direct_builder' || gateMode === 'direct_builder_with_memory')) {
    return complexity === 'trivial' ? 'mistral-small' : 'deepseek-v3';
  }
  return base;
}

export function getFallbacks(model: ModelId): ModelId[] {
  return FALLBACK_CHAIN[model] ?? ['deepseek-v3', 'groq-llama-70b'];
}

/**
 * Get provider-specific options for a model selection.
 * Enables reasoning toggles for Grok and reasoning_effort for Mistral.
 */
export function getModelOptions(role: AgentRole, complexity: TaskComplexity): Record<string, unknown> | undefined {
  const model = MODEL_MATRIX[role][complexity];

  // Grok 4.1 Fast — always reason for planning, toggle for other roles
  if (model === 'grok-4.1-fast') {
    return {
      reasoning: { enabled: role === 'plan' || role === 'architect' || complexity !== 'simple' },
    };
  }

  // Grok 4 Beta — always enable reasoning (that's why we pay for it)
  if (model === 'grok-4-beta') {
    return {
      reasoning: { enabled: true },
    };
  }

  // Mistral — set reasoning_effort based on role
  if (model === 'mistral-small') {
    if (role === 'scout' || role === 'reviewer') {
      return { reasoning_effort: 'none' };
    }
    if (role === 'builder') {
      return { reasoning_effort: 'low' };
    }
  }

  return undefined;
}
