/**
 * BrainToolInspector — Tab-opened reliability panel for brain sessions.
 *
 * Shows the last ~10 tool calls with name, duration, ok/err status, and a
 * short output preview. The point is "what is the agent doing right now?"
 * for reliability — not an analytics dashboard.
 */
import React from 'react';
import { Box, Text } from 'ink';
import type { RecentToolCall } from '../hooks/useBrainEvents.js';

interface BrainToolInspectorProps {
  calls: RecentToolCall[];
  maxHeight: number;
}

export function BrainToolInspector({ calls, maxHeight }: BrainToolInspectorProps): React.ReactElement | null {
  if (calls.length === 0 || maxHeight <= 2) return null;

  // Reserve 1 line for the header, show up to maxHeight-1 entries.
  const rows = calls.slice(-Math.max(1, maxHeight - 1)).reverse();

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="cyan" height={maxHeight}>
      <Box>
        <Text bold color="cyan">
          Tool calls
        </Text>
        <Text dimColor>{'  '}(Tab to close)</Text>
      </Box>
      {rows.map((call) => (
        <Box key={call.id} flexDirection="column">
          <Box>
            <Text color={statusColor(call)}>{statusGlyph(call)}</Text>
            <Text>{' '}</Text>
            <Text bold>{call.name}</Text>
            <Text dimColor>{'  '}{summarizeInput(call.input)}</Text>
            {call.durationMs != null && (
              <Text dimColor>
                {'  '}
                {formatDuration(call.durationMs)}
              </Text>
            )}
          </Box>
          {call.output && (
            <Box paddingLeft={2}>
              <Text dimColor>{truncate(call.output.replace(/\s+/g, ' '), 100)}</Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

function statusGlyph(call: RecentToolCall): string {
  if (call.ok === true) return '✓';
  if (call.ok === false) return '✗';
  return '●';
}

function statusColor(call: RecentToolCall): 'green' | 'red' | 'yellow' {
  if (call.ok === true) return 'green';
  if (call.ok === false) return 'red';
  return 'yellow';
}

function summarizeInput(input: Record<string, unknown>): string {
  const path = input.path ?? input.file ?? input.command ?? input.query ?? input.pattern;
  if (typeof path === 'string') return truncate(path, 50);
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  return truncate(JSON.stringify(input), 50);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
