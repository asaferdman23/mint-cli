// src/tui/components/PipelinePhase.tsx
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { PipelinePhaseData } from '../types.js';

interface PipelinePhaseProps {
  phase: PipelinePhaseData;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `${(cost * 100).toFixed(3)}¢`;
  return `$${cost.toFixed(4)}`;
}

export function PipelinePhase({ phase }: PipelinePhaseProps): React.ReactElement {
  switch (phase.status) {
    case 'done':
      return (
        <Box flexDirection="column" marginBottom={0}>
          <Box gap={1}>
            <Text color="green">✓</Text>
            <Text dimColor>{phase.name}</Text>
            {phase.model && <Text dimColor>· {phase.model}</Text>}
            {phase.duration != null && <Text dimColor>· {formatDuration(phase.duration)}</Text>}
            {phase.cost != null && <Text dimColor>· {formatCost(phase.cost)}</Text>}
          </Box>
          {phase.summary && (
            <Text dimColor>{'  '}{phase.summary}</Text>
          )}
        </Box>
      );

    case 'active':
      return (
        <Box flexDirection="column" marginBottom={0} borderColor="cyan" borderLeft={true} borderRight={false} borderTop={false} borderBottom={false} paddingLeft={1}>
          <Box gap={1}>
            <Text color="cyan"><Spinner type="dots" /></Text>
            <Text color="cyan" bold>{phase.name}</Text>
            {phase.model && <Text dimColor>· {phase.model}</Text>}
          </Box>
          {phase.streamingContent && (
            <Box flexDirection="column">
              <Text wrap="wrap">{phase.streamingContent}</Text>
              <Text color="cyan">▋</Text>
            </Box>
          )}
        </Box>
      );

    case 'pending':
      return (
        <Box gap={1} marginBottom={0}>
          <Text dimColor>○</Text>
          <Text dimColor>{phase.name}</Text>
          <Text dimColor>· waiting</Text>
        </Box>
      );

    case 'skipped':
      return (
        <Box gap={1} marginBottom={0}>
          <Text dimColor>–</Text>
          <Text dimColor>{phase.name}</Text>
          <Text dimColor>· skipped</Text>
        </Box>
      );
  }
}
