> **🚧 DRAFT — planned (Wave 3). Not ready to execute.**
> Full spec + tasks land when prioritized. Order in ROADMAP.

## Why

"Persistence" in two senses, both load-bearing for the mission:

1. **Agent doesn't give up** — recovers from failed tool calls, tries
   alternate approaches, doesn't bail at iteration 3 of a 20-step task.
   Today we halt on 2 consecutive rejections (good for user redirection but
   doesn't distinguish "user said no" from "tool errored, try differently").
2. **Session continuity across machines** — Pi has session export. Mint is
   local-only. Add `mint trace export <id>` → tarball → `mint trace import`
   on another machine; pick up where you left off.
3. **Long-task resilience** — checkpoint state every N turns so a crash or
   network blip doesn't lose 30 minutes of work. Trace persists but loop
   state doesn't.

## What Changes

- Distinguish "user-rejected" from "tool-errored" in the rejection counter;
  retry-with-alternative pattern on tool errors.
- `mint trace export <sessionId> [--out path.tar.zst]` writes a complete
  session bundle (trace + outcomes row + memory excerpts).
- `mint resume --from <bundle.tar.zst>` reconstructs the session and lets
  you continue from any turn.
- Loop checkpoints to disk every N turns (configurable); `mint recover
  <sessionId>` replays from the last checkpoint after a crash.

## Capabilities

### New Capabilities
- `agent-persistence`: Recovery patterns, session export/import, checkpoint/recover.

## Impact

- Affected: `src/brain/loop.ts`, `src/brain/session.ts`, `src/cli/commands/trace.ts`,
  new `src/cli/commands/recover.ts`.
- Risk: checkpoint overhead on long sessions — keep checkpoint format minimal,
  exclude transient cache.

## Dependencies / order

- Should land after `multi-axis-token-efficiency` so audit can show
  checkpoint cost.
