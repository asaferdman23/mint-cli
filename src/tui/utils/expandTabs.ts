/**
 * Tab expansion — ported from claude-code-src/src/ink/tabstops.ts
 *
 * Terminals use 8-column tab intervals (POSIX default, hardcoded in Ghostty,
 * iTerm2, etc.). This expands \t characters to the correct number of spaces
 * so code blocks in MessageList render with proper alignment.
 */

const DEFAULT_TAB_INTERVAL = 8

/**
 * Expand tab characters to spaces using N-column intervals.
 * ANSI escape sequences are passed through without affecting column counting.
 */
export function expandTabs(text: string, interval = DEFAULT_TAB_INTERVAL): string {
  if (!text.includes('\t')) return text

  let result = ''
  let column = 0
  let i = 0

  while (i < text.length) {
    const ch = text[i]!

    // Pass ANSI escape sequences through without counting columns.
    // ESC [ ... letter — CSI sequences (colors, cursor moves, etc.)
    if (ch === '\x1b' && text[i + 1] === '[') {
      const start = i
      i += 2
      // Advance past parameter and intermediate bytes (0x20-0x3F), then
      // the final byte (0x40-0x7E).
      while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x3f) {
        i++
      }
      if (i < text.length) i++ // final byte
      result += text.slice(start, i)
      continue
    }

    if (ch === '\t') {
      const spaces = interval - (column % interval)
      result += ' '.repeat(spaces)
      column += spaces
    } else if (ch === '\n') {
      result += ch
      column = 0
    } else {
      result += ch
      column++
    }
    i++
  }

  return result
}
