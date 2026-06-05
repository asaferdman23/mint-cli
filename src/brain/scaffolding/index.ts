/**
 * Old-model-scaffolding — harness-side interventions that lift weak models
 * to their own ceiling without changing raw capability.
 *
 * Milestone 1: format normalization (silent, observable).
 * Milestone 2: tool-call validation + single retry.
 * Milestone 3: capability-gated CoT hints + per-(model,kind) prompt patches.
 */
export { normalizeToolInput } from './normalize.js';
export type { NormalizationDiff, NormalizeResult } from './normalize.js';
