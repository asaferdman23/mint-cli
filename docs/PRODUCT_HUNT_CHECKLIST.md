# Product Hunt Launch Checklist

## ✅ Client-Side (Completed)

### Core Features
- [x] `mint quota` command - shows remaining free requests
- [x] `mint account` command - comprehensive dashboard
- [x] TUI status bar - displays "X/50 free" quota
- [x] Quota warnings - alerts at 80% usage
- [x] 429 error handling - helpful upgrade/BYOK messages
- [x] Auto-refresh quota after tasks
- [x] Version bump to 0.3.0-beta.1
- [x] CHANGELOG.md created
- [x] README.md polished for Product Hunt

### New Commands
```bash
mint quota      # View quota and usage
mint account    # Account dashboard
mint signup     # Create free account (50 requests)
mint login      # Sign in
```

### UX Improvements
- [x] Real-time quota display in status bar
- [x] Color-coded warnings (green → yellow → red)
- [x] Clear upgrade paths shown when quota exceeded
- [x] Graceful error messages with next steps

---

## 🚧 Server-Side (To Do)

See `docs/SERVER_REQUIREMENTS.md` for detailed implementation guide.

### Must Have
- [ ] Implement `GET /auth/quota` endpoint
- [ ] Add quota enforcement to `/v1/chat` and `/v1/agent`
- [ ] Return 429 errors when quota exceeded
- [ ] Database schema updates (quota fields)
- [ ] Monthly quota reset cron job
- [ ] Basic usage tracking

### Nice to Have
- [ ] Usage analytics dashboard
- [ ] Detailed usage history API
- [ ] Pro plan upgrade page
- [ ] Webhook for quota alerts

---

## 📦 Pre-Launch

### Testing
- [ ] End-to-end test: signup → init → 50 requests → quota exceeded
- [ ] Test quota warnings at 40/50, 45/50, 50/50
- [ ] Test `mint quota` command with real gateway
- [ ] Test `mint account` command displays correctly
- [ ] Test BYOK fallback when quota exceeded
- [ ] Verify TUI status bar updates in real-time
- [ ] Test on Windows, Mac, Linux

### Documentation
- [x] README.md - clear value prop and pricing
- [x] CHANGELOG.md - 0.3.0-beta.1 release notes
- [ ] Demo video/GIF (30-60 seconds)
- [ ] Screenshots for Product Hunt
  - [ ] TUI with quota in status bar
  - [ ] `mint quota` output
  - [ ] `mint account` dashboard
  - [ ] Cost comparison table

### Assets
- [ ] Demo GIF (show: install → signup → task → quota)
- [ ] Hero screenshot for README
- [ ] Product Hunt thumbnail (1270x760)
- [ ] Product Hunt gallery images (4-8 images)
- [ ] Logo/icon (if not already have)

### Copy
- [ ] Product Hunt tagline (max 60 chars)
  - Suggestion: "AI coding CLI that's 98% cheaper than Claude Opus"
- [ ] Product Hunt description (max 260 chars)
  - Suggestion: "Smart AI coding assistant with 50 free requests/month. Type mint, make changes. Most tasks under $0.01. Own your keys or use our gateway."
- [ ] First comment (detailed post from maker)
  - Explain the "one brain" architecture
  - Highlight cost savings
  - Free tier details
  - Call to action

---

## 🚀 Launch Day

### Product Hunt Setup
- [ ] Create Product Hunt listing
- [ ] Upload thumbnail and gallery
- [ ] Add tagline and description
- [ ] Set launch date/time
- [ ] Add relevant topics/tags
  - cli, developer-tools, ai, productivity, open-source
- [ ] Link to GitHub, npm, website

### npm Package
- [ ] Build: `npm run build`
- [ ] Version check: `0.3.0-beta.1`
- [ ] Publish: `npm publish`
- [ ] Verify install: `npm i -g usemint-cli@latest`

### Promotion
- [ ] Post first comment on Product Hunt
- [ ] Tweet announcement with demo GIF
- [ ] Post in relevant Discord/Slack communities
- [ ] Hacker News (Show HN: ...)
- [ ] Reddit (r/programming, r/learnprogramming, r/webdev)
- [ ] Dev.to blog post

### Monitoring
- [ ] Watch Product Hunt comments/questions
- [ ] Monitor signup rate
- [ ] Track quota usage and 429 errors
- [ ] Check npm download stats
- [ ] Watch GitHub stars/issues

---

## 🎯 Success Metrics

### Day 1 Goals
- 100+ upvotes on Product Hunt
- 50+ signups
- 10+ GitHub stars
- Top 5 product of the day

### Week 1 Goals
- 500+ npm installs
- 200+ active users
- 50+ GitHub stars
- 5+ testimonials/feedback

### User Feedback to Track
- Quota system clarity
- Cost transparency
- Onboarding experience
- Feature requests
- Bug reports

---

## 💡 Product Hunt Post Template

### Title
"Mint CLI - AI coding assistant that's 98% cheaper than Claude"

### Tagline
"Smart AI coding CLI with 50 free requests/month. Most tasks under $0.01."

### Description
"Mint is an AI coding assistant that intelligently routes between cheap and powerful models. One smart brain analyzes your task, retrieves relevant code, and generates changes for under a penny.

🎁 50 free requests to start
💰 98% cheaper than Claude Opus  
🔑 BYOK support (free forever)
📊 Transparent cost tracking"

### First Comment (from maker)
```
Hey Product Hunt! 👋

I built Mint because I was tired of paying $0.10-0.20+ per simple code edit with Claude Opus.

The key insight: Most coding tasks don't need GPT-4 or Opus-level intelligence. You just need smart routing.

Mint's "brain" classifies your task:
• Simple edit → DeepSeek V3 ($0.14/M tokens)
• Complex refactor → DeepSeek R1 (reasoning model)
• Context retrieval → Hybrid search (BM25 + embeddings)

Average cost: $0.002-0.01 per task. 98% savings vs Opus.

🆓 Free Tier: 50 requests/month (no credit card)
🔑 BYOK: Use your own API keys (free forever)
📊 Full transparency: See exact cost of every task

Just shipped v0.3.0-beta.1 with:
✅ Quota management (mint quota, mint account)
✅ Real-time cost tracking
✅ Smart warnings before you run out
✅ One-brain architecture (deleted 8k lines!)

Try it:
```bash
npm i -g usemint-cli
mint signup
mint init
mint "add a contact form"
```

Happy to answer any questions! 🚀

GitHub: https://github.com/asaferdman23/mint-cli
npm: https://www.npmjs.com/package/usemint-cli
```

---

## 📝 Follow-up Tasks

After successful launch:

### Week 1
- [ ] Respond to all comments/questions
- [ ] Fix critical bugs
- [ ] Implement most-requested features
- [ ] Write "Week 1 Learnings" blog post

### Week 2-4
- [ ] Launch Pro tier pricing page
- [ ] Add team/organization support
- [ ] Improve demo video based on feedback
- [ ] Start content marketing (tutorials, use cases)

### Month 2+
- [ ] Gateway embeddings endpoint (hybrid retrieval)
- [ ] Deep mode polish (per-subtask execution)
- [ ] TUI reliability features (session resume, diff preview popup)
- [ ] Auto-tune classifier weights (`mint tune`)

---

## ✨ Tips for Launch Day

1. **Be present**: Reply to every comment within 1 hour
2. **Show, don't tell**: Post GIFs/videos, not just text
3. **Be transparent**: Share real costs, architecture decisions
4. **Ask for feedback**: "What would make this more useful for you?"
5. **Celebrate wins**: Share milestones as they happen
6. **Stay humble**: Thank everyone, acknowledge limitations
7. **Follow up**: Post updates throughout the day

---

Good luck with the launch! 🚀
