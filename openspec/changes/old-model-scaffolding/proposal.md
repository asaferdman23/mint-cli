## Why

**Strategic: this is the moat we own that no competitor has.**

Claude Code, Cursor, Aider, Cline, Pi, OpenHands — all assume the model is
the model. If Sonnet picks badly, you eat it. If Llama 70B emits a malformed
tool call, the tool errors and the model has to figure out what went wrong
from the error message. If Mistral Small over-explains instead of just editing,
you pay for the prose. None of them scaffold around weak-model failure modes.

Mint already routes per-task kind via `mint tune`. The natural next step:
**when we route to a weak model, scaffold around its known weaknesses** so it
hits its ceiling instead of fumbling halfway. Combined with `mint tune` (which
learns per-repo which model handles which kind) and `cross-model-bench` (which
proves the per-cell cost-quality profile), scaffolding makes the cheap end of
the fleet *viable*. Without it, routing to cheap is gambling. With it, routing
to cheap is engineered.

**The honest promise:** weak models hit their own ceiling more consistently,
on more tasks, with less waste. We do NOT make Llama 8B reason like Opus —
raw capability is raw capability. We make Llama 8B nail the tasks it *could*
have nailed but routinely doesn't, because the harness wasn't catching its
known failure modes.

This is the lever that converts the model-agnostic story from a thesis into
a durable advantage. Competitors can match caching in a sprint. They can't
match per-(model, task-kind) scaffolding without rebuilding the routing+tune
loop underneath it.

## What Changes

**1. Chain-of-thought hints by task kind — gated on model reasoning capability**

A static map `KIND_COT_HINTS: Record<TaskKind, string>` of small reasoning
scaffolds injected as a tier-3 (dynamic) system block. Applied only when
`MODELS[route.model].capabilities.reasoning < 8`. Frontier models skip — they
don't need it and the extra tokens hurt cache hit rate.

Example hints:
- `debug` → "Before fixing, list 3 possible causes and rank by likelihood."
- `refactor` → "Outline the rename plan as file:line pairs before editing."
- `edit_multi` → "List files to touch and the change per file before editing."
- `scaffold` → "List files to create and their structure before writing."

Empty for `question`/`explain` (read-only doesn't need scaffolding).

Lives in tier-3 (dynamic) so cache for tier-1+2 isn't invalidated when the
hint changes per task kind.

**2. Output validation + auto-retry for malformed tool calls**

After each tool call is parsed from the stream:
- Validate `call.input` against the tool's `input_schema` (JSON Schema).
- If invalid: emit `warn` event + append a correction prompt with the specific
  validation error, re-run that turn's stream once.
- Max 1 retry per tool call. Counts against `brain.spendCap`.
- Today the loop runs the malformed call and lets the tool error out; the
  model has to figure out what went wrong from a tool error message. Wasteful
  for weak models that may misinterpret the error and loop.

**3. Format normalization at the tool-host boundary**

Best-effort coercion of common weak-model malformations:
- Comma-separated string where the schema wants an array: `path: "a, b"` →
  `["a", "b"]`
- Wrong-cased keys: `Path` → `path`, `FileName` → `path`
- Path normalization: strip leading `./`, expand `~`, resolve `..`
- Missing optional fields filled with documented defaults
- Trailing whitespace / quote weirdness in stringified args

Every normalization emits a `warn` event with the original → normalized diff
so trace shows when the harness helped the model.

**4. Per-model prompt micro-variants**

Registry `MODEL_PROMPT_PATCHES: Record<ModelId, Partial<Record<TaskKind, string>>>`
mapping `(modelId, kind) → promptPatch`. Patches addressed to known weak spots
identified via `mint bench` or `mint audit` data.

Examples (seed values — to be tuned with real bench data):
- `groq-llama-70b` × `edit_small` → "Just make the change. No explanation
  unless asked."
- `mistral-small` × `edit_small` → "Output ONLY a tool call. No prose."
- `groq-llama-8b` × `debug` → "Be concise. List one likely cause and fix it."

Empty for frontier models (Sonnet/Opus/Grok-4/Gemini Pro). Opt-in additions
for any model based on real-world observation.

**5. Audit visibility — the proof axis**

Every scaffolding fire emits a `scaffolding.applied` event:
- type: `'cot_hint' | 'validate_retry' | 'normalize' | 'model_patch'`
- model, kind, optional detail (what was normalized)

`mint audit` gains a `scaffold/turn` column showing avg scaffolding events
per turn per model. High rate = strong signal that model is struggling on
that task kind. This is what makes the feature provable, not vibes.

**Explicitly out of scope:**
- Substituting raw capability — no fine-tuning, no ensembles, no tree-of-thought
  beyond a single CoT addition. The honest promise stands: ceiling-hitting
  consistency, not capability substitution.
- Tool-call repair via a separate LLM call (too expensive).
- Per-language scaffolding (deferred — start with kind+model dimensions).
- Per-provider quirks beyond format normalization (e.g., Gemini's particular
  tool-call shape; handled in the provider layer already).

## Capabilities

### New Capabilities
- `old-model-scaffolding`: CoT hints by kind+model, tool-call validation +
  retry, format normalization, per-(model, kind) prompt patches, audit
  surface for all four.

### Modified Capabilities
- `token-efficiency` (if `multi-axis-token-efficiency` lands first): the
  audit gains a `scaffold/turn` column.

## Impact

**Affected code:**
- New `src/brain/scaffolding/` module:
  - `cot-hints.ts` — `KIND_COT_HINTS` map + threshold gate
  - `validate.ts` — minimal JSON Schema validator (~50 LoC; no new dep)
  - `normalize.ts` — format coercion helpers
  - `model-patches.ts` — `MODEL_PROMPT_PATCHES` registry
  - `index.ts` — public surface
- `src/brain/loop.ts` — inject CoT hints into tier-3, wire validate+retry
  around the tool-call dispatch
- `src/brain/tools-host.ts` — normalize tool input before execution
- `src/brain/prompt-tiers.ts` — accept scaffolding text as a dynamic-tier
  contribution
- `src/brain/events.ts` — `scaffolding.applied` event
- `src/cli/commands/audit.ts` — render `scaffold/turn` column + per-type
  breakdown
- `src/utils/config.ts` — knobs: `brain.scaffolding.{cotThreshold,
  validateRetries, normalize, modelPatches}`

**Affected APIs:**
- No new CLI commands. `--no-scaffold` flag added to one-shot path for A/B.
- Internal: `RunBrainOptions.scaffolding?: 'on' | 'off'` for programmatic
  override.

**Dependencies:** None new. Uses existing event sink + approval flow.

**Risk:**
- **Frontier models accidentally get CoT hints.** Mitigation: capability
  threshold (`reasoning < 8`) gates injection; per-model opt-out config.
- **Format normalization masks real model bugs.** Mitigation: every
  normalization emits `warn` with the diff — visible in trace + audit.
- **Retry doubles cost on truly broken cases.** Mitigation: hard max 1
  retry; counts against `brain.spendCap` (already enforced).
- **CoT hints add tokens that hurt cache.** Mitigation: hints live in
  tier-3 (the dynamic tier that already varies per turn). Tier-1+2 cache
  unaffected.
- **Static `KIND_COT_HINTS` doesn't fit every project.** Mitigation: hints
  are short (one sentence each) and conservative; future change can make
  them per-project configurable via MINT.md.

## Dependencies / order

- Hard dependency on `multi-axis-token-efficiency` Task 1 (audit
  instrumentation) — scaffolding-fire counts need the audit surface to be
  observable.
- Soft dependency on `cross-model-bench` — bench produces the data that
  reveals which (model, kind) pairs warrant patches in
  `MODEL_PROMPT_PATCHES`. Without bench data, we ship the patches from
  intuition; with it, we ship them from evidence.

Shipping order: **Wave 2**, but can land in parallel with
`subagents-parallel-exploration` and `apply-mode-polish`. Likely the first
Wave 2 change to ship because:
1. It's the highest-leverage moat (no competitor has it)
2. It compounds with `mint tune` (already shipped)
3. It makes `cross-model-bench` results richer (every cheap-model cell
   shows the lift)
