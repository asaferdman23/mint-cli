import { ModelId, MODELS, ModelInfo } from './types.js';
import { getTier } from './tiers.js';
import { OPUS_INPUT_PRICE_PER_M } from '../usage/pricing.js';

export type TaskType = 'code' | 'refactor' | 'debug' | 'explain' | 'review' | 'general';

interface RouterOptions {
  taskType?: TaskType;
  contextSize?: number;
  maxCost?: number;
  preferSpeed?: boolean;
  preferQuality?: boolean;
}

// Keywords to detect task type from prompt
const TASK_PATTERNS: Record<TaskType, RegExp[]> = {
  code: [/write|create|implement|build|generate|add/i],
  refactor: [/refactor|restructure|reorganize|clean up|improve/i],
  debug: [/debug|fix|bug|error|issue|broken|not working/i],
  explain: [/explain|what does|how does|why|understand/i],
  review: [/review|check|audit|look at|feedback/i],
  general: [/.*/],
};

// Model tiers for different scenarios
const MODEL_TIERS = {
  budget: ['deepseek-v3', 'deepseek-coder', 'qwen-coder-32b'] as ModelId[],
  balanced: ['gemini-2-pro', 'gpt-4o', 'claude-sonnet-4'] as ModelId[],
  premium: ['claude-opus-4'] as ModelId[],
};

export function detectTaskType(prompt: string): TaskType {
  for (const [type, patterns] of Object.entries(TASK_PATTERNS)) {
    if (type === 'general') continue;
    if (patterns.some(p => p.test(prompt))) {
      return type as TaskType;
    }
  }
  return 'general';
}

export function selectModel(prompt: string, options: RouterOptions = {}): ModelId {
  const {
    taskType = detectTaskType(prompt),
    contextSize = 0,
    maxCost,
    preferSpeed = false,
    preferQuality = false,
  } = options;

  // Get eligible models based on context size
  const eligibleModels = Object.values(MODELS).filter(
    (m) => m.contextWindow >= contextSize
  );

  if (eligibleModels.length === 0) {
    // Fallback to largest context model
    return 'gemini-2-pro';
  }

  // Apply cost filter if specified
  let candidates = eligibleModels;
  if (maxCost !== undefined) {
    candidates = candidates.filter((m) => m.inputPrice <= maxCost);
  }

  // Score models based on task and preferences
  const scored = candidates.map((model) => {
    let score = 0;

    // Task-specific scoring
    switch (taskType) {
      case 'code':
      case 'refactor':
        score += model.capabilities.coding * 2;
        score += model.capabilities.reasoning;
        break;
      case 'debug':
        score += model.capabilities.reasoning * 2;
        score += model.capabilities.coding;
        break;
      case 'explain':
      case 'review':
        score += model.capabilities.reasoning * 2;
        break;
      default:
        score += model.capabilities.coding + model.capabilities.reasoning;
    }

    // Preference adjustments
    if (preferSpeed) {
      score += model.capabilities.speed * 1.5;
    }
    if (preferQuality) {
      score += model.capabilities.coding + model.capabilities.reasoning;
    }

    // Cost efficiency bonus (lower price = higher bonus)
    const avgPrice = (model.inputPrice + model.outputPrice) / 2;
    score += Math.max(0, (20 - avgPrice) / 2);

    return { model, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Default strategy: pick best budget model unless quality demanded
  if (!preferQuality) {
    const budgetMatch = scored.find((s) =>
      MODEL_TIERS.budget.includes(s.model.id)
    );
    if (budgetMatch && budgetMatch.score > scored[0].score * 0.7) {
      return budgetMatch.model.id;
    }
  }

  return scored[0].model.id;
}

export function getModelInfo(modelId: ModelId): ModelInfo {
  return MODELS[modelId];
}

export function calculateCost(
  modelId: ModelId,
  inputTokens: number,
  outputTokens: number,
  cacheUsage?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number },
): { input: number; output: number; total: number } {
  const model = MODELS[modelId];
  // Anthropic prompt-cache pricing: cache writes are ~1.25x fresh input,
  // cache reads are ~0.10x fresh input. Other providers price differently
  // (or not at all) — they pass cacheUsage = undefined so this is a no-op.
  const cacheWriteTokens = cacheUsage?.cacheCreationInputTokens ?? 0;
  const cacheReadTokens = cacheUsage?.cacheReadInputTokens ?? 0;
  // Anthropic reports cache_creation_input_tokens and cache_read_input_tokens
  // SEPARATELY from input_tokens (input_tokens is fresh-only). So we add
  // cache costs on top, not subtract.
  const input = (inputTokens / 1_000_000) * model.inputPrice
    + (cacheWriteTokens / 1_000_000) * model.inputPrice * 1.25
    + (cacheReadTokens / 1_000_000) * model.inputPrice * 0.10;
  const output = (outputTokens / 1_000_000) * model.outputPrice;
  return {
    input,
    output,
    total: input + output,
  };
}


export type ClassifiedTask = 'code' | 'explain' | 'architect' | 'debug' | 'general';

const TASK_CLASSIFY_PATTERNS: Record<ClassifiedTask, RegExp[]> = {
  code:      [/write|create|implement|build|generate|add|refactor|restructure|fix|debug/i],
  explain:   [/explain|what does|how does|why|understand|what is/i],
  architect: [/design|architect|plan|structure|system|pattern/i],
  debug:     [/bug|error|issue|broken|not working|failing|crash/i],
  general:   [/.*/],
};

export function classifyTask(prompt: string): ClassifiedTask {
  for (const [type, patterns] of Object.entries(TASK_CLASSIFY_PATTERNS)) {
    if (type === 'general') continue;
    if (patterns.some((p) => p.test(prompt))) {
      return type as ClassifiedTask;
    }
  }
  return 'general';
}

export interface RoutingDecision {
  model: ModelId;
  tier: string;
  taskType: ClassifiedTask;
  reason: string;
  savingsPct: number;
}

export function selectModelWithReason(prompt: string): RoutingDecision {
  const model = selectModel(prompt);
  const tier = getTier(model);

  // Savings vs opus: (opusInputPrice - modelInputPrice) / opusInputPrice * 100
  const modelInfo = MODELS[model];
  const savingsPct = modelInfo
    ? Math.max(0, Math.round((1 - modelInfo.inputPrice / OPUS_INPUT_PRICE_PER_M) * 100))
    : 0;

  const taskType = classifyTask(prompt);
  const reason = savingsPct > 0
    ? `${taskType} task \u2192 ${model} (${savingsPct}% cheaper than Opus)`
    : `${taskType} task \u2192 ${model}`;

  return { model, tier, taskType, reason, savingsPct };
}

export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `${(cost * 100).toFixed(3)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

export function compareCosts(
  inputTokens: number,
  outputTokens: number
): Array<{ model: ModelId; cost: number; savings: string }> {
  const results = Object.keys(MODELS).map((id) => {
    const modelId = id as ModelId;
    const { total } = calculateCost(modelId, inputTokens, outputTokens);
    return { model: modelId, cost: total };
  });

  results.sort((a, b) => a.cost - b.cost);

  const maxCost = results[results.length - 1].cost;
  
  return results.map((r) => ({
    ...r,
    savings: maxCost > 0 
      ? `${Math.round((1 - r.cost / maxCost) * 100)}% cheaper` 
      : '0%',
  }));
}
