## ADDED Requirements

### Requirement: Per-task success verdict

The system SHALL compute a structured success verdict for every completed brain
run and persist it to the outcomes store. The verdict MUST be one of
`success`, `partial`, `failure`, or `unknown`, and MUST carry a `confidence`
in `[0,1]` and the list of `signals` that contributed to it.

The verdict MUST NOT be derived solely from whether the agent loop exited
cleanly. Clean process exit is necessary but not sufficient for `success`.

#### Scenario: Clean exit with no quality evidence
- **WHEN** a run exits cleanly (no abort, no stream failure) but no objective or
  behavioral signal is available
- **THEN** the verdict SHALL be `unknown` with low confidence, NOT `success`

#### Scenario: Verdict persisted with signals
- **WHEN** a run completes
- **THEN** the outcome row SHALL store the verdict, its confidence, and a
  serialized list of the contributing signals, keyed by `(kind, model, complexity)`

#### Scenario: Legacy success boolean preserved
- **WHEN** the verdict is written
- **THEN** the legacy `success` boolean SHALL be derived from it
  (`success` → true; `partial`/`failure`/`unknown` → false) so existing
  consumers continue to work

### Requirement: Objective signals are authoritative

When objective evidence exists, it SHALL dominate the verdict. Objective
signals are: whether the edit applied, and whether post-change
typecheck / build / lint / tests passed when the agent actually ran them during
the session.

#### Scenario: Post-change tests fail
- **WHEN** the agent ran the project's tests after its edits and they failed
- **THEN** the verdict SHALL be `failure` regardless of clean exit or user
  acceptance

#### Scenario: Post-change checks pass
- **WHEN** the agent ran typecheck/build/tests after its edits and all passed
- **THEN** the verdict SHALL be `success` with high confidence

#### Scenario: No objective signal available
- **WHEN** the project has no runnable tests/typecheck or the agent did not run
  them
- **THEN** the verdict SHALL fall back to behavioral signals, and absent those,
  to `unknown` — it SHALL NOT fabricate a `success`

### Requirement: Behavioral signals collected automatically

The system SHALL derive implicit behavioral signals without any extra user
action: diff acceptance vs. revert, whether the immediately following user turn
is corrective, whether the session was abandoned, and time-to-accept. These
signals SHALL contribute to the verdict and MUST NOT depend on `mint rate`.

#### Scenario: User reverts the change
- **WHEN** the user rejects/reverts the produced diff
- **THEN** the verdict SHALL be at most `partial`, and `failure` when no positive
  objective signal exists

#### Scenario: Immediate corrective follow-up
- **WHEN** the next user turn in the same session is a correction (e.g. "no",
  "that's wrong", "undo")
- **THEN** that turn SHALL be recorded as a negative behavioral signal against
  the prior task's verdict

### Requirement: Gated self-verification

The system SHALL support an optional self-verification signal in which a cheap
model judges whether the diff plausibly satisfies the task. This signal MUST be
disabled by default, enabled only via `brain.successSignal.selfVerify.enabled`,
cost-capped, and MUST run off the critical path (best-effort, after the run
completes).

#### Scenario: Self-verify disabled by default
- **WHEN** no configuration enables self-verification
- **THEN** no additional model call SHALL be made for scoring

#### Scenario: Self-verify failure is non-fatal
- **WHEN** self-verification is enabled and its model call errors or times out
- **THEN** scoring SHALL proceed without it and the run SHALL be unaffected

### Requirement: Explicit ratings calibrate, not gate

When a user supplies an explicit rating (`mint rate`), it SHALL be treated as
ground truth that overrides the automatic verdict for that outcome. Absence of a
rating SHALL never block or degrade the automatic verdict.

#### Scenario: Explicit rating overrides
- **WHEN** a user rates a session `bad` after an automatic `success` verdict
- **THEN** the stored verdict SHALL reflect the explicit `failure`

### Requirement: Success surfaced in audit

`mint audit` SHALL report success-rate aggregates by model and by task kind,
and `mint audit --json` SHALL include the verdict distribution, so
cost-per-success is observable.

#### Scenario: Audit shows success rate
- **WHEN** a user runs `mint audit` after several sessions
- **THEN** the output SHALL include success rate per model and per task kind,
  excluding `unknown` verdicts from the denominator or reporting them separately

### Requirement: Measurement only — no routing change

This capability SHALL NOT alter model selection or routing. It only records and
surfaces the verdict.

#### Scenario: Routing unchanged
- **WHEN** the success signal is enabled
- **THEN** the model chosen for any task SHALL be identical to what the router
  would have chosen without it
