# Show HN draft (v2 — frontier-by-default framing)

Post midweek (Tue–Thu), ~8–10am ET. Be present in the thread all day to answer.
The hook is the inversion of the cheap-routing trope: frontier models *can* be
cheap if you cache and retrieve properly — which Claude Code itself just proved
by breaking its own caching.

---

**Title:**

Show HN: Mint — frontier models, used the way Claude Code stopped

**URL:** https://github.com/asaferdman23/mint-cli

**Body (first comment):**

I kept seeing "AI coding CLIs" that ran everything on a cheap model and called
themselves 98% cheaper. The math never held up — cheap models loop more, miss
more, and the engineering time matters more than the per-token price.

Then Claude Code shipped a 40% token-inflation bug caused by broken prompt
caching, and it clicked: the right design isn't "use a worse model." It's
**use the frontier model properly** — cache the static prefix, retrieve only
the files that matter, and let the model one-shot the task.

That's Mint (`npm i -g usemint-cli`). Concretely:

- **Frontier-by-default.** Real code work routes to Claude Sonnet, planned by
  Opus when needed. Cheap models (Gemini Flash, Mistral Small) are reserved
  for pure reads, the classifier, and the cheap review pass.
- **Prompt caching that actually works.** The system prompt is split into
  stable tiers (base → AGENT.md/MINT.md → retrieved files) with
  `cache_control: ephemeral` on each — so after turn 1 the prefix bills at ~10%.
  Tools array gets the same treatment. There's a regression test that pins
  byte-stability of the prefix across turns, exactly to prevent the bug that
  hit Claude Code.
- **Context engineering, not context dumping.** Hybrid BM25 + embedding
  retrieval picks the few files that actually matter — so input tokens per
  turn stay tight instead of 50k-blob dumps.
- **You can verify all of this.** `mint trace` replays any session (classification,
  every tool call, every cost delta). `mint audit` aggregates across recent
  traces and shows cache hit % and input tokens/turn per model — so the cost
  story is data-backed, not vibes.

Safety: every session has a hard spend cap (default $2) that halts and asks
before crossing — and a runaway-loop detector that halts on identical
repeated tool calls. So "frontier model" can't quietly turn into a $47
afternoon.

BYOK with real API keys, or 50 free requests to try it. US/EU-only model fleet
(Anthropic, Google, OpenAI, xAI, Mistral, Groq) — no Chinese-origin providers
for teams with procurement restrictions.

It's beta and rough in spots. I'd genuinely like feedback on:
- The cache-hit numbers from your own `mint audit` after a real session
- Whether the spend-cap UX (halt-and-ask) feels right vs. just hard-stopping

---

## Anticipated questions — answers ready

- **"Isn't this just cheaper-models-with-extra-steps?"** No — Mint defaults to
  Sonnet for real edits. The cost story rests on caching + retrieval, not on
  routing to cheap models. Read `routing.default.json:_routingThesis`.

- **"How is this different from Aider / Cline?"** Aider and Cline are great
  BYOK frontends, but no free tier, no spend cap enforcement, no cache-hit
  observability, and routing is whatever model you point them at. Mint adds
  the enforcement layer + the `audit`/`trace` loop.

- **"Claude Code does prompt caching too — what's actually new?"** It does,
  yes — and they broke it (the recent ~40% token inflation). The difference
  isn't *having* caching, it's having a **test** that pins prefix stability so
  the cache hit doesn't silently regress. See `anthropic-caching.test.ts`.

- **"Quality vs Claude Code on the same task?"** Mint uses the same Sonnet/Opus
  models for real coding. The trace makes it auditable. I'd love side-by-side
  reports from anyone who runs both.

- **"Privacy?"** BYOK → code goes straight to your provider. Gateway free tier
  → forwarded, not stored. Details in `docs/BYOK_AND_COMPLIANCE.md`.

- **"How can the gateway free tier afford frontier models?"** Cache + retrieval
  do most of the work — most tasks land under $0.01. The hard spend cap protects
  the gateway against runaway sessions the same way it protects users.
