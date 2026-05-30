// src/tui/hooks/__tests__/useSessionMemory.test.ts
// Tests for the pure `appendCapped` reducer behind useSessionMemory. We avoid
// the React renderer here (react-test-renderer is not in this repo's deps) and
// instead exercise the ring semantics directly — the hook itself is a thin
// wrapper over `appendCapped` + setState. Same pattern as useApprovalFlow.test.ts.
import { describe, it, expect } from 'vitest';
import { appendCapped, awaitPendingPromises } from '../useSessionMemory.js';
import type { TurnSummary } from '../../../brain/memory/summarize-turn.js';

function makeSummary(text: string, ts = Date.now()): TurnSummary {
  return {
    text,
    createdAt: ts,
    inputs: {
      userTask: text,
      finalAssistant: '',
      filesTouched: [],
      toolCalls: 0,
      outcome: 'success',
      model: 'mistral-small',
    },
  };
}

describe('appendCapped (useSessionMemory ring)', () => {
  it('appends to an empty ring', () => {
    const out = appendCapped([], makeSummary('a'), 3);
    expect(out.map((s) => s.text)).toEqual(['a']);
  });

  it('appends within cap and preserves order (oldest first)', () => {
    const r1 = appendCapped([], makeSummary('a'), 3);
    const r2 = appendCapped(r1, makeSummary('b'), 3);
    const r3 = appendCapped(r2, makeSummary('c'), 3);
    expect(r3.map((s) => s.text)).toEqual(['a', 'b', 'c']);
  });

  it('caps at 3 by default, dropping the oldest', () => {
    let ring: TurnSummary[] = [];
    for (const t of ['a', 'b', 'c', 'd']) {
      ring = appendCapped(ring, makeSummary(t), 3);
    }
    expect(ring.map((s) => s.text)).toEqual(['b', 'c', 'd']);
  });

  it('respects a cap of 1', () => {
    let ring: TurnSummary[] = [];
    for (const t of ['a', 'b', 'c']) {
      ring = appendCapped(ring, makeSummary(t), 1);
    }
    expect(ring.map((s) => s.text)).toEqual(['c']);
  });

  it('clear-equivalent: returning [] resets the ring', () => {
    // The hook's `clear` just calls setSummaries([]) — no helper to test, but
    // verify the invariant that an empty ring + a new summary yields a 1-elem ring.
    const out = appendCapped([], makeSummary('fresh'), 3);
    expect(out.map((s) => s.text)).toEqual(['fresh']);
  });
});

describe('awaitPendingPromises (sleep-race semantics)', () => {
  it('resolves immediately when there are no pending promises', async () => {
    const t0 = Date.now();
    await awaitPendingPromises([], 1500);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it('resolves after all pending promises settle (within timeout)', async () => {
    const p1 = new Promise((r) => setTimeout(r, 20));
    const p2 = new Promise((r) => setTimeout(r, 40));
    const t0 = Date.now();
    await awaitPendingPromises([p1, p2], 1500);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(200);
  });

  it('resolves on timeout when a pending promise hangs forever', async () => {
    // Pending promise never settles — the race must fall back to the timeout.
    const hung = new Promise<void>(() => {
      /* never resolves */
    });
    const t0 = Date.now();
    await awaitPendingPromises([hung], 100);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(400);
  });

  it('does not throw when a pending promise rejects', async () => {
    const rejecting = Promise.reject(new Error('boom'));
    // Pre-emptively attach a catch so unhandled-rejection warnings don't trip
    // the test runner. allSettled inside awaitPendingPromises also handles this.
    rejecting.catch(() => undefined);
    await expect(awaitPendingPromises([rejecting], 500)).resolves.toBeUndefined();
  });
});
