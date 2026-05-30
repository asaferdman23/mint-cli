# BYOK & Compliance

How Mint handles model access, API keys, and provider compliance — and why it's
built to stay stable when providers change the rules.

## Real API keys, not a subsidized backdoor

Mint's BYOK (bring-your-own-keys) mode uses **real provider API keys** — your own
keys from Anthropic, Google, OpenAI, xAI, Mistral, or Groq. You pay the provider
directly at their published per-token rates.

This matters because of what happened to subscription-piggybacking tools. When a
third-party client routes through someone's *subscription* (e.g. a `claude -p`
style backdoor) instead of a metered API key, it depends on the provider tolerating
that. Providers don't — Anthropic actively moved to block third-party clients from
riding Claude subscriptions ("OpenClaw"), then restricted the walk-back to their
$100 tier.

Mint has nothing for a provider to revoke. Your key is your account, your billing,
your terms. If a provider changes its consumer subscription policy tomorrow, your
Mint BYOK setup is unaffected.

## US/EU-only model fleet

As of 0.3.0-beta.9, Mint removed all Chinese-origin model providers (DeepSeek,
Kimi/Moonshot, Qwen) for enterprise compliance. The current fleet is US/EU only:

| Provider  | Origin | Used for |
|-----------|--------|----------|
| Anthropic | US     | Claude Sonnet / Opus — multi-file work, planning |
| Google    | US     | Gemini Flash / Pro — simple edits, questions |
| OpenAI    | US     | GPT-4o — fallback |
| xAI       | US     | Grok — debugging |
| Mistral   | FR     | Mistral Small — classification, review |
| Groq      | US     | Llama / gpt-oss — fast inference |

Teams with procurement restrictions on Chinese-origin AI can adopt Mint without an
exception process.

## Where your code goes

- **BYOK mode** — your code goes directly from your machine to the provider whose
  key you configured. Mint's servers are not in the path.
- **Gateway mode** (the free tier) — code is sent to Mint's gateway and forwarded
  to the provider. Mint does not store your code.

## Configure BYOK

```bash
mint config:set providers.gemini <key>      # cheapest everyday tier
mint config:set providers.anthropic <key>   # Claude Sonnet / Opus
mint config:set providers.mistral <key>     # Mistral Small (EU)
mint config:set providers.groq <key>        # fast inference
mint config:set providers.openai <key>      # GPT
mint config:set providers.grok <key>        # xAI Grok
```

Check what's active with `mint account`.
