# Distribution plan (Phase 2) — founder-executed

The product hardening (Phase 0) and positioning assets (Phase 1) are done. This
phase is the part only you can run — posting, replying, and spending the ad
budget. Pace it across 2–3 weeks; ~10–15h/week.

## Pre-flight (before any posting)

- [ ] Fresh-machine smoke test: `npm i -g usemint-cli` → `mint signup` →
      `mint init` → a real task → review diff → `mint trace`. Zero crashes.
- [ ] Confirm the spend cap halts a deliberately long task, and the loop detector
      halts a repeating one.
- [ ] Landing page deployed with the new hero + `#claude-code` section + the
      corrected features. (`landing/index.html` is the live page.)
- [ ] `/claude-code-alternative` blog post published (see COMPARISON_BLOG.md).

## Week 1 — Show HN

- [ ] Post the Show HN (see SHOW_HN.md). Tue–Thu, ~8–10am ET.
- [ ] Block the day to answer every comment within ~30 min.
- [ ] Lead replies with the spend-cap + trace story; never argue, always thank.
- [ ] Capture every piece of feedback into the issue tracker.

## Week 1–2 — Reddit / Indie Hackers

- [ ] Search r/ChatGPTCoding, r/LocalLLaMA, Indie Hackers for live "Claude Code
      alternative / too expensive / burning money" threads.
- [ ] Reply with genuine help (see REDDIT_POSTS.md). Disclose you built Mint.
- [ ] One self-post max per subreddit, and only after a few helpful replies.

## Week 2+ — SEO + paid test

- [ ] Make sure the blog post is indexed; cross-link landing ⇄ post ⇄ repo.
- [ ] Once the landing page shows a real install conversion rate, run the small
      ad budget on high-intent search terms only ("claude code alternative",
      "cheaper than claude code"). Kill any campaign where CAC > ~1 month of
      revenue.
- [ ] Publish a real `mint trace` transcript of a non-trivial task as living
      proof of the observability claim.

## Metrics to watch

- landing → install
- install → first successful task
- free-50 → paid conversion
- weekly retention

## Gates

- Don't start Week 1 until the pre-flight checklist is fully green.
- Don't spend ad budget until organic shows the landing page converts.
- $10k/mo target: ~350 users at $29 or ~1,100 at $9 — push pricing toward the
  higher tier; the spend-cap + learned-routing story supports it.
