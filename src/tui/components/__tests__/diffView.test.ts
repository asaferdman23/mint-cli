/**
 * Pure unit tests for DiffView's exported helpers — counter and the per-line
 * truncation. We don't render the component here (no ink-testing-library in
 * the repo); the helpers cover the load-bearing logic.
 */
import { describe, it, expect } from 'vitest';
import { countDiffStats, truncateDiffLine, type DiffHunk } from '../DiffView.js';

describe('countDiffStats', () => {
  it('returns zero for an empty hunk list', () => {
    expect(countDiffStats([])).toEqual({ additions: 0, deletions: 0 });
  });

  it('counts additions and deletions across hunks, ignoring context lines', () => {
    const hunks: DiffHunk[] = [
      {
        lines: [
          { kind: ' ', text: 'ctx' },
          { kind: '+', text: 'new' },
          { kind: '-', text: 'old' },
          { kind: '+', text: 'another' },
        ],
      },
      {
        lines: [
          { kind: '-', text: 'gone' },
          { kind: '-', text: 'gone2' },
        ],
      },
    ];
    expect(countDiffStats(hunks)).toEqual({ additions: 2, deletions: 3 });
  });
});

describe('truncateDiffLine', () => {
  it('returns the input unchanged when it fits', () => {
    expect(truncateDiffLine('hello', 10)).toBe('hello');
    expect(truncateDiffLine('hello', 5)).toBe('hello');
  });

  it('truncates with an ellipsis when over budget', () => {
    expect(truncateDiffLine('hello world', 8)).toBe('hello w…');
    expect(truncateDiffLine('abcdef', 4)).toBe('abc…');
  });

  it('returns empty string for non-positive width', () => {
    expect(truncateDiffLine('hello', 0)).toBe('');
    expect(truncateDiffLine('hello', -3)).toBe('');
  });

  it('handles maxWidth of 1 with just an ellipsis', () => {
    expect(truncateDiffLine('hello', 1)).toBe('…');
  });
});
