## Why

Mint already has a 4-tier memory subsystem (`src/brain/memory/`): L1 working
context, L2 prior-turn summaries, L3 project memory, L4 user-global memory.
Extraction, retrieval, and storage all exist. What's missing is **everything
that makes memory a cost lever and a quality lever** instead of a silent
overhead:

1. **Extraction cost is invisible.** Every turn fires an extractor LLM call
   (`memory.extract.enabled` default true). We don't track how much it spends
   per session — could be 10–20% of total cost on short tasks.
2. **Recall precision is unknown.** We inject up to 10 memories per turn into
   the dynamic prompt tier (`memory.retrieval.k` default 10). We don't measure
   how many the model actually used. The retrieval-precision problem repeats.
3. **No pruning policy.** Memories accumulate forever. Old, low-confidence,
   contradicted memories still get retrieved and waste tokens.
4. **No per-session control.** `memory.extract.enabled` is global. A user
   on a sensitive task can't say "don't remember this session" without
   editing config.
5. **No injection budget.** Memory injection grows tier-3 unpredictably.
   A user with 200 high-recency memories could be paying 2k tokens/turn
   just for memory injection — silently.

This change makes the memory subsystem a first-class cost/quality pillar
alongside the other axes in `multi-axis-token-efficiency`. Mission framing:
**"agent memory the user can audit, cap, and trust to be relevant — not a
silent token sink."**

## What Changes

**Memory audit (measurement):**
- `mint audit` SHALL include a memory section: total extraction calls,
  extraction cost, avg memories injected per turn, recall precision (memories
  retrieved vs referenced by the model).
- `mint memory status` SHALL show per-store byte sizes + row counts + age
  distribution.
- New `memory.extract` event type recorded in the trace for full visibility.

**Memory cost control:**
- Token budget for memory injection per turn (`memory.injectionBudgetTokens`,
  default 1500). Retriever stops at the budget, prefers higher-scored memories.
- Per-session memory toggle: `/memory off` for the current session, `/memory
  pause` to stop extraction but keep retrieval. CLI: `--no-memory` flag.

**Memory quality:**
- Pruning policy: auto-discard memories with confidence < threshold older
  than N days, contradicted-by-later-write within K turns, or referenced 0
  times in the last M retrievals (LRU-like usage tracking).
- Recall feedback: when an injected memory is *referenced* by the model
  (heuristic: substring match between memory text and assistant output),
  increment a `usage_count` column. Pruner uses this.

**Privacy:**
- Confirm `redact.ts` runs on every write path (verify, add tests).
- `mint memory show <id>` to inspect a single memory before deciding to forget.
- Default-deny for `decision` and `open_question` kinds (already opt-in by
  config, just make this the documented surface).

**Explicitly deferred:**
- Cross-session memory deduplication (similar memories from different
  sessions merging into one)
- Embedding-only retrieval mode (skip BM25 to save lookup time) — measure first
- L4 sync across machines — feature not architecture

## Capabilities

### New Capabilities

- `agent-memory`: The agent memory subsystem as a cost+quality pillar — owns
  extraction telemetry, injection token budget, per-session controls, pruning
  policies, recall feedback loop, and the `mint memory` / `/memory` surfaces.

### Modified Capabilities

- `token-efficiency` (if `multi-axis-token-efficiency` lands first): The audit
  report SHALL gain a memory section. Documented as a forward dependency in
  that change's spec.

## Impact

**Affected code:**
- `src/brain/memory/extract.ts` — emit cost event, respect per-session pause flag
- `src/brain/memory/retriever.ts` — token-budget-aware retrieval, increment
  usage on reference
- `src/brain/memory/store.ts` — pruning policy implementation, `usage_count`
  column, age-based queries
- `src/brain/memory/pending.ts` — pause semantics
- `src/brain/loop.ts` — wire per-session toggle, emit memory section data
  into `done` event
- `src/cli/commands/audit.ts` — render memory section
- `src/cli/index.ts` — `--no-memory` flag, `mint memory show/prune`
  subcommands
- `src/tui/hooks/useSlashCommands.ts` — `/memory off` / `/memory pause`

**Affected APIs:**
- New CLI: `mint memory show <id>`, `mint memory prune [--dry-run]`
- New CLI flag: `mint --no-memory "<task>"`
- Internal: `RunBrainOptions.memoryMode: 'on' | 'pause' | 'off'`

**Dependencies:** None new. Reuses existing memory store, retriever, event sink.

**Risk:**
- Memory pruning could discard a memory the user wanted to keep. Mitigation:
  `--dry-run` by default; explicit pruning command, not automatic.
- Usage-count heuristic (substring match) has false negatives (model paraphrases
  the memory). Mitigation: heuristic only feeds pruning weight, not hard
  delete. Tunable threshold.
- Per-session toggle could be confusing vs the global config flag.
  Mitigation: `/memory status` clearly reports both layers.
