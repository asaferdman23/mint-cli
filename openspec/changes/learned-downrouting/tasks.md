## 1. Context-strategy axis

- [ ] 1.1 Define `ContextStrategy = 'C0'|'C1'|'C2'|'C3'` and a helper mapping the
  active retrieval tier (`tiers.ts` budget) → strategy ordinal.
- [ ] 1.2 Add idempotent `context_strategy` column to `outcomes.ts` (PRAGMA guard
  pattern); extend `RecordOutcomeInput`/`OutcomeRow`/insert/select/`rowToOutcome`.
- [ ] 1.3 Backfill migration: existing rows → `C2`, flagged inferred.
- [ ] 1.4 In `loop.ts`, thread the chosen strategy into `outcomes.record`.

## 2. Substitution map (read model, pure + tested)

- [ ] 2.1 New `src/brain/routing/substitution.ts`: `buildMap(outcomes)` →
  `Map<(kind,complexity,strategy,model), Cell>` with `{n, successRate, pLower,
  avgCost, costPerSuccess}`.
- [ ] 2.2 Implement Wilson lower bound (95%, configurable) as a pure function;
  unit-test against known values incl. small-n cases.
- [ ] 2.3 `cheapestSafeCell(map, kind, complexity, Q, N_min)` → cell | null
  (min costPerSuccess among `pLower ≥ Q && n ≥ N_min`).
- [ ] 2.4 Tests: confident step-down picks cheaper cell; thin data → null;
  cost-per-success beats raw-cost ranking.

## 3. Global priors + per-repo overlay

- [ ] 3.1 Define a global-prior map format (seeded from `cross-model-bench`
  output) shipped with the package.
- [ ] 3.2 `mergedMap(globalPrior, localMap)`: local cell with `n ≥ N_min`
  overrides prior; otherwise prior. Unit-test override precedence.

## 4. Routing integration

- [ ] 4.1 Add config `brain.downrouting.{enabled(false), qualityBar, minSamples,
  explorationRate, wilsonConfidence}` to `config.ts`.
- [ ] 4.2 In `router.ts` `resolveRoute`: when enabled, consult
  `cheapestSafeCell`; on null → existing static route. Static path unchanged when
  disabled.
- [ ] 4.3 ε-greedy exploration hook: with prob ε and complexity ≠ complex,
  pick the cheapest plausible cell; tag the decision as exploration.
- [ ] 4.4 Emit a `route.downstep` event (`events.ts`) carrying the justifying
  cell (model, strategy, pLower, n); ensure `mint trace` renders it.

## 5. Observability

- [ ] 5.1 `mint audit`: substitution-map view (per kind/complexity, the cells and
  which is selected) + `--json`.
- [ ] 5.2 Surface exploration count + realized savings-from-downrouting in audit.

## 6. Verify

- [ ] 6.1 `npm run typecheck` + `npm test` green; static routing identical when
  `enabled=false`.
- [ ] 6.2 Seed a synthetic outcomes DB; confirm a confident cheap cell triggers a
  down-route and a thin cell holds at frontier; confirm trace explains each.
- [ ] 6.3 Update `openspec/ROADMAP.md`: add `learned-downrouting` as Phase 2,
  depends on `success-signal`; note it closes the "spend the signal" gap.
