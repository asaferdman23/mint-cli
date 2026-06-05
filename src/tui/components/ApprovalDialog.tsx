// src/tui/components/ApprovalDialog.tsx
// Modal-style approval gate — replaces the single yellow-line "approvalNotice"
// that BrainApp used. Owns its own useInput so y/n/a/Esc work directly without
// requiring the user to type into the prompt input. Reversible by design
// (AGENT.md §1.5): Esc always rejects.
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { DiffView, type DiffHunk } from './DiffView.js';

export interface ApprovalDialogDiff {
  file: string;
  hunks: DiffHunk[];
}

export interface ApprovalDialogCall {
  name: string;
  preview: string;
}

export interface ApprovalDialogProps {
  reason: string;
  toolName?: string;
  filePath?: string;
  diffPreview?: ApprovalDialogDiff | null;
  /** When this is an iteration approval, the list of bundled tool calls so
   *  the user knows exactly what's about to run. */
  iterationCalls?: ApprovalDialogCall[];
  onApprove: (always: boolean) => void;
  onReject: () => void;
  termCols: number;
}

export function ApprovalDialog({
  reason,
  toolName,
  filePath,
  diffPreview,
  iterationCalls,
  onApprove,
  onReject,
  termCols,
}: ApprovalDialogProps): React.ReactElement {
  const maxPreviewWidth = Math.max(20, termCols - 12);
  useInput((input, key) => {
    // Ctrl is owned by BrainApp (Ctrl+C exits); never claim it here.
    if (key.ctrl) return;
    if (key.escape) {
      onReject();
      return;
    }
    if (key.return) {
      onApprove(false);
      return;
    }
    const ch = input.toLowerCase();
    if (ch === 'y') {
      onApprove(false);
      return;
    }
    if (ch === 'n') {
      onReject();
      return;
    }
    if (ch === 'a') {
      // TODO: wire a true "always allow this tool" channel once the brain
      // approval protocol supports it. Today the resolver is a single boolean,
      // so we approve this invocation only.
      onApprove(true);
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">
        ? Approval needed
      </Text>
      <Text>{reason}</Text>
      {(toolName || filePath) && (
        <Box flexDirection="column">
          {toolName && (
            <Text dimColor>
              Tool: <Text>{toolName}</Text>
            </Text>
          )}
          {filePath && (
            <Text dimColor>
              File: <Text>{filePath}</Text>
            </Text>
          )}
        </Box>
      )}
      {diffPreview && (
        <Box marginTop={1} flexDirection="column">
          <DiffView
            file={diffPreview.file}
            hunks={diffPreview.hunks}
            maxRows={12}
            termCols={termCols}
          />
        </Box>
      )}
      {iterationCalls && iterationCalls.length > 0 && (
        <Box flexDirection="column">
          {iterationCalls.map((c, i) => {
            const preview = c.preview.length > maxPreviewWidth
              ? `${c.preview.slice(0, maxPreviewWidth - 1)}…`
              : c.preview;
            return (
              <Text key={`call-${i}`} dimColor>
                <Text color="cyan">→ </Text>
                <Text>{c.name}</Text>
                {preview ? <Text dimColor>{`  ${preview}`}</Text> : null}
              </Text>
            );
          })}
        </Box>
      )}
      <Box marginTop={1}>
        <Text>
          <Text color="cyan">[y]</Text> approve   <Text color="cyan">[n]</Text> reject   <Text color="cyan">[a]</Text> always allow this tool   <Text color="cyan">[Esc]</Text> cancel
        </Text>
      </Box>
    </Box>
  );
}
