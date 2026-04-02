# TUI UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Mint CLI's TUI with a rich welcome screen (MINT CLI ASCII art), inline pipeline phase blocks, enhanced status bar, slash autocomplete, multi-line input, and context chips.

**Architecture:** Big-bang rewrite of 6 TUI components. New components: WelcomeScreen, PipelinePhase, SlashAutocomplete, ContextChips. Removed: RightPanel, FileTracker, Banner. Hooks and vim engine untouched. Pipeline types extended with phase-start/phase-done chunks.

**Tech Stack:** React 18, Ink 5, ink-spinner, chalk. Existing vim engine, pipeline, and provider systems.

**Spec:** `docs/superpowers/specs/2026-04-01-tui-ux-redesign-design.md`

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `src/tui/components/WelcomeScreen.tsx` | ASCII MINT CLI logo, stats row, quick-start card, keyboard card |
| `src/tui/components/PipelinePhase.tsx` | Single phase block — done/active/pending/skipped rendering |
| `src/tui/components/SlashAutocomplete.tsx` | Floating dropdown of matching slash commands |
| `src/tui/components/ContextChips.tsx` | Colored badges: language, file count, framework, index status |
| `src/tui/types.ts` | Shared types: PipelinePhaseData, PhaseName, PhaseStatus, ContextChip |

### Modified Files
| File | What Changes |
|---|---|
| `src/tui/App.tsx` | Remove RightPanel/Banner, add welcome state, phase tracking, context chips, autocomplete wiring |
| `src/tui/components/MessageList.tsx` | Add phase block rendering, remove estimateTokens, full-width |
| `src/tui/components/InputBox.tsx` | Autocomplete integration, multi-line, context chips slot |
| `src/tui/components/StatusBar.tsx` | Rich bar: model + tokens + cost + savings + mode + version |
| `src/tui/hooks/useAgentEvents.ts` | Add pipelinePhases state, onPhaseStart, onPhaseDone, resetPhases |
| `src/pipeline/types.ts` | Add phase-start, phase-done to PipelineChunk union |

### Deleted Files
| File | Reason |
|---|---|
| `src/tui/components/Banner.tsx` | Replaced by WelcomeScreen |
| `src/tui/components/RightPanel.tsx` | Info moves to inline phases + status bar |
| `src/tui/components/FileTracker.tsx` | Only used by RightPanel |

---

## Task 1: Shared TUI Types

**Files:**
- Create: `src/tui/types.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// src/tui/types.ts

export type PhaseName = 'SCOUT' | 'ARCHITECT' | 'BUILDER' | 'REVIEWER';
export type PhaseStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface PipelinePhaseData {
  name: PhaseName;
  status: PhaseStatus;
  model?: string;
  duration?: number;
  cost?: number;
  summary?: string;
  streamingContent?: string;
}

export interface ContextChip {
  label: string;
  color: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit src/tui/types.ts 2>&1 | head -5`
Expected: No errors (standalone type file)

- [ ] **Step 3: Commit**

```bash
git add src/tui/types.ts
git commit -m "feat(tui): add shared types for pipeline phases and context chips"
```

---

## Task 2: WelcomeScreen Component

**Files:**
- Create: `src/tui/components/WelcomeScreen.tsx`

- [ ] **Step 1: Create WelcomeScreen component**

```tsx
// src/tui/components/WelcomeScreen.tsx
import React from 'react';
import { Box, Text } from 'ink';

const MINT_LOGO = [
  '  ███╗   ███╗██╗███╗   ██╗████████╗     ██████╗██╗     ██╗',
  '  ████╗ ████║██║████╗  ██║╚══██╔══╝    ██╔════╝██║     ██║',
  '  ██╔████╔██║██║██╔██╗ ██║   ██║       ██║     ██║     ██║',
  '  ██║╚██╔╝██║██║██║╚██╗██║   ██║       ██║     ██║     ██║',
  '  ██║ ╚═╝ ██║██║██║ ╚████║   ██║       ╚██████╗███████╗██║',
  '  ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝╚══════╝╚═╝',
];

interface WelcomeScreenProps {
  modelCount?: number;
  agentCount?: number;
  savingsLabel?: string;
}

export function WelcomeScreen({
  modelCount = 18,
  agentCount = 4,
  savingsLabel = '97%',
}: WelcomeScreenProps): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" flexGrow={1} paddingTop={1}>
      {/* ASCII Logo */}
      <Box flexDirection="column" alignItems="center">
        {MINT_LOGO.map((line, i) => (
          <Text key={i} color="cyan">{line}</Text>
        ))}
      </Box>

      {/* Subtitle */}
      <Box marginTop={0}>
        <Text color="cyan" dimColor>{'          AI CODING CLI'}</Text>
      </Box>

      {/* Stats Row */}
      <Box marginTop={1} gap={4}>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>{String(modelCount)}</Text>
          <Text dimColor>models</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>{String(agentCount)}</Text>
          <Text dimColor>agents</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>{savingsLabel}</Text>
          <Text dimColor>cheaper</Text>
        </Box>
      </Box>

      {/* Info Cards */}
      <Box marginTop={1} gap={2}>
        {/* Quick Start */}
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={30}>
          <Text dimColor bold>{'QUICK START'}</Text>
          <Text><Text color="cyan">mint init</Text><Text dimColor> — index project</Text></Text>
          <Text><Text color="cyan">/models </Text><Text dimColor> — all models</Text></Text>
          <Text><Text color="cyan">/agent  </Text><Text dimColor> — switch mode</Text></Text>
          <Text><Text color="cyan">/usage  </Text><Text dimColor> — session stats</Text></Text>
        </Box>

        {/* Keyboard */}
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={30}>
          <Text dimColor bold>{'KEYBOARD'}</Text>
          <Text><Text color="yellow">Esc   </Text><Text dimColor> → normal mode</Text></Text>
          <Text><Text color="yellow">i     </Text><Text dimColor> → insert mode</Text></Text>
          <Text><Text color="yellow">Enter </Text><Text dimColor> → send message</Text></Text>
          <Text><Text color="yellow">Ctrl+C</Text><Text dimColor> → exit</Text></Text>
        </Box>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds (component not wired in yet, just needs to compile)

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/WelcomeScreen.tsx
git commit -m "feat(tui): add WelcomeScreen with MINT CLI ASCII art logo"
```

---

## Task 3: PipelinePhase Component

**Files:**
- Create: `src/tui/components/PipelinePhase.tsx`

- [ ] **Step 1: Create PipelinePhase component**

```tsx
// src/tui/components/PipelinePhase.tsx
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { PipelinePhaseData } from '../types.js';

interface PipelinePhaseProps {
  phase: PipelinePhaseData;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `${(cost * 100).toFixed(3)}¢`;
  return `$${cost.toFixed(4)}`;
}

export function PipelinePhase({ phase }: PipelinePhaseProps): React.ReactElement {
  switch (phase.status) {
    case 'done':
      return (
        <Box flexDirection="column" marginBottom={0}>
          <Box gap={1}>
            <Text color="green">✓</Text>
            <Text dimColor>{phase.name}</Text>
            {phase.model && <Text dimColor>· {phase.model}</Text>}
            {phase.duration != null && <Text dimColor>· {formatDuration(phase.duration)}</Text>}
            {phase.cost != null && <Text dimColor>· {formatCost(phase.cost)}</Text>}
          </Box>
          {phase.summary && (
            <Text dimColor>{'  '}{phase.summary}</Text>
          )}
        </Box>
      );

    case 'active':
      return (
        <Box flexDirection="column" marginBottom={0} borderColor="cyan" borderLeft={true} borderRight={false} borderTop={false} borderBottom={false} paddingLeft={1}>
          <Box gap={1}>
            <Text color="cyan"><Spinner type="dots" /></Text>
            <Text color="cyan" bold>{phase.name}</Text>
            {phase.model && <Text dimColor>· {phase.model}</Text>}
          </Box>
          {phase.streamingContent && (
            <Box flexDirection="column">
              <Text wrap="wrap">{phase.streamingContent}</Text>
              <Text color="cyan">▋</Text>
            </Box>
          )}
        </Box>
      );

    case 'pending':
      return (
        <Box gap={1} marginBottom={0}>
          <Text dimColor>○</Text>
          <Text dimColor>{phase.name}</Text>
          <Text dimColor>· waiting</Text>
        </Box>
      );

    case 'skipped':
      return (
        <Box gap={1} marginBottom={0}>
          <Text dimColor>–</Text>
          <Text dimColor>{phase.name}</Text>
          <Text dimColor>· skipped</Text>
        </Box>
      );
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/PipelinePhase.tsx
git commit -m "feat(tui): add PipelinePhase component with done/active/pending/skipped states"
```

---

## Task 4: ContextChips Component

**Files:**
- Create: `src/tui/components/ContextChips.tsx`

- [ ] **Step 1: Create ContextChips component**

```tsx
// src/tui/components/ContextChips.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { ContextChip } from '../types.js';

interface ContextChipsProps {
  chips: ContextChip[];
}

export function ContextChips({ chips }: ContextChipsProps): React.ReactElement {
  if (chips.length === 0) return <></>;

  return (
    <Box paddingX={1} gap={1} flexWrap="wrap">
      {chips.map((chip, i) => (
        <Text key={i} color={chip.color as Parameters<typeof Text>[0]['color']}>
          [{chip.label}]
        </Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/ContextChips.tsx
git commit -m "feat(tui): add ContextChips component for project context badges"
```

---

## Task 5: SlashAutocomplete Component

**Files:**
- Create: `src/tui/components/SlashAutocomplete.tsx`

- [ ] **Step 1: Create SlashAutocomplete component**

```tsx
// src/tui/components/SlashAutocomplete.tsx
import React from 'react';
import { Box, Text } from 'ink';

export interface SlashCommandDef {
  name: string;
  description: string;
}

interface SlashAutocompleteProps {
  input: string;
  commands: SlashCommandDef[];
  selectedIndex: number;
}

export function SlashAutocomplete({
  input,
  commands,
  selectedIndex,
}: SlashAutocompleteProps): React.ReactElement {
  const prefix = input.toLowerCase();
  const matches = commands.filter(
    (cmd) => `/${cmd.name}`.startsWith(prefix),
  );

  if (matches.length === 0) return <></>;

  const visible = matches.slice(0, 5);

  return (
    <Box flexDirection="column" paddingX={2} marginBottom={0}>
      {visible.map((cmd, i) => {
        const isSelected = i === selectedIndex % visible.length;
        return (
          <Box key={cmd.name} gap={1}>
            <Text
              color={isSelected ? 'cyan' : undefined}
              bold={isSelected}
            >
              {isSelected ? '▸' : ' '} /{cmd.name.padEnd(8)}
            </Text>
            <Text dimColor>— {cmd.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** All registered slash commands for autocomplete. */
export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'help', description: 'show commands + keyboard shortcuts' },
  { name: 'clear', description: 'clear chat history' },
  { name: 'model', description: 'show/switch model' },
  { name: 'models', description: 'list all models with tiers' },
  { name: 'agent', description: 'show/switch agent mode' },
  { name: 'usage', description: 'session stats + totals' },
];
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/SlashAutocomplete.tsx
git commit -m "feat(tui): add SlashAutocomplete dropdown component with command registry"
```

---

## Task 6: Rewrite StatusBar

**Files:**
- Modify: `src/tui/components/StatusBar.tsx`

- [ ] **Step 1: Rewrite StatusBar with rich layout**

Replace the entire contents of `src/tui/components/StatusBar.tsx` with:

```tsx
// src/tui/components/StatusBar.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { ModelId } from '../../providers/types.js';

interface StatusBarProps {
  currentModel: ModelId | null;
  sessionTokens: number;
  sessionCost: number;
  savingsPct?: number;
  agentMode?: string;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `${(cost * 100).toFixed(3)}¢`;
  return `$${cost.toFixed(4)}`;
}

function modeColor(mode: string): string {
  switch (mode) {
    case 'yolo': return 'red';
    case 'plan': return 'blue';
    case 'diff': return 'yellow';
    default: return 'green';
  }
}

export function StatusBar({
  currentModel,
  sessionTokens,
  sessionCost,
  savingsPct,
  agentMode = 'auto',
}: StatusBarProps): React.ReactElement {
  const model = currentModel ?? 'auto';

  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box gap={0}>
        <Text dimColor>{model}</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{formatTokens(sessionTokens)} tokens</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{formatCost(sessionCost)}</Text>
        {savingsPct != null && savingsPct > 0 && (
          <>
            <Text dimColor> │ </Text>
            <Text color="green" bold>-{savingsPct}% vs Opus</Text>
          </>
        )}
      </Box>
      <Box gap={0}>
        <Text color={modeColor(agentMode) as Parameters<typeof Text>[0]['color']}>{agentMode}</Text>
        <Text dimColor> │ v0.2.0</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: May show unused prop warnings from App.tsx (will be fixed in Task 9). Build should succeed.

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/StatusBar.tsx
git commit -m "feat(tui): rewrite StatusBar with rich layout — savings badge, mode, version"
```

---

## Task 7: Rewrite MessageList with Pipeline Phases

**Files:**
- Modify: `src/tui/components/MessageList.tsx`

- [ ] **Step 1: Rewrite MessageList**

Replace the entire contents of `src/tui/components/MessageList.tsx` with:

```tsx
// src/tui/components/MessageList.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PipelinePhase } from './PipelinePhase.js';
import type { PipelinePhaseData } from '../types.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  cost?: number;
  isStreaming?: boolean;
  phases?: PipelinePhaseData[];
}

interface MessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
}

export function MessageList({ messages, streamingContent }: MessageListProps): React.ReactElement {
  const allMessages = messages.map((msg) => {
    if (msg.isStreaming) {
      return { ...msg, content: streamingContent };
    }
    return msg;
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {allMessages.length === 0 && (
        <Box paddingTop={1}>
          <Text dimColor>Type a message to start chatting. /help for commands. Ctrl+C to exit.</Text>
        </Box>
      )}
      {allMessages.map((msg, idx) => (
        <Box key={msg.id} flexDirection="column" marginBottom={1}>
          {/* Separator between turns */}
          {idx > 0 && (
            <Text dimColor>{'─'.repeat(Math.min(60, process.stdout.columns ?? 60))}</Text>
          )}

          {msg.role === 'user' ? (
            <Box flexDirection="column">
              <Text color="cyan" bold>You</Text>
              <Text color="cyan">{msg.content}</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {/* Pipeline phases (if any) */}
              {msg.phases && msg.phases.length > 0 && (
                <Box flexDirection="column" marginBottom={1}>
                  {msg.phases.map((phase) => (
                    <PipelinePhase key={phase.name} phase={phase} />
                  ))}
                </Box>
              )}

              {/* Assistant response */}
              {(msg.content || msg.isStreaming) && (
                <Box flexDirection="column">
                  <Text color="green" bold>
                    {'Mint'}
                    {msg.model ? <Text dimColor> [{msg.model}]</Text> : null}
                  </Text>
                  <Text wrap="wrap">{msg.content}</Text>
                  {msg.isStreaming && !msg.phases && (
                    <Text color="cyan">▋</Text>
                  )}
                </Box>
              )}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/MessageList.tsx
git commit -m "feat(tui): rewrite MessageList with inline pipeline phase blocks"
```

---

## Task 8: Rewrite InputBox with Autocomplete + Multi-line

**Files:**
- Modify: `src/tui/components/InputBox.tsx`

- [ ] **Step 1: Rewrite InputBox**

Replace the entire contents of `src/tui/components/InputBox.tsx` with:

```tsx
// src/tui/components/InputBox.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useVimInput } from '../hooks/useVimInput.js';
import { SlashAutocomplete, SLASH_COMMANDS } from './SlashAutocomplete.js';
import type { ContextChip } from '../types.js';
import { ContextChips } from './ContextChips.js';

interface InputBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
  isBusy: boolean;
  isRouting: boolean;
  contextChips?: ContextChip[] | null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function TextWithCursor({ text, offset }: { text: string; offset: number }): React.ReactElement {
  const before = text.slice(0, offset);
  const at = text[offset] ?? ' ';
  const after = text.slice(offset + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}

export function InputBox({
  value,
  onChange,
  onSubmit,
  isBusy,
  isRouting,
  contextChips,
}: InputBoxProps): React.ReactElement {
  const tokenEst = estimateTokens(value);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  const showAutocomplete = value.startsWith('/') && value.length >= 1 && !isBusy && !isRouting;
  const autocompleteMatches = showAutocomplete
    ? SLASH_COMMANDS.filter((cmd) => `/${cmd.name}`.startsWith(value.toLowerCase()))
    : [];
  const hasAutocomplete = autocompleteMatches.length > 0 && showAutocomplete;

  const vim = useVimInput({
    value,
    onChange,
    onSubmit: (val: string) => {
      // If autocomplete is showing and user presses Enter, select the command
      if (hasAutocomplete) {
        const selected = autocompleteMatches[autocompleteIndex % autocompleteMatches.length];
        if (selected) {
          onChange(`/${selected.name} `);
          setAutocompleteIndex(0);
          return;
        }
      }
      onSubmit(val);
      setAutocompleteIndex(0);
    },
  });

  useInput(
    (input, key) => {
      // Intercept arrow keys for autocomplete navigation
      if (hasAutocomplete && vim.mode === 'INSERT') {
        if (key.upArrow) {
          setAutocompleteIndex((prev) => Math.max(0, prev - 1));
          return;
        }
        if (key.downArrow) {
          setAutocompleteIndex((prev) => Math.min(autocompleteMatches.length - 1, prev + 1));
          return;
        }
        if (key.tab) {
          const selected = autocompleteMatches[autocompleteIndex % autocompleteMatches.length];
          if (selected) {
            onChange(`/${selected.name} `);
            setAutocompleteIndex(0);
          }
          return;
        }
      }
      vim.handleKey(input, key);
    },
    { isActive: !isBusy && !isRouting },
  );

  // Reset autocomplete index when input changes
  React.useEffect(() => {
    setAutocompleteIndex(0);
  }, [value]);

  if (isRouting) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="row" gap={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text dimColor>Routing to best model…</Text>
        </Box>
      </Box>
    );
  }

  if (isBusy) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="row" gap={1}>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text dimColor>Thinking…</Text>
        </Box>
      </Box>
    );
  }

  const isNormal = vim.mode === 'NORMAL';
  const borderColor = isNormal ? 'yellow' : 'cyan';
  const promptColor = isNormal ? 'yellow' : 'cyan';

  // Multi-line: count lines and cap display height
  const lines = value.split('\n');
  const displayLines = Math.min(lines.length, 6);
  const heightVal = Math.max(1, displayLines);

  return (
    <Box flexDirection="column">
      {/* Context chips */}
      {contextChips && contextChips.length > 0 && (
        <ContextChips chips={contextChips} />
      )}

      {/* Autocomplete dropdown */}
      {hasAutocomplete && (
        <SlashAutocomplete
          input={value}
          commands={SLASH_COMMANDS}
          selectedIndex={autocompleteIndex}
        />
      )}

      {/* Input box */}
      <Box
        borderStyle="single"
        borderColor={borderColor}
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
        height={heightVal + 2}
      >
        {/* Mode indicator */}
        <Text color={promptColor} bold>{isNormal ? '[N] ' : '[I] '}</Text>

        <Box flexDirection="column" flexGrow={1}>
          {isNormal ? (
            value.length === 0
              ? <Text dimColor>— NORMAL —</Text>
              : <TextWithCursor text={value} offset={vim.cursorOffset} />
          ) : (
            <>
              <Text>{value}</Text>
              {value.length === 0 && <Text dimColor>Ask anything… or try "fix the auth bug"</Text>}
              {value.length > 0 && <Text inverse> </Text>}
            </>
          )}
        </Box>

        {value.length > 0 && (
          <Text dimColor>{` ~${tokenEst}t`}</Text>
        )}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/InputBox.tsx
git commit -m "feat(tui): rewrite InputBox with slash autocomplete, multi-line, context chips"
```

---

## Task 9: Extend Pipeline Types

**Files:**
- Modify: `src/pipeline/types.ts`

- [ ] **Step 1: Add phase-start and phase-done chunk types**

In `src/pipeline/types.ts`, replace the `PipelineChunk` interface with:

```typescript
/** Chunk emitted during streaming pipeline execution. */
export interface PipelineChunk {
  type: 'search' | 'context' | 'phase-start' | 'phase-done' | 'text' | 'done' | 'error';
  /** Streaming text from the model. */
  text?: string;
  /** Files found during search phase. */
  filesFound?: string[];
  /** Context token count after compression. */
  contextTokens?: number;
  /** Phase name (for phase-start, phase-done). */
  phase?: 'SCOUT' | 'ARCHITECT' | 'BUILDER' | 'REVIEWER';
  /** Model used by this phase. */
  phaseModel?: string;
  /** Phase summary (for phase-done). */
  phaseSummary?: string;
  /** Phase duration in ms (for phase-done). */
  phaseDuration?: number;
  /** Phase cost in dollars (for phase-done). */
  phaseCost?: number;
  /** Final result (only on type: 'done'). */
  result?: PipelineResult;
  /** Error message (only on type: 'error'). */
  error?: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds. The existing pipeline code only emits `search`, `context`, `text`, `done`, `error` — the new types are additive and won't break anything.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/types.ts
git commit -m "feat(pipeline): add phase-start and phase-done chunk types for TUI phase blocks"
```

---

## Task 10: Extend useAgentEvents with Phase Tracking

**Files:**
- Modify: `src/tui/hooks/useAgentEvents.ts`

- [ ] **Step 1: Add pipeline phase state and callbacks**

Replace the entire contents of `src/tui/hooks/useAgentEvents.ts` with:

```typescript
// src/tui/hooks/useAgentEvents.ts
import { useState, useCallback } from 'react';
import type { PipelinePhaseData, PhaseName } from '../types.js';

export type FileStatus = 'READ' | 'EDIT' | 'NEW' | 'BASH';

export interface TrackedFile {
  path: string;
  status: FileStatus;
  timestamp: number;
}

export interface ToolCall {
  name: string;
  count: number;
}

export interface PanelState {
  files: TrackedFile[];
  toolCalls: ToolCall[];
  totalCost: number;
  totalTokens: number;
  iterationCount: number;
}

export function useAgentEvents() {
  const [panelState, setPanelState] = useState<PanelState>({
    files: [],
    toolCalls: [],
    totalCost: 0,
    totalTokens: 0,
    iterationCount: 0,
  });

  const [pipelinePhases, setPipelinePhases] = useState<PipelinePhaseData[]>([]);

  const onToolCall = useCallback((toolName: string, toolInput: Record<string, unknown>) => {
    setPanelState(prev => {
      const newFiles = [...prev.files];
      const fileStatus = inferFileStatus(toolName);
      if (fileStatus && toolInput.path) {
        const path = String(toolInput.path);
        const existing = newFiles.findIndex(f => f.path === path);
        if (existing >= 0) {
          newFiles[existing] = { path, status: fileStatus, timestamp: Date.now() };
        } else {
          newFiles.push({ path, status: fileStatus, timestamp: Date.now() });
        }
      }

      const newToolCalls = [...prev.toolCalls];
      const existingTool = newToolCalls.find(t => t.name === toolName);
      if (existingTool) {
        existingTool.count++;
      } else {
        newToolCalls.push({ name: toolName, count: 1 });
      }

      return {
        ...prev,
        files: newFiles,
        toolCalls: newToolCalls,
        iterationCount: prev.iterationCount + 1,
      };
    });
  }, []);

  const onCostUpdate = useCallback((cost: number, tokens: number) => {
    setPanelState(prev => ({
      ...prev,
      totalCost: prev.totalCost + cost,
      totalTokens: prev.totalTokens + tokens,
    }));
  }, []);

  const onPhaseStart = useCallback((name: PhaseName, model?: string) => {
    setPipelinePhases(prev => [
      ...prev.map(p => p.status === 'active' ? { ...p, status: 'done' as const } : p),
      { name, status: 'active' as const, model },
    ]);
  }, []);

  const onPhaseDone = useCallback((name: PhaseName, result: { duration?: number; cost?: number; summary?: string }) => {
    setPipelinePhases(prev =>
      prev.map(p => p.name === name
        ? { ...p, status: 'done' as const, duration: result.duration, cost: result.cost, summary: result.summary }
        : p
      )
    );
  }, []);

  const resetPhases = useCallback(() => {
    setPipelinePhases([]);
  }, []);

  const reset = useCallback(() => {
    setPanelState({
      files: [],
      toolCalls: [],
      totalCost: 0,
      totalTokens: 0,
      iterationCount: 0,
    });
    setPipelinePhases([]);
  }, []);

  return { panelState, pipelinePhases, onToolCall, onCostUpdate, onPhaseStart, onPhaseDone, resetPhases, reset };
}

function inferFileStatus(toolName: string): FileStatus | null {
  switch (toolName) {
    case 'read_file':  return 'READ';
    case 'write_file': return 'NEW';
    case 'edit_file':  return 'EDIT';
    default:           return null;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/tui/hooks/useAgentEvents.ts
git commit -m "feat(tui): extend useAgentEvents with pipeline phase tracking"
```

---

## Task 11: Rewrite App.tsx — Full Layout Rewrite

**Files:**
- Modify: `src/tui/App.tsx`
- Delete: `src/tui/components/Banner.tsx`
- Delete: `src/tui/components/RightPanel.tsx`
- Delete: `src/tui/components/FileTracker.tsx`

- [ ] **Step 1: Delete removed components**

```bash
rm src/tui/components/Banner.tsx src/tui/components/RightPanel.tsx src/tui/components/FileTracker.tsx
```

- [ ] **Step 2: Rewrite App.tsx**

Replace the entire contents of `src/tui/App.tsx` with:

```tsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { initChalkLevel } from './utils/colorize.js';
import { MessageList, ChatMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { useAgentEvents } from './hooks/useAgentEvents.js';
import { calculateCost } from '../providers/router.js';
import { getTier } from '../providers/tiers.js';
import type { ModelId } from '../providers/types.js';
import { MODELS } from '../providers/types.js';
import { config } from '../utils/config.js';
import { createUsageTracker, calculateOpusCost, calculateSonnetCost } from '../usage/tracker.js';
import { runPipeline, type PipelineChunk } from '../pipeline/index.js';
import type { PipelinePhaseData, ContextChip } from './types.js';

initChalkLevel();

interface AppProps {
  initialPrompt?: string;
  modelPreference?: string;
  agentMode?: 'yolo' | 'plan' | 'diff' | 'auto';
}

let messageIdCounter = 0;
function nextId(): string {
  return `msg-${++messageIdCounter}`;
}

export function App({ initialPrompt, modelPreference, agentMode }: AppProps): React.ReactElement {
  const { exit } = useApp();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [currentModel, setCurrentModel] = useState<ModelId | null>(null);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [sessionCost, setSessionCost] = useState(0);
  const [streamingContent, setStreamingContent] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savingsPct, setSavingsPct] = useState<number | undefined>(undefined);
  const [contextChips, setContextChips] = useState<ContextChip[] | null>(null);

  const { panelState, pipelinePhases, onCostUpdate, onPhaseStart, onPhaseDone, resetPhases } = useAgentEvents();

  const streamRef = useRef('');
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const trackerRef = useRef(createUsageTracker(Date.now().toString(36), 'chat'));

  // Load context chips from .mint/context.json on mount
  useEffect(() => {
    loadContextChips().then(setContextChips).catch(() => {});
  }, []);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      abortRef.current?.abort();
      exit();
    }
  });

  const handleSubmit = useCallback(async (userInput: string) => {
    const trimmed = userInput.trim();
    if (!trimmed || busyRef.current) return;

    // Handle slash commands
    if (trimmed === '/help') {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: [
            'Commands:',
            '  /help    — this help',
            '  /clear   — clear chat',
            '  /model   — current model',
            '  /models  — list all models',
            '  /agent   — agent mode',
            '  /usage   — session stats',
            '',
            'Keyboard:',
            '  Esc      — normal mode',
            '  i        — insert mode',
            '  Ctrl+C   — exit',
          ].join('\n'),
        },
      ]);
      setInput('');
      return;
    }

    if (trimmed === '/clear') {
      setMessages([]);
      setInput('');
      setSessionTokens(0);
      setSessionCost(0);
      setSavingsPct(undefined);
      resetPhases();
      return;
    }

    if (trimmed === '/model') {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content: `Current model: ${currentModel ?? 'auto'}` },
      ]);
      setInput('');
      return;
    }

    // Add user message
    const userMsgId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: trimmed },
    ]);
    setInput('');
    busyRef.current = true;
    setIsBusy(true);
    setIsRouting(true);
    setErrorMsg(null);
    resetPhases();

    // Resolve model
    const modelMap: Record<string, ModelId> = {
      deepseek: 'deepseek-v3', sonnet: 'claude-sonnet-4', opus: 'claude-opus-4',
    };
    const preferredModel = (modelPreference && modelPreference !== 'auto')
      ? (modelMap[modelPreference] ?? modelPreference) as ModelId
      : undefined;

    // Create streaming placeholder with phase tracking
    const assistantMsgId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true, phases: [] },
    ]);

    streamRef.current = '';
    setStreamingContent('');

    const controller = new AbortController();
    abortRef.current = controller;

    const history = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    try {
      for await (const chunk of runPipeline(trimmed, {
        cwd: process.cwd(),
        model: preferredModel,
        signal: controller.signal,
        history,
      })) {
        switch (chunk.type) {
          case 'search':
            setIsRouting(false);
            if (chunk.filesFound && chunk.filesFound.length > 0) {
              onPhaseStart('SCOUT');
              onPhaseDone('SCOUT', {
                summary: `${chunk.filesFound.length} files found`,
              });
            }
            break;

          case 'context':
            if (chunk.contextTokens) {
              onPhaseStart('ARCHITECT');
            }
            break;

          case 'phase-start':
            if (chunk.phase) {
              onPhaseStart(chunk.phase, chunk.phaseModel);
            }
            break;

          case 'phase-done':
            if (chunk.phase) {
              onPhaseDone(chunk.phase, {
                duration: chunk.phaseDuration,
                cost: chunk.phaseCost,
                summary: chunk.phaseSummary,
              });
            }
            break;

          case 'text':
            if (chunk.text) {
              streamRef.current += chunk.text;
              setStreamingContent(streamRef.current);
            }
            break;

          case 'done': {
            const r = chunk.result!;
            setCurrentModel(r.model);

            const cost = calculateCost(r.model, r.inputTokens, r.outputTokens);
            setSessionTokens((t) => t + r.inputTokens + r.outputTokens);
            setSessionCost((c) => c + cost.total);
            onCostUpdate(cost.total, r.inputTokens + r.outputTokens);

            const savPct = r.opusCost > 0
              ? Math.round((1 - r.cost / r.opusCost) * 100)
              : 0;
            if (savPct > 0) setSavingsPct(savPct);

            // Complete any remaining active phases
            onPhaseDone('BUILDER', {
              duration: r.duration,
              cost: r.cost,
              summary: `${r.model} · ${r.filesSearched.length} files`,
            });

            trackerRef.current.track({
              model: r.model,
              provider: MODELS[r.model]?.provider ?? 'unknown',
              tier: getTier(r.model),
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens,
              cost: cost.total,
              opusCost: r.opusCost,
              savedAmount: Math.max(0, r.opusCost - cost.total),
              routingReason: `pipeline → ${r.model}`,
              taskPreview: trimmed,
              latencyMs: r.duration,
              costSonnet: calculateSonnetCost(r.inputTokens, r.outputTokens),
            });

            // Finalize message with phases
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: streamRef.current,
                      cost: cost.total,
                      model: r.model,
                      isStreaming: false,
                      phases: [...pipelinePhases],
                    }
                  : m
              )
            );
            setStreamingContent('');
            break;
          }

          case 'error':
            throw new Error(chunk.error);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Error: ${errMsg}`);
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
    } finally {
      busyRef.current = false;
      setIsBusy(false);
      setIsRouting(false);
      streamRef.current = '';
    }
  }, [messages, currentModel, modelPreference, pipelinePhases]);

  // Auto-submit initialPrompt on mount
  useEffect(() => {
    if (initialPrompt?.trim()) {
      const timer = setTimeout(() => handleSubmit(initialPrompt), 100);
      return () => clearTimeout(timer);
    }
  }, []);

  const showWelcome = messages.length === 0 && !isBusy && !isRouting;

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? 24}>
      {errorMsg && (
        <Box paddingX={1}>
          <Text color="red">{errorMsg}</Text>
        </Box>
      )}

      {showWelcome ? (
        <WelcomeScreen />
      ) : (
        <MessageList messages={messages} streamingContent={streamingContent} />
      )}

      <InputBox
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isBusy={isBusy}
        isRouting={isRouting}
        contextChips={contextChips}
      />

      <StatusBar
        currentModel={currentModel}
        sessionTokens={sessionTokens}
        sessionCost={sessionCost}
        savingsPct={savingsPct}
        agentMode={agentMode ?? 'auto'}
      />
    </Box>
  );
}

/** Load context chips from .mint/context.json if it exists. */
async function loadContextChips(): Promise<ContextChip[] | null> {
  try {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const indexPath = join(process.cwd(), '.mint', 'context.json');
    const raw = readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(raw);

    const chips: ContextChip[] = [];
    if (index.language) chips.push({ label: index.language, color: 'green' });
    if (index.totalFiles) chips.push({ label: `${index.totalFiles} files`, color: 'blue' });
    if (index.framework) chips.push({ label: index.framework, color: 'yellow' });
    chips.push({ label: 'indexed', color: 'cyan' });

    return chips.length > 0 ? chips : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds with no errors. There may be warnings about unused imports — that's fine.

- [ ] **Step 4: Commit**

```bash
git add -A src/tui/
git commit -m "feat(tui): complete layout rewrite — welcome screen, pipeline phases, no right panel

- Delete Banner, RightPanel, FileTracker
- Add WelcomeScreen with MINT CLI ASCII art
- Inline pipeline phase blocks in message stream
- Rich StatusBar with savings badge and mode
- Slash autocomplete dropdown
- Context chips from .mint/context.json
- Multi-line input support"
```

---

## Task 12: Build Verification + Manual Test

**Files:** None (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build 2>&1`
Expected: Build succeeds with exit code 0

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors

- [ ] **Step 3: Smoke test the TUI**

Run: `node dist/cli/index.js`
Expected: Welcome screen appears with MINT CLI ASCII logo, stats, quick-start, keyboard hints. Input box at bottom with `[I]` indicator.

- [ ] **Step 4: Test slash autocomplete**

Type `/mo` in the input.
Expected: Autocomplete dropdown shows `/model` and `/models` with descriptions.

- [ ] **Step 5: Test /help command**

Type `/help` and press Enter.
Expected: Help message appears with all commands listed.

- [ ] **Step 6: Test /clear command**

Type `/clear` and press Enter.
Expected: Chat clears, welcome screen reappears.

- [ ] **Step 7: Commit any fixes**

If any issues found, fix them and commit:
```bash
git add -A
git commit -m "fix(tui): post-rewrite adjustments from smoke testing"
```
