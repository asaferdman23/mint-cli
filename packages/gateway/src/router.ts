export type TaskTier = 'simple' | 'medium' | 'complex'

export type ProviderTarget = {
  provider: 'groq' | 'deepseek' | 'grok' | 'mistral' | 'kimi'
  model: string         // provider's native model ID
  modelLabel: string    // human label for logging
  inputPrice: number    // per 1M tokens
  outputPrice: number
  tier: TaskTier
}

const TIERS: Record<TaskTier, ProviderTarget> = {
  simple: {
    provider: 'mistral',
    model: 'mistral-small-2603',
    modelLabel: 'mistral-small',
    inputPrice: 0.15,
    outputPrice: 0.60,
    tier: 'simple',
  },
  // medium: {
  //   provider: 'deepseek',
  //   model: 'deepseek-chat',
  //   modelLabel: 'deepseek-v3',
  //   inputPrice: 0.28,
  //   outputPrice: 0.42,
  //   tier: 'medium',
  // },
  medium: {
    provider: 'kimi',
    model: 'kimi-k2-0711-preview',
    modelLabel: 'kimi-k2',
    inputPrice: 0.60,
    outputPrice: 2.50,
    tier: 'medium',
  },
  complex: {
    provider: 'grok',
    model: 'grok-3-mini-fast',
    modelLabel: 'grok-3-mini-fast',
    inputPrice: 0.60,
    outputPrice: 4.00,
    tier: 'complex',
  },
}

const FALLBACK: ProviderTarget = {
  provider: 'groq',
  model: 'llama-3.3-70b-versatile',
  modelLabel: 'groq-llama-70b',
  inputPrice: 0.59,
  outputPrice: 0.79,
  tier: 'medium',
}

const CLASSIFY_PATTERNS: Array<{ tier: TaskTier; re: RegExp }> = [
  { tier: 'simple',  re: /\b(explain|what does|how does|why|what is|understand)\b/i },
  { tier: 'complex', re: /\b(design|architect|plan|structure|system|pattern|multi.file|agent)\b/i },
  { tier: 'medium',  re: /\b(write|create|implement|build|generate|add|refactor|fix|debug|review|check)\b/i },
]

// Sonnet 4.6 pricing for savings calculation
const SONNET_INPUT  = 3.0
const SONNET_OUTPUT = 15.0

export function classifyPrompt(prompt: string, contextTokens = 0): TaskTier {
  let tier: TaskTier = 'simple'
  for (const { tier: t, re } of CLASSIFY_PATTERNS) {
    if (re.test(prompt)) { tier = t; break }
  }
  // Bump up one tier for large context
  if (contextTokens > 20_000) {
    if (tier === 'simple') tier = 'medium'
    else if (tier === 'medium') tier = 'complex'
  }
  return tier
}

export function selectTarget(prompt: string, contextTokens = 0): {
  target: ProviderTarget
  reason: string
  savingsPct: number
} {
  const tier = classifyPrompt(prompt, contextTokens)
  const target = TIERS[tier]
  const avgPrice = (target.inputPrice + target.outputPrice) / 2
  const avgSonnet = (SONNET_INPUT + SONNET_OUTPUT) / 2
  const savingsPct = Math.round((1 - avgPrice / avgSonnet) * 100)
  const reason = `${tier} task → ${target.modelLabel}`
  return { target, reason, savingsPct }
}

export { FALLBACK }
