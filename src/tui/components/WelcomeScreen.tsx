// src/tui/components/WelcomeScreen.tsx
import React from 'react';
import { Box, Text } from 'ink';

const MINT_LOGO = [
  '  ███╗   ███╗██╗███╗   ██╗████████╗',
  '  ████╗ ████║██║████╗  ██║╚══██╔══╝',
  '  ██╔████╔██║██║██╔██╗ ██║   ██║   ',
  '  ██║╚██╔╝██║██║██║╚██╗██║   ██║   ',
  '  ██║ ╚═╝ ██║██║██║ ╚████║   ██║   ',
  '  ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝   ',
];

export function WelcomeScreen(): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" flexGrow={1} paddingTop={1}>
      {/* ASCII Logo */}
      <Box flexDirection="column" alignItems="center">
        {MINT_LOGO.map((line, i) => (
          <Text key={i} color="cyan">{line}</Text>
        ))}
      </Box>

      {/* Tagline */}
      <Box marginTop={0}>
        <Text dimColor>{'  AI coding assistant · under a penny per task'}</Text>
      </Box>

      {/* Stats */}
      <Box marginTop={1} gap={4}>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>13</Text>
          <Text dimColor>tools</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>8</Text>
          <Text dimColor>providers</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>98%</Text>
          <Text dimColor>cheaper</Text>
        </Box>
      </Box>

      {/* Info Cards */}
      <Box marginTop={1} gap={2}>
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={30}>
          <Text dimColor bold>{'COMMANDS'}</Text>
          <Text><Text color="cyan">/help  </Text><Text dimColor> — show all commands</Text></Text>
          <Text><Text color="cyan">/auto  </Text><Text dimColor> — skip approvals</Text></Text>
          <Text><Text color="cyan">/yolo  </Text><Text dimColor> — full autonomy</Text></Text>
          <Text><Text color="cyan">/usage </Text><Text dimColor> — session stats</Text></Text>
        </Box>

        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={30}>
          <Text dimColor bold>{'KEYBOARD'}</Text>
          <Text><Text color="yellow">i     </Text><Text dimColor> → insert mode</Text></Text>
          <Text><Text color="yellow">Esc   </Text><Text dimColor> → normal mode</Text></Text>
          <Text><Text color="yellow">Enter </Text><Text dimColor> → send message</Text></Text>
          <Text><Text color="yellow">Ctrl+C</Text><Text dimColor> → exit</Text></Text>
        </Box>
      </Box>
    </Box>
  );
}
