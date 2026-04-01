/**
 * Chalk level management — ported from claude-code-src/src/ink/colorize.ts
 *
 * Two environment problems this solves:
 *
 * 1. xterm.js (VS Code, Cursor) supports truecolor since 2017 but often
 *    doesn't set COLORTERM=truecolor in containers. chalk falls back to
 *    level 2 (256-color cube) → rgb() calls produce washed-out colours.
 *    Fix: detect TERM_PROGRAM=vscode and boost to level 3.
 *
 * 2. tmux re-emits truecolor SGR correctly only when terminal-overrides
 *    includes Tc/RGB capability (most configs don't). Without it, truecolor
 *    backgrounds disappear on the outer terminal. Fix: clamp to level 2 so
 *    chalk emits 256-color sequences tmux passes through cleanly.
 *
 * Call initChalkLevel() once at startup before any chalk output.
 */
import chalk from 'chalk'

/**
 * Boost chalk to truecolor when running inside a VS Code terminal that
 * hasn't advertised COLORTERM=truecolor (common in devcontainers, code-server).
 */
function boostForXtermJs(): boolean {
  if (process.env.TERM_PROGRAM === 'vscode' && chalk.level === 2) {
    chalk.level = 3
    return true
  }
  return false
}

/**
 * Clamp chalk to 256-color when running inside tmux without truecolor
 * passthrough configured. Set MINT_TMUX_TRUECOLOR=1 to skip if your tmux
 * has `terminal-overrides ,*:Tc` configured.
 */
function clampForTmux(): boolean {
  if (process.env.MINT_TMUX_TRUECOLOR) return false
  if (process.env.TMUX && chalk.level > 2) {
    chalk.level = 2
    return true
  }
  return false
}

/** Call once at startup before any chalk output. */
export function initChalkLevel(): void {
  // Order matters: boost first so tmux-inside-vscode gets re-clamped.
  boostForXtermJs()
  clampForTmux()
}

/** Whether we're running inside a VS Code / xterm.js terminal. */
export function isXtermJs(): boolean {
  return process.env.TERM_PROGRAM === 'vscode'
}

/** Whether we're running inside tmux. */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX
}
