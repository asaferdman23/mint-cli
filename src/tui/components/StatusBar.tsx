/**
 * opencode-style status bar:
 * [ctrl+h help]  [Context: Xt · $Y]  [mode]  [model]
 */
import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { currentTheme } from '../theme/manager.js';
import type { ModelId } from '../../providers/types.js';

interface StatusBarProps {
  currentModel: ModelId | null;
  sessionTokens: number;
  sessionCost: number;
  agentMode?: string;
  quotaUsed?: number;
  quotaLimit?: number;
  statusMessage?: { text: string; kind: 'info' | 'warn' | 'error' } | null;
  // legacy compat
  monthlyCost?: number;
  savingsPct?: number;
  inspectorHint?: string;
  deepseekModel?: string;
  contextTokens?: number;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `${(n * 100).toFixed(3)}¢`;
  return `$${n.toFixed(4)}`;
}

function modeColor(mode: string, theme: ReturnType<typeof currentTheme>): string {
  switch (mode) {
    case 'yolo': return theme.error;
    case 'plan': return theme.info;
    case 'diff': return theme.warning;
    default:     return theme.success;
  }
}

export function StatusBar({
  currentModel,
  sessionTokens,
  sessionCost,
  agentMode = 'auto',
  quotaUsed,
  quotaLimit,
  statusMessage,
  deepseekModel,
}: StatusBarProps): React.ReactElement {
  const t = currentTheme();
  const model = deepseekModel ?? currentModel ?? 'auto';
  const cols = process.stdout.columns ?? 80;

  // Context / quota pct for warning threshold
  const quotaPct = quotaUsed != null && quotaLimit != null && quotaLimit > 0
    ? (quotaUsed / quotaLimit) * 100
    : 0;
  const tokenWarning = quotaPct >= 80;

  // If there's a transient status message, show it in the middle section
  if (statusMessage) {
    const msgColor = statusMessage.kind === 'error' ? t.error
      : statusMessage.kind === 'warn' ? t.warning
      : t.info;
    return (
      <Box paddingX={1} height={1} overflow="hidden">
        <Text>{chalk.hex(t.textMuted)('ctrl+h') + chalk.hex(t.borderNormal)(' │ ')}</Text>
        <Text>{chalk.hex(msgColor)(statusMessage.text)}</Text>
        <Box flexGrow={1} />
        <Text>{chalk.hex(t.borderNormal)(' │ ') + chalk.hex(modeColor(agentMode, t))(agentMode)}</Text>
      </Box>
    );
  }

  const parts: React.ReactElement[] = [];

  // Help hint
  parts.push(
    <Text key="help">{chalk.hex(t.textMuted)('ctrl+h help')}</Text>
  );

  // Separator
  parts.push(<Text key="sep1">{chalk.hex(t.borderNormal)(' │ ')}</Text>);

  // Context + cost (show cost only if >0 or wide terminal)
  if (sessionTokens > 0 || sessionCost > 0) {
    const contextStr = sessionTokens > 0 ? `Context: ${fmtTokens(sessionTokens)}` : '';
    const costStr = sessionCost > 0 ? `Cost: ${fmtCost(sessionCost)}` : '';
    const combined = [contextStr, costStr].filter(Boolean).join('  ');
    const color = tokenWarning ? t.warning : t.textMuted;
    parts.push(<Text key="ctx">{chalk.hex(color)(combined)}</Text>);
    parts.push(<Text key="sep2">{chalk.hex(t.borderNormal)(' │ ')}</Text>);
  }

  // Quota (free tier)
  if (quotaUsed != null && quotaLimit != null && cols >= 80) {
    const remaining = quotaLimit - quotaUsed;
    const qColor = quotaPct >= 90 ? t.error : quotaPct >= 70 ? t.warning : t.success;
    parts.push(<Text key="quota">{chalk.hex(qColor)(`${remaining}/${quotaLimit} free`)}</Text>);
    parts.push(<Text key="sep3">{chalk.hex(t.borderNormal)(' │ ')}</Text>);
  }

  // Spacer
  parts.push(<Box key="spacer" flexGrow={1} />);

  // Mode
  parts.push(
    <Text key="mode">{chalk.hex(modeColor(agentMode, t)).bold(agentMode)}</Text>
  );
  parts.push(<Text key="sep4">{chalk.hex(t.borderNormal)(' │ ')}</Text>);

  // Model
  parts.push(
    <Text key="model">{chalk.hex(t.textMuted)(String(model))}</Text>
  );

  return (
    <Box paddingX={1} height={1} overflow="hidden">
      {parts}
    </Box>
  );
}
