// src/tui/hooks/useInputHistory.ts
// In-memory ring buffer + recall state machine for the prompt input (Batch D).
// Hydrates from ~/.mint/history on mount; appends new submissions async.
import { useCallback, useEffect, useRef, useState } from 'react';
import { appendHistory, loadHistory } from '../utils/history.js';

export interface UseInputHistory {
  /** Move one entry back in history. Returns the recalled value, or null. */
  recallPrev: (currentValue: string) => string | null;
  /** Move one entry forward (toward newest). Returns recalled value or '' when
   *  exiting history mode past the newest entry, or null if no-op. */
  recallNext: () => string | null;
  /** Persist a submitted line. Dedupes against the immediately previous entry. */
  recordSubmission: (line: string) => void;
  /** Exit history mode without changing the input. Call on free-form typing. */
  exitHistory: () => void;
  isInHistory: boolean;
}

export function useInputHistory(): UseInputHistory {
  const [history, setHistory] = useState<string[]>([]);
  // null = not in history mode; otherwise index into `history` (0 = oldest, len-1 = newest).
  const indexRef = useRef<number | null>(null);
  const [isInHistory, setIsInHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadHistory().then((entries) => {
      if (!cancelled) setHistory(entries);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const recallPrev = useCallback((_currentValue: string): string | null => {
    if (history.length === 0) return null;
    const cur = indexRef.current;
    let next: number;
    if (cur === null) {
      next = history.length - 1;
    } else if (cur === 0) {
      return null; // already at oldest
    } else {
      next = cur - 1;
    }
    indexRef.current = next;
    setIsInHistory(true);
    return history[next] ?? null;
  }, [history]);

  const recallNext = useCallback((): string | null => {
    const cur = indexRef.current;
    if (cur === null) return null;
    if (cur >= history.length - 1) {
      // Past the newest — exit history mode, clear input.
      indexRef.current = null;
      setIsInHistory(false);
      return '';
    }
    const next = cur + 1;
    indexRef.current = next;
    return history[next] ?? null;
  }, [history]);

  const exitHistory = useCallback(() => {
    if (indexRef.current === null) return;
    indexRef.current = null;
    setIsInHistory(false);
  }, []);

  const recordSubmission = useCallback((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === trimmed) return prev;
      return [...prev, trimmed];
    });
    indexRef.current = null;
    setIsInHistory(false);
    // Fire-and-forget persistence; appendHistory swallows errors.
    void appendHistory(trimmed);
  }, []);

  return { recallPrev, recallNext, recordSubmission, exitHistory, isInHistory };
}
