/**
 * Tracks in-flight fire-and-forget memory writes so the TUI can drain them on
 * shutdown (Ctrl+C / Esc). The extractor + per-memory write is intentionally
 * not awaited by `loop.ts` — it would block the `done` event and stall the
 * render thread. The cost is that a hard exit can lose the last turn's
 * memories. `awaitPendingMemoryWrites()` closes that gap with a soft timeout.
 *
 * Contract:
 *   - Producers call `trackPendingMemoryWrite(promise)` immediately after
 *     starting the work.
 *   - On shutdown, the TUI awaits `awaitPendingMemoryWrites(2000)`.
 *   - The await NEVER blocks longer than the timeout — the user wants their
 *     `mint` to die when they hit Ctrl+C (AGENT.md §1.6 keystroke is sacred).
 */

const pending: Set<Promise<unknown>> = new Set();

export function trackPendingMemoryWrite<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  // Settled removal — handles both fulfilled and rejected.
  void promise.finally(() => {
    pending.delete(promise);
  });
  return promise;
}

/** Drain in-flight memory writes. Returns when all settle, or when the soft
 *  timeout elapses — whichever comes first. Never throws. */
export async function awaitPendingMemoryWrites(timeoutMs = 2000): Promise<void> {
  if (pending.size === 0) return;
  const settle = Promise.allSettled(Array.from(pending));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([settle, timeout]);
}

/** Test-only — returns the current in-flight count. */
export function __pendingCount(): number {
  return pending.size;
}
