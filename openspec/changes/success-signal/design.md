## Context

The brain records every run to `<cwd>/.mint/outcomes.sqlite` via
`OutcomesStore.record()` (`src/brain/memory/outcomes.ts`). The `success` field
it stores is computed in `src/brain/loop.ts:700` as
`cleanExit && !aborted && !streamFailed` — the comment there even calls it the
"didn't crash" signal. The classifier, retriever, and `mint tune` all read this
store; `mint audit` reports its aggregates. A `user_rating` column
(`good|meh|bad`) exists but is populated only by the not-yet-shipped `mint rate`
command and the `mint bench` inline prompt — i.e. it is sparse to empty in real
use.

Cost-native routing requires the opposite of a sparse, crash-only signal: a
**dense, automatic, per-task** measure of whether the work was actually correct.
This design adds that signal as a new, independent axis on the existing outcome
row, reusing the store's established idempotent-migration pattern.

## Goals / Non-Goals

**Goals:**
- A structured verdict (`success|partial|failure|unknown` + confidence +
  signals) on every real run, derived automatically.
- Objective evidence (tests/typecheck/lint/apply) dominates when present.
- Safe failure mode: absence of evidence → `unknown`, never a false `success`.
- Visible in `mint audit`; consumable later by learned routing.
- Cheap and off the critical path — never slows or breaks a task.

**Non-Goals:**
- No routing/model-selection change (explicit follow-on, "Phase 2").
- Not the offline benchmark — `quality-eval-harness` owns curated eval sets,
  SWE-bench, LLM-as-judge leaderboards, and CI gating. This is the *online*
  per-session signal that feeds that and feeds routing.
- No new always-on model calls. Self-verification is opt-in only.
- No dependence on `mint rate` adoption.

## Decisions

### D1 — A weighted signal aggregator, not a single source
The verdict is produced by a pure `scoreOutcome(signals): Verdict` function that
combines a typed list of `Signal { source, polarity, weight, confidence }`.
Priority order: **objective > explicit > behavioral > self-verify**. Objective
signals, when present, can force `success`/`failure` outright; the others move
confidence within a band.

*Alternative considered:* a single LLM-as-judge call per task. Rejected — costs
a model call on every task, is the very token spend we exist to cut, and is
weaker than a passing test suite. LLM-judge is demoted to the optional
self-verify signal.

### D2 — Objective signals are harvested from the run, not re-run
We do **not** spawn new test/typecheck processes after the task (expensive,
side-effectful, often misconfigured in CI-less repos). Instead the scorer reads
what the agent already did: tool calls that ran `test`/`tsc`/`lint`/`build` and
their exit results, already present in the event stream / `tools-host` results.
Edit-applied is known from `filesTouched` + apply success. This keeps scoring
free and honest (it credits checks the agent actually performed).

*Alternative considered:* the scorer proactively runs `npm test`. Rejected for
cost, side effects, and false negatives in repos without a test command.

### D3 — Behavioral signals are deferred-resolved across turns
Diff acceptance is known at run end. But "the next user turn was a correction"
is only knowable on the *following* turn. The outcome row is therefore written
with an initial verdict, and a lightweight `reviseVerdict(sessionId, signal)`
updates it when the next turn arrives (mirrors the existing
`setUserRating` update path). Corrective-follow-up detection is a cheap local
heuristic (regex/keyword on the next prompt: `no`, `that's wrong`, `undo`,
`revert`, `still`, `actually`), explicitly *not* a model call.

### D4 — Storage: new columns on `outcomes`, idempotent migration
Add `verdict TEXT`, `verdict_confidence REAL`, `signals_json TEXT` via the same
`PRAGMA table_info` guard pattern already in `outcomes.ts`. The legacy `success`
INTEGER column stays and is derived from the verdict, so `mint tune`, the
classifier, and existing queries keep working with zero changes.

### D5 — Self-verify is best-effort, post-`done`, capped
When `brain.successSignal.selfVerify.enabled`, after the `done` event we fire one
cheap-model call (same fire-and-forget slot as the existing L3 memory
extraction at `loop.ts:729`), with its own small spend guard and timeout. Any
error is swallowed; the verdict simply lacks that signal.

### D6 — Verdict event on the trace
Emit a `success.verdict` event so `mint trace` shows *why* a task was scored the
way it was (which signals fired). Consistent with the project's "no hidden
state" observability promise in the README.

## Risks / Trade-offs

- **Sparse objective signals in test-less repos** → verdict is `unknown` for
  many tasks. *Mitigation:* `unknown` is reported separately in audit and
  excluded from success-rate denominators, so it neither inflates nor deflates
  the metric; behavioral signals still apply. This is the honest, safe default.
- **Behavioral heuristics misread a follow-up** (user's next turn is unrelated,
  not a correction) → noisy negative signal. *Mitigation:* low weight + low
  confidence; objective and explicit signals dominate; the heuristic is tunable.
- **Self-verify cost creep** → *Mitigation:* off by default, cheap model only,
  per-call spend cap, off critical path.
- **Verdict revision races** (next turn arrives while scoring) →
  *Mitigation:* the update is a single keyed SQL UPDATE on the latest row for
  the session, idempotent, same pattern as `setUserRating`.

## Migration Plan

1. Ship columns + scorer behind no flag (objective + behavioral are always-on,
   zero added cost). Self-verify behind `selfVerify.enabled=false`.
2. Backfill is unnecessary — old rows keep their legacy `success`; new rows gain
   verdicts. Audit tolerates null verdicts (treats as `unknown`).
3. Rollback: the scorer call in `loop.ts` is guarded best-effort; disabling it
   reverts to the legacy boolean with no schema rollback needed (extra columns
   are inert).

## Open Questions

- Weight calibration: initial weights are hand-set. Once enough verdicts +
  explicit ratings accumulate, `mint tune` could learn them — out of scope here,
  noted for the Phase 2 routing change.
- Should a hard objective `failure` auto-suggest re-running on a stronger model?
  That is a routing action → deferred to Phase 2 by D1/Non-Goals.
