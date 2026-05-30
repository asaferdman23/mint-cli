```
  ███╗   ███╗██╗███╗   ██╗████████╗     ██████╗██╗     ██╗
  ████╗ ████║██║████╗  ██║╚══██╔══╝    ██╔════╝██║     ██║
  ██╔████╔██║██║██╔██╗ ██║   ██║       ██║     ██║     ██║
  ██║╚██╔╝██║██║██║╚██╗██║   ██║       ██║     ██║     ██║
  ██║ ╚═╝ ██║██║██║ ╚████║   ██║       ╚██████╗███████╗██║
  ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝╚══════╝╚═╝
```

# Mint CLI

> **AI coding assistant that's 98% cheaper than Claude Opus**

One smart brain. Cheap execution. Most tasks under $0.01.

<!-- TODO: Add demo GIF here -->

[![npm version](https://img.shields.io/npm/v/usemint-cli.svg)](https://www.npmjs.com/package/usemint-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```bash
npm i -g usemint-cli
mint signup              # Get 50 free requests (no credit card)
mint init                # Scan your project
mint "add a pricing section with 3 tiers"
```

## Why Mint?

✅ **98% cheaper** than Claude Opus - most tasks under $0.01  
✅ **50 free requests** to start - no credit card required  
✅ **Smart routing** - cheap models for simple tasks, powerful for complex  
✅ **Transparent costs** - see exactly what you spend  
✅ **Own your keys** - BYOK support for all major providers  
✅ **Replay every session** — `mint trace` shows the full event log of any past task

## Reliability — `mint trace`

Every Mint session writes a structured event log to `~/.mint/traces/`. You can:

```bash
mint trace             # list recent sessions, newest first
mint trace <id>        # replay one session as a readable transcript
mint trace --tail      # follow the most recent live session
```

This is the same observability surface the team uses to debug brain runs — there is no hidden state. If a task did something surprising, `mint trace` shows you why: classification, retrieved files, every tool call, every cost delta.

## Safety

Mint can't surprise you with a bill or spin forever:

- **Hard spend cap** — when a session's cost reaches `brain.spendCap` (default **$2**),
  Mint stops and asks before continuing. Set your own ceiling:
  ```bash
  mint config:set brain.spendCap 0.50
  ```
- **Runaway-loop detection** — if the model repeats an identical tool call, Mint halts
  instead of burning tokens in a loop.
- **Approval gates** — every file write, shell command, and network call is reviewable
  before it runs (unless you opt into `/auto`).

## How It Works

Mint's **brain** analyzes your task and intelligently routes between models:

- **Simple edits & questions** → Gemini Flash / Mistral Small (cents-per-million-token tier)
- **Multi-file work & refactors** → Claude Sonnet, planned by Claude Opus when needed
- **Debugging** → Grok fast models
- **Context retrieval** → Hybrid search (BM25 + embeddings)

Mint runs a **US/EU-only model fleet** (Anthropic, Google, OpenAI, xAI, Mistral, Groq) —
no Chinese-origin providers, for enterprise compliance.

You review changes before they're applied. Every cost is tracked, and a hard
[spend cap](#safety) means a task can never silently run up a bill.

```
$ mint "add a pricing section with 3 tiers"

  ● analyzing task...
  ✓ classified: edit
  ● retrieving context...
  ✓ found 3 relevant files
  ● generating changes...
  ✓ created diff

  [Shows diff preview]
  
  Apply changes? (Y/n): y
  
  ✓ Applied to landing/index.html
  
  Cost: $0.0024 · 6s · Saved $0.14 vs Opus
  41/50 free requests remaining
```

## Install

```bash
npm install -g usemint-cli
```

Or run directly:

```bash
npx usemint-cli "fix the auth bug"
```

## Usage

```bash
# First time setup
mint signup               # Get 50 free requests
mint init                 # Scan project and build search index

# Interactive mode
mint                      # Open TUI for multi-turn chat

# One-shot mode
mint "fix the auth bug"   # Single task, then exit
mint "add login form"     # Make changes
mint "what does main.ts do?"  # Ask questions

# Check your usage
mint quota                # See remaining free requests
mint account              # Full account dashboard
mint usage                # Cost breakdown with savings
mint trace                # Browse recent tasks

# Continue & improve
mint resume <session>     # Re-open a past session and keep going
mint tune                 # Suggest routing/classifier weights from your
                          # recorded outcomes (dry-run; --apply to write)
mint audit                # Measure cache hit rate + input tokens/turn
                          # across recent traces — proves the cost story
```

### In the TUI

Type naturally. The orchestrator figures out what to do:

- **Questions** — "what does this function do?" "can you see the landing page?"
- **Edits** — "change the hero title to Ship Code Faster"
- **Features** — "add a contact form with name and email fields"
- **Fixes** — "fix the mobile menu toggle"
- **Multi-turn** — "change the color to blue" → "also make the footer match"

The orchestrator remembers what files it read and what it changed. Follow-up prompts work naturally.

## Pricing

### Free Tier
- **50 requests/month** - Perfect for trying Mint or small projects
- No credit card required
- Full access to all features

### After Free Tier
Two options:

**1. Upgrade to Pro** (coming soon)
- Unlimited requests through Mint Gateway
- Priority support
- Early access to new features

**2. Bring Your Own Keys** (free forever)
```bash
mint config:set providers.gemini <your-key>
```
- Use your own API keys from Google, Anthropic, OpenAI, xAI, Mistral, or Groq
- Real API keys — no subsidized backdoor for a provider to revoke
- Pay only your provider's costs (typically $0.001-0.01 per task)
- No Mint subscription needed

## Cost Comparison

Real examples from actual usage:

| Task | Mint Cost | Opus Cost | Savings |
|------|-----------|-----------|---------|
| Simple text edit | $0.002 | $0.12 | 98% |
| Add new component | $0.008 | $0.45 | 98% |
| Multi-file refactor | $0.015 | $1.20 | 99% |
| Complex debugging | $0.032 | $2.10 | 98% |

**Average: 98% savings vs Claude Opus**

## Supported Providers

### Gateway (Default)
Start with 50 free requests - no API keys needed:
```bash
mint signup   # Create free account
mint login    # Sign in
```

### Bring Your Own Keys
Add your own API keys for unlimited usage:

```bash
# Most cost-effective for everyday tasks
mint config:set providers.gemini <key>      # Gemini Flash/Pro
mint config:set providers.mistral <key>     # Mistral Small (EU)
mint config:set providers.groq <key>        # Fast Llama / gpt-oss inference

# Heavier reasoning
mint config:set providers.anthropic <key>   # Claude Sonnet / Opus
mint config:set providers.openai <key>      # GPT models
mint config:set providers.grok <key>        # xAI Grok
```

Check configuration:
```bash
mint config       # View all settings
mint account      # See which keys are active
```

## Features

### Interactive TUI
- **Vim keybindings** - `i` for INSERT, `Esc` for NORMAL, `Tab` for tools inspector
- **Live status bar** - Shows: model, tokens, cost, quota, savings vs Opus
- **Diff preview** - Review every change before applying
- **Multi-turn chat** - Context-aware conversations about your code

### Smart Context
- **Hybrid search** - BM25 + embeddings for best retrieval
- **Auto file selection** - Brain picks relevant files automatically
- **Project awareness** - Understands your repo structure and conventions

### Cost Tracking
- **Real-time costs** - See exactly what each task costs
- **Savings tracking** - Compare vs Claude Opus in every response
- **Usage dashboard** - `mint usage` shows detailed breakdown
- **Quota management** - Track free tier usage with `mint quota`

## Requirements

- Node.js 20+
- Internet connection

## FAQ

**Q: How does the 50 free requests work?**  
A: Every new signup gets 50 requests per month through Mint Gateway. No credit card. After that, upgrade or add your own API keys.

**Q: What if I run out of free requests?**  
A: Two options: (1) Upgrade to Pro for unlimited gateway access, or (2) Add your own provider API keys - completely free forever.

**Q: Is my code sent to Mint servers?**  
A: When using Mint Gateway, code is sent to our servers then forwarded to the AI provider (Google, Anthropic, etc.). We don't store your code. With BYOK, your code goes directly to your chosen provider.

**Q: Which model should I use?**  
A: The brain auto-selects. Simple tasks go to Gemini Flash or Mistral Small; multi-file work and refactors go to Claude Sonnet (planned by Claude Opus when needed); debugging uses Grok. You can override with `--model`.

**Q: Can I self-host?**  
A: Yes! With BYOK mode, Mint runs entirely locally. The gateway is only needed for the free tier.

## Development

```bash
git clone https://github.com/asaferdman23/mint-cli
cd mint-cli
npm install
npm run build
node dist/cli/index.js
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for upcoming features.

## License

[MIT](LICENSE)

---

**Made with 🤖 by builders, for builders**

[⭐ Star on GitHub](https://github.com/asaferdman23/mint-cli) • [📦 npm Package](https://www.npmjs.com/package/usemint-cli) • [🐛 Report Bug](https://github.com/asaferdman23/mint-cli/issues) • [💡 Request Feature](https://github.com/asaferdman23/mint-cli/issues)
