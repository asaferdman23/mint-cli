// src/tui/components/QueuedPrompts.tsx
// Strip of pending prompts that the user typed while the agent was busy.
// Items are FIFO; the head dequeues automatically when the in-flight task ends.
import React from 'react';
import { Box, Text } from 'ink';

interface QueuedPromptsProps {
  items: string[];
  termCols: number;
}

export function QueuedPrompts({ items, termCols }: QueuedPromptsProps): React.ReactElement | null {
  if (items.length === 0) return null;
  // Each line: "› <text>". Budget = cols - paddingX(2) - prefix(2). Floor at 20.
  const budget = Math.max(20, termCols - 4);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan" bold>Queued ({items.length})</Text>
      {items.map((item, i) => {
        const single = item.replace(/\s+/g, ' ');
        const truncated = single.length > budget ? `${single.slice(0, budget - 1)}…` : single;
        return (
          <Box key={i}>
            <Text color="cyan">› </Text>
            <Text dimColor>{truncated}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
