# Mint CLI — Near-future roadmap

Updated: 2026-05-10. Phase 3 in progress — P1, P4, P5 shipped (Plan A); P2 (replay harness), P3 (gateway embeddings), P6 (tune + weight refit) shipped (Plan B). P7 (docs) is this update.

What's left, in priority order. Status legend: ✅ shipped, 🟡 partial, ⏳ pending.

---

## ✅ Priority 1 — Ship it

**Released as 0.3.0-beta.1.**

- ✅ `package.json` bumped to `0.3.0-beta.1`.
- ✅ CHANGELOG.md with the "one brain, four engines deleted" pitch.
- ✅ README updated; `mint trace` is the headline reliability feature.
- ✅ Smoke-tested end-to-end: `mint init` → real LLM call → `mint trace` → `mint usage`.

Remaining: actual `npm publish --tag beta` to pull users off beta 8.

---

## ✅ Priority 2 — Cost regression suite

Record/replay harness landed in `src/providers/record-replay.ts` + `src/providers/__tests__/record-replay.test.ts` (6 tests, all green).

- ✅ `MINT_RECORD=1` and `MINT_REPLAY=<dir>` env vars hook into the provider layer; SHA-256 keying over (model + system + messages + tools).
- ✅ `npm run test:replay` script seeds `MINT_REPLAY` and runs the test bucket.
- ⏳ Live cost regression test (`test/replay/cost.test.ts`) — needs a real `MINT_RECORD=1` session against the deployed gateway to seed 10–20 fixtures. Mechanism is ready; just needs a one-off recording pass.

---

## ✅ Priority 3 — Gateway embeddings endpoint

Shipped in `mint-gateway` commits `eb6f68c` (route + provider + cache schema) and `f246f91` (in-process integration smoke). Auto-deployed via Railway on push.

- ✅ `POST /v1/embeddings` (OpenAI-compatible request/response shape).
- ✅ `OPTIONS /v1/embeddings` for the mint-cli auto-probe (returns 401 unauth / 204 auth — both treated as "available" by `probeEmbeddings`).
- ✅ Provider order: Gemini `text-embedding-004` (primary, free tier covers typical usage) → OpenAI `text-embedding-3-small` (fallback on Gemini failure when both keys configured).
- ✅ `embeddings_cache` table: `(hash PK, model, vector double precision[], dim, last_used_at)`. Cache key is `sha256(model + ':' + text)` so swapping default providers does not poison cached vectors.
- ✅ Quota: 1 billable request per call regardless of batch size; tokens flow into `user_quota.tokens_used`.

Pending operationally: set `GEMINI_API` env var on Railway before users hit the endpoint.

---

## ✅ Priority 4 — Deep mode polish

- ✅ `executeSubtask()` runs a focused tool loop per plan step (was previously a no-op).
- ✅ Each step emits `phase:build` events with a `stepId` so traces show plan→build hierarchy.
- ✅ `mint trace` renders step ids on phase events; tested in `src/brain/__tests__/deep-mode.test.ts`.

---

## ✅ Priority 5 — TUI reliability polish

- ✅ `/trace` slash command inside `BrainApp` shows the live event list.
- ✅ Diff preview popup when the brain proposes a write in diff mode (renders the unified diff, not just the filename).
- ✅ `mint resume <sessionId>` re-opens a session's trace and continues where it left off; backed by the existing `outcomes.sqlite` + `traces/*.jsonl`.
- ✅ Cost budget warning — `cost.delta` past `brain.sessionBudgetUsd` (default $0.50, configurable) prompts before continuing. Warning fires at most once per session via `budgetWarnedRef`.

---

## ✅ Priority 6 — `mint tune` for weights

Shipped as `mint tune` + `mint tune --apply`.

- ✅ Reads `.mint/outcomes.sqlite`; aggregates per-(kind, model) success rate, avg cost, avg iterations.
- ✅ Proposes route swaps when an alternative model has ≥10pp success-rate lift over the current default with ≥30 samples (configurable via `--min-samples`).
- ✅ Refits the 6 fallback-classifier weights via ridge least-squares (λ=0.5, Gauss-Jordan with partial pivoting) against recorded `classifierFeatures` vectors. Targets are derived by inverting `sigmoid(4·w·x)` on a complexity-band score with iteration-based correction. Proposals are blended (`α = min(0.7, n/100)`) with current weights for stability on small datasets.
- ✅ `--apply` writes `routes` + `classifier.weights` to `.mint/routing.json`; merges with any existing override.
- ✅ `outcomes.sqlite` gained a `classifier_features TEXT` column via non-destructive `ALTER TABLE`; written on every brain session via `extractClassifierFeatures(features)`.
- ✅ 2 tests cover the <20-row guard and the RMSE-improvement invariant on synthetic data.

---

## 🟡 Priority 7 — Docs + marketing

- ✅ ROADMAP status (this update).
- ✅ PRODUCT_HUNT_CHECKLIST refreshed with current state.
- ✅ README screenshot of `mint trace` — reliability is the sell.
- ⏳ Blog post: "Why we deleted 8k lines to ship one brain".
- ⏳ 30-second demo recording for the landing page.

---

## What's after this?

1. `npm publish --tag beta` for `0.3.0-beta.1` (mechanism ready; needs a `npm whoami` + final smoke).
2. Seed the cost-regression fixture corpus (one live `MINT_RECORD=1` run against the deployed gateway).
3. `embeddings_cache` LRU cleanup job — schema has `last_used_at`; no cron yet. Not urgent until cache size becomes a problem.
4. Per-task daily token cap on `/v1/embeddings` if we see abuse — current limit is the existing per-user monthly quota only.

