## Context

Today `mint audit` measures one axis (cache hit %). The proof story
rests on this single number, which leaves us vulnerable on three fronts:

1. **Single-axis pitch is brittle.** When a competitor adds prompt caching
   (Cursor could do it in a sprint), our entire differentiation collapses.
2. **The other levers are invisible to the user.** We built compaction,
   hybrid retrieval, classifier-driven routing, and token budgeting —
   none surface in audit, so the user doesn't see the saving.
3. **The largest token wins are still unbuilt.** Tools-array pruning,
   retrieval pinning, and prompt slimming are each worth more than
   incremental caching improvements at the volumes a typical session sees.

Modeled per-turn token math for a 5k-token retrieved context, 2k tools,
3k base system, 5-turn session:
- Today (caching working): ~17k cached prefix / turn, ~12k actually billed
  (mostly at cache-read rate)
- With tools pruning (read-only kinds): drops 2k/turn → 10k billed
- With retrieval pinning (dynamic tier stable): drops cache-write cost
  on turns 2-5 from ~$0.04 each to ~$0.003 each
- With prompt slim: drops 1.5k from base, savings on every turn forever

Together, on a representative multi-turn task, modeled total drops from
~$0.05 to ~$0.018 — a ~64% reduction beyond what caching alone provides.

## Goals / Non-Goals

**Goals:**
- `mint audit` becomes a multi-axis report card consumable by humans
  (formatted table) and machines (`--json`).
- Tools-array pruning ships behind `brain.toolPruning` (default on),
  preserves correctness on all task kinds.
- Retrieval pinning ships behind `brain.retrievalPinning` (default on),
  preserves freshness when the task explicitly broadens.
- Prompt slim ships behind `brain.systemPromptVariant: 'slim' | 'full'`
  (default `full` until bench validates parity).
- Mid-stream cap enforcement tightens the spend-cap promise without
  changing the user-visible API.

**Non-Goals:**
- Output verbosity control — deferred. Requires prompt-engineering work
  and quality A/Bs that are out of scope for the measurement-first phase.
- Cross-provider caching (OpenAI implicit, Gemini explicit) — separate
  change. Worth doing but it's a provider-by-provider implementation
  detail, not part of the multi-axis story.
- Classifier accuracy retrospective metric — depends on `user_rating` data
  we don't have at volume yet. Defer until `mint rate` adoption is real.
- Cost-per-successful-task — same dependency.

## Decisions

### Decision 1: One umbrella capability, multiple requirements

Rather than create five separate capability specs (one per lever), we group
under `token-efficiency` because all five share a unified surface (the audit
table) and a unified rationale (the multi-axis cost story). Splitting now
would mean five spec files with one requirement each; the cohesion is
artificial.

If individual mechanisms grow (e.g., retrieval pinning becomes a richer
session-context system), we can split them out via future change proposals.

### Decision 2: Tools pruning by `kind`, not by per-tool capability descriptor

The simplest valid implementation: a static map from `TaskKind` →
allowed-tool-name list, applied in `loop.ts` before `getToolDefinitions()`
is passed to the stream call. Alternatives considered:
- LLM-decided pruning (the classifier picks the tools): too much latency
  cost, defeats the savings goal.
- Per-tool `whenKind` metadata on each tool: cleaner but requires
  editing every tool definition. Static map is shippable today.

### Decision 3: Retrieval pinning is session-scoped, not turn-scoped or task-scoped

A pinned context survives all turns of a session unless the broadening
keyword fires. Alternatives considered:
- Pin-per-task: forces re-retrieval on every prompt, defeats the cache win.
- Pin-per-turn: same as today.
- Pin until file watcher fires: requires fs.watch wiring, adds complexity.
  Future improvement; v1 uses the broadening-keyword escape hatch.

### Decision 4: Prompt slim ships behind a flag, default `full`

The risk of breaking behavior on prompts that rely on the verbose rules
is non-zero. We ship the slim variant **opt-in** until bench data shows
the slim version maintains task quality at lower cost.

The flag is `brain.systemPromptVariant: 'full' | 'slim'`. When bench
results from a real run show parity, we flip the default in a follow-on
change.

### Decision 5: Mid-stream cap uses streaming `usage` snapshots

Anthropic emits `usage` snapshots during streaming (the SDK aggregates
deltas). We project the final cost from the in-flight usage + a small
buffer for tokens yet to stream, compare to `spendCap`, and abort if
projected to breach.

The projection is conservative — it uses the highest output rate the
model has shown so far multiplied by the remaining `max_tokens` budget.
This will rarely false-positive but may over-trigger in edge cases. The
loop's existing `spendCapApproved` flag absorbs the false positives
(user approves once, no nag).

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tools pruning starves a model of a tool it needed | Medium | Read tools always present; only prune destructive/exec tools from read-only kinds; user override `--all-tools` |
| Retrieval pinning causes stale context after a user adds a new file mid-session | Medium | Broadening-keyword escape hatch; config `brain.retrievalPinning: false` opt-out |
| Prompt slim degrades behavior on edge cases | High | Ship behind flag, default `full`; bench A/B before flipping default |
| Mid-stream cap aborts a useful turn mid-completion | Low-Medium | Conservative projection only after first usage snapshot; user approval flag persists across turns |
| `mint audit` table grows wide and breaks at narrow terminal widths | Low | Adaptive column drop at 90 cols (mirrors StatusBar pattern); `--json` available for full data |

## Open Questions

- Should tools pruning emit a `warn` event when a pruned tool would have
  been useful (model produces a "I would have used X" text)? Probably yes,
  but the detection heuristic needs design.
- Retrieval pinning: should we expose the pinned set in `mint trace` so
  the user can see what got reused? Likely yes (one line per turn:
  `retrieval: reused N files from turn 1`).
- Prompt slim: do we offer `tiny` (~800 tokens) as a third variant? Defer.
