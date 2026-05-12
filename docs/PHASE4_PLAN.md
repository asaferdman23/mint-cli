# Mint CLI — Phase 4 Plan: Enterprise Cost Wedge

Last updated: 2026-05-11. Phase tag: `0.3.0-beta.4` → `0.3.0-rc.1`.

Companion to [FUTURE_ROADMAP.md](./FUTURE_ROADMAP.md) and [ENTERPRISE_STRATEGY.md](./ENTERPRISE_STRATEGY.md). This doc is the **executable plan** for the next ~1 week of agent work, sequenced so each task unlocks the next and the enterprise demo gets stronger every commit.

---

## What just shipped (`0.3.0-beta.4`)

- Anthropic prompt caching (`cache_control: ephemeral` on system + last tool).
- `streamAgent()` emits a final `usage` chunk with cache stats from `stream.finalMessage()`.
- `calculateCost` / `approxCostUsd` price cache writes at 1.25× fresh, reads at 0.10×.
- `BrainResult` + `session.totals` + `usage.db` carry cache tokens end-to-end (idempotent ALTER TABLE).
- `mint cost-report` — per-session breakdown with hit %, $ saved, CSV/JSON export.
- Escape hatch: `MINT_DISABLE_ANTHROPIC_CACHE=1`.

What's **not** verified yet: that markers actually land in real Anthropic requests and produce non-zero `cache_read_input_tokens` on a second run. **P1 fixes that before anything else.**

---

## Phase 4 milestones (in order)

```
P1  Verify caching live          ─┐
P2  Per-developer attribution    ─┼── Demo-ready slice (3-4 hr)
P3  Gateway-side cache logging   ─┘
P4  Audit-grade export
P5  Cache-aware compaction
P6  Provider deny-list policy
P7  Apply caching to Gemini + xAI
```

Each milestone is independently shippable. **P1–P3 = the demo.** P4–P7 = depth for follow-up calls.

---

## P1 — Verify caching works end-to-end (~30 min)

**Status: ✅ shape verified via unit test (2026-05-12)**. 4 new tests in `src/providers/__tests__/anthropic-caching.test.ts` assert cache markers + usage chunk + disable env var. Live-traffic confirmation still pending — see [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).

**Goal**: prove `cache_read_input_tokens > 0` on turn 2 of a real Anthropic session, captured in `usage.db` and surfaced in `mint cost-report`.

### Tasks

1. Run a controlled smoke: `MINT_MODEL=claude-sonnet-4 mint "explain the structure of src/brain"` twice in the same minute.
2. `sqlite3 ~/.mint/usage.db "SELECT model, inputTokens, cacheReadTokens, cacheCreationTokens FROM usage ORDER BY id DESC LIMIT 4;"` — expect turn-2 row(s) with non-zero `cacheReadTokens`.
3. `mint cost-report --since 1` — expect a non-zero **Hit%** column on the second run.

### Acceptance

- Turn 2 shows ≥1 row with `cacheReadTokens > 1000`.
- Overall hit-rate in the report footer ≥ 30% across the two runs.

### If it fails

Most likely causes, in order of probability:
- Tools array empty for the route the classifier picked → `cache_control` lands on nothing. **Fix**: when tools array is empty, attach `cache_control` to the system block only (already true) and add a second cacheable system block for the agent's role text (currently inlined).
- The `system: systemParam as unknown as string` cast quietly dropped the array shape at runtime. **Fix**: log the outbound request shape once behind `DEBUG=mint:anthropic`.
- Session is shorter than the cache minimum (1024 tokens for Sonnet). **Fix**: pick a heavier verification task.

**Deliverable**: short note in `docs/KNOWN_ISSUES.md` capturing what worked + any caveats. No code change if it passes.

---

## P2 — Per-developer attribution (~1.5 hr)

**Goal**: the client's #1 ask — "track per-developer AI spend." Today `usage.db` is per-machine and has no developer field.

### Tasks

1. **Capture developer identity** (`src/usage/tracker.ts`):
   - Resolve order: `$MINT_DEVELOPER` env → `git config user.email` (sync, cached once per process) → `os.userInfo().username` → `"unknown"`.
   - Cache in module-scope `let developerId: string | null = null`.
2. **Schema migration** (`src/usage/db.ts`):
   - Add column `developer TEXT NOT NULL DEFAULT 'unknown'` via the same idempotent `ALTER TABLE` pattern.
   - Index: `CREATE INDEX IF NOT EXISTS idx_usage_developer_ts ON usage(developer, timestamp)`.
3. **Persist on every insert** (`tracker.ts`): include `developer: resolveDeveloper()` in the record.
4. **Group view** (`src/cli/commands/cost-report.ts`):
   - New flag `--by <field>` where field ∈ `developer | model | day | repo`.
   - When grouped: aggregate cost + cache-hit + run count per group, sort by cost desc.
   - Default group view still per-session (current behavior).
5. **`--developer <id>` filter**: scope all output to one developer.

### Acceptance

- `mint cost-report --by developer` shows rows per developer with totals.
- New rows in `usage.db` have a non-null `developer`.
- `tsc --noEmit` clean, all tests pass.

### Demo line

> "Here's last month's AI spend by developer. Alice is at $42 with 67% cache hit; Bob is at $18 with 12% — we can show him the routing options that would close that gap."

---

## P3 — Gateway-side cache logging (~1 hr)

**Goal**: fleet-wide visibility without each dev running `mint cost-report`. The gateway already records per-session `(model, inputTokens, outputTokens, cost)`; extend it with cache columns so the team dashboard ([ENTERPRISE_STRATEGY.md §3](./ENTERPRISE_STRATEGY.md)) can show org-wide hit rate.

### Tasks (in `mint-gateway` repo)

1. Find the usage-log table migration. Add `cache_read_input_tokens BIGINT DEFAULT 0` and `cache_creation_input_tokens BIGINT DEFAULT 0`.
2. In the Anthropic proxy handler, parse the same fields off the upstream response (or pass-through if streaming — read from the `message_delta` event's `usage.cache_*_input_tokens` when present).
3. Persist them on the same INSERT as the existing token counts.
4. Add `/v1/usage/cache-summary?org=<id>&days=30` returning `{ totalCacheRead, totalCacheCreation, hitRate, perModel: [...] }`.

### Acceptance

- New columns populated for at least one real Anthropic-routed request through the deployed gateway.
- `/v1/usage/cache-summary` endpoint returns sensible numbers.

### Not in scope (yet)

The web dashboard at `usemint.dev/team` consumes this endpoint — that's its own Phase 4.5 ticket once the API stabilizes.

---

## P4 — Audit-grade export (~30 min)

**Goal**: enterprises want receipts. Make `mint cost-report --export csv` actually finance-grade.

### Tasks

1. Add columns to the CSV: `timestamp_iso, developer, sessionId, model, provider, tier, task, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, costUSD, opusBaselineUSD, savingsUSD, cacheHitPct, durationMs, exitStatus`.
2. New flag `--audit` → identical to `--export csv` but adds a SHA-256 row-hash column for tamper-evidence (`hash = sha256(prev_hash + canonical_row_json)`, first row's `prev_hash = "GENESIS"`).
3. Document the audit chain in a short README block in `src/cli/commands/cost-report.ts`.

### Acceptance

- `mint cost-report --audit > audit.csv` produces a CSV where every row's hash is verifiable.
- Tampering with any column breaks the chain at that row and every subsequent one.

---

## P5 — Cache-aware compaction (~2-3 hr)

**Goal**: today `brain/compact.ts` rewrites the prompt when context gets long → invalidates the cached prefix → next turn pays fresh price for everything. Big cache wins evaporate exactly on long sessions, which is the case caching matters most.

### Tasks (`src/brain/compact.ts`)

1. Make compaction **stable-prefix-aware**: the system prompt + tool schemas + project rules must never be rewritten, only the message tail.
2. Introduce two zones in the prompt:
   - **Stable zone** (cached): system instructions, tool schemas, agentmd, project rules. Re-emitted byte-identical every turn.
   - **Mutable zone** (not cached): user task + message history. Compactable freely.
3. The Anthropic request currently puts everything into `system` as one block; split into two blocks, both with `cache_control` (so the rewrite of the second block doesn't bust the first).
4. Add test: simulate a 30-turn session; assert the stable prefix is byte-identical across turns 1, 10, and 30.

### Acceptance

- 30-turn session test: stable zone hash unchanged turn-over-turn.
- Manual smoke: 20-turn session shows cache hit rate ≥60% on turn 20.

### Risk

The two-system-block pattern is well-supported by Anthropic but not by every provider — gate the split behind provider capability (`provider.supportsMultipleSystemBlocks === true`) and fall back to single-block for others.

---

## P6 — Provider deny-list policy (~1 hr)

**Goal**: the enterprise client said "no Chinese hosts." Today `routing.json` controls routing but nothing **enforces** the deny-list — a misconfig or env-var override could still hit DeepSeek.

### Tasks

1. New file `src/providers/policy.ts` exporting `enforceProviderPolicy(modelId, policy): void` that throws `ProviderDeniedError` if the model's provider is in `policy.denyProviders` or absent from `policy.allowProviders`.
2. Call it from `src/providers/router.ts` after route resolution, before dispatch.
3. Read policy from `~/.mint/config.json` `policy` field, override-able via `MINT_POLICY_FILE=/path/to/policy.json`.
4. Add `mint policy show` to print the active policy + which providers/models are denied.
5. Provide preset `policies/enterprise-no-china.json` matching the routing profile in [ENTERPRISE_STRATEGY.md](./ENTERPRISE_STRATEGY.md).

### Acceptance

- With `denyChineseHosted: true`, attempting to use `deepseek-v3` errors with a clear message before any network call.
- `mint policy show` prints the active policy.

---

## P7 — Caching for Gemini + xAI (~2 hr each)

**Goal**: Anthropic covers ~70% of enterprise spend; the rest is mostly Gemini (Flash for classifier + Q&A) and xAI (Grok 4.1 Fast for debug). Both providers support caching.

### Tasks

- **Gemini** (`src/providers/gemini.ts`): use `cachedContent` API — different shape than Anthropic. Cache the system instruction + tools. Parse `usageMetadata.cachedContentTokenCount` from response.
- **xAI** (`src/providers/grok.ts`): xAI uses OpenAI-compatible API; cache controls are server-side (xAI auto-caches identical prefixes ≥1024 tokens and reports `cached_tokens` in `usage.prompt_tokens_details`). No request-side changes — just **parse the field** and propagate via the same `usage` chunk mechanism Anthropic uses.

### Acceptance

- A Gemini-routed run shows non-zero `cacheReadTokens` in `usage.db` on turn 2.
- An xAI-routed run shows non-zero `cacheReadTokens` in `usage.db` on a long-enough prompt.

---

## Sequencing & sizing

| # | Task | Effort | Unlocks | Ship-cut |
|---|---|---|---|---|
| P1 | Verify caching live | 30 min | proves beta.4 | hotfix if broken |
| P2 | Per-developer attribution | 1.5 hr | the demo line | `0.3.0-beta.5` |
| P3 | Gateway-side cache logging | 1 hr | team dashboard | gateway deploy |
| P4 | Audit-grade export | 30 min | finance review | `0.3.0-beta.5` |
| P5 | Cache-aware compaction | 2-3 hr | sustained cache wins | `0.3.0-beta.6` |
| P6 | Provider deny-list policy | 1 hr | no-China promise enforced | `0.3.0-beta.6` |
| P7 | Gemini + xAI caching | 4 hr | full-stack caching | `0.3.0-rc.1` |

**Demo-ready cut after P1 + P2 + P3** (~3 hr): per-developer cost report with real cache hit rates, sourced from both local SQLite and the gateway's org-wide view.

**RC-ready cut after P5 + P6** (~7 hr cumulative): all four enterprise asks satisfied — attribution, savings, policy enforcement, sustained efficiency on long sessions.

---

## Cross-cutting risks

1. **Anthropic billing model change** — caching pricing is documented today (10%/125%), could change. Mitigation: `MINT_DISABLE_ANTHROPIC_CACHE=1` ships in beta.4; per-provider cache pricing tables in `src/usage/pricing.ts` should be the single edit point.
2. **`stream.finalMessage()` timing** — if the stream is aborted mid-way, no usage chunk is emitted, the loop falls back to the budget heuristic. Already handled, but means aborted turns under-report fresh tokens. Acceptable for v1.
3. **Schema drift across versions** — every new column uses the idempotent `try { ALTER TABLE } catch {}` pattern. No destructive migrations; old binaries continue to read new DBs because the new columns have defaults.
4. **Per-developer privacy** — `developer = git config user.email` may not be what enterprises want exposed in `usage.db`. Document the `MINT_DEVELOPER` override; consider hashing in P2 if a customer asks.

---

## Out of scope for Phase 4

- Web team dashboard (separate Phase 4.5, blocked on P3).
- SSO / self-hosted gateway (Phase 5+, see [ENTERPRISE_STRATEGY.md](./ENTERPRISE_STRATEGY.md#what-would-take-longer-dont-promise-on-call-1)).
- VS Code extension (Phase 6).
- Provider-side cache invalidation for project-rules edits (open question — should editing `.mintrc` bust the cache? Probably yes; not blocking).

---

## Definition of done for Phase 4

- [ ] P1 verified, note in `KNOWN_ISSUES.md`.
- [ ] `mint cost-report --by developer` works, screenshot in `docs/`.
- [ ] Gateway logs cache tokens, `/v1/usage/cache-summary` returns valid data.
- [ ] `--audit` export passes hash-chain verification by a third script.
- [ ] 20-turn session has ≥60% cache hit rate (P5 ack).
- [ ] `mint policy show` + deny-list enforcement (P6).
- [ ] Gemini + xAI cache tokens land in `usage.db`.
- [ ] 80+ tests pass (current 69 + ~12 new across P2/P5/P6).
- [ ] `0.3.0-rc.1` tagged + CHANGELOG entry + pushed.
