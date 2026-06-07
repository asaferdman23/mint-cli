/**
 * opencode-style @-completion dropdown — shows project files matching the
 * partial path typed after an `@`. Positioned above the editor.
 *
 * The parent owns the query + selection index and key handling; this is
 * purely presentational.
 */
import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { currentTheme } from '../theme/manager.js';
import { Icons } from '../styles/icons.js';

interface FileCompletionProps {
  matches: string[];
  selectedIndex: number;
  maxVisible?: number;
}

export function FileCompletion({ matches, selectedIndex, maxVisible = 8 }: FileCompletionProps): React.ReactElement | null {
  const t = currentTheme();
  if (matches.length === 0) return null;

  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, selectedIndex - half);
  const end = Math.min(matches.length, start + maxVisible);
  start = Math.max(0, end - maxVisible);
  const visible = matches.slice(start, end);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={t.borderNormal as Parameters<typeof Box>[0]['borderColor']}
      paddingX={1}
    >
      {visible.map((file, i) => {
        const realIdx = start + i;
        const selected = realIdx === selectedIndex;
        const pointer = selected ? chalk.hex(t.primary)(Icons.pointer + ' ') : '  ';
        const label = selected ? chalk.hex(t.text).bold(file) : chalk.hex(t.textMuted)(file);
        return <Text key={realIdx}>{pointer}{Icons.document} {label}</Text>;
      })}
      {matches.length > visible.length && (
        <Text>{chalk.hex(t.textMuted)(`  ${Icons.ellipsis} ${matches.length - visible.length} more`)}</Text>
      )}
    </Box>
  );
}
