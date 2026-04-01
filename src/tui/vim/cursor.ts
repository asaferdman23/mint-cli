/**
 * Cursor — text editing cursor for vim mode.
 *
 * Immutable: every motion returns a new Cursor. Text is a plain string
 * (may contain \n for multi-line input). All offsets are code-unit indices.
 */
import type { FindType } from './types.js'

function isWordChar(ch: string): boolean {
  return /\w/.test(ch)
}

function isWORDChar(ch: string): boolean {
  return ch !== ' ' && ch !== '\t' && ch !== '\n'
}

export class Cursor {
  constructor(
    public readonly text: string,
    public readonly offset: number,
  ) {}

  equals(other: Cursor): boolean {
    return this.offset === other.offset
  }

  isAtEnd(): boolean {
    return this.offset >= this.text.length - 1
  }

  // ── Basic movement ──────────────────────────────────────────────────────────

  left(): Cursor {
    if (this.offset === 0) return this
    // Don't move past the start of the current logical line
    const ch = this.text[this.offset - 1]
    if (ch === '\n') return this
    return new Cursor(this.text, this.offset - 1)
  }

  right(): Cursor {
    if (this.offset >= this.text.length - 1) return this
    if (this.text[this.offset] === '\n') return this
    return new Cursor(this.text, this.offset + 1)
  }

  // ── Line movement ───────────────────────────────────────────────────────────

  private lineStart(offset: number): number {
    let i = offset
    while (i > 0 && this.text[i - 1] !== '\n') i--
    return i
  }

  private lineEnd(offset: number): number {
    let i = offset
    while (i < this.text.length && this.text[i] !== '\n') i++
    return i
  }

  private lineCol(offset: number): number {
    return offset - this.lineStart(offset)
  }

  upLogicalLine(): Cursor {
    const ls = this.lineStart(this.offset)
    if (ls === 0) return this
    const col = this.offset - ls
    const prevLineEnd = ls - 1
    const prevLineStart = this.lineStart(prevLineEnd)
    const prevLineLen = prevLineEnd - prevLineStart
    const newOffset = prevLineStart + Math.min(col, prevLineLen)
    return new Cursor(this.text, newOffset)
  }

  downLogicalLine(): Cursor {
    const le = this.lineEnd(this.offset)
    if (le >= this.text.length) return this
    const col = this.offset - this.lineStart(this.offset)
    const nextLineStart = le + 1
    const nextLineEnd = this.lineEnd(nextLineStart)
    const nextLineLen = nextLineEnd - nextLineStart
    const newOffset = nextLineStart + Math.min(col, nextLineLen)
    return new Cursor(this.text, newOffset)
  }

  up(): Cursor { return this.upLogicalLine() }
  down(): Cursor { return this.downLogicalLine() }

  // ── Line positions ──────────────────────────────────────────────────────────

  startOfLogicalLine(): Cursor {
    return new Cursor(this.text, this.lineStart(this.offset))
  }

  firstNonBlankInLogicalLine(): Cursor {
    let i = this.lineStart(this.offset)
    const end = this.lineEnd(this.offset)
    while (i < end && (this.text[i] === ' ' || this.text[i] === '\t')) i++
    return new Cursor(this.text, i)
  }

  endOfLogicalLine(): Cursor {
    const end = this.lineEnd(this.offset)
    // Stay on the last character of the line (vim exclusive at EOL)
    return new Cursor(this.text, Math.max(this.lineStart(this.offset), end - 1))
  }

  // ── Document positions ──────────────────────────────────────────────────────

  startOfFirstLine(): Cursor {
    return new Cursor(this.text, 0)
  }

  startOfLastLine(): Cursor {
    const last = this.text.lastIndexOf('\n')
    return new Cursor(this.text, last < 0 ? 0 : last + 1)
  }

  goToLine(n: number): Cursor {
    const lines = this.text.split('\n')
    let offset = 0
    const targetLine = Math.max(0, Math.min(n - 1, lines.length - 1))
    for (let i = 0; i < targetLine; i++) {
      offset += (lines[i]?.length ?? 0) + 1 // +1 for the \n
    }
    return new Cursor(this.text, offset)
  }

  // ── Word motions ────────────────────────────────────────────────────────────

  nextVimWord(): Cursor {
    let i = this.offset
    const t = this.text
    const len = t.length
    if (i >= len) return this
    const startIsWord = isWordChar(t[i]!)
    // Skip current character class
    while (i < len && t[i] !== '\n' && isWordChar(t[i]!) === startIsWord && !/\s/.test(t[i]!)) i++
    // Skip whitespace
    while (i < len && /\s/.test(t[i]!) && t[i] !== '\n') i++
    return new Cursor(t, Math.min(i, len - 1))
  }

  prevVimWord(): Cursor {
    let i = this.offset
    const t = this.text
    if (i === 0) return this
    i-- // step back one first
    // Skip whitespace
    while (i > 0 && /\s/.test(t[i]!) && t[i] !== '\n') i--
    const endIsWord = isWordChar(t[i]!)
    // Skip current character class backward
    while (i > 0 && t[i - 1] !== '\n' && isWordChar(t[i - 1]!) === endIsWord && !/\s/.test(t[i - 1]!)) i--
    return new Cursor(t, i)
  }

  endOfVimWord(): Cursor {
    let i = this.offset
    const t = this.text
    const len = t.length
    if (i >= len - 1) return this
    i++ // step forward one first
    // Skip whitespace
    while (i < len && /\s/.test(t[i]!) && t[i] !== '\n') i++
    const startIsWord = isWordChar(t[i]!)
    // Advance through current character class
    while (i < len - 1 && t[i + 1] !== '\n' && isWordChar(t[i + 1]!) === startIsWord && !/\s/.test(t[i + 1]!)) i++
    return new Cursor(t, i)
  }

  nextWORD(): Cursor {
    let i = this.offset
    const t = this.text
    const len = t.length
    if (i >= len) return this
    // Skip non-whitespace
    while (i < len && isWORDChar(t[i]!)) i++
    // Skip whitespace
    while (i < len && !isWORDChar(t[i]!) && t[i] !== '\n') i++
    return new Cursor(t, Math.min(i, len - 1))
  }

  prevWORD(): Cursor {
    let i = this.offset
    const t = this.text
    if (i === 0) return this
    i--
    while (i > 0 && !isWORDChar(t[i]!) && t[i] !== '\n') i--
    while (i > 0 && isWORDChar(t[i - 1]!)) i--
    return new Cursor(t, i)
  }

  endOfWORD(): Cursor {
    let i = this.offset
    const t = this.text
    const len = t.length
    if (i >= len - 1) return this
    i++
    while (i < len && !isWORDChar(t[i]!) && t[i] !== '\n') i++
    while (i < len - 1 && isWORDChar(t[i + 1]!)) i++
    return new Cursor(t, i)
  }

  // ── Character find (f/F/t/T) ────────────────────────────────────────────────

  findCharacter(char: string, type: FindType, count: number): number | null {
    const t = this.text
    const len = t.length
    let i = this.offset

    if (type === 'f' || type === 't') {
      // Forward search
      let found = 0
      let j = i + 1
      while (j < len && t[j] !== '\n') {
        if (t[j] === char) {
          found++
          if (found === count) {
            return type === 'f' ? j : j - 1
          }
        }
        j++
      }
    } else {
      // Backward search (F/T)
      let found = 0
      let j = i - 1
      while (j >= 0 && t[j] !== '\n') {
        if (t[j] === char) {
          found++
          if (found === count) {
            return type === 'F' ? j : j + 1
          }
        }
        j--
      }
    }

    return null
  }
}
