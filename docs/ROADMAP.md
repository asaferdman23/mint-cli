# Mint CLI — Near-future roadmap

Updated: 2026-05-04. Post brain-rewrite. See `.claude/plans/lets-plan-one-architectual-ticklish-tower.md` for the architecture plan this replaces.

What's left, in priority order.

---

## 🎯 Priority 1 — Ship it (1–2 days)

**Release beta 9.**

- Bump `package.json` to `0.3.0-beta.1` (major version bump signals the architecture rewrite).
- Write a concise CHANGELOG with the "one brain, four engines deleted" pitch.
- Update README examples — show `mint trace` prominently as the reliability feature.
- Smoke-test from an empty project end to end: `mint init`, real LLM call, `mint trace`, `mint usage`.

**Why first:** users stuck on beta 8 are running legacy code. Every day they don't upgrade is a day we're not seeing real-world brain traces come back.

---

## 🎯 Priority 2 — Cost regression suite (2 days)

Record/replay real tasks to guard against cost regressions as we iterate on the classifier/routing.

- Add `MINT_RECORD=1` to `streamAgent` — captures the full request/response stream to JSONL under `test/fixtures/recordings/<task-hash>.jsonl`.
- `test/replay/cost.test.ts` — re-runs 10–20 recorded tasks with the provider mocked to replay from the fixture. Asserts `brain.cost ≤ 1.10 × recorded.cost`.
- Wire into CI (GitHub Actions already configured? verify).

**Why:** we just deleted the comparison baseline. The moment someone tweaks the routing table, we need a safety net or we'll silently 2× prod costs.

---

## 🎯 Priority 3 — Gateway embeddings endpoint (1 day in `mint-gateway`)

The brain auto-probes `/v1/embeddings` — if it appears, hybrid retrieval switches on without a client release. Pure gateway-side work.

- `mint-gateway/src/routes/embeddings.ts` — proxy to Gemini's `embedContent` (`text-embedding-004`, free tier covers typical usage) or OpenAI `text-embedding-3-small` as fallback.
- Cache embeddings in gateway Postgres by content hash (same as recordings) so repeat calls are free.

**Why:** retrieval quality is the #1 lever for brain quality. Going from BM25 to BM25 + dense is typically a 15–25% relevance lift with zero code changes on the client.

---

## 🎯 Priority 4 — Deep mode polish (1 day)

Deep mode today runs the planner and injects the subtask list into the system prompt. The plan called for full per-subtask mini-sessions.

- `executeSubtask()` actually runs a focused tool loop per plan step instead of no-op.
- Each step emits its own `phase:build` event with the step id.
- `mint trace` gains a plan→build hierarchy.

**Why:** genuine complex refactors (>10 files) will benefit; the brain's single loop can hit its 40-iteration cap.

---

## 🎯 Priority 5 — TUI reliability polish (2 days)

Based on the trace UI work but for the live session.

- `/trace` slash command inside `BrainApp` — shows the current session's live event list.
- Diff preview popup when the brain proposes a write in `diff` mode — show the actual unified diff before approval, not just the filename.
- Session resume — `mint resume <sessionId>` re-opens a session's trace and continues where it left off (works because `outcomes.sqlite` + `traces/*.jsonl` have enough context).
- Cost budget warning — if `cost.delta` pushes session > $0.50 (configurable), prompt "continue? this is getting expensive".

---

## 🎯 Priority 6 — `mint tune` for weights (1 day)

The fallback classifier's weights live in `routing.default.json`. We track every outcome. Close the loop.

- `mint tune` reads `.mint/outcomes.sqlite`, fits new `classifier.weights` via simple least-squares over the last 200 successful runs, writes the result to `.mint/routing.json`.
- Proposes route changes: if `edit_multi` tasks with `kimi-k2` had 80% success but `deepseek-v3` had 95%, suggest swapping the route.

**Why:** this is what "real classifier with memory" means in practice. Outcomes go in → routing improves automatically.

---

## 🎯 Priority 7 — Docs + marketing (ongoing)

- README screenshot of `mint trace` — the reliability story is the sell.
- Blog post: "Why we deleted 8k lines to ship one brain".
- Record a 30-second demo for the landing page.
