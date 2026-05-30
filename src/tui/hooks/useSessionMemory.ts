// src/tui/hooks/useSessionMemory.ts
// L2 session memory — in-memory ring of the last N turn summaries (PR3).
// Owns a fire-and-forget summarizer call so BrainApp can pass priorTurnSummaries
// into runBrain() on the next turn without blocking the render thread.
import { useCallback, useMemo, useRef, useState } from 'react';
import { summarizeTurn, type TurnInputs, type TurnSummary } from '../../brain/memory/summarize-turn.js';

const DEFAULT_CAP = 3;
const DEFAULT_AWAIT_TIMEOUT_MS = 1500;

export interface UseSessionMemoryReturn {
  /** Up to `maxSummaries` most-recent turn summaries, oldest-first. */
  summaries: TurnSummary[];
  /** Fire-and-forget — generates a summary off the render thread, appends when ready. */
  recordTurn: (inputs: TurnInputs) => void;
  /** Strings for prompt injection — just the .text fields, in chronological order. */
  summaryTexts: string[];
  /** Reset (used by /clear). */
  clear: () => void;
  /** Wait for any in-flight `recordTurn` summarizer promises to settle.
   *  Resolves on either: (a) all pending promises settle, or (b) timeoutMs
   *  elapses — whichever fires first. Never throws. Default timeout 1500ms. */
  awaitPending: (timeoutMs?: number) => Promise<void>;
}

/** Pure ring update — exported for tests. Appends `s` and caps at `cap`. */
export function appendCapped(prev: TurnSummary[], s: TurnSummary, cap: number): TurnSummary[] {
  return [...prev, s].slice(-cap);
}

/** Pure helper behind `awaitPending` — exported for tests. Races a settle of
 *  all `pending` promises against a `timeoutMs` deadline. Never throws. */
export async function awaitPendingPromises(
  pending: Array<Promise<unknown>>,
  timeoutMs: number,
): Promise<void> {
  if (pending.length === 0) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([Promise.allSettled(pending).then(() => undefined), timeout]);
}

export function useSessionMemory(maxSummaries?: number): UseSessionMemoryReturn {
  const cap = maxSummaries ?? DEFAULT_CAP;
  const [summaries, setSummaries] = useState<TurnSummary[]>([]);
  // Latest cap in a ref so a stale closure inside the fire-and-forget promise
  // resolves against the current value if the caller re-renders with a new cap.
  const capRef = useRef(cap);
  capRef.current = cap;

  // Set of in-flight summarizer promises. Used by `awaitPending` so the next
  // turn can wait for the prior turn's summary to land before runBrain reads
  // `summaryTexts`. Each promise removes itself on settle.
  const pendingRef = useRef<Set<Promise<void>>>(new Set());

  const recordTurn = useCallback((inputs: TurnInputs): void => {
    // Fire-and-forget. summarizeTurn already has an internal fallback path,
    // so the .catch here is purely defensive.
    const p: Promise<void> = summarizeTurn(inputs)
      .then((summary) => {
        setSummaries((prev) => appendCapped(prev, summary, capRef.current));
      })
      .catch(() => {
        /* swallow — summarizeTurn never throws, but guard against future changes */
      })
      .finally(() => {
        pendingRef.current.delete(p);
      });
    pendingRef.current.add(p);
  }, []);

  const clear = useCallback((): void => {
    setSummaries([]);
  }, []);

  const awaitPending = useCallback(async (timeoutMs?: number): Promise<void> => {
    const ms = timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS;
    await awaitPendingPromises([...pendingRef.current], ms);
  }, []);

  const summaryTexts = useMemo(() => summaries.map((s) => s.text), [summaries]);

  return { summaries, recordTurn, summaryTexts, clear, awaitPending };
}
