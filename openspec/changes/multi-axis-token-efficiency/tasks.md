## 1. Audit expansion — instrumentation foundation

- [ ] 1.1 Extend `cost.delta` event with `toolsArrayTokens` (count + token estimate); update events.ts type + emit site in loop.ts
- [ ] 1.2 Add `retrievedFilesRead` to `tool.result` events for `read_file` tool calls (used for precision calculation)
- [ ] 1.3 Surface compaction events in `mint audit` per-session output (already emitted, just unused)
- [ ] 1.4 Update `outcomes.sqlite` migration: add columns `tools_array_tokens`, `retrieved_files_count`, `retrieved_files_read_count`, `compaction_count`
- [ ] 1.5 Plumb the new fields into `RecordOutcomeInput` and `record()` in outcomes.ts
- [ ] 1.6 Update `mint audit` table renderer to add the new columns; preserve existing layout, drop columns adaptively below 90 cols

## 2. Audit JSON output

- [ ] 2.1 Add `--json` flag to `mint audit` command + `runAudit` signature
- [ ] 2.2 Refactor renderer: separate the data aggregation (pure function) from the table-printing (side effect)
- [ ] 2.3 Add `runAuditJson()` that returns the aggregated object; print to stdout via `console.log(JSON.stringify(...))`
- [ ] 2.4 Add a contract test: feed a synthetic trace dir, assert JSON shape matches a schema

## 3. Tools-array pruning by task kind

- [ ] 3.1 Add `KIND_TOOLS` static map in `src/brain/tools-host.ts`: `Record<TaskKind, string[]>` of allowed tool names
- [ ] 3.2 In `loop.ts`, after the classifier resolves the route, filter `getToolDefinitions()` by `KIND_TOOLS[decision.kind]` before passing to the stream call
- [ ] 3.3 Add shell-intent keyword detector for the `edit_*` kinds (heuristic match list documented in code)
- [ ] 3.4 Add `--all-tools` CLI flag + `brain.toolPruning: boolean` config (default true) override
- [ ] 3.5 Add tests: `question` task only ships read tools; `edit_small` ships writes but not bash; `--all-tools` ships everything
- [ ] 3.6 Document the tool sets per kind in `AGENT.md` so a contributor knows where to look

## 4. Per-session retrieval pinning

- [ ] 4.1 Add a `sessionContextCache: Map<sessionId, RetrieveResult>` to retriever.ts (or pass through Session.set/get)
- [ ] 4.2 Modify `retrieve()` to check the cache first; return pinned result if present and `brain.retrievalPinning !== false`
- [ ] 4.3 Detect broadening keywords in the new turn's task before consulting the cache; bypass + repopulate if matched
- [ ] 4.4 Emit a `context.retrieved` event with `source: 'pinned' | 'fresh'` so audit/trace can show reuse
- [ ] 4.5 Add tests: turn-2 of same session reuses turn-1 result byte-identical; broadening keyword invalidates; config flag opt-out works

## 5. System-prompt slim variant

- [ ] 5.1 Author the slim base prompt in `prompt-tiers.ts` as `BASE_SLIM` — target ≤ 1800 tiktoken cl100k tokens
- [ ] 5.2 Add `brain.systemPromptVariant` to config schema with type `'full' | 'slim'`, default `'full'`
- [ ] 5.3 Branch `buildBase()` on the config value; thread it through `buildPromptTiers`
- [ ] 5.4 Add token-count test: full <= 3200 tokens, slim <= 1800 tokens (locks the budget)
- [ ] 5.5 Add behavior-parity test placeholders (require real model runs — flag as such)
- [ ] 5.6 Document the trade-off in `docs/BYOK_AND_COMPLIANCE.md` or a new `docs/PROMPT_VARIANTS.md`

## 6. Mid-stream cap enforcement

- [ ] 6.1 Add a cost-projection helper in `loop.ts` that, given partial `usage` and the model's price + remaining `max_tokens` budget, returns the projected total session cost
- [ ] 6.2 In the streaming loop in `anthropic.ts`, after each `usage` chunk, call back into a watcher; if projection > spendCap and not approved, fire `abort.abort()`
- [ ] 6.3 The loop's existing abort-handling will catch this; ensure a `warn` event explains "halted mid-stream by spend cap"
- [ ] 6.4 Add a test: mock provider that emits a high-cost early `usage` chunk; assert abort fires before stream completes
- [ ] 6.5 Verify the existing `spend_limit` approval flow plays nicely (one approval covers both between-turn and mid-stream checks)

## 7. Bench expansion + validation

- [ ] 7.1 Update `mint bench` runner to capture the new audit fields per task in its results JSON
- [ ] 7.2 Update the markdown report renderer to show: cache hit %, retrieval precision, tools tokens, output tokens, iterations — per task
- [ ] 7.3 Add a `bench/tasks.json` regression task: a long multi-turn task that exercises retrieval pinning (should show high cache hit % after this change)
- [ ] 7.4 Run the bench end-to-end against the pre-change baseline (capture results.json)
- [ ] 7.5 Run the bench again after this change — compare deltas in the report

## 8. Documentation + commit

- [ ] 8.1 Update `README.md` "How it works" section to mention the multi-axis report
- [ ] 8.2 Update `docs/launch/COMPARISON_BLOG.md` with the multi-axis pitch
- [ ] 8.3 Update `docs/launch/SHOW_HN.md` — title and body refreshed to multi-axis framing
- [ ] 8.4 Update `landing/index.html` — the cost claim shifts from caching-only to multi-axis (one paragraph rewrite + new bullet)
- [ ] 8.5 Bump version to `0.3.0-beta.12`, commit, tag
- [ ] 8.6 Run `openspec validate multi-axis-token-efficiency` and `openspec archive multi-axis-token-efficiency` after merge
