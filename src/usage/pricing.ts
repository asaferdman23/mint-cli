// Shared Anthropic Opus pricing constants — single source of truth.
// Updated 2026-06 to Opus 4.8 rates ($5/$25). The old $15/$75 baseline was
// inflating every "savings vs Opus" figure ~3×. NOTE (see
// docs/PRODUCT_DEFINITION.md): the honest savings anchor is the customer's own
// actual baseline, not Opus list price — this constant is the legacy display
// baseline only.
export const OPUS_INPUT_PRICE_PER_M = 5;    // $5 per 1M input tokens (Opus 4.8)
export const OPUS_OUTPUT_PRICE_PER_M = 25;  // $25 per 1M output tokens (Opus 4.8)

// Claude Sonnet 4.6 pricing
export const SONNET_INPUT_PRICE_PER_M  = 3.0;
export const SONNET_OUTPUT_PRICE_PER_M = 15.0;
