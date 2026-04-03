```
  ███╗   ███╗██╗███╗   ██╗████████╗     ██████╗██╗     ██╗
  ████╗ ████║██║████╗  ██║╚══██╔══╝    ██╔════╝██║     ██║
  ██╔████╔██║██║██╔██╗ ██║   ██║       ██║     ██║     ██║
  ██║╚██╔╝██║██║██║╚██╗██║   ██║       ██║     ██║     ██║
  ██║ ╚═╝ ██║██║██║ ╚████║   ██║       ╚██████╗███████╗██║
  ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝╚══════╝╚═╝
```

# Mint CLI

Zero-setup AI coding assistant in your terminal. Type `mint`, start coding.

No API keys. No accounts. No config files.

```bash
npx usemint-cli
```

## Install

```bash
npm install -g usemint-cli
```

Or run directly without installing:

```bash
npx usemint-cli
```

## Usage

```bash
mint                       # open the interactive TUI
mint "fix the auth bug"    # one-shot prompt — get an answer and exit
mint usage                 # show session stats and savings
mint models                # list available models
```

## How It Works

Every message routes through a smart gateway that picks the cheapest model capable of handling your task — automatically.

```
mint CLI  →  gateway  →  best model for the job
```

**3-tier routing (automatic, invisible):**

| Complexity | Examples | Model | Cost per 1M tokens |
|------------|----------|-------|---------------------|
| Simple | explain, Q&A | Groq Llama 3.1 8B | $0.05 / $0.08 |
| Medium | write, fix, refactor | DeepSeek V3 | $0.27 / $1.10 |
| Complex | architect, multi-file | Grok 3 Mini | $0.60 / $4.00 |

Context over 20K tokens automatically bumps to the next tier. If a provider fails, it falls back to the next one.

## Supported Providers

Mint works out of the box via the gateway (no keys needed). You can also bring your own API keys:

| Provider | Models | Env Variable |
|----------|--------|-------------|
| Gateway (default) | Auto-routed | None required |
| Anthropic | Claude Sonnet, Haiku | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-4o, GPT-4o-mini | `OPENAI_API_KEY` |
| Google | Gemini Pro, Flash | `GEMINI_API_KEY` |
| DeepSeek | DeepSeek V3, R1 | `DEEPSEEK_API_KEY` |
| Groq | Llama 3.x | `GROQ_API_KEY` |
| Grok (xAI) | Grok 3 | `GROK_API_KEY` |
| Mistral | Mistral Large, Small | `MISTRAL_API_KEY` |

## TUI Features

- **Vim keybindings** — `i` for INSERT, `Esc` for NORMAL, full motion support (`w`, `b`, `e`, `f`, `d`, `c`, `y`, `p`)
- **Status bar** — current model, token count, session cost
- **Slash commands** — `/help`, `/clear`, `/model`
- **Ctrl+C** — exit

## Security

- **No keys stored in code** — all credentials are read from environment variables or local config at runtime
- **Gateway mode** requires no API keys on your machine — keys live server-side
- **Local config** is stored in your OS config directory (via [conf](https://github.com/sindresorhus/conf)) and never committed to git
- `.env`, `.mint/`, and `.claude/` are gitignored by default

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

## Contributing

1. Fork the repo
2. Create your feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

Please open an issue first for major changes so we can discuss the approach.

## License

[MIT](LICENSE)
