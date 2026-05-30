// src/tui/hooks/useApprovalFlow.ts
// Owns the approval gate: derives the display fields BrainApp's <ApprovalDialog>
// needs from a raw PendingApproval payload, plus the row budget reserved above
// the input (AGENT.md §1.6 — no layout shifts when a spinner starts).
//
// The pending-approval *state* still lives in useBrainEvents (it's produced
// from the brain event stream there). This hook is the consumer-side view:
// pure derivations + a reducer that's testable in isolation.
import { useMemo } from 'react';
import type { DiffHunk } from '../components/DiffView.js';

/** Subset of useBrainEvents' PendingApproval that we read. Kept structural
 *  to avoid a cycle into the events hook. */
export interface ApprovalFlowInput {
  reason: 'diff' | 'iteration' | 'tool' | string;
  payload: Record<string, unknown>;
}

export interface ApprovalDisplay {
  /** Tool name pulled out of payload.name, if any. */
  toolName: string | undefined;
  /** File path pulled out of payload.input.path or payload.input.file. */
  filePath: string | undefined;
  /** Diff to render inside the dialog (only when reason === 'diff'). */
  diff: { file: string; hunks: DiffHunk[] } | null;
  /** Total rows BrainApp must reserve above the input for the dialog. */
  rows: number;
}

/** Pure reducer: derive the dialog's display fields from the pending approval.
 *  Exported separately so it can be unit-tested without rendering Ink. */
export function deriveApprovalDisplay(
  pending: ApprovalFlowInput | null,
  lastDiff: { file: string; hunks: DiffHunk[] } | null,
): ApprovalDisplay {
  if (!pending) {
    return { toolName: undefined, filePath: undefined, diff: null, rows: 0 };
  }

  const toolName =
    typeof pending.payload.name === 'string' ? pending.payload.name : undefined;
  const input =
    typeof pending.payload.input === 'object' && pending.payload.input !== null
      ? (pending.payload.input as Record<string, unknown>)
      : undefined;
  const filePath =
    input && typeof input.path === 'string'
      ? input.path
      : input && typeof input.file === 'string'
        ? input.file
        : undefined;

  const diff = pending.reason === 'diff' && lastDiff ? lastDiff : null;

  // Rows: 2 border + title + reason + optional tool/file lines + optional
  // diff (capped at ~14 incl. its border) + spacer + choices.
  const rows =
    2 /* border */ +
    1 /* title */ +
    1 /* reason */ +
    (toolName ? 1 : 0) +
    (filePath ? 1 : 0) +
    (diff ? 14 : 0) +
    1 /* marginTop spacer above choices */ +
    1; /* choices */

  return { toolName, filePath, diff, rows };
}

export function useApprovalFlow(
  pending: ApprovalFlowInput | null,
  lastDiff: { file: string; hunks: DiffHunk[] } | null,
): ApprovalDisplay {
  return useMemo(() => deriveApprovalDisplay(pending, lastDiff), [pending, lastDiff]);
}
