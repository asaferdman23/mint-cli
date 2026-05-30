// src/tui/components/WelcomeScreen.tsx
import React from 'react';
import { Box, Text } from 'ink';

const MINT_LOGO = [
  '███╗   ███╗██╗███╗   ██╗████████╗     ██████╗██╗     ██╗',
  '████╗ ████║██║████╗  ██║╚══██╔══╝    ██╔════╝██║     ██║',
  '██╔████╔██║██║██╔██╗ ██║   ██║       ██║     ██║     ██║',
  '██║╚██╔╝██║██║██║╚██╗██║   ██║       ██║     ██║     ██║',
  '██║ ╚═╝ ██║██║██║ ╚████║   ██║       ╚██████╗███████╗██║',
  '╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝╚══════╝╚═╝',
];

// Example prompts the user can type to get started. Copy-paste friendly.
const EXAMPLES = [
  'add a README section for installation',
  'fix the mobile nav toggle',
  'explain what src/main.ts does',
  'refactor the auth function to use async/await',
];

export function WelcomeScreen(): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" paddingTop={1}>
      {/* ASCII Logo */}
      <Box flexDirection="column" alignItems="flex-start">
        {MINT_LOGO.map((line, i) => (
          <Text key={i} color="cyan">
            {line}
          </Text>
        ))}
      </Box>

      {/* Tagline */}
      <Box marginTop={0}>
        <Text dimColor>AI coding assistant · smart routing · under a penny per task</Text>
      </Box>

      {/* First-prompt hint */}
      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0}>
        <Box>
          <Text color="cyan" bold>Try typing one of these:</Text>
        </Box>
        <Box marginTop={0} flexDirection="column">
          {EXAMPLES.map((ex, i) => (
            <Box key={i}>
              <Text dimColor>  › </Text>
              <Text color="white">{ex}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Shortcuts — Tab hint intentionally omitted here: BrainApp's useInput
          is gated on messages.length > 0, so Tab would be a no-op on the
          welcome screen. Once the session has activity, StatusBar's
          inspectorHint slot surfaces the Tab/Ctrl+O affordance. */}
      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text dimColor>
          <Text color="yellow">/help</Text>
          {' help  '}
          <Text color="yellow">/auto</Text>
          {' skip approvals  '}
          <Text color="yellow">Ctrl+C</Text>
          {' exit'}
        </Text>
      </Box>
    </Box>
  );
}
