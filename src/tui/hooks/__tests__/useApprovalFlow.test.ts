// src/tui/hooks/__tests__/useApprovalFlow.test.ts
// Tests for the pure `deriveApprovalDisplay` reducer behind useApprovalFlow.
// Renders nothing — just verifies field extraction and the row budget.
import { describe, it, expect } from 'vitest';
import { deriveApprovalDisplay } from '../useApprovalFlow.js';

describe('deriveApprovalDisplay', () => {
  it('returns empty display when no pending approval', () => {
    const r = deriveApprovalDisplay(null, null);
    expect(r.toolName).toBeUndefined();
    expect(r.filePath).toBeUndefined();
    expect(r.diff).toBeNull();
    expect(r.rows).toBe(0);
  });

  it('extracts toolName from payload.name', () => {
    const r = deriveApprovalDisplay(
      { reason: 'tool', payload: { name: 'shell.exec' } },
      null,
    );
    expect(r.toolName).toBe('shell.exec');
  });

  it('extracts filePath from payload.input.path', () => {
    const r = deriveApprovalDisplay(
      { reason: 'tool', payload: { name: 'fs.write', input: { path: '/tmp/a.ts' } } },
      null,
    );
    expect(r.filePath).toBe('/tmp/a.ts');
  });

  it('falls back to payload.input.file when path is absent', () => {
    const r = deriveApprovalDisplay(
      { reason: 'tool', payload: { name: 'fs.write', input: { file: 'b.ts' } } },
      null,
    );
    expect(r.filePath).toBe('b.ts');
  });

  it('attaches diff only when reason is "diff" and lastDiff is present', () => {
    const lastDiff = { file: 'x.ts', hunks: [] };
    expect(
      deriveApprovalDisplay({ reason: 'diff', payload: {} }, lastDiff).diff,
    ).toBe(lastDiff);
    expect(
      deriveApprovalDisplay({ reason: 'tool', payload: {} }, lastDiff).diff,
    ).toBeNull();
    expect(
      deriveApprovalDisplay({ reason: 'diff', payload: {} }, null).diff,
    ).toBeNull();
  });

  it('row budget grows with optional fields', () => {
    const base = deriveApprovalDisplay({ reason: 'tool', payload: {} }, null).rows;
    // border(2)+title(1)+reason(1)+spacer(1)+choices(1) = 6
    expect(base).toBe(6);
    const withTool = deriveApprovalDisplay(
      { reason: 'tool', payload: { name: 'fs.write' } },
      null,
    ).rows;
    expect(withTool).toBe(base + 1);
    const withDiff = deriveApprovalDisplay(
      { reason: 'diff', payload: {} },
      { file: 'a.ts', hunks: [] },
    ).rows;
    expect(withDiff).toBe(base + 14);
  });

  it('ignores non-string payload.name and non-object payload.input', () => {
    const r = deriveApprovalDisplay(
      { reason: 'tool', payload: { name: 42, input: 'not-an-object' } },
      null,
    );
    expect(r.toolName).toBeUndefined();
    expect(r.filePath).toBeUndefined();
  });
});
