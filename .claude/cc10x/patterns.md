# Project Patterns
<!-- CC10X MEMORY CONTRACT: Do not rename headings. Used as Edit anchors. -->

## Architecture Patterns
- Provider pattern: `Provider` interface in `types.ts`, registered in `providers/index.ts` Map, resolved by `MODELS[modelId].provider`
- All OpenAI-compatible providers extend `OpenAICompatibleProvider` base class (config-driven)
- Gemini uses its own class (`GeminiProvider`) due to Google SDK incompatibility
- Context tier system: `tiers.ts` is the source of truth, imported by both provider and context modules
- Agent loop: generator pattern (`async function*`) in `loop.ts`, orchestrated by `runAgent()` in `index.ts`
- Tool execution: single chokepoint at `executeTool()` in `tools.ts` — all mode checks live here

## Code Conventions
- ESM: ALL imports use `.js` extension (e.g., `import { x } from './file.js'`)
- Config access: `config.get('providers') as Record<string, string> | undefined` then `?.['keyName']`
- Provider registration: add to Map in `src/providers/index.ts` — `['providerId', providerInstance]`
- streamAgent for non-Anthropic providers: method on class directly, no cast needed
- streamAgent for Anthropic: uses `as Provider & { streamAgent? }` cast in `providers/index.ts`
- Path safety: use `assertInCwd()` from tools.ts for any file path in tools

## File Structure
- Provider: `src/providers/{name}.ts` — class + exported singleton instance
- Context module: `src/context/{purpose}.ts` — pure functions or stateless exports
- TUI component: `src/tui/components/{Name}.tsx` — React functional component
- TUI hook: `src/tui/hooks/use{Name}.ts` — React hook returning state + callbacks
- CLI command: `src/cli/commands/{name}.ts` — exported async function(s)

## Testing Patterns
- Build smoke test: `npm run build && npm run typecheck` after each task
- Manual test pattern: document exact command + expected output in plan steps

## Common Gotchas
- ESM .js extensions: TypeScript resolves .ts at compile time, Node requires .js at runtime — ALWAYS add .js in imports
- `config.get()` returns `unknown` — cast aggressively before property access
- Ink `flexGrow` on right panel: MUST set explicit width, hide when `process.stdout.columns < 80`
- `--diff` mode interactive readline conflicts with Ink render — keep diff mode as stdout (non-TUI) only
- ModelId vs API model string: NEVER use ModelId directly as the API request model string — always go through `modelMap`
- Tool result messages have role `'tool'` — must be handled separately from `'assistant'` in all provider message builders
- JSX in `.ts` files: tsup/esbuild fails — use `.tsx` extension for any file with JSX even if not a component (e.g. Ink render functions)
- `better-sqlite3` bundled types: none — must install `@types/better-sqlite3` as devDep
- tsup single-bundle: all source compiles to `dist/cli/index.js` — no per-module dist files exist

## API Patterns
- Provider complete/stream methods all accept `CompletionRequest` from `types.ts`
- Tool definitions use `input_schema` (snake_case) to match Anthropic format — OpenAI providers convert to `parameters`
- AgentStreamChunk: `{ type: 'text' | 'tool_call' | 'tool_result', ...fields }` — all providers yield this shape

## Error Handling
- Provider client lazy-init: throw descriptive error with `axon config:set` instruction when API key missing
- Tool execution errors: `ToolResult.isError = true`, content is the error message (never throw)
- Agent loop error: yield `{ type: 'error', error: message }` then return (don't throw)

## Dependencies
- `openai` (^4.67.0): Used for DeepSeek + all OpenAI-compatible providers (Kimi, Grok, Groq, Qwen)
- `@anthropic-ai/sdk` (^0.80.0): Used only for Anthropic provider
- `@google/generative-ai`: Used only for Gemini provider (install separately)
- `ink` (^5.0.1) + `react` (^18.3.1): TUI rendering
- `diff` (^7.0.0): Unified diff for --diff mode (`createTwoFilesPatch`)
- `glob` (^11.0.0) + `ignore` (^6.0.2): File discovery in context pack
- `tiktoken` (^1.0.16): Accurate token counting (available but use char/4 estimate for speed)
- `conf` (^13.0.1): Key-value config store (`config.get/set`)
