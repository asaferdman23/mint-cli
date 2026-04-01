/**
 * Vim State Transition Table
 * Ported from claude-code-src/src/vim/transitions.ts
 *
 * Scannable source of truth for state transitions.
 * Each state function handles exactly one state type.
 */
import { Cursor } from './cursor.js'
import { resolveMotion } from './motions.js'
import {
  type CommandState,
  FIND_KEYS,
  type FindType,
  isOperatorKey,
  isTextObjScopeKey,
  MAX_VIM_COUNT,
  OPERATORS,
  type Operator,
  SIMPLE_MOTIONS,
  TEXT_OBJ_SCOPES,
  TEXT_OBJ_TYPES,
  type TextObjScope,
} from './types.js'

export type TransitionContext = {
  cursor: Cursor
  text: string
  setText: (text: string) => void
  setOffset: (offset: number) => void
  enterInsert: (offset: number) => void
  getRegister: () => string
  setRegister: (content: string, linewise: boolean) => void
  getLastFind: () => { type: FindType; char: string } | null
  setLastFind: (type: FindType, char: string) => void
  onUndo?: () => void
  onDotRepeat?: () => void
}

export type TransitionResult = {
  next?: CommandState
  execute?: () => void
}

export function transition(
  state: CommandState,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  switch (state.type) {
    case 'idle': return fromIdle(input, ctx)
    case 'count': return fromCount(state, input, ctx)
    case 'operator': return fromOperator(state, input, ctx)
    case 'operatorCount': return fromOperatorCount(state, input, ctx)
    case 'operatorFind': return fromOperatorFind(state, input, ctx)
    case 'operatorTextObj': return fromOperatorTextObj(state, input, ctx)
    case 'find': return fromFind(state, input, ctx)
    case 'g': return fromG(state, input, ctx)
    case 'operatorG': return fromOperatorG(state, input, ctx)
    case 'replace': return fromReplace(state, input, ctx)
    case 'indent': return fromIndent(state, input, ctx)
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function applyOperator(
  op: Operator,
  from: number,
  to: number,
  ctx: TransitionContext,
  linewise = false,
): void {
  const text = ctx.text
  let start = Math.min(from, to)
  let end = Math.max(from, to)

  if (linewise) {
    // Expand to full lines
    while (start > 0 && text[start - 1] !== '\n') start--
    while (end < text.length && text[end] !== '\n') end++
    if (end < text.length) end++ // include trailing \n
  }

  const yanked = text.slice(start, end)
  ctx.setRegister(yanked, linewise)

  if (op === 'yank') {
    ctx.setOffset(from)
    return
  }

  const newText = text.slice(0, start) + text.slice(end)
  ctx.setText(newText)
  ctx.setOffset(Math.min(start, newText.length - 1))

  if (op === 'change') {
    ctx.enterInsert(start)
  }
}

function executeLineOp(op: Operator, count: number, ctx: TransitionContext): void {
  const { text, cursor } = ctx
  let start = cursor.startOfLogicalLine().offset
  let end = start
  for (let i = 0; i < count; i++) {
    while (end < text.length && text[end] !== '\n') end++
    if (end < text.length) end++
  }
  applyOperator(op, start, end, ctx, true)
}

function handleNormalInput(
  input: string,
  count: number,
  ctx: TransitionContext,
): TransitionResult | null {
  if (isOperatorKey(input)) {
    return { next: { type: 'operator', op: OPERATORS[input]!, count } }
  }

  if (SIMPLE_MOTIONS.has(input)) {
    return {
      execute: () => {
        const target = resolveMotion(input, ctx.cursor, count)
        ctx.setOffset(target.offset)
      },
    }
  }

  if (FIND_KEYS.has(input)) {
    return { next: { type: 'find', find: input as FindType, count } }
  }

  if (input === 'g') return { next: { type: 'g', count } }
  if (input === 'r') return { next: { type: 'replace', count } }
  if (input === '>' || input === '<') {
    return { next: { type: 'indent', dir: input, count } }
  }

  if (input === 'x') {
    return {
      execute: () => {
        const { text, cursor } = ctx
        const n = Math.min(count, text.length - cursor.offset)
        const newText = text.slice(0, cursor.offset) + text.slice(cursor.offset + n)
        ctx.setText(newText)
        ctx.setOffset(Math.min(cursor.offset, newText.length - 1))
      },
    }
  }

  if (input === 'D') {
    return {
      execute: () => {
        const end = ctx.cursor.endOfLogicalLine().offset + 1
        applyOperator('delete', ctx.cursor.offset, end, ctx)
      },
    }
  }

  if (input === 'C') {
    return {
      execute: () => {
        const end = ctx.cursor.endOfLogicalLine().offset + 1
        applyOperator('change', ctx.cursor.offset, end, ctx)
      },
    }
  }

  if (input === 'Y') {
    return { execute: () => executeLineOp('yank', count, ctx) }
  }

  if (input === 'p') {
    return {
      execute: () => {
        const reg = ctx.getRegister()
        if (!reg) return
        const pos = ctx.cursor.offset + 1
        const newText = ctx.text.slice(0, pos) + reg + ctx.text.slice(pos)
        ctx.setText(newText)
        ctx.setOffset(pos)
      },
    }
  }

  if (input === 'P') {
    return {
      execute: () => {
        const reg = ctx.getRegister()
        if (!reg) return
        const pos = ctx.cursor.offset
        const newText = ctx.text.slice(0, pos) + reg + ctx.text.slice(pos)
        ctx.setText(newText)
        ctx.setOffset(pos)
      },
    }
  }

  if (input === 'G') {
    return {
      execute: () => {
        if (count === 1) {
          ctx.setOffset(ctx.cursor.startOfLastLine().offset)
        } else {
          ctx.setOffset(ctx.cursor.goToLine(count).offset)
        }
      },
    }
  }

  if (input === 'J') {
    return {
      execute: () => {
        const { text, cursor } = ctx
        const lineEnd = text.indexOf('\n', cursor.offset)
        if (lineEnd < 0) return
        let nextStart = lineEnd + 1
        while (nextStart < text.length && (text[nextStart] === ' ' || text[nextStart] === '\t')) {
          nextStart++
        }
        const newText = text.slice(0, lineEnd) + ' ' + text.slice(nextStart)
        ctx.setText(newText)
        ctx.setOffset(lineEnd)
      },
    }
  }

  if (input === '.') return { execute: () => ctx.onDotRepeat?.() }
  if (input === 'u') return { execute: () => ctx.onUndo?.() }

  if (input === ';' || input === ',') {
    return {
      execute: () => {
        const lf = ctx.getLastFind()
        if (!lf) return
        const flipMap: Record<FindType, FindType> = { f: 'F', F: 'f', t: 'T', T: 't' }
        const findType = input === ',' ? flipMap[lf.type] : lf.type
        const result = ctx.cursor.findCharacter(lf.char, findType, count)
        if (result !== null) ctx.setOffset(result)
      },
    }
  }

  if (input === 'i') return { execute: () => ctx.enterInsert(ctx.cursor.offset) }
  if (input === 'I') return { execute: () => ctx.enterInsert(ctx.cursor.firstNonBlankInLogicalLine().offset) }
  if (input === 'a') {
    return {
      execute: () => {
        const newOffset = ctx.cursor.isAtEnd() ? ctx.cursor.offset : ctx.cursor.right().offset
        ctx.enterInsert(newOffset)
      },
    }
  }
  if (input === 'A') return { execute: () => ctx.enterInsert(ctx.cursor.endOfLogicalLine().offset + 1) }
  if (input === 'o') {
    return {
      execute: () => {
        const le = ctx.cursor.endOfLogicalLine().offset + 1
        const newText = ctx.text.slice(0, le) + '\n' + ctx.text.slice(le)
        ctx.setText(newText)
        ctx.enterInsert(le + 1)
      },
    }
  }
  if (input === 'O') {
    return {
      execute: () => {
        const ls = ctx.cursor.startOfLogicalLine().offset
        const newText = ctx.text.slice(0, ls) + '\n' + ctx.text.slice(ls)
        ctx.setText(newText)
        ctx.enterInsert(ls)
      },
    }
  }

  return null
}

function handleOperatorInput(
  op: Operator,
  count: number,
  input: string,
  ctx: TransitionContext,
): TransitionResult | null {
  if (isTextObjScopeKey(input)) {
    return { next: { type: 'operatorTextObj', op, count, scope: TEXT_OBJ_SCOPES[input]! } }
  }
  if (FIND_KEYS.has(input)) {
    return { next: { type: 'operatorFind', op, count, find: input as FindType } }
  }
  if (SIMPLE_MOTIONS.has(input)) {
    return {
      execute: () => {
        const target = resolveMotion(input, ctx.cursor, count)
        if (!target.equals(ctx.cursor)) {
          applyOperator(op, ctx.cursor.offset, target.offset, ctx, 'jkG'.includes(input))
        }
      },
    }
  }
  if (input === 'G') {
    return {
      execute: () => {
        const target = ctx.cursor.startOfLastLine()
        applyOperator(op, ctx.cursor.offset, target.offset, ctx, true)
      },
    }
  }
  if (input === 'g') return { next: { type: 'operatorG', op, count } }
  return null
}

// ── State transition functions ────────────────────────────────────────────────

function fromIdle(input: string, ctx: TransitionContext): TransitionResult {
  if (/[1-9]/.test(input)) return { next: { type: 'count', digits: input } }
  if (input === '0') return { execute: () => ctx.setOffset(ctx.cursor.startOfLogicalLine().offset) }
  return handleNormalInput(input, 1, ctx) ?? {}
}

function fromCount(
  state: { type: 'count'; digits: string },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (/[0-9]/.test(input)) {
    const newDigits = state.digits + input
    const count = Math.min(parseInt(newDigits, 10), MAX_VIM_COUNT)
    return { next: { type: 'count', digits: String(count) } }
  }
  const count = parseInt(state.digits, 10)
  return handleNormalInput(input, count, ctx) ?? { next: { type: 'idle' } }
}

function fromOperator(
  state: { type: 'operator'; op: Operator; count: number },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  // dd, cc, yy = line operation
  if (input === state.op[0]) {
    return { execute: () => executeLineOp(state.op, state.count, ctx) }
  }
  if (/[0-9]/.test(input)) {
    return { next: { type: 'operatorCount', op: state.op, count: state.count, digits: input } }
  }
  return handleOperatorInput(state.op, state.count, input, ctx) ?? { next: { type: 'idle' } }
}

function fromOperatorCount(
  state: { type: 'operatorCount'; op: Operator; count: number; digits: string },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (/[0-9]/.test(input)) {
    const newDigits = state.digits + input
    const parsed = Math.min(parseInt(newDigits, 10), MAX_VIM_COUNT)
    return { next: { ...state, digits: String(parsed) } }
  }
  const motionCount = parseInt(state.digits, 10)
  const effectiveCount = state.count * motionCount
  return handleOperatorInput(state.op, effectiveCount, input, ctx) ?? { next: { type: 'idle' } }
}

function fromOperatorFind(
  state: { type: 'operatorFind'; op: Operator; count: number; find: FindType },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  return {
    execute: () => {
      const targetOffset = ctx.cursor.findCharacter(input, state.find, state.count)
      if (targetOffset === null) return
      applyOperator(state.op, ctx.cursor.offset, targetOffset, ctx)
      ctx.setLastFind(state.find, input)
    },
  }
}

function fromOperatorTextObj(
  state: { type: 'operatorTextObj'; op: Operator; count: number; scope: TextObjScope },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (!TEXT_OBJ_TYPES.has(input)) return { next: { type: 'idle' } }
  return {
    execute: () => {
      // Basic word text object (iw/aw) — the most common case
      const { text, cursor } = ctx
      let start = cursor.offset
      let end = cursor.offset

      if (input === 'w' || input === 'W') {
        const isWord = input === 'w'
        const test = isWord ? (ch: string) => /\w/.test(ch) : (ch: string) => !/\s/.test(ch)
        if (state.scope === 'inner') {
          while (start > 0 && test(text[start - 1]!)) start--
          while (end < text.length && test(text[end]!)) end++
        } else {
          // around: include trailing whitespace
          while (start > 0 && test(text[start - 1]!)) start--
          while (end < text.length && test(text[end]!)) end++
          while (end < text.length && /[ \t]/.test(text[end]!)) end++
        }
      } else {
        // Paired delimiters: (), [], {}, "", '', ``
        const pairs: Record<string, string> = {
          '(': ')', ')': '(', '[': ']', ']': '[',
          '{': '}', '}': '{', 'b': ')', 'B': '}',
          '<': '>', '>': '<',
          '"': '"', "'": "'", '`': '`',
        }
        const close = pairs[input] ?? input
        const open = (close === input) ? input : input
        let depth = 0
        // Find open
        let s = cursor.offset
        while (s >= 0) {
          if (text[s] === close && s !== cursor.offset) depth++
          if (text[s] === open) {
            if (depth === 0) break
            depth--
          }
          s--
        }
        // Find close
        let e = cursor.offset
        depth = 0
        while (e < text.length) {
          if (text[e] === open && e !== cursor.offset) depth++
          if (text[e] === close) {
            if (depth === 0) break
            depth--
          }
          e++
        }
        if (state.scope === 'inner') {
          start = s + 1
          end = e
        } else {
          start = s
          end = e + 1
        }
      }

      if (start !== end) {
        applyOperator(state.op, start, end, ctx)
      }
    },
  }
}

function fromFind(
  state: { type: 'find'; find: FindType; count: number },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  return {
    execute: () => {
      const result = ctx.cursor.findCharacter(input, state.find, state.count)
      if (result !== null) {
        ctx.setOffset(result)
        ctx.setLastFind(state.find, input)
      }
    },
  }
}

function fromG(
  state: { type: 'g'; count: number },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (input === 'j' || input === 'k') {
    return {
      execute: () => {
        const target = resolveMotion(`g${input}`, ctx.cursor, state.count)
        ctx.setOffset(target.offset)
      },
    }
  }
  if (input === 'g') {
    if (state.count > 1) {
      return { execute: () => ctx.setOffset(ctx.cursor.goToLine(state.count).offset) }
    }
    return { execute: () => ctx.setOffset(ctx.cursor.startOfFirstLine().offset) }
  }
  return { next: { type: 'idle' } }
}

function fromOperatorG(
  state: { type: 'operatorG'; op: Operator; count: number },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (input === 'j' || input === 'k') {
    return {
      execute: () => {
        const target = resolveMotion(`g${input}`, ctx.cursor, state.count)
        if (!target.equals(ctx.cursor)) {
          applyOperator(state.op, ctx.cursor.offset, target.offset, ctx)
        }
      },
    }
  }
  if (input === 'g') {
    return {
      execute: () => {
        const target = ctx.cursor.startOfFirstLine()
        applyOperator(state.op, ctx.cursor.offset, target.offset, ctx, true)
      },
    }
  }
  return { next: { type: 'idle' } }
}

function fromReplace(
  state: { type: 'replace'; count: number },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (input === '') return { next: { type: 'idle' } }
  return {
    execute: () => {
      const { text, cursor } = ctx
      const n = Math.min(state.count, text.length - cursor.offset)
      const newText = text.slice(0, cursor.offset) + input.repeat(n) + text.slice(cursor.offset + n)
      ctx.setText(newText)
      ctx.setOffset(cursor.offset + n - 1)
    },
  }
}

function fromIndent(
  state: { type: 'indent'; dir: '>' | '<'; count: number },
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (input === state.dir) {
    return {
      execute: () => {
        const { text, cursor } = ctx
        const ls = cursor.startOfLogicalLine().offset
        const le = text.indexOf('\n', ls)
        const end = le < 0 ? text.length : le
        const line = text.slice(ls, end)
        const newLine = state.dir === '>' ? '  ' + line : line.replace(/^  /, '')
        const newText = text.slice(0, ls) + newLine + text.slice(end)
        ctx.setText(newText)
        ctx.setOffset(ls)
      },
    }
  }
  return { next: { type: 'idle' } }
}
