# Changelog

All notable changes to Mint CLI will be documented in this file.

## [0.3.0-beta.5] - 2026-05-12

### 👤 Per-developer cost attribution

The second slice of the enterprise cost wedge. `mint cost-report` now answers “who spent what on AI this month?” — the #1 ask from the first enterprise client.

- **Developer identity** auto-resolved from `$MINT_DEVELOPER` → `git config user.email` → OS username → `unknown`. Cached per-process so we don't shell out repeatedly.
- **`usage.db` schema** gains a `developer` column (idempotent `ALTER TABLE`) plus `idx_usage_developer_ts` index. Old installs upgrade transparently.
- **`mint cost-report --by developer`** — grouped table sorted by spend, showing runs / tokens / cache R-W / hit % / cost / savings per developer.
- **`--by model`** and **`--by day`** — same grouping for cost-by-model and cost-over-time views.
- **`--developer <id>`** — scope the per-session table to a single developer.
- CSV export now includes a `developer` column; the grouped views also export to CSV / JSON.
- **Verified prompt-cache markers via unit test** (`anthropic-caching.test.ts`, 4 assertions). System block + last tool carry `cache_control: ephemeral`; usage chunk carries cache token counts; `MINT_DISABLE_ANTHROPIC_CACHE=1` strips both.

77/77 tests pass (+8 since beta.3). Build 466 KB.

## [0.3.0-beta.4] - 2026-05-12

### 💰 Anthropic prompt caching + per-session cost reporting

The enterprise-cost slice. Multi-turn Claude sessions now reuse cached prompts (system + tool schemas), and a new `mint cost-report` shows where the savings landed.

- **Anthropic prompt caching** — system prompt and the last tool definition are now tagged with `cache_control: { type: 'ephemeral' }` on every request. Repeat turns within ~5 minutes pay ~10% of the fresh input price for the cached portion. Expected ~60–70% reduction in input cost on multi-turn sessions.
- **Real cache stats end-to-end** — `streamAgent()` now yields a final `usage` chunk with `cache_creation_input_tokens` and `cache_read_input_tokens` from `stream.finalMessage()`. The brain loop replaces its old budget-heuristic cost accounting with these authoritative numbers when present.
- **Cost math knows about cache** — `calculateCost()` and `approxCostUsd()` accept a `cacheUsage` parameter and price cache writes at 1.25× fresh, cache reads at 0.10× fresh.
- **`mint cost-report`** — per-session cost breakdown showing fresh vs cached tokens, cache hit %, $ spent, $ saved vs Opus, and the bigger “Opus, no-cache” baseline that captures both routing + caching savings. Supports `--since <days>`, `--limit <n>`, and `--export csv | json`.
- **Schema migration** — `usage.db` gains `cacheReadTokens` and `cacheCreationTokens` columns via non-destructive `ALTER TABLE` (idempotent, safe on existing installs).
- **Escape hatch** — set `MINT_DISABLE_ANTHROPIC_CACHE=1` to opt out of cache markers if Anthropic billing changes.

## [0.3.0-beta.3] - 2026-05-11

### ✨ Live Activity UI

The TUI now feels alive while the agent works — you always know what it is doing and why.

- **Live activity panel** replaces the bland "Thinking\u2026" spinner. Shows the current verb ("Reading", "Editing", "Running command", "Routed to deepseek-v3\u2026"), the target (file path / command / search pattern), and the most recent tool result (✓ read 142 lines / ✗ command failed: …).
- **Routing reasoning is now surfaced** in chat at the start of every turn (`→ Routed to deepseek-v3 (code · medium, 0.87 conf, via llm) — <reasoning>`). No more wondering why your task got a small model.
- **Tool inspector auto-opens while the agent is working** — you no longer need to remember Tab to see what's happening. Tab still toggles it manually.
- **Inspector status glyph** changes from ● to ⋯ for in-flight tools so you can see what's still running vs. done.

## [0.3.0-beta.2] - 2026-05-11

### ✨ New

- **Browser OAuth login** — `mint signup` / `mint login` now open the browser to `https://usemint.dev/auth` and sign in via GitHub or Google (Claude-style). Email/password is still available as `mint signup:password` / `mint login:password`.
- **In-TUI slash commands** — `/model [id|auto]` to list or switch the active model without restarting, `/login`, `/logout`, `/usage` for in-session account control. Old mode toggles (`/auto`, `/diff`, `/plan`, `/yolo`) still work.
- **Monthly free-tier quota** — gateway now resets the 50-request free quota per calendar month (was daily), matching the docs and pricing page.

## [0.3.0-beta.1] - 2026-05-09

### 🚀 Major Architecture Rewrite

**"One Brain, Four Engines Deleted"**

This release represents a complete architectural simplification. We deleted 8,000+ lines of complex orchestration code and replaced it with a single unified "brain" that intelligently routes between cheap and smart models.

### ✨ New Features

#### Free Tier & Quota System
- **50 free requests** for all new users - no credit card required
- `mint quota` - Check your remaining free requests and usage
- `mint account` - Comprehensive dashboard showing plan, usage, API keys, and quick actions
- Real-time quota display in TUI status bar (e.g., "42/50 free")
- Smart warnings at 80% usage with upgrade options
- Graceful handling when quota is exceeded

#### Improved UX
- Better error messages for quota/rate limits with clear next steps
- Status bar now shows quota alongside cost and savings
- Auto-refresh quota after each task
- Clear upgrade paths: Pro plan or bring-your-own API keys

#### New Commands
- `mint quota` - View detailed quota and usage
- `mint account` - Account dashboard with all info in one place
- Enhanced `mint signup` and `mint login` flows

### 🔧 Core Changes

#### Smart Context Engine (DeepSeek V3.2)
- Replaced multi-agent pipeline with single intelligent brain
- Automatic task classification (question, edit, refactor, debug)
- Smart model routing: cheap for simple tasks, powerful for complex
- Hybrid retrieval with BM25 + embeddings (when gateway supports)
- Context-aware file selection

#### Cost Optimization
- Real Opus comparison tracking (no more hardcoded multipliers)
- Typical savings: 95-98% vs Claude Opus
- Most tasks under $0.01
- Transparent cost tracking in every command

### 🐛 Fixes
- Fixed OAuth auth flow for Windows users
- Better browser launch fallback (shows URL if browser fails)
- Improved error handling throughout
- More reliable gateway authentication

### �️ Reliability & Hardening (Phase 2 audit — 44 issues fixed)

**Blockers**
- Approval promise settles on abort/timeout (no demo hangs on Ctrl+C)
- Iteration cap emits `warn` + `success: false` when incomplete
- Gateway 5xx/network errors retry 2× with backoff before surfacing
- Malformed tool calls from providers dropped with `warn`
- Quota warnings deduped (no longer spam after every refresh)
- All gateway fetches now have a 10s timeout via shared `gatewayFetch` helper
- `EACCES` on config save shows a real error instead of being silent
- 120s hard timeout on pending approvals (auto-deny)

**Majors**
- Cost accounting skipped on turn failure (no inflated fake costs)
- Diff-preview failures surface to the approval UI
- Empty-task guard in `runBrain`
- Rejected iterations emit a clear "skipped N tools" warning
- Tab key no longer fights between `InputBox` and `BrainApp`
- Slash-autocomplete list matches reality (no phantom commands)
- Approval prompt wording clarified ("Press y or Enter for yes")
- StatusBar truncates gracefully on narrow terminals (mode/quota/model always visible)
- Resize no longer wipes chat history
- Onboarding handles TTY/Ctrl+C; BYOK completes inline (no dead-end)
- Auth errors distinguish network / 4xx / 5xx
- `mint login` while authed offers account switch
- Quota display validated against NaN, negative, and unknown `plan_type`
- `mint init` caps at 20k files (no OOM on monorepos)
- Init skips symlink loops (`git ls-files` handles it)
- Windows password visible-input fallback with warning
- Compaction + deep-mode fallback emit `warn` events

**Minors & hardening**
- NaN cost guard in `approxCostUsd`
- `apiBaseUrl` URL validation
- Unknown config keys rejected with "did you mean X?" hint
- BYOK key format sanity check (prefix detection)
- Corrupted config file auto-moved aside; CLI keeps working
- Nested `.gitignore` support in glob fallback
- Binary file detection in indexer (no garbage in `context.json`)
- `mint init` re-index confirmation (`--force` to skip)
- Spinner shows elapsed seconds + Ctrl+C hint after 8s
- Windows ASCII logo fallback for legacy terminals
- JWT vs API token tracking with re-login hint
- Quota offline cold-cache (`~/.mint-quota-cache.json`)
- Outcomes DB corruption recovery
- New `mint doctor` command — 7 health checks (Node version, config writable, gateway reachable, auth, indexer, traces dir, BYOK keys)

### �📝 Developer Experience
- Cleaner codebase (deleted: agents/, context/classifier.ts, orchestrator.ts)
- Single entry point: `brain/index.ts`
- Simpler tool system
- Better TypeScript types throughout

### 🔄 Breaking Changes
- Old multi-agent system removed (orchestrator, architect, builder, etc.)
- Environment variable `MINT_BRAIN=1` no longer needed (brain is now default)
- Legacy `mint run` and comparison commands removed

### 📦 Dependencies
- Updated `@anthropic-ai/sdk` to 0.82.0
- Updated `@google/generative-ai` to 0.24.1
- Updated `openai` to 4.67.0

---

## [0.2.0-beta.8] - 2026-05-04

Previous beta with multi-agent architecture (now deprecated).

---

## How to Upgrade

```bash
npm install -g usemint-cli@latest
mint login  # Get your 50 free requests
mint init   # Re-index your project with new smart context
```

## Migration Guide

### From 0.2.x

The brain is now the default and only execution mode. No configuration changes needed.

**Old:**
```bash
MINT_BRAIN=1 mint "add a login form"
```

**New:**
```bash
mint "add a login form"  # Just works!
```

### Quota Management

New users automatically get 50 free requests. After that:

1. **Upgrade to Pro** for unlimited requests
2. **Add your own API keys** (free forever):
   ```bash
   mint config:set providers.deepseek <your-deepseek-key>
   ```

Check your status anytime:
```bash
mint quota    # Quick quota check
mint account  # Full account dashboard
mint usage    # Cost breakdown and savings
```

---

**Full Changelog**: https://github.com/asaferdman23/mint-cli/compare/v0.2.0-beta.8...v0.3.0-beta.1
