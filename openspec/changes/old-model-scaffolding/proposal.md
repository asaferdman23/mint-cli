> **🚧 DRAFT — planned (Wave 2). Not ready to execute.**
> Full spec + tasks land when prioritized.

## Why

Raw model capability sets a ceiling per task — Llama 3.1 8B can't suddenly
understand SQLite WAL semantics. But weak/old models routinely *miss their
own ceiling* on tasks they could handle, because:

- They emit malformed tool calls (slightly-off arg shapes, wrong key names)
- They jump to a hack without reasoning through the problem
- They produce output that's "almost right" but doesn't parse
- They give up on multi-step tasks where a small CoT nudge would carry them

Each of those is fixable in the harness — not by changing the model, but by
scaffolding around it. The result: weak models punch above their weight, and
Mint's "any model gets to its ceiling" promise becomes provable on the cheap
end of the fleet, not just the frontier end.

This is the **model-agnostic quality lever** that converts our existing
strengths (audit, tune, routing) into a cross-fleet performance multiplier.

## What Changes

**1. Chain-of-thought hints by task kind**
- A static map `KIND_COT_HINTS: Record<TaskKind, string>` of small reasoning
  scaffolds appended to the user task on weak models.
- Examples: `debug` → "Before fixing, list 3 possible causes and rank by
  likelihood." `refactor` → "Outline the rename plan as a list of file:line
  changes before editing."
- Applied conditionally: only when the resolved model is below a capability
  threshold (e.g., `MODELS[m].capabilities.reasoning < 8`).
- Frontier models skip the scaffold — they don't need it and it adds tokens.

**2. Output validation + auto-retry for malformed tool calls**
- After each tool call, validate the input against the tool's JSON schema.
- On validation failure: emit a correction prompt to the model with the
  specific error and re-run that tool turn (max 1 retry; counts against the
  spend cap).
- Today the loop just runs the malformed call and lets the tool error out;
  the model then has to figure out what went wrong from a tool error message.

**3. Format normalization at the tool-host boundary**
- Best-effort coercion of common weak-model malformations:
  - String args that should be arrays (`path: "a, b"` → `["a", "b"]`)
  - Wrong-cased keys (`Path` → `path`)
  - Missing optional fields with sensible defaults
- Log every normalization as a `warn` event so users see when the model
  needed help.

**4. Per-model prompt micro-variants where it materially helps**
- A registry mapping `(modelId, taskKind) → promptPatch` for known weak
  spots (e.g., Llama tends to over-think simple edits → "Just make the
  change; don't explain unless asked").
- Empty for frontier models; opt-in additions for cheap models.

**Explicitly out of scope:**
- Substituting raw capability — we don't fine-tune models, don't ensemble,
  don't tree-of-thought beyond a single CoT prompt addition. The honest
  promise is "weaker models hit their own ceiling more often," not "weak
  models become frontier."

## Capabilities

### New Capabilities
- `old-model-scaffolding`: CoT hints by task kind, tool-call validation +
  retry, format normalization, per-model prompt micro-variants. Audit and
  trace surface all of these so users can see when scaffolding fired.

### Modified Capabilities
- `token-efficiency` (if `multi-axis-token-efficiency` lands first): the
  audit gains a `scaffolding fires/turn` column showing how often weak
  models needed help.

## Impact

**Affected code:**
- New `src/brain/scaffolding/` module — kind-hints, normalizers, validators
- `src/brain/loop.ts` — wire CoT hint injection after route resolution
- `src/brain/tools-host.ts` — validation + retry + normalization
- `src/cli/commands/audit.ts` — surface scaffolding fire counts

**Risk:**
- CoT hints could degrade frontier models if accidentally applied to them.
  Mitigation: capability-threshold gate, opt-out per model in config.
- Format normalization could mask real model bugs by silently fixing them.
  Mitigation: every normalization emits a `warn` event so it's visible in
  trace.
- Retry loop could double-spend on truly broken cases. Mitigation: hard
  max 1 retry per tool call; counts against spend cap.

## Dependencies / order

- Hard dependency on `multi-axis-token-efficiency` Task 1 (audit
  instrumentation) so scaffolding-fire counts are observable.
- Shipping order: Wave 2, alongside `subagents-parallel-exploration` and
  `apply-mode-polish`.
