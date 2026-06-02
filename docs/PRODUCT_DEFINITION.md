# Mint — Product Definition & The Plugin Test

> Last updated: 2026-06-02. This is the standing filter for what Mint *is* and
> what belongs in the roadmap. Read it before adding any change to
> `openspec/`. If a proposed feature fails **The Plugin Test** below, it is
> table stakes — ship it quietly, never lead with it.

---

## The one-paragraph definition

**Mint is a cross-vendor coding agent where every developer can run the top
frontier model *or* a cheaper one — and the agent (a) routes to the cheapest
model its own outcome data says will succeed for that task type, (b) crushes
token cost on whichever model runs, and (c) gives the org per-developer spend
visibility, caps, and provider policy across all vendors.**

The token engineering — caching, memory, context pinning, prompt slimming,
loop discipline — is **table stakes under the hood**. The *product* is the
cross-vendor **cost-per-success brain** plus **org governance**: the part that
is structurally impossible to ship as a plugin.

We optimize for **cost-per-*successful-task*, not cost-per-call** and not
max-capability. A cheap model that fails, retries, and needs a frontier redo
costs more than starting frontier. Cheapest *path to a correct result* — never
cheapest individual step.

---

## The Plugin Test (the standing filter)

> **Could this feature be a Claude Code plugin, an MCP server, or a single
> CLAUDE.md file? If YES — it is not your moat. Ship it quietly as table
> stakes. Never make it the headline or the identity.**

The law behind the test:

- **Within one vendor's model → plugin-able → mostly already free.**
  Caching, compaction, terseness, retrieval, memory, prompt compression. The
  host tool (Claude Code) does most natively and improves it faster than we
  can. Free plugins already exist (`claude-token-efficient` is *one file*;
  `claude-hud`; LLMLingua; GPTCache).
- **Across vendors, or governing an org → CANNOT be a plugin → requires being
  the harness → this is the product.**

### Apply the test

| Capability | Plugin-able? | Verdict |
|---|---|---|
| Prompt caching / compaction | ✅ native to host | Table stakes |
| Output terseness / token diet | ✅ one CLAUDE.md | Table stakes |
| Prompt compression / semantic cache | ✅ library (LLMLingua, GPTCache) | Table stakes |
| Memory | ✅ MCP / plugin | Table stakes |
| Precise retrieval | ✅ skill / subagent | Table stakes |
| **Cross-vendor routing** (Gemini *or* Opus *or* GPT per task) | ❌ a Claude Code plugin can't make it use Gemini | **MOAT** |
| **Per-developer org spend caps + provider policy across vendors** | ❌ needs a gateway / data-plane | **MOAT** |
| **Cost-per-success learned routing** | ❌ needs to own the loop + model choice + outcome data | **MOAT** |

Anything in the top group is a *feature inside* Mint. Anything in the bottom
group is *why Mint exists*.

---

## Why the labs and the gateways can't take the moat

- **Labs (Anthropic/OpenAI) won't build "spend less on our models"** — their
  revenue is your tokens. Structural conflict. They optimize their harness for
  quality/UX, never for minimizing their own billing.
- **LiteLLM / OpenRouter / Portkey are pipes, not agents.** They route one API
  call. No agent loop, no coding-task taxonomy, no concept of a *succeeded
  task*, no per-developer (human) coding attribution. They can sit *under*
  Mint as transport; they are not competitors *to* Mint. (If a buyer compares
  us to LiteLLM, we've mis-positioned — that's a category error.)
- **Cursor/Copilot are single-stack** and still profit from your spend; their
  admin analytics lock you in rather than cut the bill.

The white space — vendor-neutral, coding-native, cost-per-success + org
governance — is owned by no one and abandoned by the incumbents on purpose.

---

## What we never say

- ❌ "Mint is a router." (The router is a $0 commodity — LiteLLM ships the
  complexity router, budgets, and dashboard, MIT-licensed, free. Calling
  ourselves a router invites the one comparison we lose.)
- ❌ "98% cheaper than Opus." (It compares against a baseline nobody runs —
  `src/providers/router.ts:184` computes savings vs Opus *list price*. A
  cost-conscious buyer recomputes it against their *actual* setup and the
  number collapses. Anchor savings against the customer's own trailing-30-day
  spend instead.)
- ❌ "Old/cheap models perform like frontier." (Untrue, and it bets against
  the labs' core roadmap of making cheap models good.)

## What we do say

- ✅ "The cost-native coding agent: frontier quality, measurably cheaper, with
  the receipts — across every model, with per-developer governance."
- ✅ Savings measured against **the customer's own actual baseline**, live from
  their traces. Auditable, survives procurement.

---

## The build order this implies (keystone first)

Cost-native is unfalsifiable without a **success signal**. Build the referee
before tuning the engine.

1. **Phase 0 — the safe test.** Context + memory + harness levers **on
   frontier**. Proves "frontier quality, X% cheaper" with ~zero quality risk
   (same model = quality held constant). Honest, shippable, generates the
   outcome data later phases learn from.
2. **Phase 1 — the referee (keystone).** The success signal / quality gate
   (even thin: test-pass-rate where tests exist). Without it we optimize
   cost-per-*call* as a blind proxy for cost-per-*success*.
3. **Phase 2 — the moat.** Use the signal + accumulated trace data to learn
   *where it is safe to route down* to cheaper models. The big savings AND the
   defensible moat live here — and are only safe *because* Phase 1 exists.

Frontier-by-default is the correct honest default **until the data earns the
discount.** Route down only where measured success rate says quality holds.

> One contradiction to keep resolved: the repo currently runs two opposite
> bets — `router.ts` v3 "frontier made cheap" and `old-model-scaffolding`
> "cheap made good." Lead with frontier-default; treat scaffolding as an
> experiment, not the moat.

---

## ICP (who feels the pain — set by the strategy session, 2026-06-02)

B2B, decisively. B2C is shielded by flat-rate subscriptions — per-token pain
only exists where someone pays per-token and sees the bill = businesses.
Attack order:

1. **AI-native startups (Seed–B, 20–100 devs)** — beachhead. Burning runway,
   founder-accessible, vocal references.
2. **Mid-market eng orgs (50–500 devs already on AI tools)** — highest WTP,
   board-visible bill, slower access.
3. **Dev agencies / outsourcing** — API cost = COGS, cleanest ROI math, almost
   no competition. Underrated dark horse.
4. **Regulated enterprise** — compliance moat (US/EU-only fleet), 12-mo cycles;
   land via mid-market logos first.
5. **Solo/indie (B2C)** — free PLG funnel only; never monetize.
