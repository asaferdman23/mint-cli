## Context

The memory subsystem (`src/brain/memory/`) is fully wired: extractor,
hybrid retriever (BM25 + embeddings), two SQLite stores (project + user-
global), pending-write buffer, redact for secret detection, summarize-turn
for L2. Default config extracts every turn and injects up to 10 memories.

What's missing is **everything that turns memory from a silent system into
a measurable, controllable, prunable system**. Today a user has no idea
how much memory costs them per session, can't pause it for one task without
editing config, and has no way to prune the long tail of low-value
memories that accumulate.

This change closes that loop without rewriting the memory subsystem.

## Goals / Non-Goals

**Goals:**
- Memory cost surfaces in `mint audit` (extraction cost, injection token
  share, recall precision).
- Per-session memory control (`/memory off`, `--no-memory`) for sensitive
  tasks and cost-aware runs.
- A pruning policy that's manual (`mint memory prune --apply`) but smart
  (uses confidence, age, and usage-count signals together).
- A recall feedback loop that tracks which injected memories the model
  actually referenced, feeding the pruner.
- Token budget for memory injection so the dynamic tier stays predictable.

**Non-Goals:**
- Cross-session memory deduplication (similar facts merging into one
  canonical memory). Worth doing later; out of scope now.
- Embedding-only retrieval to skip BM25 (premature without measurement).
- L4 sync across machines (architecture work, not relevant to cost/quality
  story).
- Automatic pruning on a cron — risky, defer.

## Decisions

### Decision 1: Pruning is manual, not automatic

The cost of mis-pruning a useful memory is higher than the cost of leaving
dead-weight memories around. Manual pruning with `--dry-run` default forces
the user to review what's being removed.

If users want automation later, they can wire `mint memory prune --apply`
into a cron. We won't ship that automation in v1.

### Decision 2: Recall heuristic is substring match, not semantic

A semantic-match would require an LLM call per turn per memory — too
expensive to be in the hot path. Substring match (case-insensitive, ≥ 20
char window) is fast, deterministic, and has false negatives we can live
with.

Pruning weights usage_count as one signal among three (confidence + age +
usage). A memory with low usage but high confidence and recent creation
isn't pruned just because the heuristic missed a reference.

### Decision 3: Per-session memory mode is layered over the global config

The persistent config (`memory.extract.enabled`) stays as the user's
default preference. Per-session mode (CLI flag or slash command) layers
on top of it for ad-hoc control.

When both are set, the more restrictive one wins:
- Config `enabled: true` + session `off` → off
- Config `enabled: false` + session `on` → off (config blocks)
- Config `enabled: true` + session `pause` → pause

`/memory status` shows both layers explicitly so the user knows where a
behavior is coming from.

### Decision 4: Injection budget is token-count, not row-count

`memory.retrieval.k = 10` is a row count — but row sizes vary 50× (a
preference is ~30 tokens; an episode is ~1500). A token budget keeps the
injection cost predictable regardless of memory size.

Budget default is **1500 tokens** — fits ~5–10 typical memories. Coexists
with `memory.retrieval.k` (whichever cap hits first wins). Setting budget
to 0 means "no token cap, use k only" (legacy behavior).

### Decision 5: Memory section in audit, not a separate command

`mint audit` already aggregates per-session data. Adding a memory section
there means users get the full picture in one view rather than running
`mint audit && mint memory audit`. The `mint memory` subcommand remains
for management (list, show, prune, status, forget).

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Substring recall heuristic misses paraphrased references | High | Heuristic is one of three pruning signals, not the sole signal. Tunable thresholds. |
| Token budget cuts off a high-value memory at position 11 | Medium | Memories ordered by score before budget applies — top-scored win. Users can raise budget via config. |
| `/memory off` confuses users vs the global config | Medium | `/memory status` shows both layers and which one is currently winning. |
| `mint memory prune --apply` deletes something the user wanted | Medium | Dry-run default; explicit `--apply`; print full list before deleting; the operation is logged so users can see what happened. |
| Recall feedback adds substring-scan overhead per turn | Low | Scan happens once per turn over assistant text + injected memory texts (≤ 10 in practice). Negligible. |

## Open Questions

- Should `mint memory prune --apply` support partial application
  (e.g., `--only-low-confidence`)? Probably yes; defer until users ask.
- Should the recall feedback loop also fire on tool calls (model used a
  memory to decide *which* file to read)? Maybe — needs a different
  heuristic (e.g., memory text mentioning a file the model then read_file'd).
- Should we expose `mint memory cost` as a quick standalone command
  (separate from `mint audit`)? Convenience question; punt to user
  feedback.
