# Mint CLI — Future Roadmap (post-0.3.0-beta.3)

Last updated: 2026-05-11.

This document captures the forward-looking plan beyond what's tracked in [ROADMAP.md](./ROADMAP.md) (which covers Phase 3, now shipped).

---

## What's shipped (Phase 3 — `0.3.0-beta.x`)

All 7 priorities in [ROADMAP.md](./ROADMAP.md): one-brain rewrite, replay-based cost regression harness, gateway embeddings, deep mode, trace UI, `mint tune` for weights, docs.

Plus, in this session:

- **0.3.0-beta.2** — browser OAuth (Claude-style); `/model` `/login` `/logout` `/usage` slash commands; monthly free-tier quota (was daily).
- **0.3.0-beta.3** — live activity panel, auto-opening tool inspector, routing-reasoning chat messages.

---

## Immediate (next 1–2 days of agent work)

1. **`npm publish --tag beta`** — only thing blocking real users from `npm i -g usemint-cli@beta`. Mechanism is ready, needs `npm whoami` + final smoke.
2. **Seed cost-regression fixtures** — one `MINT_RECORD=1` session against the deployed gateway populates `test/replay/cost.test.ts` so PRs can never silently raise per-task costs.
3. **Tool inspector "expand a call"** — Tab+Enter on a row to see full input/output JSON; biggest debug win for power users.

---

## Phase 4 — "Make every developer feel the agent is with them" (~2 weeks)

The live-activity work in beta.3 is the foundation. What builds on it:

| Item | Why |
|---|---|
| **Inline streaming reasoning** | Wire `text.delta` into the assistant message bubble *as it arrives* (currently rendered only when `done` fires). Users see the model think word-by-word. |
| **Per-step approval previews** | In `diff` mode, show a unified preview before each `tool.call` that writes — not just `diff.proposed`. |
| **`/inspect <toolCallId>`** | Pop the full input/output of any past tool call for debugging long sessions. |
| **`/cost` and `/savings`** | Inline session cost breakdown by tool/model + Opus-equivalent savings. |
| **Smart resume** | `mint` (no args) inside a directory with a recent session offers "Resume last session?" instead of starting fresh. |

---

## Phase 5 — Reliability/quality (the moat)

Drives the "doesn't break your codebase" promise:

| Item | Why |
|---|---|
| **Pre-commit verification loop** | Auto-run `mint:project.testCommand` before declaring `done`; if tests fail, agent retries with the failure as context. Foundation exists in `tools/run-tests.ts`. |
| **Deep-mode planner caching** | Hash plan steps; replay an identical plan instead of re-classifying. Free perf win on repeated workflows. |
| **Embeddings hybrid retrieval (default-on)** | Currently behind probe + opt-in. Once the gateway has 1k+ users on it without abuse, flip to default-on. |
| **Self-tune cron** | After every N sessions, auto-suggest `mint tune --apply` if confidence > threshold. |
| **`mint review <pr-url>`** | Read-only mode: pull a PR diff, run review prompts, post comments via `gh` CLI. New product surface. |

---

## Phase 6 — Distribution (after publish)

| Item | Why |
|---|---|
| **VS Code extension shim** | Wraps the CLI as a chat participant. Reuses the entire brain — just a UI layer. |
| **GitHub Action** | `usemint/action@v1` for CI workflows: run `mint review` on PRs, `mint test` on flaky test investigation. |
| **Pro tier billing** | Stripe + the gateway already speaks `/auth/quota`; needs `/billing/checkout` + webhook. Server requirements live in [SERVER_REQUIREMENTS.md](./SERVER_REQUIREMENTS.md). |
| **Team plan** | Shared API tokens + per-seat usage dashboard on `landing/`. |
| **Self-host docs** | A bring-your-own-gateway path so enterprise can deploy `mint-gateway` behind their VPN. |

---

## Phase 7 — Differentiation vs. Claude Code / Cursor / Aider

Where Mint pulls ahead:

1. **Cost transparency** — `mint usage`, `mint trace`, real Opus-savings comparison. Nobody else shows per-task cost in the TUI status bar.
2. **Model agnosticism** — `/model` switches between any of 25+ models live. Claude Code is Anthropic-only.
3. **Self-tuning** — `mint tune` actually refits classifier weights from your usage. Unique.
4. **Free tier with no credit card** — 50 monthly requests via the gateway. Aider has none, Cursor needs payment.

---

## Open questions / future bets

These need discussion before committing to a phase.

### Browser-based agent
Once the gateway stabilises, a `usemint.dev/agent` web app could run sessions in-cloud (sandboxed). Big shift but would 10× addressable market.

### Skill marketplace
`skills/mint-code/SKILL.md` already exists; let users publish & install skills like npm packages.

### Headless agents (already exists, needs polish)
`src/brain/headless.ts` is wired; could be product-ised as `mint serve` for remote scripting.
