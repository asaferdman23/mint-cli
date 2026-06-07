/**
 * opencode-style welcome screen:
 * ⌬ Mint CLI · version · cwd · examples · shortcuts
 */
import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { currentTheme } from '../theme/manager.js';
import { Icons } from '../styles/icons.js';

const EXAMPLES = [
  'fix the failing tests in src/brain/',
  'add pagination to the usage dashboard',
  'explain what loop.ts does',
  'refactor the router to support per-route timeouts',
];

export function WelcomeScreen(): React.ReactElement {
  const t = currentTheme();
  const cwd = process.cwd();

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>

      {/* Logo + version */}
      <Box flexDirection="row" gap={1}>
        <Text>{chalk.hex(t.primary).bold(`${Icons.logo} Mint CLI`)}</Text>
        <Text>{chalk.hex(t.textMuted)('v0.3.0-beta.10')}</Text>
      </Box>

      {/* cwd */}
      <Box>
        <Text>
          {chalk.hex(t.textMuted)('cwd: ')}
          {chalk.hex(t.text)(cwd)}
        </Text>
      </Box>

      {/* divider */}
      <Box marginTop={1}>
        <Text>{chalk.hex(t.borderNormal)(Icons.separator.repeat(50))}</Text>
      </Box>

      {/* Examples */}
      <Box marginTop={1} flexDirection="column">
        <Text>{chalk.hex(t.textEmphasized).bold('Try asking:')}</Text>
        {EXAMPLES.map((ex, i) => (
          <Box key={i}>
            <Text>
              {chalk.hex(t.primary)(`  ${Icons.arrow} `)}
              {chalk.hex(t.text)(ex)}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Shortcuts */}
      <Box marginTop={1}>
        <Text>{chalk.hex(t.borderNormal)(Icons.separator.repeat(50))}</Text>
      </Box>
      <Box marginTop={0}>
        <Text>
          {chalk.hex(t.primary).bold('ctrl+h')}{chalk.hex(t.textMuted)(' help   ')}
          {chalk.hex(t.primary).bold('ctrl+o')}{chalk.hex(t.textMuted)(' model   ')}
          {chalk.hex(t.primary).bold('ctrl+t')}{chalk.hex(t.textMuted)(' theme   ')}
          {chalk.hex(t.primary).bold('ctrl+b')}{chalk.hex(t.textMuted)(' files   ')}
          {chalk.hex(t.primary).bold('ctrl+c')}{chalk.hex(t.textMuted)(' exit')}
        </Text>
      </Box>
    </Box>
  );
}
