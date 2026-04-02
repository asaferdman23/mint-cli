# TUI UX Redesign — Design Spec

## Overview

Redesign Mint CLI's TUI from a basic chat interface into a polished, professional terminal experience that wows newcomers in the first 10 seconds and rewards power users with depth. Visual personality: clean 95% of the time, delightful at key moments (pipeline execution, savings celebrations).

## Design Decisions

| Decision | Choice | Alternatives Considered |
|---|---|---|
| Visual personality | Hybrid — clean baseline + wow moments | Dense/professional, Vibrant/modern, Hacker aesthetic |
| Welcome experience | Rich welcome card with ASCII logo | Minimal prompt, Interactive onboarding |
| Pipeline display | Inline phase blocks in message stream | Horizontal progress bar, Right panel timeline |
| Input enhancements | All three (autocomplete, multi-line, chips) | Individual features only |
| Implementation approach | Big bang rewrite | Incremental layering, Parallel new TUI |

## Color Palette (from landing page CSS)

```
--cyan:       #00d4ff   (primary — logo, accents, active elements)
--cyan-dim:   #4d6a82   (muted text, borders)
--bg:         #07090d   (not controlled by TUI — terminal bg)
--green:      #3fb950   (success, cost savings, done phases)
--orange:     #f0883e   (savings badge, warnings)
--yellow:     #e6b450   (vim normal mode, keyboard hints)
--border:     #1c2b3a   (card borders)
--border-hi:  #263d52   (active input border)
```

---

## Component Architecture

### New Files

| File | Purpose |
|---|---|
| `src/tui/components/WelcomeScreen.tsx` | ASCII logo + stats + quick start + keyboard hints |
| `src/tui/components/PipelinePhase.tsx` | Collapsible phase block (done=one-line, active=streaming) |
| `src/tui/components/SlashAutocomplete.tsx` | Floating dropdown when input starts with `/` |
| `src/tui/components/ContextChips.tsx` | Project context badges above input |

### Rewritten Files

| File | Changes |
|---|---|
| `src/tui/components/MessageList.tsx` | Pipeline phase rendering, no right-panel dependency |
| `src/tui/components/InputBox.tsx` | Multi-line, autocomplete integration, context chips slot |
| `src/tui/components/StatusBar.tsx` | Model + tokens + cost + savings + agent mode + version |
| `src/tui/App.tsx` | Remove right panel, add welcome state, phase tracking |

### Deleted Files

| File | Reason |
|---|---|
| `src/tui/components/Banner.tsx` | Replaced by WelcomeScreen |
| `src/tui/components/RightPanel.tsx` | Info moves to inline phases + status bar |
| `src/tui/components/FileTracker.tsx` | Was only used by RightPanel |

### Unchanged Files

| File | Reason |
|---|---|
| `src/tui/hooks/useVimInput.ts` | Solid implementation, no changes needed |
| `src/tui/vim/*` | Cursor, motions, transitions all stay |
| `src/tui/utils/*` | colorize, expandTabs stay |

### Extended Files

| File | Changes |
|---|---|
| `src/tui/hooks/useAgentEvents.ts` | Add `pipelinePhases` state + `onPhaseUpdate` callback |

---

## Component Specs

### 1. WelcomeScreen

**Renders when:** `messages.length === 0`. Disappears after first message.

**Layout (top to bottom):**

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   ███╗   ███╗██╗███╗   ██╗████████╗     ██████╗██╗     ██╗│
│   ████╗ ████║██║████╗  ██║╚══██╔══╝    ██╔════╝██║     ██║│
│   ██╔████╔██║██║██╔██╗ ██║   ██║       ██║     ██║     ██║│
│   ██║╚██╔╝██║██║██║╚██╗██║   ██║       ██║     ██║     ██║│
│   ██║ ╚═╝ ██║██║██║ ╚████║   ██║       ╚██████╗███████╗██║│
│   ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝╚══════╝╚═╝│
│                     AI CODING CLI                          │
│                                                            │
│              18 models  ·  4 agents  ·  97% cheaper        │
│                                                            │
│  ┌─ QUICK START ──────────┐  ┌─ KEYBOARD ────────────────┐ │
│  │ mint init — index proj │  │ Esc   → normal mode       │ │
│  │ /models  — all models  │  │ i     → insert mode       │ │
│  │ /agent   — switch mode │  │ Enter → send message      │ │
│  │ /usage   — session     │  │ Ctrl+C→ exit              │ │
│  └────────────────────────┘  └───────────────────────────┘ │
│                                                            │
│  [I] Ask anything… or try "fix the auth bug" ▎             │
│  auto · 0 tokens · $0                          v0.2.0     │
└────────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface WelcomeScreenProps {
  modelCount?: number;    // default 18
  agentCount?: number;    // default 4
  savingsLabel?: string;  // default "97%"
}
```

**Implementation notes:**
- ASCII art stored as a const string array (one line per element)
- All `<Text color="cyan">` for logo, dim cyan for subtitle
- Stats row uses `<Box gap={4} justifyContent="center">`
- Cards use `<Box borderStyle="single" borderColor="gray">`
- Takes full available height via `flexGrow={1}`

### 2. PipelinePhase

**Renders inline within MessageList for messages with phase data.**

**Types:**
```typescript
type PhaseName = 'SCOUT' | 'ARCHITECT' | 'BUILDER' | 'REVIEWER';
type PhaseStatus = 'pending' | 'active' | 'done' | 'skipped';

interface PipelinePhaseData {
  name: PhaseName;
  status: PhaseStatus;
  model?: string;
  duration?: number;       // ms
  cost?: number;
  summary?: string;        // one-line when collapsed
  streamingContent?: string;
}

interface PipelinePhaseProps {
  phase: PipelinePhaseData;
}
```

**Render rules by status:**

`done`:
```
✓ SCOUT · groq/llama-3.1-8b · 0.3s · $0.0001
  4 files → tokenService.ts, auth.ts, middleware.ts, types.ts
```
- `✓` in green, name in dim, metadata in dimmer
- Summary line indented, dim color

`active`:
```
│ ⠋ BUILDER · deepseek-v3
│ export async function refreshToken(payload: TokenPayload) {
│   const lock = await acquireMutex('token-refresh');
│   try {
│ ▋
```
- Left border: 2px cyan (via `borderLeft` or `│` prefix)
- Spinner (`ink-spinner`) + bold cyan name
- Streaming content below with cursor `▋`

`pending`:
```
○ REVIEWER · waiting
```
- All dim/gray

`skipped`:
```
– ARCHITECT · skipped (trivial task)
```
- Dim with explanation

### 3. SlashAutocomplete

**Renders when:** `input.startsWith('/') && input.length >= 1 && !isBusy`

**Behavior:**
- Positioned as a `<Box>` directly above the InputBox
- Filters registered slash commands by prefix match
- Shows up to 5 matches: command name + description
- Active item highlighted with cyan background
- Navigation: `↑`/`↓` arrows, `Tab`/`Enter` selects, `Esc` dismisses
- On select: replaces input with the full command name + space

**Props:**
```typescript
interface SlashAutocompleteProps {
  input: string;
  commands: { name: string; description: string }[];
  selectedIndex: number;
  onSelect: (command: string) => void;
}
```

**Render:**
```
  /model  — show/switch model
  /models — list all 18 models      ◀ highlighted
```

### 4. ContextChips

**Renders when:** project has been indexed (`.mint/context.json` exists)

**Layout:** horizontal row of colored badges above input box.

```
[typescript] [847 files] [react] [indexed]
```

**Props:**
```typescript
interface ContextChipsProps {
  chips: { label: string; color: string }[];
}
```

**Chip colors:**
- Language → green
- File count → blue
- Framework → orange
- Index status → cyan

**Source:** Read from `.mint/context.json` on startup, cache in App state. Only re-read on `/init` or when file changes.

### 5. MessageList (rewrite)

**Changes from current:**
1. Remove `estimateTokens` display from inline (moves to StatusBar)
2. Add pipeline phase rendering
3. Full-width (no right panel sharing space)

**Extended ChatMessage type:**
```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  cost?: number;
  isStreaming?: boolean;
  phases?: PipelinePhaseData[];  // NEW
}
```

**Render logic:**
```
if (msg.phases && msg.phases.length > 0) {
  // Render phase blocks, then final content below last phase
  return <PipelineMessage phases={msg.phases} content={msg.content} ... />
} else {
  // Regular chat message (slash command responses, errors, etc.)
  return <ChatBubble ... />
}
```

**Turn separators:** Keep `─` lines between turns, but use full terminal width.

### 6. InputBox (rewrite)

**Phase 1 additions (autocomplete):**
- Accept `commands` prop for slash command list
- Track `autocompleteIndex` state
- Intercept `↑`/`↓`/`Tab`/`Enter` when autocomplete is visible
- Render `<SlashAutocomplete>` above when active

**Phase 2 additions (multi-line):**
- Track input as string with `\n` for newlines
- `Shift+Enter` in INSERT mode → insert `\n`
- `Enter` alone → submit
- Box height = `Math.min(lineCount, 6)` lines
- Vim `j`/`k` move between lines in NORMAL mode

**Phase 3 additions (context chips):**
- Accept `contextChips` prop
- Render `<ContextChips>` above the input border when present

**Existing behavior preserved:**
- Vim mode (NORMAL/INSERT) with block cursor
- `[N]`/`[I]` mode indicator
- Token estimate on right
- Busy/routing spinner states

### 7. StatusBar (rewrite)

**New layout:**
```
deepseek-v3 │ 4.2k tokens │ $0.0021 │ -97% vs Opus          auto │ v0.2.0
```

**Props:**
```typescript
interface StatusBarProps {
  currentModel: ModelId | null;
  sessionTokens: number;
  sessionCost: number;
  savingsPct?: number;
  agentMode: string;
  version?: string;      // default from package.json
}
```

**Formatting:**
- Model name: plain text
- Tokens: abbreviated (4.2k, 12.3k, 1.2M)
- Cost: `$0.0021` or `0.21¢` for sub-cent
- Savings: green `-97% vs Opus` (only if > 0)
- Agent mode: colored (yolo=red, plan=blue, diff=yellow, auto=green)
- Separators: dim `│`
- Left-aligned info, right-aligned mode + version

### 8. App.tsx (rewrite)

**Removed:**
- `RightPanel` import and rendering
- `Banner` import
- `FileTracker` dependency

**New state:**
```typescript
const [showWelcome, setShowWelcome] = useState(true);
const [pipelinePhases, setPipelinePhases] = useState<PipelinePhaseData[]>([]);
const [contextChips, setContextChips] = useState<ContextChip[] | null>(null);
const [autocompleteVisible, setAutocompleteVisible] = useState(false);
const [autocompleteIndex, setAutocompleteIndex] = useState(0);
```

**Welcome → Chat transition:**
- `showWelcome` starts `true`
- On first `handleSubmit`, set `showWelcome = false`
- WelcomeScreen unmounts, MessageList mounts

**Pipeline phase tracking:**
- Extend `runPipeline` chunk handling with new chunk types: `phase-start`, `phase-done`
- On `phase-start`: add/update phase in `pipelinePhases` with `status: 'active'`
- On `phase-done`: update phase to `status: 'done'` with summary, cost, duration
- On `done`: attach `pipelinePhases` to the assistant message

**Context chips loading:**
- On mount, check if `.mint/context.json` exists
- If yes, parse and create chips from `language`, `totalFiles`, framework detection
- Re-read after `/init` command

**New layout:**
```tsx
<Box flexDirection="column" height={rows}>
  {errorMsg && <ErrorBar message={errorMsg} />}

  {showWelcome && messages.length === 0 ? (
    <WelcomeScreen />
  ) : (
    <MessageList messages={messages} streamingContent={streamingContent} />
  )}

  {contextChips && <ContextChips chips={contextChips} />}
  {autocompleteVisible && (
    <SlashAutocomplete
      input={input}
      commands={allCommands}
      selectedIndex={autocompleteIndex}
      onSelect={handleAutocompleteSelect}
    />
  )}

  <InputBox
    value={input}
    onChange={setInput}
    onSubmit={handleSubmit}
    isBusy={isBusy}
    isRouting={isRouting}
  />

  <StatusBar
    currentModel={currentModel}
    sessionTokens={sessionTokens}
    sessionCost={sessionCost}
    savingsPct={savingsPct}
    agentMode={agentMode}
  />
</Box>
```

---

## useAgentEvents Extension

Add pipeline phase tracking to the existing hook:

```typescript
// New state
const [pipelinePhases, setPipelinePhases] = useState<PipelinePhaseData[]>([]);

// New callbacks
const onPhaseStart = useCallback((name: PhaseName, model?: string) => {
  setPipelinePhases(prev => [
    ...prev.map(p => p.status === 'active' ? { ...p, status: 'done' as const } : p),
    { name, status: 'active', model },
  ]);
}, []);

const onPhaseDone = useCallback((name: PhaseName, result: PhaseResult) => {
  setPipelinePhases(prev =>
    prev.map(p => p.name === name
      ? { ...p, status: 'done', duration: result.duration, cost: result.cost, summary: result.summary }
      : p
    )
  );
}, []);

const resetPhases = useCallback(() => setPipelinePhases([]), []);
```

---

## Pipeline Chunk Extensions

The `runPipeline` generator in `src/pipeline/index.ts` needs two new chunk types:

```typescript
type PipelineChunk =
  | { type: 'search'; filesFound?: string[] }
  | { type: 'context'; filesFound?: string[]; contextTokens?: number }
  | { type: 'phase-start'; phase: PhaseName; model?: string }       // NEW
  | { type: 'phase-done'; phase: PhaseName; summary: string;        // NEW
      model?: string; duration?: number; cost?: number }
  | { type: 'text'; text?: string }
  | { type: 'done'; result: PipelineResult }
  | { type: 'error'; error: string };
```

These chunks are emitted at the start and end of each agent phase, allowing the TUI to update inline phase blocks in real-time.

---

## Slash Command Registry Integration

The autocomplete pulls from the existing command registry (from the TUI redesign plan). Commands available:

| Command | Description |
|---|---|
| `/help` | Show all commands + keyboard shortcuts |
| `/clear` | Clear chat history + reset counters |
| `/model` | Show/switch model (`/model sonnet`) |
| `/models` | List all 18 models with tiers + pricing |
| `/agent` | Show/switch agent mode (`/agent yolo`) |
| `/usage` | Session stats + all-time totals |

The autocomplete component receives the command list from App.tsx and filters by prefix.

---

## Implementation Phases

### Phase 1 — Core Layout (highest impact)
- WelcomeScreen component
- App.tsx layout rewrite (remove right panel, add welcome state)
- StatusBar rewrite
- Delete Banner, RightPanel, FileTracker

### Phase 2 — Pipeline Phases
- PipelinePhase component
- MessageList rewrite with phase rendering
- useAgentEvents extension
- Pipeline chunk extensions (phase-start, phase-done)

### Phase 3 — Input Enhancements
- SlashAutocomplete component
- InputBox autocomplete integration
- Multi-line input support
- ContextChips component

---

## Success Criteria

- [ ] `mint` (no args) shows ASCII art welcome screen with MINT CLI logo
- [ ] Welcome disappears after first message
- [ ] Pipeline phases render inline as collapsible blocks
- [ ] Active phase streams with cyan left border + cursor
- [ ] Completed phases collapse to one-line summary
- [ ] No right panel — full-width chat
- [ ] StatusBar shows model + tokens + cost + savings + mode
- [ ] Typing `/` triggers autocomplete dropdown
- [ ] Shift+Enter adds newline in input
- [ ] Context chips appear when project is indexed
- [ ] `npm run build` exits 0
- [ ] Vim mode (NORMAL/INSERT) works unchanged
