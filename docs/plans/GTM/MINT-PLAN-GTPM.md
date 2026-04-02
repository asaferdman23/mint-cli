# Mint CLI — v0.1 Ship Plan
 
## The One Thing That Must Work
 
```
$ mint "fix the auth token refresh bug"
→ Scans project, finds relevant files
→ Plans the fix
→ Writes the code
→ Shows you the diff + cost
→ You approve, changes applied
```
 
That's it. That's v0.1. Everything else is a nice-to-have.
 
---
 
## What Must Work (Non-Negotiable)
 
| # | Feature | Why It's Non-Negotiable | Status |
|---|---|---|---|
| 1 | `mint "task"` runs and returns code changes | This IS the product | ❌ Build |
| 2 | Changes are shown as diffs before applying | Devs won't trust blind file edits | ❌ Build |
| 3 | Cost is shown after every task | This is your marketing differentiator | ✅ Exists partially |
| 4 | It actually works on a real 100+ file project | If it only works on toy projects, nobody cares | ❌ Test |
| 5 | `npm install -g usemint` → `mint` just works | Zero friction onboarding | ✅ Exists |
 
---
 
## What You Do NOT Need for v0.1
 
- ❌ Multi-agent pipeline (Scout → Architect → Builder → Reviewer) — start with 2 phases: Search + Execute
- ❌ Perfect routing across 6 models — start with 2: DeepSeek for hard tasks, Groq for easy ones
- ❌ `mint init` with full codebase indexing — start with simple grep + glob file search
- ❌ Stripe billing — give the first 50 users free access, add billing in week 2
- ❌ Landing page polish — a README with a GIF is enough
- ❌ Reviewer agent — you (the user) are the reviewer in v0.1, you see the diff and approve
- ❌ Undo support
- ❌ Team tier
- ❌ TUI chat mode improvements
 
---
 
## The Fastest Path to v0.1 (5-7 Days)
 
### Day 1-2: File Tools + Simple Context
 
- File read, file write, grep, glob tools
- Given a task: grep the project for relevant keywords
- Load those files into context (cap at 30K tokens)
- Send to DeepSeek V3 with a good system prompt
 
### Day 3-4: Diff Output + Apply
 
- Model returns unified diffs (enforce in system prompt)
- Show colored diffs in terminal (green/red with chalk)
- Ask user "Apply changes? [Y/n]"
- Apply diffs to filesystem
- Show: "Done — Cost: $0.04 (Claude Code estimate: $1.50)"
 
### Day 5: Test on 3 Real Projects
 
- Your own mint-cli repo
- A React app (Next.js or similar)
- A Node.js API
- Fix real bugs. Does it work? Does the cost math hold?
 
### Day 6: Record GIF + Write Launch Post
 
- Record terminal session showing a real task
- Write Reddit post with cost comparison
- Push to npm as v0.1.0
 
### Day 7: Launch
 
- WhatsApp AI agents group
- Reddit r/ClaudeCode + r/ChatGPTCoding
- LinkedIn
- Twitter/X
 
---
 
## The v0.1 User Flow
 
```
$ npm install -g usemint
$ cd my-project
$ mint "fix the login redirect bug after OAuth callback"
 
🔍 Searching project... found 6 relevant files
🧠 Thinking with DeepSeek V3...
 
── src/auth/callback.ts ──────────────────
-  const redirectUrl = req.query.redirect;
+  const redirectUrl = req.query.redirect || '/dashboard';
 
── src/middleware/auth.ts ─────────────────
-  if (!session.token) return res.redirect('/login');
+  if (!session.token) {
+    req.session.returnTo = req.originalUrl;
+    return res.redirect('/login');
+  }
 
💰 Cost: $0.038 | Claude Code estimate: ~$1.50 | Saved 97%
 
Apply changes? [Y/n]
```
 
---
 
## How You Know It's Ready to Ship
 
Ask yourself these 3 questions:
 
1. **Would you use this yourself instead of Claude Code for simple-to-medium tasks?** If yes → ship.
2. **Can you record a 60-second GIF that makes someone say "I want that"?** If yes → ship.
3. **Does it work on at least 2 real projects you didn't build specifically for testing?** If yes → ship.
 
---
 
## First Customers Timeline
 
| Milestone | Users | Timeline | How |
|---|---|---|---|
| First 10 | Week 1 after launch | WhatsApp group + personal network |
| First 100 | Month 1-2 | Reddit + HN + Twitter/X + LinkedIn |
| First 500 | Month 3-4 | Word of mouth + content marketing |
| First 1,000 | Month 5-6 | If retention is good, organic compounds |
 
At 1,000 Pro users = **$10K MRR**.
 
---
 
## Launch Distribution Plan
 
### Week 1 — Warm Network (target: 10-20 users)
 
- WhatsApp AI agents group: "בניתי CLI שנותן תוצאות של Claude Code ב-$10 לחודש. מי רוצה גישה?"
- DM the 5-10 most active people individually
- LinkedIn post with the terminal GIF
 
### Week 2 — Reddit (target: 50-100 users)
 
- `r/ClaudeCode` — "I was spending $200/mo on Claude Code. I built an alternative for $10/mo."
- `r/ChatGPTCoding` — same angle
- `r/programming` — Show HN style with the GIF
- `r/webdev` — focus on React/Next.js use case
- `r/SideProject` — the builder story
 
### Week 3 — Hacker News + Twitter (target: 100-200 users)
 
- Show HN: "Mint CLI – Claude Code results for $10/mo with multi-model routing"
- Twitter/X thread showing real tasks with real costs
- Reply to every viral tweet about Claude Code costs with your demo GIF
 
### Week 4 — Content Engine
 
- Blog post: "How I route between 5 LLMs to save 97% on AI coding"
- Blog post: "DeepSeek V4 vs Claude Opus for coding — real benchmarks"
- Weekly model update posts
 
---
 
## Pain Points You're Solving (Use in Marketing)
 
| Reddit Pain Point | Mint CLI Answer |
|---|---|
| "$200/mo and hit 90% in 3 days" | $10/mo, smart routing to cheap models |
| "21K tokens for a one-word fix" | Complexity classifier — trivial tasks cost $0.005 |
| "Butterfly effect breaks everything" | Show diffs before applying, user approves |
| "AI forgets context between sessions" | Persistent project context |
| "No idea why my bill is so high" | Real-time cost display in status bar |
| "Locked to one expensive model" | Auto-routes across multiple models per task |
| "Managing 5 API keys is exhausting" | Zero setup — one account, one bill |
 
---
 
## The Rule
 
**The GIF is the product.** If the GIF doesn't make someone stop scrolling and say "I want that" — keep iterating until it does. Everything else is noise.
 