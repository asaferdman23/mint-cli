// src/tui/components/DiffView.tsx
// Bordered diff preview — renders a unified-diff-style patch with explicit
// add/remove/context coloring and a soft row budget. Replaces the inline diff
// popup that lived in BrainApp; reused inside ApprovalDialog when an approval
// carries a diff payload.
import React from 'react';
import { Box, Text } from 'ink';

export interface DiffHunk {
  /** e.g. "@@ -10,5 +10,7 @@" — printed dim above the hunk's lines. */
  header?: string;
  lines: Array<{ kind: '+' | '-' | ' '; text: string }>;
}

export interface DiffViewProps {
  file: string;
  hunks: DiffHunk[];
  /** Soft cap on rendered rows (excluding the file header row). Default 20. */
  maxRows?: number;
  termCols: number;
}

/**
 * Truncate a single diff line to fit a target visual width. Diff columns must
 * stay aligned, so we never word-wrap — we slice and append `…` when over.
 * Exported for unit tests.
 */
export function truncateDiffLine(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (text.length <= maxWidth) return text;
  if (maxWidth === 1) return '…';
  return `${text.slice(0, maxWidth - 1)}…`;
}

/** Count +/- across all hunks. Exported for tests. */
export function countDiffStats(hunks: DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line.kind === '+') additions += 1;
      else if (line.kind === '-') deletions += 1;
    }
  }
  return { additions, deletions };
}

interface FlatRow {
  kind: 'header' | 'line';
  hunkIndex: number;
  text: string;
  lineKind?: '+' | '-' | ' ';
}

/** Flatten hunks → row stream so the row budget is enforced uniformly. */
function flattenHunks(hunks: DiffHunk[]): FlatRow[] {
  const rows: FlatRow[] = [];
  hunks.forEach((h, hi) => {
    if (h.header) rows.push({ kind: 'header', hunkIndex: hi, text: h.header });
    for (const l of h.lines) {
      rows.push({ kind: 'line', hunkIndex: hi, text: l.text, lineKind: l.kind });
    }
  });
  return rows;
}

export function DiffView({ file, hunks, maxRows = 20, termCols }: DiffViewProps): React.ReactElement {
  const { additions, deletions } = countDiffStats(hunks);
  // Subtract: 1 col gutter + 1 space + padding-x(1 each side = 2) ⇒ 4.
  const lineWidth = Math.max(8, termCols - 4);

  const allRows = flattenHunks(hunks);
  const totalRows = allRows.length;
  // Reserve 1 row for the "… N more lines" indicator when we overflow, so the
  // visible content is maxRows-1 if we need to elide.
  const overflow = totalRows > maxRows;
  const visibleCount = overflow ? Math.max(1, maxRows - 1) : totalRows;
  const visible = allRows.slice(0, visibleCount);
  const hiddenCount = totalRows - visible.length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        {file}
        <Text dimColor>{'  '}</Text>
        <Text color="green">+{additions}</Text>
        <Text dimColor> </Text>
        <Text color="red">-{deletions}</Text>
      </Text>
      {visible.map((row, i) => {
        if (row.kind === 'header') {
          return (
            <Text key={`h-${i}`} dimColor>
              {truncateDiffLine(row.text, lineWidth)}
            </Text>
          );
        }
        const k = row.lineKind ?? ' ';
        const color = k === '+' ? 'green' : k === '-' ? 'red' : undefined;
        const content = truncateDiffLine(row.text, lineWidth - 2);
        if (k === ' ') {
          return (
            <Text key={`l-${i}`}>
              {'  '}{content}
            </Text>
          );
        }
        return (
          <Text key={`l-${i}`} color={color}>
            {k} {content}
          </Text>
        );
      })}
      {overflow && (
        <Text dimColor>
          … {hiddenCount} more line{hiddenCount === 1 ? '' : 's'} (Ctrl+O to expand)
        </Text>
      )}
    </Box>
  );
}
