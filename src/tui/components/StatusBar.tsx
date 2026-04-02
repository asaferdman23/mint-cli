// src/tui/components/StatusBar.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { ModelId } from '../../providers/types.js';

interface StatusBarProps {
  currentModel: ModelId | null;
  sessionTokens: number;
  sessionCost: number;
  savingsPct?: number;
  agentMode?: string;
  inspectorHint?: string;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `${(cost * 100).toFixed(3)}¢`;
  return `$${cost.toFixed(4)}`;
}

function modeColor(mode: string): string {
  switch (mode) {
    case 'yolo': return 'red';
    case 'plan': return 'blue';
    case 'diff': return 'yellow';
    default: return 'green';
  }
}

export function StatusBar({
  currentModel,
  sessionTokens,
  sessionCost,
  savingsPct,
  agentMode = 'auto',
  inspectorHint,
}: StatusBarProps): React.ReactElement {
  const model = currentModel ?? 'auto';

  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box gap={0}>
        <Text dimColor>{model}</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{formatTokens(sessionTokens)} tokens</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{formatCost(sessionCost)}</Text>
        {savingsPct != null && savingsPct > 0 && (
          <>
            <Text dimColor> │ </Text>
            <Text color="green" bold>-{savingsPct}% vs Opus</Text>
          </>
        )}
      </Box>
      <Box gap={0}>
        <Text color={modeColor(agentMode) as Parameters<typeof Text>[0]['color']}>{agentMode}</Text>
        <Text dimColor> │ v0.2.0</Text>
        {inspectorHint && (
          <>
            <Text dimColor> │ </Text>
            <Text dimColor>{inspectorHint}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
