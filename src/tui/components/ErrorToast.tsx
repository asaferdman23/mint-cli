// src/tui/components/ErrorToast.tsx
// Transient red error toast — surfaces brain `error` events (rate limits,
// gateway failures) prominently above the input instead of burying them in
// the trace inspector. Dismisses on Esc or when BrainApp clears it on the
// next user submit. AGENT.md §1.5 (reversibility — Esc always reachable),
// §2 (red is the error color), §11 (round borders only, no emoji).
import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface ErrorToastProps {
  message: string;
  onDismiss: () => void;
  termCols: number;
}

export function ErrorToast({ message, onDismiss, termCols }: ErrorToastProps): React.ReactElement {
  useInput((_input, key) => {
    if (key.ctrl) return;
    if (key.escape) onDismiss();
  });

  const hint = ' (Esc to dismiss)';
  const maxBody = Math.max(10, termCols - 2 /* border */ - 2 /* padX */ - hint.length - 2 /* glyph */);
  const body = message.length > maxBody ? `${message.slice(0, maxBody - 1)}…` : message;

  return (
    <Box borderStyle="round" borderColor="red" paddingX={1}>
      <Text color="red" bold>✗ </Text>
      <Text color="red">{body}</Text>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
