## Why

Mint's entire cost-native thesis is "cheapest path to a **successful** task,"
but today we cannot tell whether a task succeeded. The `success` field written
to `outcomes.sqlite` is defined in `src/brain/loop.ts:700` as
`cleanExit && !aborted && !streamFailed` — i.e. **"the agent didn't crash."** A
task can exit cleanly with completely wrong code and be recorded as a success.

That makes every cost claim and every routing decision unfalsifiable: we
optimize **cost-per-call** (measurable) as a blind proxy for **cost-per-success**
(the number that actually matters). Learned down-routing to cheaper models —
the moat — is unsafe to build on top of a "didn't crash" signal, because it
cannot detect the quality cliff where a cheap model fails. This change builds
the **referee** that makes cost-per-success measurable. It is the keystone
dependency for `cross-model-bench` and `quality-eval-harness`, and should be
pulled ahead of both.

## What Changes

- **New per-task success verdict.** Replace the binary "didn't crash" boolean
  with a structured verdict: `success | partial | failure | unknown`, plus a
  `confidence` and the list of contributing `signals`. The legacy boolean is
  retained (derived from the verdict) for backward compatibility.
- **Automatic signal collection (no reliance on `mint rate`).** User ratings
  are too sparse to drive routing. The verdict is derived primarily from cheap,
  automatic signals collected during/after the run:
  1. **Objective** (strongest): did the edit apply? did post-change
     typecheck / build / lint / tests pass (when the project has them and the
     agent ran them)?
  2. **Behavioral** (free, implicit): did the user accept the diff or revert it;
     did the next user turn look like a correction ("no", "that's wrong",
     "undo"); did the session end cleanly or get abandoned; time-to-accept.
  3. **Self-verification** (cheap, **off by default**, gated behind a cost
     flag): a small/cheap model judges whether the diff plausibly satisfies the
     task.
  4. **Explicit** (sparse, ground-truth when present): `mint rate` thumbs, used
     to override/calibrate when available.
- **Persist the verdict** to `outcomes.sqlite` keyed by `(kind, model,
  complexity)` via new columns (idempotent migration, matching the existing
  pattern in `outcomes.ts`).
- **Surface it** in `mint audit` as a success-rate-by-model / by-kind report so
  the cost-per-success number is visible.
- **No routing change.** This change only *measures* success. Consuming the
  signal to route down to cheaper models is an explicit follow-on (Phase 2).

## Capabilities

### New Capabilities
- `success-signal`: Per-task, runtime success verdict for every real session —
  the signal model, the automatic collectors (objective / behavioral /
  self-verification / explicit), persistence to the outcomes store, and the
  `mint audit` success-rate surface. Online and per-session — distinct from the
  offline batch eval owned by `quality-eval`.

### Modified Capabilities
<!-- None. `token-efficiency` (multi-axis-token-efficiency) owns the audit
     table and outcomes telemetry, but its spec defines token/cost axes only;
     this change adds an independent success axis without altering its
     requirements. No existing spec requirement changes. -->

## Impact

**Affected code:**
- `src/brain/loop.ts` — replace the `success` derivation (line ~700) with a call
  into the new scorer; record the verdict + signals in the outcome.
- `src/brain/memory/outcomes.ts` — new columns (`verdict`, `verdict_confidence`,
  `signals_json`) via idempotent migration; extend `RecordOutcomeInput` /
  `OutcomeRow`.
- **New** `src/brain/success/` — the scorer (`scorer.ts`) and signal collectors
  (`objective.ts`, `behavioral.ts`, `self-verify.ts`).
- `src/brain/events.ts` — new `success.verdict` event for the trace.
- `src/cli/commands/audit.ts` — success-rate columns / `--json` field.
- `src/utils/config.ts` — `brain.successSignal.selfVerify.enabled` (default
  `false`) and model/cost guards.

**Risk:** self-verification adds a model call per task → **off by default**,
gated by config, hard-capped, and never on the critical path (runs after the
`done` event, best-effort like the existing outcomes write). Objective signals
depend on the project having tests/typecheck the agent actually ran — when
absent, the verdict degrades to `unknown` rather than a false `success`, which
is the safe failure mode.

## Dependencies / order

- **Keystone — pull ahead of `cross-model-bench` and `quality-eval-harness`.**
  Both consume "success"; neither is meaningful while success means "didn't
  crash." Wave 1 priority.
- Builds on `multi-axis-token-efficiency` (owns the `mint audit` surface and the
  outcomes telemetry columns this extends). Lands cleanly after it.
- Unblocks the future **learned down-routing** change (Phase 2) — out of scope
  here.
