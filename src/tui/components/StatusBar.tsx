import React from 'react';
import { Box, Text } from 'ink';
import type { ModelId } from '../../providers/types.js';

interface StatusBarProps {
  currentModel: ModelId | null;
  sessionTokens: number;
  sessionCost: number;
  messageCount: number;
  routingReason?: string;
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `${(cost * 100).toFixed(3)}¢`;
  return `$${cost.toFixed(4)}`;
}

export function StatusBar({ currentModel, sessionTokens, sessionCost }: StatusBarProps): React.ReactElement {
  const model = currentModel ?? 'auto';
  return (
    <Box paddingX={1}>
      <Text dimColor>{`${model} · ${sessionTokens.toLocaleString()} tokens · ${formatCost(sessionCost)}`}</Text>
    </Box>
  );
}
