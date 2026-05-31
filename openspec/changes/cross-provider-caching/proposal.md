> **🚧 DRAFT — planned (Wave 2). Not ready to execute.**
> Full spec + tasks land when prioritized. Order in ROADMAP.

## Why

Today Mint's caching story is Anthropic-only — `cache_control` markers
work on Sonnet/Opus and nowhere else. Users on GPT-4o or Gemini get the
model but not the caching savings story.

Critically:
- **OpenAI has automatic implicit prefix caching** at 50% discount on
  repeated prefixes > 1024 tokens. We just don't read or report the
  `cached_tokens` field from the response. **One-day fix** to make Mint's
  cost story honest for OpenAI users.
- **Gemini has cached-context API** — different model (you create a
  cached content object, then reference it). Implementation is more work
  (2-3 days) but unlocks Gemini Pro as a real caching alternative.

Without this, the "Sonnet-only because that's where caching lives"
critique that came up in earlier strategy review stays valid forever.

## What Changes

- **OpenAI**: read `usage.prompt_tokens_details.cached_tokens` from chat
  completion responses; emit on the existing `cost.delta` event as
  `cacheReadInputTokens`. No request-side changes needed — caching is
  automatic.
- **Gemini**: implement `cachedContents.create()` at session start (or on
  first turn of a sticky session); reference via `cachedContent` in
  subsequent calls; emit cache usage similarly.
- `mint audit` table SHALL show non-Anthropic cache stats correctly
  (no special case in renderer — just the `cacheRead`/`cacheWrite`
  fields).

## Capabilities

### New Capabilities
- `multi-provider-caching`: OpenAI implicit observability + Gemini explicit
  caching implementation.

### Modified Capabilities
- `token-efficiency` (if it ships first): the audit's "cache hit %" column
  becomes meaningful for non-Anthropic users.

## Impact

- Affected: `src/providers/openai.ts`, `src/providers/openai-agent-format.ts`,
  `src/providers/gemini.ts`, `src/cli/commands/audit.ts` (already model-agnostic).
- Risk: Gemini cached-content API has lifecycle (TTL, max size) — design
  for retirement of stale cached contexts.

## Dependencies / order

- Should land after `multi-axis-token-efficiency` so the audit infra is
  already there to surface the new numbers.
