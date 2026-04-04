// src/tui/components/StatusBar.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { ModelId } from '../../providers/types.js';

interface StatusBarProps {
  currentModel: ModelId | null;
  sessionTokens: number;
  sessionCost: number;
  monthlyCost?: number;
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
  monthlyCost,
  savingsPct,
  agentMode = 'auto',
  inspectorHint,
}: StatusBarProps): React.ReactElement {
  const model = currentModel ?? 'auto';

  return (
    <Box paddingX={1}>
      <Box flexGrow={1} flexShrink={1} gap={0} overflow="hidden">
        <Text dimColor>{model}</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{formatTokens(sessionTokens)} tokens</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>session {formatCost(sessionCost)}</Text>
        {monthlyCost != null && monthlyCost > 0 && (
          <>
            <Text dimColor> │ </Text>
            <Text color="cyan">month {formatCost(monthlyCost)}</Text>
          </>
        )}
        {savingsPct != null && savingsPct > 0 && (
          <>
            <Text dimColor> │ </Text>
            <Text color="green" bold>-{savingsPct}% vs Opus</Text>
          </>
        )}
      </Box>
      <Box flexShrink={0} gap={0}>
        <Text dimColor> │ </Text>
        <Text color={modeColor(agentMode) as Parameters<typeof Text>[0]['color']}>{agentMode}</Text>
        <Text dimColor> │ v0.2.0-beta</Text>
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
