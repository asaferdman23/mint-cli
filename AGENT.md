# AGENT.md — Mint CLI UX/UI Operating Manual

> Cross-tool agent guide (Claude Code, Codex, Cursor, Aider).
> Read this **before** touching anything under `src/tui/`, `src/cli/`, or any user-facing surface.
> Source of truth for *how* Mint should look, feel, and behave in the terminal.

---

## 0. What you are working on

**Mint CLI** is a zero-setup AI coding CLI (`mint`). It is a React app rendered to the terminal via **Ink**. The TUI is the product — every keystroke, color, and millisecond of latency is the UX.

Your job as an agent is to keep the TUI **fast, calm, legible, and trustworthy**. Speed and clarity beat features.

| Surface           | Location                                  | Owner of look & feel       |
| ----------------- | ----------------------------------------- | -------------------------- |
| Active TUI        | `src/tui/`                                | This file                  |
| CLI entry / flags | `src/cli/index.ts`                        | This file                  |
| Reference design  | `claude-code-src/src/components/`         | Read-only — learn from it  |
| Project rules     | `MINT.md`                                 | Build/conventions          |

`claude-code-src/` is a vendored snapshot of Anthropic's Claude Code TUI. **Do not edit it.** It exists so you can read patterns: theming, prompt input, message rendering, permission dialogs, fullscreen layout, virtual message list, design-system primitives. When in doubt about "how should this look?" — grep `claude-code-src/src/components/`.

---

## 1. The Mint UX principles (override defaults)

These are non-negotiable. If a request conflicts with them, surface the conflict before implementing.

1. **Calm by default.** No emoji, no exclamation marks, no animations longer than necessary. Spinners only when work is actually happening. Quiet success — loud only on error or approval gates.
2. **One line of trace, not ten.** Users want to know *what's happening now*, not see a firehose. See `BrainToolInspector.tsx` — one trace sentence + collapsible plan rows.
3. **Responsive layout is mandatory.** Read `process.stdout.columns`. Hide tokens < 90 cols, hide cost/savings < 110 cols. Pattern: `StatusBar.tsx` lines around `showDetails/showTokens/showExtras`.
4. **Color carries meaning.** Reserve red for errors, yellow for `diff`/warning, green for success/`auto`-safe, cyan for info/Mint identity, blue for `plan`, magenta for thinking. Never use color as decoration.
5. **Trust requires reversibility.** Any state-changing action (file write, shell exec, network call) goes through an approval gate unless mode is `yolo`. Never silently mutate.
6. **Keystroke is sacred.** No re-renders that drop a key. No layout shifts when a spinner starts. Use `useInput` consumers, never block the event loop.
7. **Don't invent visual chrome.** Reuse existing primitives (`Box`, `Text`, `Spinner`, the components in `src/tui/components/`). New border styles, new icon characters, new badge shapes — almost always wrong.

---

## 2. Visual language — exact tokens

### Colors (Ink `Text` color prop)

| Token    | Use                                              |
| -------- | ------------------------------------------------ |
| `cyan`   | Mint identity, info, trace pointers (`›`), borders for the trace panel |
| `green`  | Assistant header (`Mint`), success, `auto` mode  |
| `yellow` | `diff` mode, warnings, slash-command hints       |
| `blue`   | `plan` mode                                      |
| `red`    | Errors, `yolo` mode, quota ≥ 90%                 |
| `white`  | User-typed examples, primary content             |
| `dimColor` | Separators, metadata, model tag, hints         |

Status bar mode colors live in `StatusBar.tsx:modeColor()` — extend there, not inline.

### Typography (Ink Text props)

- `bold` for section titles ("Trace", "Try typing one of these:", assistant header).
- `dimColor` for everything secondary. If in doubt, dim it.
- Never use `inverse`, `underline`, `strikethrough` for chrome. They render inconsistently across terminals.

### Glyphs (already in use — reuse, don't add)

```
›   bullet for examples / trace pointer
─   separator line (use Math.min(60, termWidth - 2) characters)
●   session start
◆   classify
▤   context retrieved
§   phase
◇   plan
→ ← tool call / result
~   diff proposed
+   diff applied
$   cost delta
⇢   compact
?   approval needed
⚠   warn
✗   error
✓   done
```

Adding a new glyph requires a reason. Don't reach for emoji.

### Borders

- `borderStyle="round"` only. No `single`, `double`, `bold` — they look broken in some terminals.
- Border color matches the panel's semantic color (cyan for trace, cyan for welcome hints).

### Spacing

- `paddingX={1}` for any boxed UI. `paddingX={2}` only inside the welcome hints box.
- Vertical: `marginTop={1}` between unrelated sections, `marginTop={0}` between related rows.
- Never use `paddingY > 1` — terminals are short.

---

## 3. Component map (what already exists — do not duplicate)

### `src/tui/components/`

| Component             | Owns                                                       |
| --------------------- | ---------------------------------------------------------- |
| `BrainApp.tsx`        | Top-level layout; orchestrates input/messages/trace        |
| `MessageList.tsx`     | Chat transcript, virtualization, assistant/user rendering  |
| `MarkdownContent.tsx` | Renders markdown to Ink (code fences, bold, inline code)   |
| `InputBox.tsx`        | Prompt input, autocomplete, busy spinner with elapsed sec  |
| `SlashAutocomplete.tsx` | Slash command list + match filter                        |
| `StatusBar.tsx`       | Bottom bar: model, mode, cost, tokens, quota               |
| `ContextChips.tsx`    | Inline `[label]` chips above input                         |
| `WelcomeScreen.tsx`   | First-run logo + example prompts + shortcut hints          |
| `BrainToolInspector.tsx` | Trace panel — Tab to toggle                             |

**Before adding a component, grep for an existing one that does ~80% of what you need and extend it.** The fastest way to ruin Mint's coherence is parallel components with slightly different conventions.

---

## 4. Patterns to copy from `claude-code-src/` (read these)

When you need to build something, find the analogue in the reference snapshot first:

| If you're building…                  | Read first                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------- |
| A theme/color token                  | `utils/theme.ts`, `components/design-system/color.ts`, `ThemedText.tsx`     |
| A prompt input feature               | `components/PromptInput/PromptInput.tsx` + `PromptInputFooter.tsx`          |
| A permission/approval dialog         | `components/permissions/PermissionDialog.tsx`, `PermissionRequest.tsx`     |
| A message kind (user/assistant/tool) | `components/messages/*` (one file per kind — follow that split)             |
| A modal / fullscreen pane            | `components/FullscreenLayout.tsx`, `design-system/Pane.tsx`, `Dialog.tsx`   |
| A picker / fuzzy select              | `components/design-system/FuzzyPicker.tsx`, `ModelPicker.tsx`               |
| A list with selection                | `design-system/ListItem.tsx`, `components/ui/OrderedList.tsx`               |
| A status indicator                   | `design-system/StatusIcon.tsx`, `LoadingState.tsx`, `ProgressBar.tsx`       |
| Virtualized scrolling chat           | `components/VirtualMessageList.tsx`                                         |
| Diff rendering                       | `components/StructuredDiff*.tsx`, `components/diff/`                       |
| Spinner / shimmer                    | `components/Spinner.tsx`, `Spinner/`                                        |

**Do not import from `claude-code-src/`.** It is reference material, not a dependency. Reimplement the pattern in `src/tui/` using our existing primitives and theme.

---

## 5. Interaction & keybinding rules

- `Enter` submits — unless an autocomplete row is selected, then it accepts the row (see `InputBox.tsx`).
- `Tab` toggles secondary panes (trace inspector). Never use Tab for autocomplete acceptance — it conflicts with terminal focus.
- `Ctrl+C` is owned by the top-level `BrainApp` (`useInput` with `key.ctrl`). Child components must skip ctrl keys: `if (key.ctrl) return;`
- `Esc` cancels/closes the most recent overlay.
- Arrow keys: in an input, cursor; over a selection list, navigate items. Never both.
- All slash commands start with `/` and are filtered live. Source list: `SLASH_COMMANDS` in `SlashAutocomplete.tsx`. Adding a command = one entry, nothing else.

---

## 6. Streaming, spinners, and "is this hung?" UX

The single most important latency rule in Mint:

> If something takes > 1s, show motion. If it takes > 8s, show elapsed seconds.

See `InputBox.tsx:THINKING_ELAPSED_THRESHOLD_SEC = 8`. Pattern: tick a `setInterval(1000)` while `isBusy`, append `(Ns)` to the spinner label after the threshold. Do not poll more often than 1Hz — it costs frames.

Streaming assistant output: append to the *same* message object (`isStreaming: true`), never push new rows per token. `MessageList` already handles this.

---

## 7. Approvals, modes, and safety

Modes (see `StatusBar.tsx`): `auto` (green), `diff` (yellow, default), `plan` (blue), `yolo` (red).

Rules:
- `diff` mode shows proposed changes before applying. **Never** apply file edits without an `approval.needed` event in non-`auto`/`yolo` mode.
- The mode badge is always visible — it's the user's safety net. Never hide it for layout reasons.
- Quota warnings: yellow at 70%, red at 90%. Don't add a third threshold.

---

## 8. Codex compatibility

This file is the canonical agent guide. For tools that look for different filenames:

- **Claude Code** reads `CLAUDE.md` and `AGENT.md`. This file works directly.
- **Codex / OpenAI agents** read `AGENTS.md`. Symlink or copy this file to `AGENTS.md` if needed; the content is tool-agnostic.
- **Cursor** reads `.cursorrules` — point it here with a one-line include.
- **Aider** reads `CONVENTIONS.md` — same.

Whatever the host, the directives in sections 1–7 apply unchanged. Do not author tool-specific UX variants.

---

## 9. Code conventions (UX-relevant)

From `MINT.md` plus what the codebase actually does:

- TypeScript strict. No `any` in UI code — it hides prop drift that breaks rendering.
- React function components, `React.ReactElement` return type (not `JSX.Element`).
- Hooks: prefer `useState` + `useEffect` with explicit deps. No `useReducer` unless state shape is genuinely complex (see `BrainApp` — even it doesn't need one).
- Props interfaces named `<Component>Props`, defined immediately above the component.
- No default exports for components — named exports only (matches existing files).
- File header comment: one short sentence describing what the component owns. See `MessageList.tsx`, `InputBox.tsx`.
- Inline comments only when *why* is non-obvious. Don't restate the code.

---

## 10. Before you ship a UI change — verification checklist

You cannot claim a UI change is "done" without these. Run them.

```bash
npm run build           # tsup must succeed
npm run typecheck       # tsc --noEmit must succeed
npm test                # vitest run must pass
node dist/cli/index.js  # actually launch it and look at it
```

Then in the running TUI:
- [ ] Resize the terminal to 60, 80, 120 cols — nothing clips, nothing wraps weird.
- [ ] Type a slash command, accept it, submit — autocomplete dismisses correctly.
- [ ] Trigger a long task — spinner appears within 100ms, elapsed seconds appear by 8s.
- [ ] Ctrl+C exits cleanly.
- [ ] Mode badge in StatusBar matches current mode.
- [ ] Welcome screen renders on first run (no messages).

If you cannot run the TUI (e.g. sandboxed agent), **say so explicitly** in your final message. Do not claim visual correctness from code-reading alone.

---

## 11. Anti-patterns — automatic rejection

- New ASCII logos / banners outside `WelcomeScreen.tsx`.
- Hard-coded hex colors anywhere in `src/tui/`. Use theme tokens / Ink color names.
- `console.log` left in TUI code paths — it corrupts the alt-screen.
- `setInterval` without cleanup in a `useEffect`.
- `process.exit(0)` outside `BrainApp` / CLI entry.
- New border styles other than `round`.
- Emoji in user-facing strings (unless the user explicitly asked).
- "Loading…" without a spinner. "Done!" with an exclamation mark.
- New top-level layout component when `BrainApp` could host the change.
- Adding a dependency for something Ink + `chalk` already do.

---

## 12. When the user asks for something this guide forbids

State the conflict in one sentence, propose the closest aligned alternative, and ask. Example:

> The guide forbids emoji in default output (sec 1.1). I can add a `--emoji` flag that opts in, or use the existing `✓ / ✗` glyphs. Which do you want?

The user can override anything in this file — but they should know they're overriding it.
