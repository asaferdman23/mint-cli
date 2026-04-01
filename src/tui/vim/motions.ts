/**
 * Vim Motion Functions
 * Ported from claude-code-src/src/vim/motions.ts
 *
 * Pure functions — resolve a motion key to a new cursor position.
 */
import { Cursor } from './cursor.js'

export function resolveMotion(key: string, cursor: Cursor, count: number): Cursor {
  let result = cursor
  for (let i = 0; i < count; i++) {
    const next = applySingleMotion(key, result)
    if (next.equals(result)) break
    result = next
  }
  return result
}

function applySingleMotion(key: string, cursor: Cursor): Cursor {
  switch (key) {
    case 'h': return cursor.left()
    case 'l': return cursor.right()
    case 'j': return cursor.downLogicalLine()
    case 'k': return cursor.upLogicalLine()
    case 'gj': return cursor.down()
    case 'gk': return cursor.up()
    case 'w': return cursor.nextVimWord()
    case 'b': return cursor.prevVimWord()
    case 'e': return cursor.endOfVimWord()
    case 'W': return cursor.nextWORD()
    case 'B': return cursor.prevWORD()
    case 'E': return cursor.endOfWORD()
    case '0': return cursor.startOfLogicalLine()
    case '^': return cursor.firstNonBlankInLogicalLine()
    case '$': return cursor.endOfLogicalLine()
    case 'G': return cursor.startOfLastLine()
    default: return cursor
  }
}

/** Inclusive motions include the character at the destination. */
export function isInclusiveMotion(key: string): boolean {
  return 'eE$'.includes(key)
}

/** Linewise motions operate on whole lines when combined with operators. */
export function isLinewiseMotion(key: string): boolean {
  return 'jkG'.includes(key) || key === 'gg'
}
