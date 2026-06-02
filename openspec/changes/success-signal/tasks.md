## 1. Signal model & scorer (pure, unit-tested first)

- [ ] 1.1 Define types in `src/brain/success/types.ts`: `Verdict =
  'success'|'partial'|'failure'|'unknown'`, `Signal { source:
  'objective'|'behavioral'|'self-verify'|'explicit', polarity: -1|0|1, weight:
  number, confidence: number, detail?: string }`, `ScoredVerdict { verdict,
  confidence, signals }`.
- [ ] 1.2 Implement pure `scoreOutcome(signals: Signal[]): ScoredVerdict` in
  `src/brain/success/scorer.ts` with priority objective > explicit > behavioral >
  self-verify (D1). Objective present → forces success/failure; others adjust
  confidence within band; no signals → `unknown` low confidence.
- [ ] 1.3 Write `src/brain/__tests__/success-scorer.test.ts` covering every spec
  scenario: clean-exit-no-evidence → unknown; tests-fail → failure; checks-pass →
  success; revert → ≤partial; explicit override; unknown excluded from success.

## 2. Objective signal collector (harvest, do not re-run)

- [ ] 2.1 Implement `collectObjectiveSignals(run)` in
  `src/brain/success/objective.ts` reading the run's existing tool results for
  `test`/`tsc`/`lint`/`build` invocations + their exit status, and edit-applied
  from `filesTouched`/apply success (D2). No new processes spawned.
- [ ] 2.2 Map results → `Signal[]` (passing checks = strong +1; failing = strong
  -1; absent = none). Unit-test against synthetic tool-result fixtures.

## 3. Behavioral signal collector (free, cross-turn)

- [ ] 3.1 Implement `collectBehavioralSignals(run)` in
  `src/brain/success/behavioral.ts`: diff accepted vs reverted, time-to-accept,
  abandoned session (from `userAccepted` + session state).
- [ ] 3.2 Implement corrective-follow-up heuristic (local regex/keywords: `no`,
  `that's wrong`, `undo`, `revert`, `actually`, `still`) — no model call (D3).
- [ ] 3.3 Implement `reviseVerdict(sessionId, signal)` on `OutcomesStore`
  mirroring `setUserRating`, to apply the next-turn corrective signal to the
  prior task's row. Unit-test the update path.

## 4. Self-verification signal (gated, off by default)

- [ ] 4.1 Add config `brain.successSignal.selfVerify.enabled` (default `false`),
  `.model` (a cheap model id), and `.spendCapUsd` to `src/utils/config.ts`.
- [ ] 4.2 Implement `selfVerify(run)` in `src/brain/success/self-verify.ts`: one
  cheap-model call judging diff-vs-task → `Signal`. Hard timeout + spend guard;
  errors swallowed (D5).

## 5. Persistence

- [ ] 5.1 Add idempotent migration in `outcomes.ts` for columns `verdict TEXT`,
  `verdict_confidence REAL`, `signals_json TEXT` using the existing
  `PRAGMA table_info` guard pattern.
- [ ] 5.2 Extend `RecordOutcomeInput` + `OutcomeRow` + insert/select statements
  + `rowToOutcome` with the new fields; keep legacy `success` derived from
  verdict (D4).

## 6. Wire into the brain loop

- [ ] 6.1 In `src/brain/loop.ts` (~line 700), replace the direct `success`
  derivation: gather objective + behavioral signals, call `scoreOutcome`, derive
  legacy `success` from the verdict, and pass verdict/confidence/signals to
  `outcomes.record`.
- [ ] 6.2 Add the self-verify call in the existing post-`done` best-effort block
  (alongside L3 memory extraction at ~line 729), gated by config, fire-and-forget.
- [ ] 6.3 Add a `success.verdict` event to `src/brain/events.ts` and emit it so
  `mint trace` shows which signals fired (D6).

## 7. Surface in audit

- [ ] 7.1 Add success-rate-by-model and success-rate-by-kind aggregates to
  `src/cli/commands/audit.ts`, reporting `unknown` separately / excluded from the
  denominator.
- [ ] 7.2 Add verdict distribution to `mint audit --json`.

## 8. Verify & document

- [ ] 8.1 Run `npm test` and `npm run typecheck`; confirm legacy consumers
  (`mint tune`, classifier, retriever) still read `success` correctly.
- [ ] 8.2 Manual check: run a task whose tests pass → `success`; break a test and
  re-run → `failure`; run in a test-less dir → `unknown`. Confirm `mint audit`
  reflects each and routing is unchanged.
- [ ] 8.3 Update `openspec/ROADMAP.md`: add `success-signal` as Wave 1 keystone
  ahead of `cross-model-bench`/`quality-eval-harness`; note the cost-per-success
  pillar it closes.
