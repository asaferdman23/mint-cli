/**
 * opencode-style sidebar — modified files + session stats.
 * Rendered as the right panel of the chat split when there are tracked files.
 */
import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { currentTheme } from '../theme/manager.js';
import { Icons } from '../styles/icons.js';
import type { TrackedFile, FileStatus } from '../hooks/useBrainEvents.js';

interface SidebarProps {
  files: TrackedFile[];
  totalCost: number;
  totalTokens: number;
  width: number;
  height: number;
}

function statusGlyph(status: FileStatus, t: ReturnType<typeof currentTheme>): string {
  switch (status) {
    case 'NEW':  return chalk.hex(t.success)('A');
    case 'EDIT': return chalk.hex(t.warning)('M');
    case 'READ': return chalk.hex(t.textMuted)('R');
    case 'BASH': return chalk.hex(t.info)('$');
  }
}

function truncatePath(path: string, max: number): string {
  if (path.length <= max) return path;
  return Icons.ellipsis + path.slice(-(max - 1));
}

export function Sidebar({ files, totalCost, totalTokens, width, height }: SidebarProps): React.ReactElement {
  const t = currentTheme();
  const innerWidth = Math.max(12, width - 4);

  // Show changed files (NEW/EDIT) first, then reads.
  const sorted = [...files].sort((a, b) => {
    const rank = (s: FileStatus) => (s === 'NEW' || s === 'EDIT' ? 0 : 1);
    return rank(a.status) - rank(b.status) || b.timestamp - a.timestamp;
  });
  const visible = sorted.slice(0, Math.max(1, height - 5));

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={t.borderNormal as Parameters<typeof Box>[0]['borderColor']}
      paddingX={1}
      width={width}
      height={height}
      overflow="hidden"
    >
      <Text>{chalk.hex(t.primary).bold('Files')}</Text>
      <Text>{chalk.hex(t.borderNormal)(Icons.separator.repeat(innerWidth))}</Text>

      {visible.length === 0 ? (
        <Text>{chalk.hex(t.textMuted)('No files touched yet')}</Text>
      ) : (
        visible.map((f, i) => (
          <Text key={i}>
            {statusGlyph(f.status, t)}{' '}
            {chalk.hex(f.status === 'NEW' || f.status === 'EDIT' ? t.text : t.textMuted)(
              truncatePath(f.path, innerWidth - 2)
            )}
          </Text>
        ))
      )}

      {sorted.length > visible.length && (
        <Text>{chalk.hex(t.textMuted)(`  +${sorted.length - visible.length} more`)}</Text>
      )}

      <Box flexGrow={1} />
      <Text>{chalk.hex(t.borderNormal)(Icons.separator.repeat(innerWidth))}</Text>
      <Text>{chalk.hex(t.textMuted)(`${formatTokens(totalTokens)} tok · $${totalCost.toFixed(4)}`)}</Text>
    </Box>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
