// src/tui/components/CostBanner.tsx
// Transient yellow warning banner — used for cost-budget alerts so the chat
// transcript stays clean. Dismisses on Esc or when BrainApp clears it on the
// next user submit. Single line, round border, no layout shift (AGENT.md §1.6
// — caller reserves a fixed row budget while message is non-null; §2 — yellow
// is the warning color; §11 — round borders only).
import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface CostBannerProps {
  message: string;
  onDismiss: () => void;
  termCols: number;
}

export function CostBanner({ message, onDismiss, termCols }: CostBannerProps): React.ReactElement {
  useInput((_input, key) => {
    // Ctrl is owned by BrainApp (Ctrl+C exits); never claim it here.
    if (key.ctrl) return;
    if (key.escape) {
      onDismiss();
    }
  });

  // Reserve 2 cols for borders, 2 for paddingX, and a few for the "Esc" hint.
  const hint = ' (Esc to dismiss)';
  const maxBody = Math.max(10, termCols - 2 /* border */ - 2 /* padX */ - hint.length);
  const body = message.length > maxBody ? `${message.slice(0, maxBody - 1)}…` : message;

  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">⚠ </Text>
      <Text color="yellow">{body}</Text>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
