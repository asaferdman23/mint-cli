# Mint CLI — Enterprise Strategy

Last updated: 2026-05-11.

Captures the strategy for the enterprise/cost-tracking wedge identified with the first potential startup client (May 2026). Companion to [FUTURE_ROADMAP.md](./FUTURE_ROADMAP.md).

---

## The wedge

A startup client wants to use Mint to:
1. Track exactly how much each developer spends on AI coding.
2. Reduce the per-developer cost.
3. Use **only enterprise-grade providers** — no DeepSeek, Kimi, Qwen, Moonshot, or other Chinese-hosted models.

This is exactly what Mint's architecture was built for. The trick is delivering enterprise quality at cheap prices via context engineering + caching, not just by switching models.

---

## What can be promised today (no new code)

1. **Per-developer audit trail.** `~/.mint/traces/*.jsonl` + `outcomes.sqlite` log every model call with token-level cost.
2. **Org-wide default model push.** `routing.json` is the single config to swap.
3. **Enterprise providers only.** Anthropic, OpenAI, Google, xAI (US), Mistral (EU), Groq (US). No data crosses to Chinese hosts.
4. **Real Opus-equivalent savings.** Status bar shows "You spent $0.04, would have been $0.31 on Opus" — already shipping in beta.3.

---

## What to build for the client (~1 week of agent work)

### 1. Enterprise routing profile (~30 min)

Drop a `routing.enterprise.json` next to `routing.default.json`. Activated via `MINT_PROFILE=enterprise` or `mint config:set profile enterprise`.

Final draft (no GPT-4o, no Grok-4-beta — both rejected as low value/cost):

```json
{
  "routes": {
    "question":    { "model": "gemini-2-flash",  "fallbacks": ["mistral-small"] },
    "edit_small":  { "model": "claude-sonnet-4", "fallbacks": ["gemini-2-pro"] },
    "edit_multi":  { "model": "claude-sonnet-4", "fallbacks": ["gemini-2-pro"] },
    "refactor":    { "model": "claude-sonnet-4", "fallbacks": ["gemini-2-pro"] },
    "debug":       { "model": "grok-4.1-fast",   "fallbacks": ["claude-sonnet-4"],
                     "providerOptions": { "reasoning": { "enabled": true } } },
    "scaffold":    { "model": "claude-sonnet-4", "fallbacks": ["gemini-2-pro"] },
    "review":      { "model": "claude-sonnet-4", "fallbacks": ["gemini-2-pro"] },
    "explain":     { "model": "gemini-2-flash",  "fallbacks": ["mistral-small"] }
  },
  "complexityOverrides": {
    "complex":  { "model": "claude-opus-4" },
    "moderate": {},
    "simple":   {},
    "trivial":  { "model": "gemini-2-flash" }
  },
  "writeCode":   { "model": "claude-sonnet-4", "fallbacks": ["gemini-2-pro"] },
  "embedding":   { "model": "embedding-small" },
  "classifier":  { "model": "gemini-2-flash", "timeoutMs": 4000 },
  "policy": {
    "allowedProviders": ["anthropic", "google", "xai", "mistral", "groq-us"],
    "denyChineseHosted": true
  }
}
```

### 2. Gateway provider deny-list (~½ day)

Add an `org_policy` table on the gateway. Every request validates the requested provider against the user's org policy before dispatch. Hard error on violation:

> `Provider deepseek is denied by your org policy. Allowed: anthropic, google, xai, mistral, groq-us.`

This is the audit-grade story: even if the CLI is misconfigured, the gateway refuses.

### 3. Team dashboard (~2 days)

Web view at `usemint.dev/team` (extends the existing [landing/](../landing/) Supabase auth):

- Cost per developer this month (top-N spenders).
- Cost per repo (from `cwd` hash).
- Cost per model (where the budget actually goes).
- 30-day trend chart.
- Drill-down to per-task breakdown on click.

Data source: gateway already records per-session `(model, inputTokens, outputTokens, cost)`. Need an `org` concept mapping users to orgs.

### 4. Spend caps + alerts (~½ day)

- Per-developer monthly cap (`MINT_DEV_BUDGET=500`). Soft-warn at 80%, hard-stop at 100%.
- Per-org Slack/email webhook on threshold breach.
- `mint usage --export csv` for finance review.

---

## Quality at cheap price — the four levers

The model is the rifle; context is the aim. Routing alone gets ~3× cost reduction. Combined with the levers below, we get **5–8× reduction with quality equal or better than naive Opus**.

### Lever 1 — Prompt caching (biggest single lever)

Cached tokens cost ~10% of fresh tokens (Anthropic, Google, xAI all support it). For a session with 8k system+context tokens across 20 turns:

- Naive: `8k × 20 × $3/M = $0.48`
- Cached: `8k × $3/M + 8k × 19 × $0.30/M = $0.07`
- **~7× per-session savings, zero quality loss.**

**Status**: Provider abstractions exist (`providers/anthropic.ts`, `gemini.ts`, etc.) but cache-control headers need to be audited and added to system prompts, tool schemas, agentmd, and project rules.

**Build**: ~2 hours per provider. Anthropic first (~70% of enterprise spend will go through Sonnet).

### Lever 2 — Hybrid retrieval (already built, just flip the flag)

Find the 5 *right* files instead of stuffing 50. Quality goes UP because the model isn't drowning; cost goes DOWN because tokens are 10% of what they were.

**Status**:
- Gateway `/v1/embeddings` shipped (B2).
- BM25 indexer in `context/indexer.ts` shipped.
- Hybrid scoring in `context/graph.ts` shipped.
- Currently behind opt-in probe.

**Build**: ~30 min. Make hybrid retrieval default-on for the enterprise profile via routing flag.

### Lever 3 — Tiered context compaction (refactor)

Current `brain/compact.ts` summarizes everything over the threshold. Better strategy:

- **Always preserve**: original task, most recent 5 turns, all `diff.applied` events.
- **Summarize**: tool outputs (file reads/greps), older assistant explanations.
- **Drop entirely**: redundant tool calls (file read 3 times → keep last only).

**Build**: ~½ day. Quality goes UP because the *important* context stays intact.

For enterprise profile, default `compactionTokens: 60000` (more aggressive). Free tier stays at 80000.

### Lever 4 — Tier-aware context budgets (already wired)

`providers/tiers.ts` enforces per-tier context caps:

| Tier | Models | Context | Output |
|---|---|---|---|
| apex | Opus, Sonnet | 180k | 20k |
| smart | Gemini 2 Pro, Grok-4.1 Fast | 60k | 8k |
| fast | Gemini 2 Flash | 20k | 4k |
| ultra | Mistral Small | 8k | 2k |

When the classifier routes a simple Q&A to Flash, the indexer only loads 20k context, not 180k. Free cost win, zero quality loss because the question didn't need 180k anyway.

---

## Enterprise model matrix (no Chinese, no GPT-4o, no Grok-4-beta)

| Model | In/Out $/1M | Coding | Reasoning | Notes |
|---|---|---|---|---|
| **Claude Sonnet 4** | 3.00 / 15.00 | 9 | 9 | Anthropic. Default for code edits. |
| **Claude Opus 4** | 15.00 / 75.00 | 10 | 10 | Reserve for `complexity=complex`. |
| **Gemini 2.0 Pro** | 1.25 / 5.00 | 8 | 9 | 5× cheaper than GPT-4o, equal reasoning, 1M context. |
| **Gemini 2.0 Flash** | 0.10 / 0.40 | 7 | 7 | 25× cheaper than GPT-4o. Q&A + classifier. |
| **Grok 4.1 Fast** (reasoning) | 0.20 / 0.50 | 8 | 9 | Production xAI, built-in reasoning. Debug default. |
| **Mistral Small 4** | 0.15 / 0.60 | 7 | 6 | EU sovereign 🇫🇷. GDPR story. |
| **Llama 3.3 70B (Groq US)** | 0.59 / 0.79 | 8 | 7 | Open-weight, US-hosted. |

Rejected: GPT-4o (overpriced for capability), Grok-4-beta (beta + 15× more expensive than Grok-4.1 Fast).

---

## Per-task cost projection

Combining all four levers + the enterprise routing for an average task (5k input, 2k output):

| Step | What happens | Tokens | Cost |
|---|---|---|---|
| 1. Classifier (Gemini Flash) | "edit_multi, complexity=moderate" | 200 | $0.00002 |
| 2. Hybrid retrieval | 5 relevant files via BM25 + dense | 4k loaded | $0.00 |
| 3. First model turn (Sonnet) | System+context (cached) + task | 4k cached + 1k fresh + 500 out | $0.012 |
| 4. Tool calls (avg 6) | Cache reused, only deltas billed | 6 × 800 fresh + 300 out | $0.038 |
| 5. Final answer | Same cached prefix | 200 fresh + 500 out | $0.008 |
| **Total** | | | **~$0.06** |

vs. naive "throw 50 files at Opus": **~$0.50**. **8× cheaper, equal or better quality.**

---

## Differentiation vs. competitors (enterprise focus)

| Capability | Mint | Cursor | Claude Code | GitHub Copilot |
|---|---|---|---|---|
| Per-task cost in CLI | ✅ | ❌ | ❌ | ❌ |
| Per-developer cost dashboard | ✅ (planned) | ❌ | ❌ | ⚠ (limited) |
| Provider deny-list (no China) | ✅ (planned) | ❌ | N/A | N/A |
| Self-tuning routing weights | ✅ | ❌ | ❌ | ❌ |
| Multi-provider | ✅ (25+) | ⚠ (3) | ❌ (1) | ❌ (1) |
| Audit trail (CSV/JSON export) | ✅ (planned) | ❌ | ❌ | ⚠ (basic) |
| ~$/dev/month at fixed quality | ~$5 | $20 | $50+ | $19 |

---

## What would take longer (don't promise on call 1)

- **SSO (SAML/OIDC)** — gateway uses Supabase. SAML add-on is doable. ~1 week.
- **Self-hosted deployment** — gateway is Hono + Postgres + Supabase Auth; running their own copy in their VPC means swapping Supabase for Auth0/Keycloak. ~2 weeks. Unlocks regulated industries.
- **Zero-data-retention agreements** — paperwork with Anthropic/OpenAI/Google ZDR programs, not code.

---

## Open strategic questions

1. **How many developers?** 5 vs. 500 changes the team-dashboard architecture significantly.
2. **Hosted on Mint gateway or self-hosted?** Self-hosted adds ~2 weeks but unlocks banks, defense, healthcare.
3. **Pricing model**: $20–50/dev/month tier? Per-token markup? Flat infra fee?
4. **Design partner deal**: do they want to be a logo + signature for free/discounted access in exchange for shaping the product?

---

## Implementation order (recommended)

1. **Day 1**:
   - Anthropic cache audit + cache-control headers (~2 hrs).
   - Enterprise routing profile JSON (~30 min).
   - Hybrid retrieval default-on for enterprise profile (~30 min).
2. **Day 2**:
   - Tiered compaction refactor (~½ day).
   - Gateway provider deny-list + `org_policy` table (~½ day).
3. **Day 3–4**: Team dashboard (`usemint.dev/team`).
4. **Day 5**: Spend caps + alerts + CSV export.
5. **Day 6**: `mint cost-report` per-task breakdown command.

Total: ~1 week of focused agent work. Result: enterprise tier with audit trail, deny-list, team dashboard, 5–8× cost reduction vs. Claude Code defaults, all on US/EU providers only.
