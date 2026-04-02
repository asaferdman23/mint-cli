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
    trivial:  'mistral-small',    // was groq-llama-8b — mistral is cheaper + faster
    simple:   'mistral-small',    // was groq-llama-8b
    moderate: 'mistral-small',    // was groq-llama-70b — mistral is still fast enough
    complex:  'deepseek-v3',      // keep deepseek for complex scout
  },
  architect: {
    trivial:  'mistral-small',    // was groq-llama-8b
    simple:   'deepseek-v3',      // keep
    moderate: 'deepseek-v3',      // keep
    complex:  'grok-4-beta',      // NEW — grok with reasoning for complex planning
  },
  builder: {
    trivial:  'mistral-small',    // was groq-llama-70b — mistral for trivial is fine
    simple:   'deepseek-v3',      // keep
    moderate: 'deepseek-v3',      // keep
    complex:  'deepseek-v3',      // keep
  },
  reviewer: {
    trivial:  'mistral-small',    // was groq-llama-8b
    simple:   'mistral-small',    // was groq-llama-8b — mistral is better quality
    moderate: 'mistral-small',    // was groq-llama-70b — mistral is cheaper
    complex:  'deepseek-v3',      // keep for complex reviews
  },
};

const FALLBACK_CHAIN: Record<ModelId, ModelId[]> = {
  'mistral-small': ['groq-llama-70b', 'deepseek-v3'],
  'deepseek-v3': ['groq-llama-70b', 'mistral-small'],
  'grok-4-beta': ['deepseek-v3', 'groq-llama-70b'],
  'groq-llama-70b': ['deepseek-v3', 'mistral-small'],
  'groq-llama-8b': ['mistral-small', 'groq-llama-70b'],
  'claude-sonnet-4': ['deepseek-v3', 'groq-llama-70b'],
  'claude-opus-4': ['claude-sonnet-4', 'deepseek-v3'],
  'gemini-2-flash': ['mistral-small', 'deepseek-v3'],
};

export function selectAgentModel(role: AgentRole, complexity: TaskComplexity): ModelId {
  return MODEL_MATRIX[role][complexity];
}

export function getFallbacks(model: ModelId): ModelId[] {
  return FALLBACK_CHAIN[model] ?? ['deepseek-v3', 'groq-llama-70b'];
}
