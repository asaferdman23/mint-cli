# Manual Testing Checklist

Run this checklist before every release. Pass criteria: every item either PASSES or is explicitly moved to `KNOWN_ISSUES.md` with a reason.

Test environment: set `MINT_GATEWAY_URL` to your dev gateway, or use production cautiously.

---

## A. Install & First Run

- [ ] **A1.** `npm i -g usemint-cli@<version>` installs cleanly on macOS
- [ ] **A2.** `npm i -g usemint-cli@<version>` installs cleanly on Windows (PowerShell)
- [ ] **A3.** `npm i -g usemint-cli@<version>` installs cleanly on Linux
- [ ] **A4.** After fresh install + `mint logout` (or clean config), typing `mint` shows the welcome screen (not an empty TUI)
- [ ] **A5.** Picking option 4 (Info) from welcome menu shows the pitch and exits cleanly
- [ ] **A6.** Piping input (`echo "1" | mint`) does NOT hang — it prints the non-interactive hint and exits
- [ ] **A7.** On legacy Windows cmd (no `WT_SESSION` env var), the ASCII fallback logo renders
- [ ] **A8.** On modern terminal (Windows Terminal, iTerm, macOS Terminal), the Unicode logo renders correctly

## B. Signup Flow

- [ ] **B1.** `mint signup` prompts for email and password
- [ ] **B2.** Password input is hidden (asterisks) on terminals with raw mode support
- [ ] **B3.** On terminals without raw mode, a warning is shown and password is visible
- [ ] **B4.** Invalid email is rejected with a clear message
- [ ] **B5.** Password < 8 chars is rejected
- [ ] **B6.** Ctrl+C mid-signup exits cleanly (no hang, no traceback)
- [ ] **B7.** Successful signup shows green box with "Next steps" + `mint init` hint
- [ ] **B8.** After successful signup, `whoami` shows email + "API token" auth kind
- [ ] **B9.** Signup with existing email shows "already registered" (not generic 500)
- [ ] **B10.** Gateway down during signup shows "Can't reach the Mint gateway" (not a timeout stack)

## C. Login Flow

- [ ] **C1.** `mint login` when not authed prompts for email + password
- [ ] **C2.** `mint login` when already authed offers "Log out and sign in as a different user? [y/N]"
- [ ] **C3.** Login with wrong password shows "Invalid email or password" (not generic 401)
- [ ] **C4.** Login with non-existent email shows "Invalid email or password" + signup hint
- [ ] **C5.** Successful login shows green box with Quick start commands
- [ ] **C6.** `mint logout` then `mint login` switches cleanly

## D. Init

- [ ] **D1.** `mint init` in a new project scans files, generates MINT.md, creates .mint/context.json
- [ ] **D2.** `mint init` twice within 1 hour prompts "Re-index now? [y/N]" (answering N skips)
- [ ] **D3.** `mint init --force` overrides the re-index prompt
- [ ] **D4.** `mint init` in a folder with 100k+ files caps at 20k and logs the warning
- [ ] **D5.** `mint init` in an empty folder finishes without crashing
- [ ] **D6.** `mint init` in a non-git folder falls back to glob discovery
- [ ] **D7.** Binary files (images, PDFs) are skipped — no garbage in context.json
- [ ] **D8.** Nested .gitignore files are honored when glob fallback is used

## E. First Task (Happy Path)

- [ ] **E1.** `mint "add a hello function to README"` classifies, retrieves, streams output, shows diff
- [ ] **E2.** Diff mode shows a file diff preview before approval
- [ ] **E3.** Typing `y` or Enter at the approval prompt applies the change
- [ ] **E4.** Typing `n` at the approval prompt rejects and the file is NOT modified
- [ ] **E5.** After task completes, the status bar shows updated quota (e.g., "49/50 free")
- [ ] **E6.** `mint quota` reports the same updated count
- [ ] **E7.** Cost is shown (never NaN, never negative)

## F. TUI Behaviors

- [ ] **F1.** Typing a task and pressing Enter submits
- [ ] **F2.** `/help` shows the command list
- [ ] **F3.** `/diff`, `/auto`, `/plan`, `/yolo` switch mode (status bar updates)
- [ ] **F4.** `/clear` empties the chat
- [ ] **F5.** Typing `/` shows autocomplete with ALL registered commands (no phantom entries)
- [ ] **F6.** Tab with no autocomplete toggles the tool inspector (if tools were called)
- [ ] **F7.** Tab with autocomplete showing completes the selected command
- [ ] **F8.** Arrow keys scroll the transcript when there's content to scroll
- [ ] **F9.** Resizing the terminal mid-session preserves the current chat (no blank screen)
- [ ] **F10.** On a narrow terminal (80 cols or less), the status bar still shows mode + model + quota
- [ ] **F11.** "Thinking..." spinner shows elapsed seconds + "Ctrl+C to cancel" hint after 8s
- [ ] **F12.** Ctrl+C during a task aborts cleanly (no hang, no traceback)
- [ ] **F13.** Ctrl+C during an approval prompt aborts cleanly

## G. Approvals & Modes

- [ ] **G1.** In `diff` mode, every write is gated with a diff preview
- [ ] **G2.** In `auto` mode, tool calls apply without prompting (until a destructive bash)
- [ ] **G3.** In `plan` mode, no writes happen — only the proposed plan is emitted
- [ ] **G4.** In `yolo` mode, everything runs without approvals
- [ ] **G5.** If diff preview generation fails, user sees a warn ("approving without visual review")
- [ ] **G6.** Rejecting a destructive iteration shows count of skipped tools

## H. Quota System

- [ ] **H1.** New user sees "0/50 free" in status bar
- [ ] **H2.** After 40 tasks, status bar goes yellow
- [ ] **H3.** After 40 tasks, the 80% warning appears in chat (ONCE, not on every refresh)
- [ ] **H4.** After 45 tasks, the 80% warning does NOT repeat
- [ ] **H5.** After 50 tasks, status bar goes red and 100% warning appears (exactly once)
- [ ] **H6.** 51st request returns 429 with upgrade/BYOK message
- [ ] **H7.** `mint quota` shows the progress bar + plan badge + reset date
- [ ] **H8.** `mint quota` with an unknown plan_type from gateway doesn't crash (shows gray badge)
- [ ] **H9.** `mint account` shows quota + email + API keys + quick actions

## I. Error Recovery

- [ ] **I1.** Gateway down mid-task shows a retry warn then surfaces the error
- [ ] **I2.** Expired token (401) on `mint quota` shows "Your session has expired. Run `mint login`..."
- [ ] **I3.** Network drop during signup shows "Request timed out after 10s" (not hang)
- [ ] **I4.** Running `mint` in a read-only directory still opens the TUI (doesn't crash)
- [ ] **I5.** Corrupting `.mint/outcomes.sqlite` then running `mint` recovers (file moved aside, message shown)
- [ ] **I6.** Corrupting the Conf JSON file then running `mint` recovers (file moved aside)
- [ ] **I7.** Task that hits the iteration cap shows "Reached max iterations..." warn
- [ ] **I8.** Malformed tool call from provider is dropped + user sees warn

## J. BYOK

- [ ] **J1.** `mint config:set providers.deepseek sk-xxx` succeeds and confirms save
- [ ] **J2.** `mint config:set providers.deepseek bad-key` shows format warning (but still saves)
- [ ] **J3.** `mint config:set providers.nonexistent sk-xxx` rejects with "Did you mean..." hint
- [ ] **J4.** `mint config:set apiBaseUrl not-a-url` rejects with URL example
- [ ] **J5.** `mint config:set apiBaseUrl http://localhost:3000` saves
- [ ] **J6.** `mint config:set invalid_key foo` shows "Unknown setting" + closest match

## K. Commands

- [ ] **K1.** `mint --version` prints 0.3.0-beta.1
- [ ] **K2.** `mint --help` lists all commands
- [ ] **K3.** `mint whoami` shows email when authed, hint when not
- [ ] **K4.** `mint config` lists all settings (auth redacted)
- [ ] **K5.** `mint trace` lists recent sessions
- [ ] **K6.** `mint trace --tail` follows the most recent session
- [ ] **K7.** `mint usage` opens the Ink dashboard
- [ ] **K8.** `mint quota` shows quota UI
- [ ] **K9.** `mint account` shows account UI
- [ ] **K10.** `mint doctor` runs all health checks (pass/fail/warn summary)
- [ ] **K11.** `mint init --force` bypasses the re-index prompt
- [ ] **K12.** `mint skills` lists skills if .mint/skills exists

## L. Headless / Agent Integration

- [ ] **L1.** `mint exec "simple task"` outputs JSON to stdout
- [ ] **L2.** `mint exec --apply "..."` actually writes files
- [ ] **L3.** `mint exec --pipe` reads task from stdin as JSON

## M. Cross-Platform

- [ ] **M1.** Run the full A-K checklist on Windows
- [ ] **M2.** Run the full A-K checklist on macOS
- [ ] **M3.** Run the full A-K checklist on Linux (Ubuntu or Debian)
- [ ] **M4.** Run on a narrow 80x24 terminal — no overflow, no clipping of critical UI

---

## Release Gates

Before cutting a release:

1. **Typecheck**: `npm run typecheck` passes
2. **Build**: `npm run build` produces a working bundle
3. **Smoke**: `node dist/cli/index.js doctor` shows all green on a fresh profile
4. **Checklist**: every item in this doc passes OR has a documented exception in KNOWN_ISSUES.md

## Reporting Issues

When a checklist item fails:

1. Add the failure to `KNOWN_ISSUES.md` with:
   - What you did (the exact step)
   - What happened (actual behavior)
   - What should have happened (expected behavior)
   - Workaround (if any)
2. Open a GitHub issue linking to the checklist item number (e.g. "Fails F11")
3. If it's a blocker, mark the release as not-ready
