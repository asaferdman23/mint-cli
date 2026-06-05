## Why

`success-signal` makes cost-per-success *measurable*; this change *spends* it.
Today routing is static (`routing.default.json`) and frontier-by-default — safe,
but it never learns that a cheaper model would have succeeded. The advantage
only Mint can have is the **context-for-cost substitution**: better retrieval
lets a cheaper model clear the quality bar, so you buy a cheaper route by
spending context effort instead of model tokens. That substitution is invisible
to a single-model tool (Claude Code) and a context-blind router (LiteLLM) — it
requires owning context + routing + the success signal at once.

This change builds the **substitution map** — a learned surface of
`(kind, complexity, context_strategy, model) → success_rate, cost` — and lets
routing step *down* the model ladder, but only where the data says it is safe.
It is Phase 2 of the cost-native thesis and depends on `success-signal`.

## What Changes

- **Record the context-strategy knob.** The harness already chooses a retrieval
  tier; this change records *which* tier (an ordinal `C0..C3`) on each outcome,
  making context effort a first-class, learnable axis alongside model.
- **Substitution map (read model).** A new aggregation over `outcomes.sqlite`
  producing, per `(kind, complexity, context_strategy, model)`: sample count,
  success rate, **Wilson lower bound**, avg cost, and cost-per-success.
- **Safe learned down-routing.** `resolveRoute` consults the map: among cells
  whose Wilson lower bound ≥ quality bar `Q` and `n ≥ N_min`, pick the lowest
  cost-per-success model+strategy. If none qualify → **fall back to the static
  frontier-default route** (never gamble on thin data).
- **Cold-start handling.** Ship global priors (from bench) so new users aren't
  blind; ε-greedy exploration deliberately samples a cheaper cell on a small
  fraction of low-risk tasks to fill the map — logged, never silent.
- **Per-repo learning.** The map is global-prior overlaid with per-`cwd`
  outcomes, so "in *this* codebase, Flash handles edit_small after C3 retrieval"
  is a compounding, per-customer asset.
- **Observability.** `mint audit` shows the map and which cells are driving
  down-routes; every step-down is explained in the trace.

## Capabilities

### New Capabilities
- `learned-downrouting`: The substitution map (aggregation + Wilson bounds), the
  context-strategy recording, the safe step-down decision in `resolveRoute`, the
  exploration policy, and the audit/trace surfaces. Consumes the `success-signal`
  verdict; owns model selection only — retrieval mechanics stay in
  `token-efficiency`.

### Modified Capabilities
<!-- None at spec level. `success-signal` provides the verdict this consumes but
     its requirements are unchanged. Static routing in routing.default.json
     remains the fallback, not a modified requirement. -->

## Impact

**Affected code:**
- `src/brain/memory/outcomes.ts` — new `context_strategy` column (idempotent
  migration); extend record/row types.
- **New** `src/brain/routing/substitution.ts` — the map: SQL aggregation + Wilson
  interval + cheapest-safe-cell selection.
- `src/brain/router.ts` — `resolveRoute` consults the map, falls back to the
  static route when no cell qualifies; ε-greedy exploration hook.
- `src/brain/loop.ts` — pass the chosen `context_strategy` into the outcome
  record; emit a `route.downstep` trace event.
- `src/cli/commands/audit.ts` — substitution-map view.
- `src/utils/config.ts` — `brain.downrouting.{enabled, qualityBar, minSamples,
  explorationRate}` (enabled defaults **false** until a map exists).

**Risk:** an over-eager step-down ships a worse result. Mitigated by Wilson
lower bound (not raw rate) + `N_min` gate + frontier-default fallback +
`enabled=false` by default. Quality bar and min-samples are tunable; exploration
is capped and logged.

## Dependencies / order

- **Hard dependency on `success-signal`** — the map is built from verdicts;
  without them this is unfalsifiable. Lands after it.
- Builds on `token-efficiency` (owns the retrieval tiers that define
  `context_strategy`) and `cross-model-bench` (seeds the global priors).
- This is the change that converts the measured signal into actual savings —
  Phase 2 of the cost-native thesis.
