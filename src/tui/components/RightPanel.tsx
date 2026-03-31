// src/tui/components/RightPanel.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { FileTracker } from './FileTracker.js';
import type { PanelState } from '../hooks/useAgentEvents.js';

interface RightPanelProps {
  state: PanelState;
  currentModel: string | null;
  mode?: string;
  width?: number;
  savingsPct?: number;
}

export function RightPanel({ state, currentModel, mode = 'auto', width = 24, savingsPct }: RightPanelProps): React.ReactElement {
  const toolSummary = state.toolCalls
    .map(t => `${t.name.replace('_', '')}x${t.count}`)
    .join(' ');

  const costStr = state.totalCost < 0.001
    ? `${(state.totalCost * 100_000).toFixed(3)}mc`
    : `$${state.totalCost.toFixed(4)}`;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      {/* Files Section */}
      <Text bold color="cyan"> FILES</Text>
      <FileTracker files={state.files} maxVisible={6} />

      <Box marginTop={1} />

      {/* Tools Section */}
      <Text bold color="cyan"> TOOLS ({state.iterationCount})</Text>
      {toolSummary ? (
        <Text wrap="truncate">{toolSummary}</Text>
      ) : (
        <Text dimColor>none yet</Text>
      )}

      <Box marginTop={1} />

      {/* Cost Section */}
      <Text bold color="cyan"> COST</Text>
      <Text color="green">{costStr}</Text>
      {state.totalTokens > 0 && (
        <Text dimColor>{state.totalTokens.toLocaleString()} tok</Text>
      )}

      <Box marginTop={1} />

      {/* Model + Mode + Savings badge */}
      {currentModel && (
        <Text dimColor wrap="truncate">{currentModel}</Text>
      )}
      <Text color={modeColor(mode) as Parameters<typeof Text>[0]['color']}>{mode}</Text>
      {savingsPct !== undefined && savingsPct > 0 && (
        <Text color="green">{`-${savingsPct}% vs Opus`}</Text>
      )}
    </Box>
  );
}

function modeColor(mode: string): string {
  switch (mode) {
    case 'yolo': return 'red';
    case 'plan': return 'blue';
    case 'diff': return 'yellow';
    default:     return 'green';
  }
}
