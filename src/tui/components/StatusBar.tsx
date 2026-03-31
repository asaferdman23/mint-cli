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

function formatCostDisplay(cost: number): string {
  if (cost < 0.01) {
    return `${(cost * 100).toFixed(3)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

export function StatusBar({
  currentModel,
  sessionTokens,
  sessionCost,
  messageCount,
  routingReason,
}: StatusBarProps): React.ReactElement {
  const modelLabel = currentModel ?? 'auto';
  const userTurns = Math.ceil(messageCount / 2);

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
      <Text dimColor>
        {`[${modelLabel}] | tokens: ${sessionTokens.toLocaleString()} | cost: ${formatCostDisplay(sessionCost)} | session: #${userTurns}`}
      </Text>
      <Box flexDirection="row" gap={2}>
        {routingReason ? (
          <Text color="cyan" dimColor>{`routed: ${routingReason}`}</Text>
        ) : null}
        <Text dimColor>{'Ctrl+C exit  /help cmds'}</Text>
      </Box>
    </Box>
  );
}
