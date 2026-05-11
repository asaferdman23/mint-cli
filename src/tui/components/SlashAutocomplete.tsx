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

/**
 * All registered slash commands for autocomplete.
 * Keep this list in sync with the `if (trimmed === '/...'` branches in
 * BrainApp.tsx — a command that isn't handled there will silently be sent
 * as a regular prompt and confuse users.
 */
export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'help', description: 'show commands + keyboard shortcuts' },
  { name: 'clear', description: 'clear chat history' },
  { name: 'model', description: 'list or switch active model (e.g. /model claude-sonnet-4)' },
  { name: 'login', description: 'sign in via browser (GitHub or Google)' },
  { name: 'logout', description: 'sign out of the gateway' },
  { name: 'usage', description: 'show free-tier quota + session cost' },
  { name: 'trace', description: 'show recent events from this session' },
  { name: 'diff', description: 'switch to diff mode (per-file approval)' },
  { name: 'auto', description: 'switch to auto mode (skip approvals)' },
  { name: 'plan', description: 'switch to plan mode (no writes)' },
  { name: 'yolo', description: 'switch to yolo mode (full autonomy)' },
];
