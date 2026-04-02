# Active Context
<!-- CC10X: Do not rename headings. Used as Edit anchors. -->

## Current Focus
Specialist builder system + skills system built and verified.

## Recent Changes
- [2026-04-01] Built specialist builder system: 7 specialist configs (frontend/backend/database/testing/devops/docs/general) in src/agents/specialists/
- [2026-04-01] Built skills system: src/context/skills.ts — loadSkills + getSkillsForSpecialist with YAML frontmatter parsing
- [2026-04-01] Updated Subtask type with specialist field, architect parses/detects specialist, builder uses specialist prompt + skills
- [2026-04-01] Added `mint skills` CLI command, updated `mint init` to generate starter skills in .mint/skills/
- [2026-04-01] Test: src/agents/__tests__/specialists-skills.test.ts — RED exit=1, GREEN exit=0
- [2026-04-01] Built real multi-agent pipeline in src/agents/ — parallel builders, retry loop, JSON-structured arch output
- [2026-04-01] Added Subtask, SubtaskBuilderResult types to agents/types.ts
- [2026-04-01] Updated ArchitectOutput to type='single'|'split' with JSON parsing (parseArchitectResponse exported)
- [2026-04-01] Updated ReviewerOutput with subtaskFeedback + parseReviewerResponseFull exported for testing
- [2026-04-01] Added BuilderOptions interface with isolated flag (skips history + project tree in subtask mode)
- [2026-04-01] Rewrote agents/index.ts — parallel builders via Promise.all, max-2 retry loop with subtask targeting
- [2026-04-01] Test: src/agents/__tests__/agents-pipeline.test.ts — RED exit=1, GREEN exit=0
- [2026-03-30] Task 28: Created src/usage/db.ts (UsageDb, better-sqlite3)
- [2026-03-30] Task 28: Created src/usage/tracker.ts (calculateOpusCost, createUsageTracker)
- [2026-03-30] Task 28: Created src/usage/dashboard.tsx (Ink TUI dashboard)
- [2026-03-30] Task 28: Extended src/providers/router.ts (selectModelWithReason, classifyTask, RoutingDecision)
- [2026-03-30] Task 28: Added `axon usage` (Ink dashboard) + `axon savings` (one-liner) to cli/index.ts
- [2026-03-30] Task 28: Extended StatusBar.tsx with routingReason prop; RightPanel.tsx with savingsPct prop
- Plan saved: docs/plans/2026-03-30-axon-v2-context-plan.md
- Prior plan reference: docs/plans/2026-03-27-axon-cli-plan.md (Phase 1-3 baseline)

## Next Steps
1. Execute plan: docs/plans/2026-03-30-axon-v2-context-plan.md
2. Start with Phase 1 (Task 1.1 — extend types.ts ModelId union)
3. Install `@google/generative-ai` before starting Phase 1 Task 1.5

## Decisions
- OpenAICompatibleProvider base class: shared implementation for Kimi, Grok, Groq, Qwen (80% reuse)
- Gemini uses `@google/generative-ai` SDK (not OpenAI-compatible)
- ContextTier lives in `src/providers/tiers.ts` (not context/), imported by both providers and context modules
- Agent modes enforce at `executeTool()` level, not loop level (single enforcement point)
- AGENT.md injected in `buildEnrichedSystemPrompt()` — async, called from `runAgent()` not `buildSystemPrompt()`
- Right panel hidden when `process.stdout.columns < 80` (narrow terminal guard)
- `--diff` mode runs in non-TUI stdout mode (avoids readline/Ink conflict)

## Learnings
- `config.get('providers')` returns `unknown` — always cast as `Record<string, string> | undefined`
- All new file imports MUST end in `.js` (ESM project)
- `streamAgent()` in index.ts uses cast pattern `as Provider & { streamAgent? }` for Anthropic only — OpenAICompatibleProvider has it as a regular method
- `diff` package already in package.json — use `createTwoFilesPatch` for --diff mode
- `tiktoken` already in package.json — available for accurate token counting
- JSX in `.ts` files fails tsup build — must use `.tsx` extension for Ink components
- `better-sqlite3` has no bundled types — need `@types/better-sqlite3` (now installed as devDep)
- tsup bundles all into `dist/cli/index.js` — no separate per-file dist outputs
- Pre-existing typecheck errors in providers/index.ts + providers/openai-compatible.ts — not blocking build

## References
- Plan: `docs/plans/2026-03-30-axon-v2-context-plan.md`
- Prior plan: `docs/plans/2026-03-27-axon-cli-plan.md`

## Blockers
- None

## Last Updated
2026-03-30
