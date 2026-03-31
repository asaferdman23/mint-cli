// src/tui/components/FileTracker.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { TrackedFile } from '../hooks/useAgentEvents.js';

interface FileTrackerProps {
  files: TrackedFile[];
  maxVisible?: number;
}

const STATUS_COLORS: Record<string, string> = {
  READ: 'blue',
  EDIT: 'yellow',
  NEW:  'green',
  BASH: 'cyan',
};

export function FileTracker({ files, maxVisible = 8 }: FileTrackerProps): React.ReactElement {
  const visible = files.slice(-maxVisible);  // most recent

  if (visible.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>no files yet</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visible.map((f) => {
        const name = f.path.split('/').pop() ?? f.path;
        const color = STATUS_COLORS[f.status] ?? 'white';
        return (
          <Box key={`${f.path}-${f.timestamp}`} gap={1}>
            <Text dimColor>{name.slice(0, 14).padEnd(14)}</Text>
            <Text color={color as Parameters<typeof Text>[0]['color']}>{f.status}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
