// src/tui/components/ContextChips.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { ContextChip } from '../types.js';

interface ContextChipsProps {
  chips: ContextChip[];
}

export function ContextChips({ chips }: ContextChipsProps): React.ReactElement {
  if (chips.length === 0) return <></>;

  return (
    <Box paddingX={1} gap={1} flexWrap="wrap">
      {chips.map((chip, i) => (
        <Text key={i} color={chip.color as Parameters<typeof Text>[0]['color']}>
          [{chip.label}]
        </Text>
      ))}
    </Box>
  );
}
