# Reddit / X post drafts

Rule: lead with help, not promotion. Reply to *existing* threads about Claude Code
cost / alternatives. Only link Mint when it genuinely answers the question, and
disclose that you built it. One promotional self-post max per subreddit.

Target subreddits: r/ChatGPTCoding, r/LocalLLaMA, r/ArtificialIntelligence,
Indie Hackers. Search for live threads: "Claude Code alternative", "Claude Code
too expensive", "AI coding cost".

---

## Reply A — for "Claude Code is too expensive / left the $20 plan" threads

Same boat — the move off the $20 tier is what pushed me to build my own CLI
(Mint, it's on npm, disclosure: I made it). Two things I'd look for in whatever
you switch to:

1. A **hard spend cap** that actually halts mid-task, not just a warning. Most
   tools meter you; very few stop you.
2. **BYOK with real API keys** rather than anything riding a subscription —
   subscription-piggybacking tools keep getting blocked by providers.

If you want metered API pricing, Aider and Cline are solid BYOK options. Happy
to compare notes on routing setups.

---

## Reply B — for "how do you keep AI agents from burning money" threads

The thing that actually fixed this for me wasn't cheaper models — it was
enforcement. Two guards worth adding to whatever you use:

- A per-session cost ceiling that **stops and asks**, so a loop can't run for an
  hour unattended.
- Loop detection — if the agent repeats the same tool call with identical input,
  halt. That's where the surprise bills come from.

I ended up building both into a CLI (Mint — disclosure, mine). But even if you
roll your own wrapper, those two checks save real money.

---

## Reply C — for "Claude Code quality got worse / it's a black box" threads

The part that frustrated me wasn't the quality dip, it was not being able to
*see* what changed. Whatever tool you use, push for one with a real trace — the
ability to replay a session and see classification, file selection, every tool
call, every cost delta. If it degrades you want to prove it, not guess.

(I build a CLI with this — `mint trace` — disclosure. But the principle stands
for any tool: demand observability.)

---

## Self-post draft (Indie Hackers / r/ChatGPTCoding) — use sparingly

**Title:** I built an AI coding CLI that can't surprise you with a bill

**Body:** After one too many "why did that task cost $40" moments, I built Mint —
a terminal coding agent with a hard spend cap (halts and asks at your ceiling),
runaway-loop detection, and a full session replay (`mint trace`). It routes each
task to the cheapest capable model; most tasks land under $0.01. BYOK or 50 free
requests. It's beta and rough — looking for honest feedback, especially on the
routing. Repo: github.com/asaferdman23/mint-cli
