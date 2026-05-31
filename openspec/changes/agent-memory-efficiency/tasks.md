## 1. Memory cost telemetry

- [ ] 1.1 Add `memory.extract` event type to `events.ts` with `{model, inputTokens, outputTokens, usd, memoriesProduced: Record<kind, number>}`
- [ ] 1.2 Wire emission in `src/brain/memory/extract.ts` — wrap the extractor LLM call, capture cost, emit before returning
- [ ] 1.3 Extend `BrainResult` with `memorySection: { extractionCallCount, extractionTotalCostUsd, injectedMemoriesPerTurn, injectedMemoryTokens, recallPrecision }`
- [ ] 1.4 Aggregate the `memorySection` data in `loop.ts` before emitting `done`
- [ ] 1.5 Add the memory section to outcomes.sqlite as JSON column or denormalized fields (decision: keep it on the trace; outcomes only stores cost + counts if needed for tune)

## 2. `mint audit` memory section

- [ ] 2.1 Extend the audit aggregator in `src/cli/commands/audit.ts` to read `memory.extract` events from trace JSONL
- [ ] 2.2 Compute per-model: total extraction cost, share of total session cost, avg memories injected per turn, recall precision
- [ ] 2.3 Render a `Memory` subsection in the audit table (between Models and Read this:)
- [ ] 2.4 Include in `mint audit --json` output (depends on the JSON flag from `multi-axis-token-efficiency` change 2.x)

## 3. Memory injection token budget

- [ ] 3.1 Add `memory.injectionBudgetTokens: z.number().default(1500)` to config schema
- [ ] 3.2 In `src/brain/memory/retriever.ts`, after scoring memories, walk in score order and accumulate token count via `countTokens(memory.text)`; stop when budget exhausted
- [ ] 3.3 Emit budget metrics on the `context.retrieved` event: `memoriesSelectedCount`, `memoriesAvailableCount`, `memoryTokens`
- [ ] 3.4 Add tests: budget caps injection at the threshold; budget=0 falls back to top-K; scoring order respected

## 4. Per-session memory mode

- [ ] 4.1 Add `memoryMode?: 'on' | 'pause' | 'off'` to `RunBrainOptions` (loop.ts) and `HeadlessOptions` (headless.ts)
- [ ] 4.2 Add `--no-memory` CLI flag to the root `mint` command (sets `memoryMode: 'off'`)
- [ ] 4.3 Branch memory extract + retrieve calls in `loop.ts` on `memoryMode`
- [ ] 4.4 Add `/memory off`, `/memory pause`, `/memory on`, `/memory status` to `useSlashCommands.ts`; persist mode on a useState in BrainApp for the session
- [ ] 4.5 `/memory status` SHALL print both the per-session mode and the global config so users see both layers
- [ ] 4.6 Add tests: `--no-memory` skips extract event + zero memories injected; pause skips extract but retrieval still happens; on restores defaults

## 5. Pruning policy + `mint memory prune`

- [ ] 5.1 Add columns to memory.sqlite migration: `usage_count INTEGER DEFAULT 0`, `last_used INTEGER` (epoch ms)
- [ ] 5.2 Add prune-policy config block: `memory.prune.{confidenceMin, maxAgeDays, minUsageCount, usageWindowDays}` with sensible defaults
- [ ] 5.3 Implement `OutcomesStore.findPruneCandidates(policy)` returning rows grouped by reason
- [ ] 5.4 Wait — memories live in `store.ts` not outcomes — implement on `MemoryStore.findPruneCandidates`
- [ ] 5.5 Add `mint memory prune` CLI subcommand with `--dry-run` (default) and `--apply` flags
- [ ] 5.6 Wire `--help` to print the policy rules and config knobs
- [ ] 5.7 Add tests for each rule independently (confidence, age, unused, contradicted) and combined

## 6. Recall feedback loop

- [ ] 6.1 After each turn, in `loop.ts`, scan the assistant text for substring matches against the injected memory texts (≥ 20 chars, case-insensitive)
- [ ] 6.2 For each match, call `MemoryStore.touchUsage(memoryId)` which increments `usage_count` and sets `last_used = now()`
- [ ] 6.3 Compute the turn's `recallPrecision = matchedCount / injectedCount` and roll into the session aggregate
- [ ] 6.4 Add a test with a synthetic turn (known memory text, known assistant output) asserting the increment + precision

## 7. `mint memory show` and `mint memory status` enhancements

- [ ] 7.1 Add `mint memory show <id>` subcommand — looks up by id across user + project stores
- [ ] 7.2 Print structured detail: kind, text, confidence, created_at, last_used, usage_count, source, store path
- [ ] 7.3 Extend `/memory status` in the TUI to include the new per-session mode + injection budget consumption for the current turn
- [ ] 7.4 Verify `redact.containsSecret` is on every write path (extract.ts, `/remember`, `mint memory show` — last one is read, no write but worth a check)

## 8. Privacy hardening

- [ ] 8.1 Audit `extract.ts` to ensure `containsSecret` runs BEFORE the SQLite insert, not after
- [ ] 8.2 Add a test: synthetic turn that includes a fake API key in user input; assert no memory written
- [ ] 8.3 Add `mint memory verify` smoke command that scans the existing store for anything that looks like a secret (one-shot remediation tool)

## 9. Documentation + commit

- [ ] 9.1 Update `README.md` Safety section to mention `--no-memory` and `mint memory prune`
- [ ] 9.2 Update `docs/BYOK_AND_COMPLIANCE.md` with the memory mode + pruning story
- [ ] 9.3 New doc `docs/MEMORY.md` explaining the 4-tier model, when memories are extracted, how to control them
- [ ] 9.4 Bump version, commit, run `openspec validate agent-memory-efficiency`, archive after merge
