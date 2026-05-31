> **🚧 DRAFT — planned (Wave 2). Not ready to execute.**
> Full spec + tasks land when prioritized. Order in ROADMAP.

## Why

Today `src/providers/types.ts` is hand-edited every time a provider ships a
new model. When Sonnet 4.5 or Opus 4.7 drops, we're behind until I update
the file. That breaks the "best in the world" claim — Pi auto-detects
provider model lists.

A model registry that auto-updates means Mint supports new frontier models
within 24 hours, not weeks.

## What Changes

- Option A: Hosted manifest at `https://api.usemint.dev/models.json` with the
  latest model id/pricing/capabilities; mint pulls it on startup with a
  24h cache.
- Option B: Per-provider introspection script (Anthropic exposes `/v1/models`,
  Gemini exposes `models.list`, OpenAI exposes `models.list`) that runs on
  `mint models --refresh` and writes a local override.
- Likely both — manifest as default (no per-user API calls), override as
  power-user escape hatch.
- `MODELS` becomes a function over the merged manifest, not a static
  Record.

## Capabilities

### New Capabilities
- `model-registry`: Hosted manifest + provider introspection + local override.

## Impact

- Affected: `src/providers/types.ts` (becomes loader), all provider files
  that import `MODELS`, new `src/providers/registry.ts`.
- Risk: stale local cache when offline — fall back to bundled defaults;
  document the fallback.

## Dependencies / order

- Independent — can ship any time. Lower priority than wedge work.
