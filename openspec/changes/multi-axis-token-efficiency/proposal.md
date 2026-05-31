## Why

The Mint cost story has so far been single-axis: prompt caching on Anthropic.
That's one lever out of at least six the original mission named — caching,
context engineering, harness engineering, token efficiency, routing, and
compaction. We built code for some of the others (compaction, hybrid retrieval,
classifier, token budget) but they're **not surfaced in `mint audit`**, so we
can't prove they're working. We *didn't* build the highest-leverage token wins
yet — tools-array pruning, system-prompt slimming, retrieval pinning, output
verbosity control, mid-stream cap.

This change makes Mint's cost claim multi-axis and defensible:
1. `mint audit` becomes a token-efficiency report card (not just a cache meter).
2. We ship the four highest-leverage cost levers we haven't built yet.
3. The result: a Show HN screenshot that says "Mint reduces input tokens on
   six measurable axes" — vs the current "we have caching like Claude Code,
   but tested." Much harder for any competitor to replicate axis-by-axis.

This is also a hedge against the Sonnet-only critique: most of these levers
work on any model (only caching is provider-specific today). The wedge
broadens.

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
