```
  ███╗   ███╗██╗███╗   ██╗████████╗     ██████╗██╗     ██╗
  ████╗ ████║██║████╗  ██║╚══██╔══╝    ██╔════╝██║     ██║
  ██╔████╔██║██║██╔██╗ ██║   ██║       ██║     ██║     ██║
  ██║╚██╔╝██║██║██║╚██╗██║   ██║       ██║     ██║     ██║
  ██║ ╚═╝ ██║██║██║ ╚████║   ██║       ╚██████╗███████╗██║
  ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝╚══════╝╚═╝
```

# Mint CLI

AI coding assistant that uses a smart orchestrator + cheap coding models. One command edits your codebase — under a penny per task.

```bash
npm i -g usemint-cli
mint init
mint "add a pricing section with 3 tiers before the footer"
```

## How It Works

One smart model (Grok 4.1 Fast) orchestrates. It searches your files, reads them, understands the problem, then dispatches to a cheap coding model (DeepSeek V3) for the actual edit. You approve before anything touches disk.

```
You: "add a pricing section with 3 tiers"

  ● searching files...
  ✓ files found
  ● reading landing/index.html
  ✓ file read
  ● searching in landing/index.html
  ✓ pattern found
  ● editing landing/index.html
  ✓ file edited

  Added pricing section with Free, Pro ($29/mo), and Enterprise tiers.
  Cost: $0.003 · 8s
```

**Orchestrator** (Grok 4.1 Fast, $0.20/M) — thinks, plans, decides what to do
**Code writer** (DeepSeek V3, $0.28/M) — writes code when needed
**Everything else** — pure code, $0 (file search, read, edit, grep, shell commands)

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
mint init                  # scan project, build search index
mint                       # open interactive TUI
mint "fix the auth bug"    # one-shot — edit and exit
mint "what does main.ts do?"  # ask questions about your code
```

### In the TUI

Type naturally. The orchestrator figures out what to do:

- **Questions** — "what does this function do?" "can you see the landing page?"
- **Edits** — "change the hero title to Ship Code Faster"
- **Features** — "add a contact form with name and email fields"
- **Fixes** — "fix the mobile menu toggle"
- **Multi-turn** — "change the color to blue" → "also make the footer match"

The orchestrator remembers what files it read and what it changed. Follow-up prompts work naturally.

## What It Costs

| Task type | Time | Cost | Opus equivalent |
|-----------|------|------|-----------------|
| Simple edit (change text) | 6s | $0.002 | $0.12 |
| Color scheme change | 13s | $0.005 | $0.23 |
| Add new section | 9s | $0.003 | $0.18 |
| Multi-file feature | 15s | $0.008 | $0.40 |

98% cheaper than running Claude Opus for every task.

## Supported Providers

Mint routes through a gateway by default (no keys needed). You can also bring your own:

| Provider | Config command |
|----------|---------------|
| Gateway (default) | `mint login` |
| DeepSeek | `mint config:set providers.deepseek <key>` |
| Grok (xAI) | `mint config:set providers.grok <key>` |
| Mistral | `mint config:set providers.mistral <key>` |
| Groq | `mint config:set providers.groq <key>` |
| Gemini | `mint config:set providers.gemini <key>` |
| Anthropic | `mint config:set providers.anthropic <key>` |
| Kimi (Moonshot) | `mint config:set providers.kimi <key>` |

## TUI Features

- **Vim keybindings** — `i` for INSERT, `Esc` for NORMAL
- **Status bar** — current model, session cost, monthly spend
- **Step indicators** — see what the orchestrator is doing in real-time
- **Approval gate** — review changes before they're applied

## Requirements

- Node.js 20+
- Internet connection

## Development

```bash
git clone https://github.com/asaferdman23/mint-cli
cd mint-cli
npm install
npm run build
node dist/cli/index.js
```

## License

[MIT](LICENSE)
