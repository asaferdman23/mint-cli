# mint-tui — Specification

Native Go terminal UI for the Mint CLI, built on the opencode stack
(BubbleTea + Lipgloss + Glamour). The Go process owns all rendering; the
existing TypeScript brain runs unchanged as a child process. The two
communicate over a newline-delimited JSON (NDJSON) protocol on stdio.

---

## 1. Goals & non-goals

**Goals**
- A 1:1 opencode-style TUI (themed colors, thick-border messages, overlays).
- Zero reimplementation of agent logic — reuse the tested TS brain verbatim.
- Deterministic, testable rendering (pure functions over model state).

**Non-goals**
- Porting providers / tools / classifier / retrieval to Go.
- Session persistence or a logs page (future; needs brain-side support).

---

## 2. Process architecture

```
┌──────────────────────────────┐   stdin  (Command NDJSON)   ┌───────────────────────────┐
│ mint-tui (Go)                │ ──────────────────────────► │ node dist/cli/index.js     │
│   BubbleTea event loop       │                             │   stream-agent             │
│   Lipgloss + Glamour render  │ ◄────────────────────────── │   runBrain() async gen     │
└──────────────────────────────┘   stdout (Event NDJSON)     └───────────────────────────┘
```

- The Go binary spawns `node <entry> stream-agent` with the working directory
  set to the target repo (`protocol.Start`).
- All child **stdout** lines are JSON `Event`s. The Go reader (`Bridge.Next`)
  decodes each line; non-JSON lines are skipped (defensive against stray logs).
- The Go UI writes JSON `Command`s to the child **stdin** (`Bridge.Send`).
- Child **stderr** passes through for debugging.
- Scanner buffer is 8 MiB to tolerate large tool outputs on one line.

---

## 3. Wire protocol (NDJSON)

### 3.1 Commands — Go → brain

One JSON object per line on the child's stdin.

| `type`     | Fields                          | Meaning                              |
|------------|---------------------------------|--------------------------------------|
| `prompt`   | `task`, `mode`, `model?`        | Run a task. `mode` ∈ diff/auto/plan/yolo. `model` omitted ⇒ auto-route. |
| `approval` | `ok` (bool)                     | Answer the open approval gate.       |
| `cancel`   | —                               | Abort the running task (SIGABRT-equivalent via AbortController). |

Prompts received while one is running are queued and processed serially.

### 3.2 Events — brain → Go

One JSON object per line on the child's stdout. These mirror the brain's
`AgentEvent` union; the Go `protocol.Event` struct decodes the subset the UI
needs and ignores the rest. Every event carries `type` and `ts`.

| `type`              | Key fields                                            | UI effect                          |
|---------------------|------------------------------------------------------|------------------------------------|
| `meta`              | `models[]{id,tier}`, `paths[]`, `cwd`                | Populate model picker + @-completion. Emitted once at startup. |
| `session.start`     | `sessionId`, `mode`                                  | (informational)                    |
| `classify`          | `model`, `kind`, `complexity`, `confidence`          | Set active model; activity line.   |
| `context.retrieved` | `files[]{path}`, `tokensUsed`, `tokenBudget`         | Activity line.                     |
| `text.delta`        | `text`                                               | Append to streaming buffer.        |
| `tool.call`         | `id`, `name`, `input`                                | Activity line; track touched file. |
| `tool.result`       | `id`, `ok`, `output`, `durationMs`                   | (reserved)                         |
| `diff.applied`      | `file`, `additions`, `deletions`                     | Mark file EDIT in sidebar.         |
| `cost.delta`        | `usd`, `inputTokens`, `outputTokens`                 | Accumulate cost + tokens.          |
| `approval.needed`   | `reason`, `payload`                                  | Open approval gate; park brain.    |
| `warn` / `error`    | `message` / `error`                                  | Status line.                       |
| `done`              | `result{output,model,totalCostUsd,durationMs,…}`     | Finalize last assistant message.   |

### 3.3 Approval handshake

`approval.needed` cannot carry the brain's `resolve` function across the wire.
The TS bridge emits a serializable `approval.needed`, then **parks** the brain
on a promise until the Go UI sends `{"type":"approval","ok":<bool>}`. The
bridge resolves the promise and the brain continues.

---

## 4. UI model (BubbleTea)

`ui.Model` is the single source of truth. `Update` is pure over
`(Model, tea.Msg) → (Model, Cmd)`; `View` is pure over `Model → string`.

### 4.1 State

- transcript: `messages[]`, `streaming` buffer, `busy`
- routing: `mode`, `model`, `tokens`, `cost`, `activity`, `statusErr`
- gates: `approval` (reason or "")
- overlays: `overlay` ∈ {"", help, model, theme}, `overlayIndex`
- panels: `showSidebar`, `files[]` (touched this session)
- pickers: `models[]`, `filePaths[]`, `themeName`
- completion: `fileIndex`

### 4.2 Layout (rows, top→bottom)

```
┌ viewport (chat)            [+ sidebar if ctrl+b and width≥80] ┐
│ … thick-border messages, Glamour markdown, streaming         │
├ input area (3 rows): editor | busy activity | approval prompt┤
│   (@-completion dropdown floats above the editor)            │
├ status bar (1 row)                                           ┤
└──────────────────────────────────────────────────────────────┘
```

Overlays (help / model / theme) replace the whole view, centered via
`lipgloss.Place`.

### 4.3 Rendering rules

- **User message**: `You` header + `┃ ` border in `theme.Secondary` (blue).
- **Assistant message**: `Mint` header + `┃ ` border in `theme.Primary`
  (orange); body rendered through Glamour; footer `model · time · cost`.
- **Status bar**: `ctrl+h help │ Context: <tok>  Cost: $<n> │ <mode> │ <model>`.
- **Sidebar**: `Files` + `A/M/R/$` glyphs (NEW/EDIT/READ/BASH), path truncated
  left with `…`, footer `<tok> · $<cost>`.

### 4.4 Keybindings

| Key            | Action                                             |
|----------------|----------------------------------------------------|
| `enter`        | Send prompt / select completion / commit overlay   |
| `ctrl+c`       | Quit                                               |
| `ctrl+h`       | Toggle help overlay                                |
| `ctrl+o`       | Model picker                                        |
| `ctrl+t`       | Theme switcher (live preview, Esc reverts)         |
| `ctrl+b`       | Toggle files sidebar (needs width ≥ 80)            |
| `↑/↓`          | Navigate overlay / @-completion                    |
| `pgup/pgdn`    | Scroll transcript                                  |
| `esc`          | Close overlay (revert theme preview)               |
| `y`/`n`        | Answer approval gate                               |
| `@<query>`     | File completion from the project index             |
| `/clear`, `/diff`, `/auto`, `/plan`, `/yolo` | Inline commands (handled in Go) |

---

## 5. Theming

`theme.Theme` is a flat struct of `lipgloss.Color`. `theme.Current` is the
active palette; `theme.SetByName` swaps it. Built-in: `opencode` (default),
`tokyonight`. The theme switcher previews live on `↑/↓` and reverts on `esc`.
Adding a theme = append to `theme.Named`.

---

## 6. Error & lifecycle behavior

- Child **stream close** (`io.EOF`) ⇒ mark idle, keep UI alive (no crash).
- Brain **exception** ⇒ `error` event ⇒ status line; UI stays usable.
- **Quit** (`ctrl+c`) ⇒ `Bridge.Close` kills the child and waits.
- Malformed stdin/stdout lines are ignored on both sides.

---

## 7. Build, run, test

```bash
# brain (TypeScript)
npm run build

# UI (Go)
cd tui-go && go build -o mint-tui .
./mint-tui --entry ../dist/cli/index.js --mode diff --theme opencode
```

Flags: `--entry` (required), `--node`, `--mode`, `--theme`, `--cwd`.

**Tests** (`go test ./...`): rendering (borders, status bar, sidebar),
event application (text/cost accumulation, done finalize, file tracking),
overlays (model commit, theme preview/apply), and @-completion (filter +
apply). The brain bridge is verified by a live NDJSON round-trip.

---

## 8. Future work

- Model/theme overlays are done; remaining opencode parity items:
  **session switcher** (`ctrl+s`) and **logs page** (`ctrl+l`) — both need
  brain-side session/log surfaces, not just UI.
- `tool.result` is decoded but not yet surfaced (planned: inline tool output).
- Glamour style currently uses the stock "dark" theme; a palette-matched
  custom `ansi.StyleConfig` is a refinement.
