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
  contextTokens?: number;
  quotaUsed?: number;
  quotaLimit?: number;
  termCols?: number;
  /** Anthropic prompt-cache hit ratio in [0,1]. Undefined when no cache-aware
   *  turns have happened yet. Rendered only when showExtras (≥110 cols). */
  cacheHitRatio?: number;
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

function cacheRatioColor(ratio: number): 'green' | 'yellow' | 'cyan' {
  if (ratio >= 0.75) return 'green';
  if (ratio < 0.5) return 'yellow';
  return 'cyan';
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
  contextTokens,
  quotaUsed,
  quotaLimit,
  termCols,
  cacheHitRatio,
}: StatusBarProps): React.ReactElement {
  const model = currentModel ?? 'auto';
  // Surface reasoning-enabled models in the status bar.
  const isThinking = typeof currentModel === 'string' && (
    currentModel === 'claude-opus-4' ||
    currentModel === 'grok-4-beta' ||
    currentModel === 'grok-4.1-fast'
  );

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
  const cols = termCols ?? process.stdout.columns ?? 80;
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
        {showExtras && cacheHitRatio != null && (
          <>
            <Text dimColor> │ </Text>
            <Text color={cacheRatioColor(cacheHitRatio)}>cache: {Math.round(cacheHitRatio * 100)}%</Text>
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
