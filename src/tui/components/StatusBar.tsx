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
  deepseekModel?: string;
  contextTokens?: number;
  quotaUsed?: number;
  quotaLimit?: number;
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
  deepseekModel,
  contextTokens,
  quotaUsed,
  quotaLimit,
}: StatusBarProps): React.ReactElement {
  const model = deepseekModel ?? currentModel ?? 'auto';
  const isThinking = deepseekModel === 'deepseek-reasoner';

  // Calculate quota status
  const showQuota = quotaUsed != null && quotaLimit != null;
  const quotaRemaining = showQuota ? quotaLimit - quotaUsed : 0;
  const quotaPercent = showQuota ? (quotaUsed / quotaLimit) * 100 : 0;

  let quotaColor: Parameters<typeof Text>[0]['color'] = 'green';
  if (quotaPercent >= 90) quotaColor = 'red';
  else if (quotaPercent >= 70) quotaColor = 'yellow';

  // Responsive layout priority (narrow → wide):
  //   1. mode           (always show; critical safety indicator)
  //   2. quota          (always show if set; critical for free-tier UX)
  //   3. model          (always show; users want to know what's running)
  //   4. session cost   (hide < 70 cols)
  //   5. tokens         (hide < 90 cols)
  //   6. month cost / savings / context / inspector hint / version (hide < 110 cols)
  const cols = process.stdout.columns ?? 80;
  const showDetails = cols >= 70;
  const showTokens = cols >= 90;
  const showExtras = cols >= 110;

  return (
    <Box paddingX={1}>
      <Box flexGrow={1} flexShrink={1} gap={0} overflow="hidden">
        <Text dimColor>{model}{isThinking ? ' [thinking]' : ''}</Text>
        {showTokens && (
          <>
            <Text dimColor> │ </Text>
            <Text dimColor>{formatTokens(sessionTokens)} tokens</Text>
          </>
        )}
        {showDetails && (
          <>
            <Text dimColor> │ </Text>
            <Text dimColor>session {formatCost(sessionCost)}</Text>
          </>
        )}
        {showExtras && monthlyCost != null && monthlyCost > 0 && (
          <>
            <Text dimColor> │ </Text>
            <Text color="cyan">month {formatCost(monthlyCost)}</Text>
          </>
        )}
        {showQuota && (
          <>
            <Text dimColor> │ </Text>
            <Text color={quotaColor}>{quotaRemaining}/{quotaLimit} free</Text>
          </>
        )}
        {showExtras && savingsPct != null && savingsPct > 0 && (
          <>
            <Text dimColor> │ </Text>
            <Text color="green" bold>-{savingsPct}% vs Opus</Text>
          </>
        )}
      </Box>
      <Box flexShrink={0} gap={0}>
        <Text dimColor> │ </Text>
        <Text color={modeColor(agentMode) as Parameters<typeof Text>[0]['color']}>{agentMode}</Text>
        {showExtras && contextTokens != null && contextTokens > 0 && (
          <>
            <Text dimColor> │ </Text>
            <Text dimColor>ctx {formatTokens(contextTokens)}</Text>
          </>
        )}
        {showExtras && <Text dimColor> │ v0.3.0-β1</Text>}
        {showExtras && inspectorHint && (
          <>
            <Text dimColor> │ </Text>
            <Text dimColor>{inspectorHint}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
