## Context

`success-signal` writes a per-task `verdict` to `outcomes.sqlite` keyed by
`(kind, model, complexity)`. Routing today is static: `resolveRoute` reads
`routing.default.json` and is frontier-by-default. Retrieval already runs at a
tier (see `tiers.ts` context budgets), but the tier is not recorded, so we
cannot learn how context effort trades against model cost. This change adds the
missing axis, aggregates the outcomes into a substitution map, and lets routing
walk *down* that map safely.

The defensible asset is the **joint surface**: for each task type, the cheapest
model that succeeds *at each level of context effort*. Single-model tools and
context-blind routers structurally cannot build it.

## Goals / Non-Goals

**Goals:**
- Record `context_strategy` (ordinal C0–C3) per task.
- Build `(kind, complexity, context_strategy, model) → {n, p_lower, cost_per_success}`.
- Step routing down to the cheapest cell whose Wilson lower bound ≥ Q and n ≥ N_min.
- Never gamble: insufficient/low-confidence data → static frontier-default.
- Learn per-repo (overlay on global priors); fill gaps via capped exploration.

**Non-Goals:**
- Not changing retrieval mechanics — `token-efficiency` owns *how* context is
  built; this change only records *which tier* was used and reads success.
- Not the success measurement itself — that is `success-signal`.
- Not auto-tuning the quality bar Q (operator-set; learned tuning is later).
- No new model calls.

## Decisions

### D1 — `context_strategy` is an ordinal knob, recorded, not inferred
Define C0 skeleton / C1 lexical (BM25) / C2 hybrid+pinned (current default) /
C3 hybrid+graph+priors. The harness picks one (initially always its current
default = C2) and records it. Making it an explicit column is what lets the map
have a context axis at all.

*Alternative considered:* derive a continuous "context quality score" from
`retrieved_files_read / retrieved_files` precision. Rejected as the primary key —
too noisy to bucket reliably; kept as an optional secondary feature.

### D2 — Wilson lower bound, not raw success rate
Each cell's eligibility uses the Wilson score interval's lower bound at 95%, not
the point estimate. This is the single safety property that prevents "3 lucky
runs on a cheap model" from triggering a permanent down-route. A cell needs
*confident* success, which naturally requires both high rate and adequate n.

*Alternative considered:* raw rate + hard n threshold. Rejected — raw rate is
unstable at low n exactly where a wrong step-down is most likely.

### D3 — Cheapest-cost-per-success wins, with a hard frontier-default floor
Among cells passing (`p_lower ≥ Q`, `n ≥ N_min`), pick min `cost_per_success`
(not min `cost` — a cheap model that fails twice is not cheap). If the set is
empty, return the static route from `routing.default.json`. The failure mode is
always "stay on the safe expensive model," never "guess cheap."

### D4 — ε-greedy exploration, capped and logged
With probability ε (default ~0.10) on tasks whose static route is *not* the
top complexity tier, run the cheapest plausible cell instead, to grow `n` where
the map is thin. Every exploration is `log()`-ed and trace-tagged so the cost is
visible — no silent sampling. Never explore on `complex` complexity.

### D5 — Global priors + per-repo overlay
`outcomes.sqlite` is per-`cwd`. The map merges a shipped global prior (seeded
from `cross-model-bench`) with locally-learned cells; a local cell with
sufficient n overrides the prior. This gives a sane day-one default and a
compounding per-codebase asset.

### D6 — Off by default, behind `brain.downrouting.enabled`
Until a map with real data exists, routing stays static. Flipping the flag with
an empty map is a no-op (every cell fails the gate → frontier-default), so
enabling it is safe.

## Risks / Trade-offs

- **Over-eager step-down ships a worse result** → D2 (Wilson) + D3 (frontier
  floor) + D6 (off by default). The bar Q and N_min are operator-tunable.
- **Map staleness after a model/pricing change** → cells carry a recency window;
  a model id that changes pricing invalidates its cells (cost_per_success
  recomputed); stale cells age out by `ts`.
- **Exploration cost** → ε capped, never on `complex`, fully logged; operator
  can set ε=0 to disable.
- **Sparse cells for rare (kind,complexity,strategy) combos** → they simply
  never qualify; routing holds at frontier-default for them. Safe by default.

## Migration Plan

1. Add `context_strategy` column (idempotent migration); backfill old rows as
   `C2` (the prior default) so existing data is usable, flagged `inferred`.
2. Ship the substitution read model + audit view with routing untouched
   (`enabled=false`). Operators inspect the map first.
3. Enable down-routing per-repo once `mint audit` shows enough qualified cells.
4. Rollback: set `enabled=false` → instantly reverts to static routing; no schema
   rollback needed (column is inert).

## Open Questions

- Should Q vary by `kind` (e.g. stricter for `refactor` than `explain`)? Likely
  yes; start with a single global Q, allow per-kind override.
- Confidence level for Wilson (95% vs 90%) — start 95%, expose as config.
- Should a confirmed `failure` on a down-routed task auto-escalate and re-run on
  the static route within the same session? Attractive but it doubles cost on
  miss — deferred to a follow-on "escalation" change.
