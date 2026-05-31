## Why

**Strategic reframe (2026-05-31):** Mint's cost story is shifting from
single-axis (Anthropic prompt caching) to **model-agnostic multi-axis token
efficiency**. The mission is: **whatever model you pick — frontier or cheap,
new or old — Mint runs it at its ceiling.** 7 of 10 efficiency levers in
this change are model-agnostic (tools pruning, retrieval pinning, system-
prompt slim, compaction, hard cap, loop detector, mid-stream cap). Only
caching is provider-specific, and even there other providers have analogs
we'll wire in `cross-provider-caching`.

The original cache-only story had three problems:
1. Single-axis pitch is brittle — competitors can copy caching in a sprint
2. The other levers we already built (compaction, hybrid retrieval, classifier,
   token budget) aren't surfaced in `mint audit`, so users can't see them work
3. The highest-leverage token wins aren't built yet: tools-array pruning,
   system-prompt slimming, retrieval pinning, mid-stream cap

This change closes all three:
1. `mint audit` becomes a multi-axis token-efficiency report card — every
   axis visible, every axis benefitting every model in the fleet
2. We ship the four highest-leverage cost levers (all model-agnostic)
3. The proof artifact (after `cross-model-bench` runs) shows the same task
   set across Sonnet, Mistral, Gemini Flash, Llama 70B, GPT-4o — proving
   the efficiency claim isn't Sonnet-specific

The result: a comparison table no competitor can replicate, because none of
them have multi-axis audit + multi-provider routing + per-repo learning
stitched together. Cache becomes a *bonus* tier on top of the model-agnostic
foundation, not the foundation itself.

## What Changes

**Audit (measurement, no behavior change):**
- Per-turn instrumentation: tools_array_tokens, retrieved_files_count,
  retrieved_files_read_count (precision), compaction_count, output_tokens.
- Per-session aggregates: routing accuracy (was the kind classified correctly,
  retrospectively), iteration distribution, output-tokens/turn average.
- `mint audit` table grows new columns; existing columns unchanged.
- New `mint audit --json` flag emits the full report as machine-readable
  output so customers (and the bench) can consume it.

**Token-efficiency mechanisms (new behavior):**
- **Tools-array pruning by task kind** — `question`/`explain` skip
  `write_file`/`edit_file`/`bash`; `edit_*` skip `bash` when no shell hint;
  saves ~2k input tokens per turn on read-only work.
- **Per-session retrieval pinning** — compute the context set on turn 1,
  reuse across turns of the same session unless the task explicitly broadens
  scope. Makes the dynamic tier stable → Anthropic prefix cache actually hits.
- **System-prompt slim (tier 1)** — base prompt from ~3k → ~1.5k tokens, with
  an A/B fallback flag so we can rollback if quality regresses.
- **Mid-stream cap enforcement** — listen to streaming `usage` chunks; if the
  projected total would breach `brain.spendCap`, fire the already-wired
  AbortSignal before the turn completes. Tightens the cap promise from
  "halts between turns" to "halts before completing the overshoot turn."

**Explicitly deferred to follow-on changes:**
- Output verbosity control (needs prompt-tuning work, defer)
- Classifier accuracy retrospective metric (depends on user_rating data we
  don't have at volume yet)
- Cross-provider caching (OpenAI implicit, Gemini explicit) — separate change
- Cost-per-successful-task metric (depends on `mint rate` adoption)

## Capabilities

### New Capabilities

- `token-efficiency`: Multi-axis measurement and optimization of token spend per
  session. Owns the `mint audit` surface, the per-axis instrumentation events,
  and the four optimization mechanisms (tools pruning, retrieval pinning,
  prompt slim, mid-stream cap).

### Modified Capabilities

- None — this is the first formal capability defined in `openspec/specs/`.

## Impact

**Affected code:**
- `src/cli/commands/audit.ts` — column additions, `--json` flag.
- `src/brain/loop.ts` — emit new event fields (tools_array_tokens,
  retrieved_files_read on tool result, mid-stream cap check).
- `src/brain/events.ts` — extend `cost.delta` with tools array size; new
  per-turn telemetry on `tool.result` for retrieval precision.
- `src/brain/tools-host.ts` + `src/brain/loop.ts` — pruning logic for tools by
  task kind.
- `src/brain/memory/retriever.ts` — session-keyed memoization for pinning.
- `src/brain/prompt-tiers.ts` — tier-1 slim variant gated by config flag.
- `src/providers/anthropic.ts` — wire the abort signal into the cost watcher
  for mid-stream cap.

**Affected APIs:**
- Public CLI: `mint audit --json` is new (additive).
- Internal: `RunBrainOptions.spendCap` (already added) now also enforced
  mid-stream.

**Dependencies:** None new — uses existing AbortController + SDK signal.

**Risk:**
- Tools pruning could starve a model of a tool it actually needed (e.g., an
  `edit_small` that turns out to need `bash`). Mitigation: keep `read_file`
  available across all kinds; only prune destructive/write tools from
  read-only kinds.
- System-prompt slim could degrade behavior. Mitigation: gated by
  `brain.systemPromptVariant` config, default to `full` initially, ship `slim`
  behind opt-in until bench data validates parity.
- Retrieval pinning could miss new files the user creates mid-session.
  Mitigation: invalidate pin on file-watcher event or explicit broadening
  keyword in task.
