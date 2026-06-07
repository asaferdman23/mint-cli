# mint-tui (Go / BubbleTea)

A native Go terminal UI for the Mint CLI, built on the same stack as opencode:
**BubbleTea** + **Lipgloss** + **Glamour**.

## Architecture

The Go binary renders the entire UI and drives the existing TypeScript brain
over a newline-delimited JSON (NDJSON) protocol — no agent logic is
reimplemented in Go.

```
┌─────────────────────────────┐   NDJSON over stdio   ┌──────────────────────────┐
│  mint-tui (Go)              │ ───── prompt ───────► │  node brain (TypeScript)  │
│  BubbleTea + Lipgloss +     │ ◄──── AgentEvents ─── │  mint stream-agent        │
│  Glamour                    │                       │  runBrain() unchanged     │
└─────────────────────────────┘                       └──────────────────────────┘
```

- **`protocol/`** — `Event` (AgentEvent mirror), `Command`, and `Bridge`
  (spawns `node <entry> stream-agent`, speaks NDJSON).
- **`theme/`** — opencode + tokyonight palettes (Lipgloss colors).
- **`ui/`** — BubbleTea root model, message/markdown rendering, status bar.
- **`main.go`** — flag parsing, bridge startup, `tea.NewProgram`.

The TypeScript side exposes the bridge via `mint stream-agent` (see
`src/cli/stream-agent.ts`): it reads `{"type":"prompt",...}` commands on stdin
and writes each brain `AgentEvent` as one JSON line on stdout. Approval gates
emit `{"type":"approval.needed",...}` and park until `{"type":"approval","ok":...}`
arrives.

## Build

```bash
cd tui-go
go build -o mint-tui .
```

## Run

Requires the TS CLI to be built first (`npm run build` in the repo root):

```bash
./mint-tui --entry ../dist/cli/index.js --mode diff --theme opencode
```

Flags:
- `--entry` (required) — path to `dist/cli/index.js`
- `--node` — node binary (default `node`)
- `--mode` — `diff` | `auto` | `plan` | `yolo`
- `--theme` — `opencode` | `tokyonight`
- `--cwd` — working directory (default: current)

## Keys

- `enter` — send / run
- `ctrl+h` — help overlay
- `ctrl+c` — quit
- `pgup` / `pgdn` — scroll transcript
- `/clear`, `/diff`, `/auto`, `/plan`, `/yolo` — inline commands
- `y` / `n` — answer approval prompts

## Status

Implemented: chat with thick left-border messages (user=blue,
assistant=orange), Glamour markdown + syntax highlighting, streaming text,
live activity line, status bar, help overlay (`ctrl+h`), **model picker
(`ctrl+o`)**, **theme switcher (`ctrl+t`, live preview)**, **files sidebar
(`ctrl+b`)**, **@-file completion**, approval gate, NDJSON bridge.

See [SPEC.md](SPEC.md) for the full protocol and UI contract.

Not yet ported (need brain-side support, not just UI): session switcher
(`ctrl+s`), logs page (`ctrl+l`).
