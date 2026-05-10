# Known Issues

Issues we know about but haven't fixed yet. Transparency > mystery.

---

## Active

### No active blockers

_Last updated: 2026-05-09 (0.3.0-beta.1)_

We aren't aware of any user-blocking issues right now. If you hit one, please [open a GitHub issue](https://github.com/asaferdman23/mint-cli/issues) with:
- What command you ran
- What you expected to happen
- What actually happened
- Your platform (Windows/macOS/Linux) and Node version

---

## Minor Rough Edges

### Paste in the input box may jump the cursor

When you paste multi-line text into the TUI input, the cursor can end up mid-word. Workaround: after paste, press `End` (or just submit — the content is correct).

**Status**: tracked, low priority.

---

### First `mint init` on a very large monorepo may take a few seconds

Projects with 20k+ files are capped at 20k indexed files (smaller paths prioritized). Fully scanning a 100k-file monorepo can take 10-30s. Subsequent runs are fast because we use `git ls-files`.

**Status**: by design for v0.3. A streaming re-indexer is in the roadmap.

---

### Quota display may be briefly missing on a cold start

The TUI fetches quota on mount. If the gateway is slow or unreachable, the status bar won't show "X/50 free" until the fetch completes. We cache the last-known value to `~/.mint-quota-cache.json` so this only affects the very first run or after cache invalidation.

**Status**: expected.

---

### Slash command autocomplete disappears when the command is fully typed

If you type `/diff` exactly, the autocomplete list collapses because the match is an exact prefix of only one command. This is Ink behavior, not a bug — press Enter to submit.

**Status**: not a bug.

---

## Platform-specific

### Windows legacy cmd.exe shows an ASCII-fallback logo

On old Windows terminals without `WT_SESSION` or `TERM_PROGRAM` env vars set, we fall back to a plain ASCII logo. Upgrade to [Windows Terminal](https://aka.ms/terminal) for the full Unicode experience.

**Status**: by design.

---

### Password input is visible on some Windows terminals

Terminals that don't support `stdin.setRawMode` (some older WT versions, IDE integrated terminals) will display your password as you type. We show a warning first. Use a modern terminal for hidden input.

**Status**: by design — can't hide input without raw mode.

---

## Recently Fixed

Moved to `CHANGELOG.md`. See [CHANGELOG.md](../CHANGELOG.md) for what shipped in each beta.
