# axon-cli Implementation Plan

> **For Claude:** REQUIRED: Follow this plan phase-by-phase. Each phase is independently usable and testable. Read the source files cited before touching any code. Do NOT port manus workspace/device-flow/control-plane pieces.

**Goal:** Evolve axon-cli from a basic non-streaming CLI into a full terminal-first AI coding assistant with multi-model smart routing, persistent sessions, an Ink TUI, agent tools, and a real usage dashboard.

**Architecture:** axon-cli keeps its own `providers/types.ts` and `providers/router.ts` as the unique multi-model routing core. manus's TUI (`chat-app.tsx`), runtime (`runtime.ts`), context-engine, policy-engine, storage, and security packages are ported and adapted — stripping all manus-specific workspace/control-plane concepts and wiring axon's router in their place.

**Tech Stack:** Node 20+, TypeScript (ESM), Commander.js, Ink + React (TUI), better-sqlite3 (sessions), `@anthropic-ai/sdk` (streaming), `openai` (DeepSeek/OpenRouter), Conf (config), AES-256-GCM (key encryption).

**Prerequisites:** `axon-cli` repo at `/Users/user/Desktop/axon-cli/` with existing structure intact. `manusaApiAgentCoding` repo at `/Users/user/Desktop/manusaApiAgentCoding/` available for reading source to port.

---

## What NOT to Port (manus-specific, skip these)

| manus file/package | Reason to skip |
|---|---|
| `apps/cli/src/control-plane-client.ts` | Manus cloud workspace device-flow — not relevant |
| `apps/cli/src/config-store.ts` | Uses manus control-plane URL/token — axon has its own Conf store |
| `apps/cli/src/web-server.ts` | Optional web shell — defer to Phase 5+ |
| `packages/manus-adapter/` | Manus proprietary API — axon uses direct provider SDKs |
| `apps/cli/src/index.tsx` top-level `login`/`connect` commands | Manus workspace auth — axon has BYOK + simple device-code auth |
| workspace member / organization DB tables | Multi-tenant SaaS — axon is single-user CLI |
| `WorkspaceRecord`, `OrganizationRecord`, `WorkspaceMemberRecord` | Too manus-specific — simplify axon storage schema |

---

## Relevant Codebase Files

### axon-cli (keep/modify)
- `/Users/user/Desktop/axon-cli/src/providers/types.ts` — ModelId, MODELS, interfaces (keep as-is)
- `/Users/user/Desktop/axon-cli/src/providers/router.ts` — selectModel, detectTaskType, calculateCost (keep as-is)
- `/Users/user/Desktop/axon-cli/src/providers/anthropic.ts` — AnthropicProvider with `streamComplete` already implemented
- `/Users/user/Desktop/axon-cli/src/providers/deepseek.ts` — DeepSeekProvider with `streamComplete` already implemented
- `/Users/user/Desktop/axon-cli/src/providers/index.ts` — registry, `complete()`, `streamComplete()`
- `/Users/user/Desktop/axon-cli/src/context/gather.ts` — basic file glob context (replace in Phase 2)
- `/Users/user/Desktop/axon-cli/src/utils/config.ts` — Conf-based store (extend in Phase 4)
- `/Users/user/Desktop/axon-cli/src/cli/index.ts` — Commander entry (extend each phase)
- `/Users/user/Desktop/axon-cli/src/cli/commands/run.ts` — main command (upgrade Phase 1)
- `/Users/user/Desktop/axon-cli/package.json` — add deps per phase

### manus source to port (read-only reference)
- `/Users/user/Desktop/manusaApiAgentCoding/apps/cli/src/chat-app.tsx` (~1000 lines) — Ink TUI
- `/Users/user/Desktop/manusaApiAgentCoding/apps/cli/src/runtime.ts` (~700 lines) — session/agent runtime
- `/Users/user/Desktop/manusaApiAgentCoding/apps/cli/src/slash-commands.ts` — slash command parser
- `/Users/user/Desktop/manusaApiAgentCoding/apps/cli/src/themes.ts` — color theme system
- `/Users/user/Desktop/manusaApiAgentCoding/packages/context-engine/src/index.ts` — ContextPack builder
- `/Users/user/Desktop/manusaApiAgentCoding/packages/policy-engine/src/index.ts` — shell command approval
- `/Users/user/Desktop/manusaApiAgentCoding/packages/storage/src/index.ts` — SQLite storage (LocalStorage class)
- `/Users/user/Desktop/manusaApiAgentCoding/packages/security/src/index.ts` — AES-256-GCM key encryption

---

## Phase 1: Streaming + Interactive Chat Mode

> **Exit Criteria:** `axon "write a hello world"` streams output token-by-token. `axon chat` opens an interactive Ink TUI where the user can type prompts and get streamed responses. Ctrl+C exits cleanly. Model selection shown live.

### Task 1.1: Add streaming to `run.ts`

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/cli/commands/run.ts`

The current `run.ts` calls `complete()` (full response). Replace with `streamComplete()` from `src/providers/index.ts`. The `streamComplete` method already exists on both `AnthropicProvider` and `DeepSeekProvider`.

**Step 1:** Read `src/cli/commands/run.ts` in full (done above).

**Step 2:** Replace the execute block (lines 106–154) with a streaming version.

```typescript
// Replace the "Execute" block in run.ts with:
const spinner = ora(`Routing to ${modelInfo.name}...`).start();
const startTime = Date.now();
let fullContent = '';

try {
  spinner.stop();
  process.stdout.write('\n');

  for await (const chunk of streamComplete({ model: modelId, messages })) {
    process.stdout.write(chunk);
    fullContent += chunk;
  }

  process.stdout.write('\n\n');

  const latency = Date.now() - startTime;
  // Estimate tokens (no real usage from stream — calculate from chars)
  const estimatedInputTokens = Math.ceil(
    messages.reduce((sum, m) => sum + m.content.length, 0) / 4
  );
  const estimatedOutputTokens = Math.ceil(fullContent.length / 4);
  const cost = calculateCost(modelId, estimatedInputTokens, estimatedOutputTokens);

  if (options.verbose) {
    console.log(boxen(
      `${chalk.bold('Response Stats')}\n\n` +
      `Model: ${modelInfo.name}\n` +
      `Tokens (est.): ${estimatedInputTokens.toLocaleString()} in / ${estimatedOutputTokens.toLocaleString()} out\n` +
      `Cost (est.): ${formatCost(cost.total)}\n` +
      `Latency: ${(latency / 1000).toFixed(2)}s`,
      { padding: 1, borderColor: 'gray', borderStyle: 'round', dimBorder: true }
    ));
  } else {
    console.log(chalk.dim(
      `${modelInfo.name} • est. ${(estimatedInputTokens + estimatedOutputTokens).toLocaleString()} tokens • ${formatCost(cost.total)}`
    ));
  }
} catch (error) {
  process.stdout.write('\n');
  console.error(chalk.red((error as Error).message));
  process.exit(1);
}
```

**Step 3:** Add `import { streamComplete } from '../../providers/index.js'` (it already exports it).

**Step 4:** Build and test.
```bash
cd /Users/user/Desktop/axon-cli && npm run build
axon "write a function that adds two numbers"
```
Expected: Token-by-token streaming output, then cost line.

**Step 5:** Commit.
```bash
git add src/cli/commands/run.ts
git commit -m "feat: stream responses token-by-token in run command"
```

---

### Task 1.2: Create `src/tui/themes.ts`

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/tui/themes.ts`

Port directly from `/Users/user/Desktop/manusaApiAgentCoding/apps/cli/src/themes.ts`. Change the default theme name from "Pilot" to "Axon". Add one more theme called "axon-dark" with cyan primary. Zero logic changes needed.

**Step 1:** Copy the file content, rename `"Pilot"` → `"Axon"`, update primary color to `"#22d3ee"` (cyan) for the default theme to match axon branding.

**Step 2:** No build needed yet (not imported anywhere).

**Step 3:** Commit.
```bash
git add src/tui/themes.ts
git commit -m "feat: add theme system ported from manus"
```

---

### Task 1.3: Create `src/tui/slash-commands.ts`

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/tui/slash-commands.ts`

Port from `/Users/user/Desktop/manusaApiAgentCoding/apps/cli/src/slash-commands.ts`. Remove manus-specific commands (`skills`, `agents`, `thinking`, `serve`, `feedback`, `compact`). Keep axon-relevant set: `help`, `context`, `copy`, `clear`, `themes`, `sessions`, `new`, `cost`, `route`, `files`, `compare`, `diff`, `approvals`, `policy`, `accept`, `reject`. Update the `formatSlashHelp` to reflect axon keyboard shortcuts.

**Step 1:** Create the file with the trimmed command list.
```typescript
// Axon-specific slash commands (manus-specific ones removed)
export type SlashCommandName =
  | 'help' | 'context' | 'copy' | 'clear' | 'themes'
  | 'sessions' | 'new' | 'cost' | 'route' | 'files'
  | 'compare' | 'diff' | 'approvals' | 'policy' | 'accept' | 'reject';
```

**Step 2:** Port `parseSlashCommand`, `getSlashCommandSuggestions`, `formatSlashHelp` functions verbatim (they have no external deps).

**Step 3:** Update keyboard shortcut help section — replace manus shortcuts with:
```
Ctrl+C  Exit
Tab     Toggle sidebar
Ctrl+T  Switch theme
Ctrl+B  Toggle baseline/optimize mode
Ctrl+K  Cost workbench
Esc     Clear input
!cmd    Run bash command
@file   Reference a file
```

**Step 4:** Commit.
```bash
git add src/tui/slash-commands.ts
git commit -m "feat: add slash command system for TUI"
```

---

### Task 1.4: Create `src/tui/chat-app.tsx` (simplified Phase 1 version)

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/tui/chat-app.tsx`

Port from `/Users/user/Desktop/manusaApiAgentCoding/apps/cli/src/chat-app.tsx`. Phase 1 is a simplified version — no sidebar workbench panels, no session persistence from storage (in-memory only), no policy approvals. Just: scrolling message list, text input, slash command autocomplete, streaming display, theme support.

**Key differences from manus chat-app.tsx:**
- Remove `CliRuntime` interface dependency (use direct provider calls in Phase 1, wire full runtime in Phase 3)
- Remove sidebar workbench panels (`plan`, `files`, `diff`, `approvals`, `cost`) — add in Phase 4
- Remove `SessionRecord` import (no DB yet) — use a simple `{ id: string; messages: Message[] }` in-memory session
- Remove `startWebServer` import
- Keep: `useInput`, theme cycling, slash command autocomplete display, busy spinner

**Phase 1 ChatApp props:**
```typescript
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  costEst?: number;
}

interface ChatAppProps {
  initialPrompt?: string;
  modelPreference: string; // 'auto' | ModelId
}
```

**Streaming integration (key difference from manus):**

manus used `runtime.sendUserTurn()` which called a provider internally. In Phase 1, `ChatApp` calls `streamComplete()` directly with axon's router:

```typescript
// In handleSubmit inside chat-app.tsx Phase 1:
const modelId = selectModel(userInput, { contextSize: contextTokens });
setStatusNote(`Routing to ${MODELS[modelId].name}...`);
setIsBusy(true);

let streaming = '';
const msgId = Date.now().toString();
// Append empty assistant message first
setMessages(prev => [...prev, { role: 'assistant', content: '', model: MODELS[modelId].name }]);

try {
  for await (const chunk of streamComplete({ model: modelId, messages: buildMessages(messages, userInput, contextStr) })) {
    streaming += chunk;
    setMessages(prev => {
      const copy = [...prev];
      copy[copy.length - 1] = { ...copy[copy.length - 1], content: streaming };
      return copy;
    });
  }
} finally {
  setIsBusy(false);
  setStatusNote('Ready');
}
```

**Step 1:** Scaffold the file with imports, `Message` type, `ChatAppProps` interface.

**Step 2:** Implement the message list rendering (port from manus chat-app.tsx lines 200–400, adapt to local Message type).

**Step 3:** Implement the input area with slash command autocomplete (port lines 400–600 from manus chat-app.tsx).

**Step 4:** Implement `handleSubmit` with streaming as shown above.

**Step 5:** Implement keyboard shortcuts (`useInput` block from manus chat-app.tsx lines 105–179, remove sidebar ones for now).

**Step 6:** Build and test.
```bash
npm run build
axon chat
# Type a prompt, verify streaming, type /help, verify autocomplete
```

**Step 7:** Commit.
```bash
git add src/tui/chat-app.tsx
git commit -m "feat: Phase 1 Ink TUI chat-app with streaming"
```

---

### Task 1.5: Register `axon chat` command in `cli/index.ts`

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/cli/index.ts`

**Step 1:** Add import.
```typescript
import React from 'react';
import { render } from 'ink';
import { ChatApp } from '../tui/chat-app.js';
```

**Step 2:** Add command.
```typescript
program
  .command('chat')
  .description('Start interactive AI coding session')
  .argument('[prompt...]', 'Optional initial prompt')
  .option('-m, --model <model>', 'Model preference (auto, deepseek, sonnet, opus)', 'auto')
  .action(async (promptParts: string[], options) => {
    const initialPrompt = promptParts.join(' ').trim() || undefined;
    render(
      React.createElement(ChatApp, {
        initialPrompt,
        modelPreference: options.model,
      })
    );
  });
```

**Step 3:** Build and test end-to-end.
```bash
npm run build
axon chat "write a fibonacci function"
# Verify: streams immediately, shows model name, /help works
axon chat
# Verify: opens interactive prompt
```

**Step 4:** Commit.
```bash
git add src/cli/index.ts
git commit -m "feat: register axon chat command with Ink TUI"
```

---

### Phase 1 package.json additions

No new deps needed — `ink`, `react`, `openai`, `@anthropic-ai/sdk` are already in `package.json`. If `@anthropic-ai/sdk` is missing, add it:
```bash
npm install @anthropic-ai/sdk
```

Verify `tsup` config handles React JSX. Check `tsup.config.ts` (or `package.json` build script) — add `--format esm --target node20 --jsx react` if needed.

---

### Phase 1 Success Criteria

- [ ] `axon "prompt"` streams output token-by-token (no more full-wait then print)
- [ ] `axon chat` opens Ink TUI, user can type prompts
- [ ] Model auto-selection printed before streaming starts
- [ ] Slash command autocomplete shows on `/` keystroke
- [ ] `/help` command shows command list
- [ ] `Ctrl+C` exits cleanly
- [ ] `Ctrl+T` cycles themes (terminal colors change)

---

## Phase 2: Context Engine Upgrade

> **Exit Criteria:** `axon chat` shows context summary after gathering (baseline vs. optimized token counts). Repeated prompts on same codebase hit a cache and show "cache hit" in status. `axon "prompt"` one-shot mode also benefits from the upgraded context.

### Task 2.1: Create `src/context/engine.ts`

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/context/engine.ts`

Port from `/Users/user/Desktop/manusaApiAgentCoding/packages/context-engine/src/index.ts`. This file is self-contained (no external package deps except an internal `MessageRecord` type). Replace `MessageRecord` with axon's own `Message` type from `providers/types.ts`.

**Key interface changes:**
```typescript
// Replace manus MessageRecord with axon Message
import { Message } from '../providers/types.js';

export interface BuildContextPackInput {
  mode?: 'baseline' | 'optimize';
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  recentMessages: Message[];   // was MessageRecord[]
  projectSummary?: string;
  memoryNotes?: string[];
  cache?: ContextCache;
}
```

**ContextCache in Phase 2:** Use a simple in-memory `Map<string, PromptCacheEntry>` (SQLite cache comes in Phase 3).

```typescript
// In chat-app.tsx Phase 2, add a module-level cache:
const contextCache = new Map<string, PromptCacheEntry>();
const simpleCache: ContextCache = {
  get: (key) => contextCache.get(key),
  put: (entry) => {
    const full = { ...entry, createdAt: new Date().toISOString(), lastHitAt: new Date().toISOString(), hitCount: 1 };
    contextCache.set(entry.cacheKey, full);
    return full;
  }
};
```

**Port the full implementation** from `context-engine/src/index.ts` — functions `buildStableBlocks`, `buildBaselineVolatileBlocks`, `buildOptimizedVolatileBlocks`, `renderBlocks`, `hashStablePrompt`, `estimateTokens`, `buildContextPack`. These are pure functions with no side effects.

**Step 1:** Copy the full engine, replacing `MessageRecord` with `Message`.

**Step 2:** Export: `buildContextPack`, `estimateTokens`, `type ContextPack`, `type ContextBlock`.

**Step 3:** Compile check.
```bash
npm run typecheck
```

**Step 4:** Commit.
```bash
git add src/context/engine.ts
git commit -m "feat: port context engine with baseline/optimize modes and caching"
```

---

### Task 2.2: Wire context engine into `chat-app.tsx`

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/tui/chat-app.tsx`

**Step 1:** Import context engine.
```typescript
import { buildContextPack, estimateTokens, type ContextPack } from '../context/engine.js';
import { gatherContext } from '../context/gather.js';
```

**Step 2:** Add `contextSummary` state.
```typescript
const [contextSummary, setContextSummary] = useState<ContextPack | undefined>(undefined);
```

**Step 3:** On startup (useEffect once), gather file context using the existing `gather.ts` and build a ContextPack.
```typescript
useEffect(() => {
  async function initContext() {
    const ctx = await gatherContext(process.cwd(), { maxTokens: 80000 });
    const projectSummary = `Codebase: ${ctx.files.length} files, ${ctx.totalTokens} tokens. Files: ${ctx.files.map(f => f.path).slice(0, 20).join(', ')}`;
    setProjectSummary(projectSummary);
    setStatusNote(`Context: ${ctx.files.length} files`);
  }
  void initContext();
}, []);
```

**Step 4:** In `handleSubmit`, use `buildContextPack` instead of raw `formatContextForPrompt`:
```typescript
const pack = buildContextPack({
  mode: runMode,  // 'baseline' | 'optimize'
  model: modelId,
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: userInput,
  maxTokens: 80000,
  recentMessages: messages,
  projectSummary,
  cache: simpleCache,
});
setContextSummary(pack);
setStatusNote(pack.cacheHit
  ? `Cache hit - saved ${pack.cacheSavedTokens} tokens`
  : `Context: ${pack.optimizedTokenEstimate} tokens (${pack.savedTokens} saved)`
);
// Use pack.compiledPrompt as the user message content
```

**Step 5:** Display context summary below input.
```tsx
{contextSummary && (
  <Box>
    <Text color={theme.colors.muted}>
      {runMode === 'optimize'
        ? `optimize: ${contextSummary.optimizedTokenEstimate}t (saved ${contextSummary.savedTokens})`
        : `baseline: ${contextSummary.baselineTokenEstimate}t`}
      {contextSummary.cacheHit ? '  cache-hit' : ''}
    </Text>
  </Box>
)}
```

**Step 6:** Handle `/context` slash command to print context summary detail.

**Step 7:** Build and test.
```bash
npm run build
cd /some-project && axon chat
# Type a prompt, verify: "Context: N tokens (M saved)" in status bar
# Type same prompt again, verify: "Cache hit - saved K tokens"
```

**Step 8:** Commit.
```bash
git add src/tui/chat-app.tsx src/context/engine.ts
git commit -m "feat: wire advanced context engine with optimize mode and caching"
```

---

### Task 2.3: Wire context engine into one-shot `run.ts`

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/cli/commands/run.ts`

**Step 1:** Replace `gatherContext` + `formatContextForPrompt` pattern with `buildContextPack`.
```typescript
import { buildContextPack } from '../../context/engine.js';
// ...
const pack = buildContextPack({
  mode: 'optimize',
  model: modelId,
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: prompt,
  maxTokens: config.get('maxContextTokens') || 80000,
  recentMessages: [],
  projectSummary: contextSummary,
});
// use pack.compiledPrompt as the user message
```

**Step 2:** Show baseline vs optimized token counts in verbose mode.

**Step 3:** Build and test.
```bash
npm run build
axon -v "explain this codebase"
# Verify: stats show baseline vs optimized token counts
```

**Step 4:** Commit.
```bash
git add src/cli/commands/run.ts
git commit -m "feat: upgrade one-shot run command with context engine"
```

---

### Phase 2 package.json additions

No new deps. `tiktoken` is already in package.json (used by context engine for token estimation if needed — the engine uses a char/4 estimator by default, which is fine).

---

### Phase 2 Success Criteria

- [ ] `axon chat` shows "Context: N tokens (M saved)" after first prompt
- [ ] Second identical prompt shows "Cache hit"
- [ ] `/context` slash command prints block summary
- [ ] Ctrl+B toggles between baseline and optimize modes, status bar updates
- [ ] `axon -v "prompt"` shows baseline vs optimized token counts

---

## Phase 3: Session Persistence + SQLite Storage

> **Exit Criteria:** `axon chat` creates a session in `~/.axon/axon.db`. Restarting `axon chat` resumes the last session (previous messages visible). `axon sessions` lists all sessions. `axon usage` reads from local DB instead of placeholder data.

### Task 3.1: Create `src/storage/index.ts`

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/storage/index.ts`

Port from `/Users/user/Desktop/manusaApiAgentCoding/packages/storage/src/index.ts` with heavy simplification. Remove manus-specific tables: `Organization`, `WorkspaceMember`, `ProviderConnection`, `PolicyEvent`, `UxEvent`. Keep: `Session`, `Message`, `Run`, `PromptCache`.

**Simplified schema for axon:**
```sql
-- sessions: one per (workspacePath, model)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- messages: conversation turns
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  token_estimate INTEGER DEFAULT 0,
  metadata TEXT, -- JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- runs: per-request cost tracking
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  baseline_tokens INTEGER DEFAULT 0,
  optimized_tokens INTEGER DEFAULT 0,
  saved_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  cache_hit INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- prompt_cache: context pack cache
CREATE TABLE prompt_cache (
  cache_key TEXT PRIMARY KEY,
  prompt_text TEXT NOT NULL,
  token_estimate INTEGER DEFAULT 0,
  hit_count INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  last_hit_at TEXT NOT NULL
);
```

**AxonStorage class methods to implement:**
```typescript
export class AxonStorage {
  constructor(dbPath: string)

  // Sessions
  ensureSession(workspacePath: string, model: string): SessionRecord
  getSession(id: string): SessionRecord | undefined
  listSessions(workspacePath?: string): SessionRecord[]
  findLatestSession(workspacePath: string): SessionRecord | undefined

  // Messages
  saveMessage(msg: Omit<MessageRecord, 'id' | 'createdAt'>): MessageRecord
  listMessages(sessionId: string, limit?: number): MessageRecord[]

  // Runs
  saveRun(run: Omit<RunRecord, 'id' | 'createdAt'>): RunRecord
  listRuns(sessionId?: string, limit?: number): RunRecord[]
  getUsageSummary(days?: number): UsageSummary

  // Prompt cache
  getPromptCache(cacheKey: string): PromptCacheEntry | undefined
  putPromptCache(entry: Omit<PromptCacheEntry, 'createdAt' | 'lastHitAt' | 'hitCount'>): PromptCacheEntry

  close(): void
}
```

**Step 1:** Install `better-sqlite3`.
```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

**Step 2:** Write `AxonStorage` class with `better-sqlite3`. Port the SQL-building patterns from manus's LocalStorage (same `better-sqlite3` usage). Use `os.homedir() + '/.axon/axon.db'` as default path.

**Step 3:** Export types: `SessionRecord`, `MessageRecord`, `RunRecord`, `PromptCacheEntry`, `UsageSummary`.

**Step 4:** Compile check.
```bash
npm run typecheck
```

**Step 5:** Commit.
```bash
git add src/storage/index.ts package.json package-lock.json
git commit -m "feat: add SQLite session/message/run storage"
```

---

### Task 3.2: Create `src/runtime/index.ts` (axon runtime)

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/runtime/index.ts`

This is the core adaptation task. Port manus's `createRuntime()` from `runtime.ts` but wire axon's multi-model router instead of manus's single-provider connection system.

**Key interface:**
```typescript
export interface AxonRuntime {
  ensureSession(sessionId?: string): SessionRecord;
  listMessages(sessionId: string): MessageRecord[];
  sendUserTurn(input: SendTurnInput): Promise<TurnResult>;
  getRunState(): RuntimeUiState;
  getLastContextSummary(): ContextSummary | undefined;
  listSessions(): SessionRecord[];
  getCurrentSession(): SessionRecord;
  listWorkspaceFiles(query?: string): WorkspaceFileEntry[];
  readWorkspaceFile(filePath: string): WorkspaceFilePreview;
  getUsageSummary(): UsageSummary;
  close(): void;
}
```

**The critical adaptation — `sendUserTurn`:**

manus called `resolveConnection()` then `buildProviderAdapter()` then `executeProviderTurn()` — all tied to a manus ProviderConnection record. axon replaces this entirely with axon's router + existing providers:

```typescript
// In axon runtime.ts sendUserTurn:
const { mode = 'optimize', userPrompt, session, onChunk, onStatus } = input;

// 1. Gather context
onStatus?.('Compiling context...');
const recentMessages = storage.listMessages(session.id, 16);
const pack = buildContextPack({
  mode,
  model: 'auto', // placeholder — router decides below
  systemPrompt: AXON_SYSTEM_PROMPT,
  userPrompt,
  maxTokens: options.maxContextTokens,
  recentMessages: recentMessages.map(m => ({ role: m.role, content: m.content })),
  projectSummary: options.projectSummary,
  cache: storageCache,
});

// 2. Route to model using axon's router
const modelId = selectModel(userPrompt, {
  contextSize: pack.optimizedTokenEstimate,
  preferSpeed: mode === 'baseline',
});
onStatus?.(`Routing to ${MODELS[modelId].name}...`);

// 3. Build messages array
const messages: Message[] = [
  { role: 'system', content: AXON_SYSTEM_PROMPT },
  { role: 'user', content: pack.compiledPrompt },
];

// 4. Save user message to DB
storage.saveMessage({ sessionId: session.id, role: 'user', content: userPrompt,
  tokenEstimate: estimateTokens(userPrompt), metadata: { mode, modelId } });

// 5. Stream from provider
const startTime = Date.now();
let fullContent = '';

for await (const chunk of streamComplete({ model: modelId, messages })) {
  fullContent += chunk;
  onChunk?.(chunk);
}

const latency = Date.now() - startTime;

// 6. Estimate tokens & cost
const inputTokens = pack.optimizedTokenEstimate;
const outputTokens = estimateTokens(fullContent);
const cost = calculateCost(modelId, inputTokens, outputTokens);

// 7. Save assistant message and run record
const assistantMessage = storage.saveMessage({
  sessionId: session.id, role: 'assistant', content: fullContent,
  tokenEstimate: outputTokens, metadata: { modelId, cost: cost.total }
});
storage.saveRun({
  sessionId: session.id, model: modelId,
  inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
  estimatedCostUsd: cost.total,
  baselineTokens: pack.baselineTokenEstimate,
  optimizedTokens: pack.optimizedTokenEstimate,
  savedTokens: pack.savedTokens,
  latencyMs: latency, cacheHit: pack.cacheHit,
});

return { assistantMessage, modelId, cost, pack, latency };
```

**Step 1:** Create the file with `AxonRuntime` interface, `RuntimeOptions`, `SendTurnInput`, `TurnResult` types.

**Step 2:** Implement `createRuntime(options)` factory function.

**Step 3:** Implement `ensureSession`, `listMessages`, `sendUserTurn` (key method above), `getUsageSummary`, `listWorkspaceFiles`, `readWorkspaceFile`, `close`.

**Step 4:** Compile check.
```bash
npm run typecheck
```

**Step 5:** Commit.
```bash
git add src/runtime/index.ts
git commit -m "feat: axon runtime with multi-model router wired into session/storage"
```

---

### Task 3.3: Upgrade `chat-app.tsx` to use runtime

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/tui/chat-app.tsx`

Replace direct `streamComplete()` calls in `ChatApp` with `runtime.sendUserTurn()`. The runtime handles routing, context packing, DB persistence, and cost tracking.

**Updated `ChatAppProps`:**
```typescript
interface ChatAppProps {
  runtime: AxonRuntime;
  session: SessionRecord;
  initialPrompt?: string;
}
```

**Updated `handleSubmit`:**
```typescript
async function handleSubmit(userInput: string) {
  setIsBusy(true);

  // Append empty assistant message for streaming
  setMessages(prev => [...prev, { role: 'user', content: userInput },
                                { role: 'assistant', content: '' }]);

  try {
    await runtime.sendUserTurn({
      session,
      userPrompt: userInput,
      mode: runMode,
      onChunk: (chunk) => {
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });
      },
      onStatus: setStatusNote,
    });

    // Refresh from DB after turn
    setMessages(runtime.listMessages(session.id));
  } finally {
    setIsBusy(false);
  }
}
```

**Step 1:** Update `ChatApp` props and `handleSubmit`.

**Step 2:** Update `cli/index.ts` chat command to create runtime first.
```typescript
// In cli/index.ts chat command:
import path from 'path';
import os from 'os';
import { createRuntime } from '../runtime/index.js';

// In action handler:
const runtime = await createRuntime({
  cwd: process.cwd(),
  dbPath: path.join(os.homedir(), '.axon', 'axon.db'),
  maxContextTokens: 80000,
});
const session = runtime.ensureSession();
render(React.createElement(ChatApp, { runtime, session, initialPrompt }));
```

**Step 3:** Build and test.
```bash
npm run build
axon chat "write a bubble sort"
# Exit, restart
axon chat
# Verify: previous message visible
```

**Step 4:** Commit.
```bash
git add src/tui/chat-app.tsx src/cli/index.ts
git commit -m "feat: wire runtime into ChatApp for persistent sessions"
```

---

### Task 3.4: Add `axon sessions` command and upgrade `axon usage`

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/cli/commands/sessions.ts`
- Modify: `/Users/user/Desktop/axon-cli/src/cli/commands/usage.ts`
- Modify: `/Users/user/Desktop/axon-cli/src/cli/index.ts`

**sessions.ts:** List sessions from DB.
```typescript
export async function listSessions(): Promise<void> {
  const storage = new AxonStorage(DEFAULT_DB_PATH);
  const sessions = storage.listSessions(process.cwd());
  // Print table using cli-table3
}
```

**usage.ts:** Replace placeholder/API call with DB query.
```typescript
export async function showUsage(options: UsageOptions): Promise<void> {
  const storage = new AxonStorage(DEFAULT_DB_PATH);
  const summary = storage.getUsageSummary(parseInt(options.days));
  // Render with existing displayUsage() function (already good)
}
```

**Step 1:** Implement sessions.ts.

**Step 2:** Update usage.ts to use storage.

**Step 3:** Register `axon sessions` in `cli/index.ts`.

**Step 4:** Build and test.
```bash
npm run build
axon sessions      # lists sessions
axon usage         # shows real data from DB
axon usage -d 30   # 30-day window
```

**Step 5:** Commit.
```bash
git add src/cli/commands/sessions.ts src/cli/commands/usage.ts src/cli/index.ts
git commit -m "feat: sessions list command and real usage from SQLite"
```

---

### Phase 3 package.json additions

```json
{
  "dependencies": {
    "better-sqlite3": "^9.4.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11"
  }
}
```

---

### Phase 3 Success Criteria

- [ ] `axon chat` creates a session visible in `~/.axon/axon.db`
- [ ] Restart `axon chat` — previous messages appear
- [ ] `axon sessions` lists sessions with timestamps
- [ ] `axon usage` shows real token/cost data from DB (not placeholder)
- [ ] `axon usage -d 30` shows 30-day summary
- [ ] Context pack cache persists across chat-app restarts (prompt_cache table)

---

## Phase 4: Agent Tools + Policy Engine

> **Exit Criteria:** Inside `axon chat`, user can type `!ls -la` to run shell commands. AI can propose file reads/writes. `axon chat` shows an approval queue for destructive operations (Ctrl+A to open). Policy preset (strict/balanced/power) enforces what auto-runs vs. needs approval.

### Task 4.1: Create `src/policy/index.ts`

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/policy/index.ts`

Port `/Users/user/Desktop/manusaApiAgentCoding/packages/policy-engine/src/index.ts` verbatim. Zero changes needed — the file has no external dependencies and exports `evaluatePolicyForCommand`, `classifyCommand`, `canReadFile`, and related types. Only rename any internal references from `@manus-code/` to relative paths (there are none — it's self-contained).

**Step 1:** Copy file to `src/policy/index.ts`.

**Step 2:** Extend with an axon-specific helper:
```typescript
// Add to axon policy:
export function getDefaultPreset(): ApprovalPreset {
  return (config.get('policyPreset') as ApprovalPreset) ?? 'balanced';
}
```

**Step 3:** Compile check.
```bash
npm run typecheck
```

**Step 4:** Commit.
```bash
git add src/policy/index.ts
git commit -m "feat: port policy engine for shell/file approval"
```

---

### Task 4.2: Add `!command` execution to the runtime

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/runtime/index.ts`

**Step 1:** Add `executeCommand` method to `AxonRuntime` interface.
```typescript
executeCommand(command: string): Promise<CommandExecutionResult>;
```

**Step 2:** Implement using `child_process.spawnSync` (port pattern from manus runtime.ts `executeCommand`):
```typescript
const executeCommand = async (command: string): Promise<CommandExecutionResult> => {
  const preset = getDefaultPreset();
  const decision = evaluatePolicyForCommand(command, preset, true);

  if (decision.status === 'denied') {
    return { status: 'denied', stdout: '', stderr: decision.reason, exitCode: -1 };
  }

  if (decision.status === 'needs-approval') {
    const proposal: ActionProposal = {
      id: crypto.randomUUID(),
      actionType: decision.actionType,
      riskLevel: 'medium',
      summary: `Run: ${command}`,
      target: command,
      preview: command,
      approvalStatus: 'pending',
      command,
      createdAt: new Date().toISOString(),
    };
    queueAction(proposal);
    return { status: 'queued', stdout: '', stderr: '', exitCode: 0, actionProposal: proposal };
  }

  // auto-approved: run it
  const result = spawnSync('sh', ['-c', command], {
    cwd: options.cwd, encoding: 'utf8', timeout: 30000
  });
  return {
    status: 'executed',
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 0,
  };
};
```

**Step 3:** Add `pendingActions` array to runtime state, expose via `getPendingActions()`, `acceptAction()`, `rejectAction()`.

**Step 4:** Compile check.

**Step 5:** Commit.
```bash
git add src/runtime/index.ts
git commit -m "feat: shell command execution with policy approval in runtime"
```

---

### Task 4.3: Wire `!command` into `chat-app.tsx`

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/tui/chat-app.tsx`

**Step 1:** In `handleSubmit`, detect `!` prefix:
```typescript
if (userInput.startsWith('!')) {
  const command = userInput.slice(1).trim();
  const result = await runtime.executeCommand(command);
  if (result.status === 'executed') {
    setMessages(prev => [...prev,
      { role: 'user', content: userInput },
      { role: 'system', content: `$ ${command}\n${result.stdout}${result.stderr ? '\nstderr: ' + result.stderr : ''}` }
    ]);
  } else if (result.status === 'queued') {
    setPendingActions(runtime.getPendingActions());
    setStatusNote(`Action queued for approval: ${command}`);
  } else {
    setErrorMessage(`Denied: ${result.stderr}`);
  }
  return;
}
```

**Step 2:** Add `pendingActions` state and approval workbench panel (Ctrl+A sidebar panel).
```typescript
const [pendingActions, setPendingActions] = useState<ActionProposal[]>([]);
```

**Step 3:** Render approval queue in sidebar when `workbenchMode === 'approvals'`:
```tsx
// In sidebar render:
{workbenchMode === 'approvals' && (
  <Box flexDirection="column">
    <Text bold>Pending Approvals ({pendingActions.length})</Text>
    {pendingActions.map(action => (
      <Box key={action.id} flexDirection="column">
        <Text color={theme.colors.warning}>{action.summary}</Text>
        <Text dimColor>Tab to select, /accept or /reject</Text>
      </Box>
    ))}
  </Box>
)}
```

**Step 4:** Wire `/accept` and `/reject` slash commands to `runtime.acceptAction()` / `runtime.rejectAction()`.

**Step 5:** Add `workbenchMode` state and Ctrl+A keyboard shortcut.

**Step 6:** Build and test.
```bash
npm run build
axon chat
# Type: !ls -la
# Verify: output appears as system message
# Type: !rm important.txt  (should queue for approval in balanced mode)
# Press Ctrl+A, verify approval queue shows
```

**Step 7:** Commit.
```bash
git add src/tui/chat-app.tsx
git commit -m "feat: !command execution with policy approval UI in TUI"
```

---

### Task 4.4: Add `@file` reference parsing

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/runtime/index.ts`

Port `parseInput` method from manus runtime.ts. Parse `@filename` references: read file content, inject as context.

```typescript
export function parseInput(input: string): ParsedInput {
  if (input.startsWith('@')) {
    const filePath = input.slice(1).trim();
    const resolvedPath = path.resolve(options.cwd, filePath);
    if (canReadFile(resolvedPath)) {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      return {
        type: 'file-ref',
        content: input,
        referencedFiles: [{ path: resolvedPath, name: filePath, content }],
      };
    }
  }
  return { type: 'prompt', content: input };
}
```

**Step 1:** Implement `parseInput` in runtime.

**Step 2:** In `sendUserTurn`, preprocess input through `parseInput`. If file refs found, prepend them to the context pack.

**Step 3:** In `chat-app.tsx`, when input starts with `@`, trigger autocomplete from `runtime.listWorkspaceFiles()`.

**Step 4:** Test.
```bash
axon chat
# Type: @src/providers/router.ts explain what selectModel does
# Verify: file content included in context, AI can reference it
```

**Step 5:** Commit.
```bash
git add src/runtime/index.ts src/tui/chat-app.tsx
git commit -m "feat: @file reference injection into context"
```

---

### Task 4.5: Add policy config to `axon config`

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/utils/config.ts`
- Modify: `/Users/user/Desktop/axon-cli/src/cli/commands/config.ts`

**Step 1:** Add `policyPreset` to config schema:
```typescript
policyPreset: z.enum(['strict', 'balanced', 'power']).default('balanced'),
```

**Step 2:** In `showConfig`, display policy preset.

**Step 3:** `axon config:set policy.preset power` works.

**Step 4:** Wire `/policy` slash command in `chat-app.tsx` to call `runtime.getPolicy()` / set policy.

**Step 5:** Commit.
```bash
git add src/utils/config.ts src/cli/commands/config.ts
git commit -m "feat: policy preset config (strict/balanced/power)"
```

---

### Phase 4 package.json additions

No new deps. `child_process` is built into Node. The `crypto` used for UUID is built-in. `better-sqlite3` already added in Phase 3.

---

### Phase 4 Success Criteria

- [ ] `!ls -la` in chat runs and shows output
- [ ] `!rm file.txt` in `balanced` mode queues for approval, not auto-run
- [ ] `!rm file.txt` in `power` mode runs immediately
- [ ] `!rm file.txt` in `strict` mode shows Denied
- [ ] Ctrl+A opens approval queue workbench in sidebar
- [ ] `/accept` approves queued action
- [ ] `/reject` rejects queued action
- [ ] `@src/foo.ts` in input injects file content as context
- [ ] `axon config:set policyPreset power` persists across restarts

---

## Phase 5: Usage Dashboard + Security + Auth Polish

> **Exit Criteria:** Provider API keys stored encrypted (not plaintext in Conf). `axon usage` shows real savings vs. hypothetical Opus baseline. `/cost` slash command shows session-level spend. `axon login` device-code flow functional (for users who want a hosted key). `axon compare` upgraded with streaming.

### Task 5.1: Create `src/security/index.ts`

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/security/index.ts`

Port from `/Users/user/Desktop/manusaApiAgentCoding/packages/security/src/index.ts` verbatim. Zero changes needed — it's pure Node.js crypto with no external deps. Just replace the env var name from `MANUS_CODE_MASTER_KEY` to `AXON_MASTER_KEY`.

```typescript
// Only change in security/index.ts:
const fromEnv = process.env.AXON_MASTER_KEY;  // was MANUS_CODE_MASTER_KEY
const KEY_FILE_NAME = 'axon.key';              // was master.key
const CONFIG_DIR = path.join(os.homedir(), '.axon');
```

**Step 1:** Port the file with the 3 name changes above.

**Step 2:** Commit.
```bash
git add src/security/index.ts
git commit -m "feat: AES-256-GCM encrypted key storage"
```

---

### Task 5.2: Migrate provider keys to encrypted storage

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/providers/anthropic.ts`
- Modify: `/Users/user/Desktop/axon-cli/src/providers/deepseek.ts`
- Modify: `/Users/user/Desktop/axon-cli/src/cli/commands/config.ts`

**Step 1:** In `config:set providers.anthropic <key>`, encrypt the key before saving:
```typescript
// In config.ts command handler, when setting a provider key:
import { getOrCreateMasterKey, encryptSecret } from '../../security/index.js';
const masterKey = getOrCreateMasterKey(path.join(os.homedir(), '.axon'));
const encrypted = encryptSecret(value, masterKey);
config.set('providers', { ...existing, [provider]: encrypted });
config.set('providerKeysEncrypted', true);
```

**Step 2:** In `AnthropicProvider.getClient()` and `DeepSeekProvider.getClient()`, decrypt on read:
```typescript
const stored = config.get('providers')?.anthropic;
const isEncrypted = config.get('providerKeysEncrypted');
const apiKey = isEncrypted ? decryptSecret(stored, masterKey) : stored;
```

**Step 3:** Handle migration: if `providerKeysEncrypted` is not set, treat stored keys as plaintext (backward compat).

**Step 4:** Test.
```bash
axon config:set providers.anthropic sk-ant-xxx
# Verify config file shows encrypted blob, not raw key
axon "hello"  # should work using decrypted key
```

**Step 5:** Commit.
```bash
git add src/providers/anthropic.ts src/providers/deepseek.ts src/cli/commands/config.ts src/security/index.ts
git commit -m "feat: encrypt provider API keys at rest with AES-256-GCM"
```

---

### Task 5.3: Add OpenRouter provider

**Files:**
- Create: `/Users/user/Desktop/axon-cli/src/providers/openrouter.ts`
- Modify: `/Users/user/Desktop/axon-cli/src/providers/index.ts`

OpenRouter supports `qwen-coder-32b` and `gemini-2-pro` via OpenAI-compatible API. Port pattern from manus `openai-compatible-adapter/src/index.ts`.

```typescript
// openrouter.ts — OpenAI-compatible, base URL differs
export class OpenRouterProvider implements Provider {
  id = 'openrouter' as const;
  name = 'OpenRouter';

  private getClient(): OpenAI {
    const apiKey = config.get('providers')?.openrouter;
    return new OpenAI({
      apiKey: isEncrypted ? decrypt(apiKey) : apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://axon.dev',
        'X-Title': 'axon-cli',
      },
    });
  }

  // MODEL_MAP: qwen-coder-32b → 'qwen/qwen-2.5-coder-32b-instruct'
  //            gemini-2-pro → 'google/gemini-pro-1.5'
  //            gemini-2-flash → 'google/gemini-flash-1.5'
}
```

**Step 1:** Implement `OpenRouterProvider` with `complete` and `streamComplete`.

**Step 2:** Register in `providers/index.ts`:
```typescript
import { openrouterProvider } from './openrouter.js';
providers.set('openrouter', openrouterProvider);
```

**Step 3:** Test with Qwen.
```bash
axon config:set providers.openrouter sk-or-xxx
axon -m qwen "write a quicksort"
# Verify: routes to openrouter, streams
```

**Step 4:** Commit.
```bash
git add src/providers/openrouter.ts src/providers/index.ts
git commit -m "feat: OpenRouter provider for Qwen and Gemini models"
```

---

### Task 5.4: Upgrade `axon usage` with savings comparison

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/cli/commands/usage.ts`
- Modify: `/Users/user/Desktop/axon-cli/src/storage/index.ts`

**Step 1:** Add `getUsageSummary` to `AxonStorage`:
```typescript
interface UsageSummary {
  totalTokens: number;
  totalCostUsd: number;
  totalSavedTokens: number;
  predictedSavingsVsOpus: number;  // calculated: what Opus would have cost
  byModel: Array<{ model: string; requests: number; tokens: number; costUsd: number }>;
  byDay: Array<{ date: string; tokens: number; costUsd: number }>;
}

// In getUsageSummary():
// predictedSavingsVsOpus = totalTokens * MODELS['claude-opus-4'].inputPrice / 1_000_000 - totalCostUsd
```

**Step 2:** Update `displayUsage` in `usage.ts` to show "Savings vs Opus baseline" with real numbers.

**Step 3:** Add bar chart for "tokens saved per day" in addition to cost.

**Step 4:** Test.
```bash
# After running several chat sessions:
axon usage
# Verify: real data, savings calculated correctly
```

**Step 5:** Commit.
```bash
git add src/cli/commands/usage.ts src/storage/index.ts
git commit -m "feat: real usage dashboard with savings vs Opus baseline"
```

---

### Task 5.5: Upgrade `axon compare` with streaming

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/cli/commands/compare.ts`

Current `compare.ts` uses `complete()` (blocking). Upgrade to run models in parallel with streaming:

```typescript
// Run all models in parallel
const results = await Promise.allSettled(
  modelIds.map(async modelId => {
    const spinner = ora(`${MODELS[modelId].name}...`).start();
    let content = '';
    let inputEst = 0;

    for await (const chunk of streamComplete({ model: modelId, messages })) {
      content += chunk;
    }

    inputEst = Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4);
    const outputEst = Math.ceil(content.length / 4);
    const cost = calculateCost(modelId, inputEst, outputEst);
    spinner.succeed(`${MODELS[modelId].name}: ${formatCost(cost.total)}`);
    return { model: modelId, content, cost: cost.total, tokens: inputEst + outputEst };
  })
);
```

**Step 1:** Port to parallel streaming.

**Step 2:** Also save comparison results to DB (runs table with model breakdown).

**Step 3:** Build and test.
```bash
npm run build
axon compare "write a sorting algorithm" --models deepseek,sonnet
# Verify: both stream simultaneously, table shows cost delta
```

**Step 4:** Commit.
```bash
git add src/cli/commands/compare.ts
git commit -m "feat: upgrade compare command with parallel streaming"
```

---

### Task 5.6: Polish `/cost` slash command in TUI

**Files:**
- Modify: `/Users/user/Desktop/axon-cli/src/tui/chat-app.tsx`
- Modify: `/Users/user/Desktop/axon-cli/src/runtime/index.ts`

**Step 1:** Add `getSessionCostSummary()` to runtime:
```typescript
getSessionCostSummary(sessionId: string): {
  totalCost: number;
  totalTokens: number;
  savedTokens: number;
  runs: number;
}
```

**Step 2:** Handle `/cost` slash command in `chat-app.tsx`:
```typescript
case 'cost': {
  const summary = runtime.getSessionCostSummary(session.id);
  setMessages(prev => [...prev, {
    role: 'system',
    content: `Session cost: $${summary.totalCost.toFixed(5)} | ${summary.totalTokens} tokens | ${summary.savedTokens} saved | ${summary.runs} runs`
  }]);
  break;
}
```

**Step 3:** Add cost workbench panel in sidebar (Ctrl+K):
```tsx
{workbenchMode === 'cost' && (
  <Box flexDirection="column" padding={1}>
    <Text bold color={theme.colors.primary}>Cost Dashboard</Text>
    <Text>Session: ${costSummary.totalCost.toFixed(5)}</Text>
    <Text>Tokens: {costSummary.totalTokens.toLocaleString()}</Text>
    <Text color={theme.colors.success}>Saved: {costSummary.savedTokens.toLocaleString()} tokens</Text>
  </Box>
)}
```

**Step 4:** Test.
```bash
axon chat
# Run 3 prompts, then type: /cost
# Verify: shows real accumulated cost for this session
# Press Ctrl+K, verify sidebar shows cost panel
```

**Step 5:** Commit.
```bash
git add src/tui/chat-app.tsx src/runtime/index.ts
git commit -m "feat: real-time cost panel in TUI sidebar"
```

---

### Phase 5 package.json additions

No new packages. All crypto is Node built-in.

---

### Phase 5 Success Criteria

- [ ] `axon config:set providers.anthropic sk-xxx` stores encrypted, not plaintext
- [ ] Provider keys survive restart and work correctly (decrypt on use)
- [ ] `axon usage` shows real savings vs Opus baseline (not placeholder)
- [ ] `/cost` in chat shows session-level accumulated spend
- [ ] `axon compare` runs models in parallel (both stream simultaneously)
- [ ] OpenRouter configured → `axon -m qwen "prompt"` works
- [ ] Ctrl+K opens cost workbench in TUI sidebar

---

## Risk Assessment

| Risk | P | I | Score | Mitigation |
|---|---|---|---|---|
| `better-sqlite3` native module rebuild issues on some platforms | 3 | 4 | 12 | Pin to a tested version; test on macOS Apple Silicon specifically; fallback: use `sql.js` (wasm, no native) |
| Ink TUI rendering broken in non-TTY environments (CI, piped output) | 3 | 3 | 9 | Detect `!process.stdout.isTTY` and fall back to plain `run.ts` mode; already pattern in manus index.tsx |
| `streamComplete` not implemented on all providers | 2 | 4 | 8 | AnthropicProvider and DeepSeekProvider already have `streamComplete`. Add OpenRouter in Phase 5. Gemini needs separate implementation — skip until provider added. |
| Token estimation drift (char/4 heuristic vs real) | 4 | 2 | 8 | Use tiktoken for output token counting where accuracy matters (cost display). Keep char/4 for context routing (over-estimate is safe). |
| React state update on unmounted Ink component (streaming continues after Ctrl+C) | 3 | 2 | 6 | Use `AbortController` on the streaming loop; cancel on `runtime.close()` |
| Context engine `buildContextPack` compiled prompt too long | 2 | 4 | 8 | Cap `maxTokens` in `BuildContextPackInput`. Context engine already handles dropping blocks gracefully. |
| Encrypted key storage breaks on first run (no master key yet) | 2 | 4 | 8 | `getOrCreateMasterKey` creates key on first call. Handle migration where keys stored pre-encryption are treated as plaintext. |

---

## Build Order (Dependency Graph)

```
Phase 1:
  Task 1.1 (streaming run.ts)              — no deps
  Task 1.2 (themes.ts)                     — no deps
  Task 1.3 (slash-commands.ts)             — no deps
  Task 1.4 (chat-app.tsx Phase 1)          — needs 1.2, 1.3
  Task 1.5 (register axon chat)            — needs 1.4

Phase 2:
  Task 2.1 (context/engine.ts)             — no deps (pure functions)
  Task 2.2 (wire engine into chat-app)     — needs 2.1, 1.4
  Task 2.3 (wire engine into run.ts)       — needs 2.1

Phase 3:
  Task 3.1 (storage/index.ts)              — no deps (just better-sqlite3)
  Task 3.2 (runtime/index.ts)             — needs 3.1, 2.1, providers/*
  Task 3.3 (upgrade chat-app with runtime) — needs 3.2, 1.4
  Task 3.4 (sessions + usage commands)     — needs 3.1

Phase 4:
  Task 4.1 (policy/index.ts)              — no deps (pure functions)
  Task 4.2 (executeCommand in runtime)    — needs 4.1, 3.2
  Task 4.3 (wire !cmd in chat-app)        — needs 4.2, 3.3
  Task 4.4 (@file reference)              — needs 4.1, 3.2
  Task 4.5 (policy config)               — needs 4.1, config.ts

Phase 5:
  Task 5.1 (security/index.ts)            — no deps (pure Node crypto)
  Task 5.2 (encrypt provider keys)        — needs 5.1
  Task 5.3 (openrouter provider)          — needs providers/index.ts
  Task 5.4 (usage dashboard upgrade)      — needs 3.1
  Task 5.5 (compare streaming)            — needs providers/index.ts
  Task 5.6 (/cost slash command)          — needs 3.2, 3.3
```

---

## tsup Configuration Note

axon-cli uses `tsup`. Verify `package.json` has JSX support for the Ink TUI. If `tsup.config.ts` doesn't exist, create it:

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.jsxImportSource = 'react';
  },
});
```

Add `tsup.config.ts` as Task 0 before Phase 1 begins.

---

## Memory Notes

### Learnings
- axon's `Provider` interface already has `streamComplete?: AsyncIterable<string>` — both Anthropic and DeepSeek providers implement it. Phase 1 streaming just needs to switch from `complete()` to `streamComplete()`.
- manus runtime's `sendUserTurn` uses `resolveConnection → buildProviderAdapter → executeProviderTurn` — this entire chain is replaced in axon by `selectModel → streamComplete`. The cost/session persistence patterns are kept.
- manus `chat-app.tsx` uses a polling `setInterval(900ms)` to refresh UI panels from runtime state. Axon can use the same pattern since the runtime is synchronous for reads.
- manus `LocalStorage` uses `better-sqlite3` with synchronous APIs — axon should use the same (all DB calls are synchronous in manus, which is fine for a CLI).
- context-engine `buildContextPack` is pure — no side effects, no imports beyond internal helpers. Safe to port as a standalone module.
- OpenRouter requires `HTTP-Referer` and `X-Title` headers for attribution — don't forget these.
- Ink 5.x requires React 18. Already in axon `package.json`.
- `ink-text-input` and `ink-spinner` are used by manus chat-app. Need to add these to axon `package.json`.

### Patterns
- Port order matters: themes → slash-commands → chat-app → storage → runtime → policy → security
- Each manus package imports are `@manus-code/xyz` — when porting, replace with relative paths like `../../storage/index.js`
- axon keeps its own `ModelId` and `MODELS` table — never import manus's model concepts
- manus's `ProviderName` / `ProviderConnection` / `ProviderAdapter` system is entirely replaced by axon's `Provider` interface + `selectModel()`
- Chat-app Phase 1 has direct provider calls; Phase 3 upgrades to runtime calls — this 2-step migration keeps Phase 1 testable independently
- `spawnSync` for shell commands is safe for a CLI tool (blocking is acceptable, it's user-initiated)

### Verification
- Phase 1: `axon "hello"` streams. `axon chat` opens Ink TUI.
- Phase 2: `/context` shows token savings. Same prompt twice = cache hit.
- Phase 3: Restart chat and see previous messages.
- Phase 4: `!ls` runs. `!rm` queues in balanced mode.
- Phase 5: `axon config:set providers.anthropic KEY` stores encrypted.

### Additional deps to add to package.json
```json
{
  "ink-text-input": "^5.0.1",
  "ink-spinner": "^5.0.0",
  "better-sqlite3": "^9.4.3"
}
```
```json
{
  "@types/better-sqlite3": "^7.6.11"
}
```
