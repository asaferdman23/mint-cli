// src/tui/components/SlashAutocomplete.tsx
import React from 'react';
import { Box, Text } from 'ink';

export interface SlashCommandDef {
  name: string;
  description: string;
}

interface SlashAutocompleteProps {
  input: string;
  commands: SlashCommandDef[];
  selectedIndex: number;
}

export function SlashAutocomplete({
  input,
  commands,
  selectedIndex,
}: SlashAutocompleteProps): React.ReactElement {
  const prefix = input.toLowerCase();
  const matches = commands.filter(
    (cmd) => `/${cmd.name}`.startsWith(prefix),
  );

  if (matches.length === 0) return <></>;

  const visible = matches.slice(0, 5);

  return (
    <Box flexDirection="column" paddingX={2} marginBottom={0}>
      {visible.map((cmd, i) => {
        const isSelected = i === selectedIndex % visible.length;
        return (
          <Box key={cmd.name} gap={1}>
            <Text
              color={isSelected ? 'cyan' : undefined}
              bold={isSelected}
            >
              {isSelected ? '▸' : ' '} /{cmd.name.padEnd(8)}
            </Text>
            <Text dimColor>— {cmd.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** All registered slash commands for autocomplete. */
export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'help', description: 'show commands + keyboard shortcuts' },
  { name: 'clear', description: 'clear chat history' },
  { name: 'model', description: 'show current model' },
  { name: 'auto', description: 'toggle auto mode (skip approvals)' },
  { name: 'yolo', description: 'toggle yolo mode (full autonomy)' },
  { name: 'usage', description: 'session stats + savings' },
];
