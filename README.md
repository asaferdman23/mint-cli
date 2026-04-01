# mint

Zero-setup AI coding CLI. Type `mint`, start coding.

No API keys. No accounts. No config.

---

## Install

```bash
npm install -g usemint
```

## Use

```bash
mint
```

That's it. The TUI opens immediately.

---

## How it works

Every message goes to `api.usemint.dev` — a gateway that holds all provider keys and picks the cheapest model capable of handling your task.

```
mint CLI  →  api.usemint.dev  →  Groq / DeepSeek / Grok
```

**3-tier routing — automatic, invisible:**

| Task | Examples | Model | Cost |
|------|----------|-------|------|
| Simple | explain, Q&A, "what is" | Groq llama-3.1-8b | $0.05/$0.08 per 1M |
| Medium | write, fix, refactor, review | DeepSeek v3 | $0.27/$1.10 per 1M |
| Complex | architect, multi-file, agents | Grok-3-mini-fast | $0.60/$4.00 per 1M |
| Fallback | any provider failure | Groq llama-3.3-70b | $0.59/$0.79 per 1M |

Context over 20K tokens automatically bumps to the next tier.

---

## TUI

The interface is minimal by design:

- **Vim mode** — `i` for INSERT, `Esc` for NORMAL. Full motion support (w, b, e, f, t, d, c, y, p, and more)
- **Status bar** — shows current model, token count, and session cost
- **Slash commands** — `/help`, `/clear`, `/model`
- **Ctrl+C** — exit

---

## Observability (for us, not you)

Every request is logged server-side to Postgres and Axiom:

- Which model ran, why, how long it took
- Token counts and actual cost vs. what Claude Sonnet would have cost
- Full session replay via admin API

You don't need to configure anything. This is how we tune the routing.

---

## Commands

```bash
mint                     # open TUI (default)
mint "fix the auth bug"  # one-shot prompt
mint usage               # show savings dashboard
mint savings             # total $ saved vs Claude Opus
mint models              # list available models
```

---

## Requirements

- Node.js 20+
- Internet connection

---

## Development

```bash
git clone https://github.com/asaferdman23/mint-cli
cd mint-cli
npm install
npm run build
node dist/cli/index.js
```

Gateway lives in `packages/gateway/` — deployed to Railway.

---

## License

MIT
