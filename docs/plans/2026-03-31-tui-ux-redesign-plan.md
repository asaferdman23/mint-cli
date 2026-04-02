# TUI UX Redesign — Implementation Plan
> Goal: `mint` alone opens TUI. Rich slash command system inside.

## Phase 1 — `mint` Opens TUI by Default
**Change:** `src/cli/index.ts` — when no prompt given, launch TUI instead of `program.help()`

```typescript
if (!prompt) {
  const { render } = await import('ink');
  const React = await import('react');
  const { App } = await import('../tui/App.js');
  const app = render(React.default.createElement(App, { modelPreference: options.model }));
  await app.waitUntilExit();
  return;
}
```

---

## Phase 2 — Slash Command Registry
New files: `src/tui/commands/`

- `registry.ts` — `Map<string, SlashCommand>`, `CommandContext`, `ExecuteResult` types
- `clear.ts` — clears messages + resets counters (noop result)
- `model.ts` — show/switch model; `/model sonnet` switches instantly
- `models.ts` — table of all 18 models sorted by tier
- `agent.ts` — show/switch agent mode (auto/yolo/plan/diff)
- `usage.ts` — session stats + all-time SQLite totals
- `help.ts` — lists all registered commands (import last, so it sees all)
- `index.ts` — barrel that imports all above; re-exports `getCommand`, `parseSlashInput`, `getAllCommands`

### SlashCommand Shape
```typescript
interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  execute: (ctx: CommandContext) => ExecuteResult;
}

type ExecuteResult =
  | { type: 'message'; message: ChatMessage }
  | { type: 'noop' }
  | { type: 'overlay'; content: React.ReactElement };  // future
```

### CommandContext (assembled by App.tsx on each dispatch)
```typescript
interface CommandContext {
  args: string;
  currentModel: ModelId | null;
  sessionTokens: number;
  sessionCost: number;
  messageCount: number;
  agentMode: AgentMode;
  messages: ChatMessage[];
  setMessages, setCurrentModel, setAgentMode, setSessionTokens, setSessionCost, nextId
}
```

---

## Phase 3 — Wire Registry into App.tsx
- Rename `agentMode` prop → `agentModeFromProps`, add `useState<AgentMode>` initialized from it
- Import `./commands/index.js` (registers all commands as side-effect)
- Replace entire if/else slash block with:
```typescript
if (trimmed.startsWith('/')) {
  const parsed = parseSlashInput(trimmed);
  const cmd = getCommand(parsed.name);
  if (!cmd) { /* show "unknown command" message */ return; }
  const result = cmd.execute(ctx);
  if (result.type === 'message') setMessages(prev => [...prev, result.message]);
  setInput(''); return;
}
```
- Pass `agentMode` state (not prop) to RightPanel and StatusBar

---

## Phase 4 — Slash Hints in InputBox
- Add `commandNames?: string[]` prop to `InputBox`
- When input starts with `/`, filter `commandNames` and render dim hint line above input box
- Example: typing `/mo` shows `  /model  /models` above the border

---

## Phase 5 — StatusBar + Banner Polish
- StatusBar: add `agentMode` badge next to model name (coloured: yolo=red, plan=blue, diff=yellow, auto=green)
- Banner: update hint text → `⚡ mint  ·  /model  /models  /agent  /usage  /help  ·  Ctrl+C exit`

---

## UX Per Command

| Command | Output |
|---|---|
| `/help` | List of all commands with usage + description. Keyboard shortcuts section. |
| `/clear` | Messages + counters reset instantly. Silent (noop). |
| `/model` | Current model info (provider, tier, pricing, context). `/model sonnet` switches. |
| `/models` | Table: ID · PROVIDER · TIER · IN/OUT $/1M. Active model marked `◀`. |
| `/agent` | Current mode + all 4 modes with descriptions. `/agent yolo` switches. |
| `/usage` | Session: tokens, cost, turns. All-time: requests, total cost, saved vs Opus. |

---

## Build Order
1. Phase 1 — `mint` → TUI (one line change, biggest UX win)
2. Phase 2 — Registry + commands (pure new files, zero regression)
3. Phase 3 — Wire into App.tsx (replaces existing logic)
4. Phase 4 — Slash hints (additive polish)
5. Phase 5 — StatusBar + Banner (cosmetic)

## Success Criteria
- [ ] `mint` (no args) opens TUI
- [ ] `mint "text"` still runs runPrompt
- [ ] `mint chat` still works
- [ ] All 6 slash commands work: /help /clear /model /models /agent /usage
- [ ] Unknown `/foo` shows helpful error
- [ ] Slash hints appear when typing `/mo`
- [ ] StatusBar shows agent mode
- [ ] `npm run build` exits 0
