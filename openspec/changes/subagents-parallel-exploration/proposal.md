> **🚧 DRAFT — planned (Wave 2). Not ready to execute.**
> Full spec + tasks land when prioritized. Order in ROADMAP.

## Why

Claude Code spawns subagents for parallel exploration; OpenHands does
parallel research. Mint runs a single loop sequentially. On large tasks
(refactor, multi-file scaffold, investigation) we're 3–5× slower than the
competition because the model serially reads-then-reads-then-reads.

Parallel subagents let the orchestrator dispatch independent reads/searches
in one round-trip, dramatically cutting iteration count on exploratory work.

## What Changes

- Add a `spawnSubagent(task, model?, contextSubset?)` primitive that runs an
  isolated `runHeadless` against a constrained tool set (read-only by default).
- Add a tool `parallel_explore({queries: [string]})` the model can call to
  fan out research questions.
- Aggregate sub-results back into the parent context as a summary block.
- Each subagent's cost rolls into the parent session's `costUsd`; the cap
  applies across all parallel work.
- `mint trace` shows the subagent tree; `mint audit` includes a sub-loop
  count and per-loop cost share.

## Capabilities

### New Capabilities
- `parallel-subagents`: Subagent spawning, isolated tool/context subsets,
  aggregation, trace/audit visibility, cap inheritance.

## Impact

- Affected: `src/brain/loop.ts`, new `src/brain/subagent.ts`, tools-host,
  event types.
- Risk: parallel cost explosion if cap isn't inherited correctly — spec must
  pin this. Subagent timeout to prevent runaway.

## Dependencies / order

- Hard dependency on `multi-axis-token-efficiency` (audit must understand
  sub-loop attribution before this ships).
