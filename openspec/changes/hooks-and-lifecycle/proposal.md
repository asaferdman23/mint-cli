> **🚧 DRAFT — planned (Wave 3). Not ready to execute.**
> Full spec + tasks land when prioritized. Order in ROADMAP.

## Why

Claude Code has hooks (pre-tool-use, post-edit, on-error). Pi has TS
extensions. Mint is monolithic — users wanting to add policy (e.g., "block
edits to /infra/", "log every tool call to my SIEM", "auto-format on
post-edit") must fork.

Hooks let teams add policy and automation without forking the CLI, and
position Mint for enterprise where policy customization is required.

## What Changes

- New config block `hooks.<event>: Array<{name, command|script}>` for shell
  commands or JS files to run at each lifecycle event.
- Events: `session.start`, `tool.before`, `tool.after`, `diff.proposed`,
  `diff.applied`, `session.end`, `error`.
- Synchronous hooks block the event; async hooks fire-and-forget. Config
  selects per hook.
- A failing required hook aborts the action (e.g., a SIEM-logging hook that
  fails on network outage can be marked `failOpen: true` to not block).
- `mint hooks list` + `mint hooks test <name>` for inspection.

## Capabilities

### New Capabilities
- `hooks-system`: Lifecycle event registry, hook execution, blocking vs async
  semantics, failure modes.

## Impact

- Affected: every event emitter in `loop.ts` and `tools-host.ts`, new
  `src/hooks/` module, config schema.
- Risk: blocking hooks can hang the loop — hard timeout per hook.

## Dependencies / order

- Should land after `multi-axis-token-efficiency` so audit can track hook
  cost (hooks that call LLMs).
