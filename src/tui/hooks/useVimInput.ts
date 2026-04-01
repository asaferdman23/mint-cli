/**
 * useVimInput — React hook for vim-mode text editing.
 *
 * Manages VimState, PersistentState, text, and cursor offset.
 * Returns handlers for useInput (Ink) and the current mode string.
 *
 * Usage:
 *   const vim = useVimInput({ value, onChange })
 *   useInput((input, key) => vim.handleKey(input, key))
 *   // Render vim.modeLabel as the INSERT/NORMAL indicator
 */
import { useCallback, useRef, useState } from 'react'
import { Cursor } from '../vim/cursor.js'
import {
  createInitialPersistentState,
  createInitialVimState,
  type FindType,
  type PersistentState,
  type VimState,
} from '../vim/types.js'
import { transition, type TransitionContext } from '../vim/transitions.js'

export type VimInputHandle = {
  /** Current mode for the indicator: 'INSERT' | 'NORMAL' */
  mode: 'INSERT' | 'NORMAL'
  /** Short label for the pill: 'I' | 'N' */
  modeLabel: string
  /** Full mode name for display */
  modeName: string
  /** The current cursor offset within the text */
  cursorOffset: number
  /** Key handler — pass to useInput */
  handleKey: (input: string, key: InkKey) => void
}

/** Subset of Ink's Key type we care about. */
export type InkKey = {
  escape?: boolean
  backspace?: boolean
  delete?: boolean
  return?: boolean
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  name?: string
}

export type UseVimInputOptions = {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  /** If false (default), starts in INSERT mode. If true, starts in NORMAL. */
  startInNormal?: boolean
}

export function useVimInput({
  value,
  onChange,
  onSubmit,
  startInNormal = false,
}: UseVimInputOptions): VimInputHandle {
  const [vimState, setVimState] = useState<VimState>(() =>
    startInNormal
      ? { mode: 'NORMAL', command: { type: 'idle' } }
      : createInitialVimState(),
  )
  const [cursorOffset, setCursorOffset] = useState(0)

  const persistentRef = useRef<PersistentState>(createInitialPersistentState())

  // Keep text + offset stable refs for the callback (avoids stale closure)
  const textRef = useRef(value)
  textRef.current = value
  const offsetRef = useRef(cursorOffset)
  offsetRef.current = cursorOffset
  const vimRef = useRef(vimState)
  vimRef.current = vimState

  const handleKey = useCallback(
    (input: string, key: InkKey) => {
      const currentVim = vimRef.current
      const text = textRef.current
      const offset = Math.min(offsetRef.current, Math.max(0, text.length - 1))

      // ── INSERT mode ─────────────────────────────────────────────────────────
      if (currentVim.mode === 'INSERT') {
        // Escape → NORMAL
        if (key.escape) {
          const newOffset = Math.max(0, offset - 1)
          setCursorOffset(newOffset)
          setVimState({ mode: 'NORMAL', command: { type: 'idle' } })
          return
        }

        // Ctrl+C handled by App; we just return
        if (key.ctrl && key.name === 'c') return

        // Enter / submit
        if (key.return) {
          onSubmit?.(text)
          setCursorOffset(0)
          return
        }

        // Backspace
        if (key.backspace || key.delete) {
          if (offset === 0) return
          const newText = text.slice(0, offset - 1) + text.slice(offset)
          onChange(newText)
          setCursorOffset(offset - 1)
          return
        }

        // Regular character input
        if (input && !key.ctrl && !key.meta) {
          const newText = text.slice(0, offset) + input + text.slice(offset)
          onChange(newText)
          setCursorOffset(offset + input.length)
        }
        return
      }

      // ── NORMAL mode ──────────────────────────────────────────────────────────
      // Escape resets to idle
      if (key.escape) {
        setVimState({ mode: 'NORMAL', command: { type: 'idle' } })
        return
      }

      // Map Ink key names to vim input strings
      let vimInput = input
      if (key.name === 'up') vimInput = 'k'
      else if (key.name === 'down') vimInput = 'j'
      else if (key.name === 'left') vimInput = 'h'
      else if (key.name === 'right') vimInput = 'l'
      else if (key.backspace || key.delete) vimInput = 'h'

      if (!vimInput) return

      // Build context for the transition
      let nextText = text
      let nextOffset = offset
      let nextVimState: VimState = currentVim

      const cursor = new Cursor(text, offset)

      const ctx: TransitionContext = {
        cursor,
        text,
        setText: (t) => { nextText = t },
        setOffset: (o) => { nextOffset = Math.max(0, Math.min(o, nextText.length - 1)) },
        enterInsert: (o) => {
          nextOffset = Math.max(0, Math.min(o, nextText.length))
          nextVimState = { mode: 'INSERT', insertedText: '' }
        },
        getRegister: () => persistentRef.current.register,
        setRegister: (content, linewise) => {
          persistentRef.current = { ...persistentRef.current, register: content, registerIsLinewise: linewise }
        },
        getLastFind: () => persistentRef.current.lastFind,
        setLastFind: (type: FindType, char: string) => {
          persistentRef.current = { ...persistentRef.current, lastFind: { type, char } }
        },
        onUndo: undefined, // wire up undo if needed
        onDotRepeat: undefined,
      }

      const result = transition(currentVim.command, vimInput, ctx)

      if (result.execute) {
        result.execute()
      }

      // Apply text changes
      if (nextText !== text) onChange(nextText)
      setCursorOffset(nextOffset)

      // Transition state
      if (nextVimState !== currentVim) {
        setVimState(nextVimState)
      } else if (result.next !== undefined) {
        setVimState({ mode: 'NORMAL', command: result.next })
      }
    },
    [onChange, onSubmit],
  )

  const mode = vimState.mode

  return {
    mode,
    modeLabel: mode === 'INSERT' ? 'I' : 'N',
    modeName: mode === 'INSERT' ? 'INSERT' : 'NORMAL',
    cursorOffset,
    handleKey,
  }
}
