// src/tui/components/WelcomeScreen.tsx
import React from 'react';
import { Box, Text } from 'ink';

const MINT_LOGO = [
  '  ███╗   ███╗██╗███╗   ██╗████████╗     ██████╗██╗     ██╗',
  '  ████╗ ████║██║████╗  ██║╚══██╔══╝    ██╔════╝██║     ██║',
  '  ██╔████╔██║██║██╔██╗ ██║   ██║       ██║     ██║     ██║',
  '  ██║╚██╔╝██║██║██║╚██╗██║   ██║       ██║     ██║     ██║',
  '  ██║ ╚═╝ ██║██║██║ ╚████║   ██║       ╚██████╗███████╗██║',
  '  ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝╚══════╝╚═╝',
];

interface WelcomeScreenProps {
  modelCount?: number;
  agentCount?: number;
  savingsLabel?: string;
}

export function WelcomeScreen({
  modelCount = 18,
  agentCount = 4,
  savingsLabel = '97%',
}: WelcomeScreenProps): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" flexGrow={1} paddingTop={1}>
      {/* ASCII Logo */}
      <Box flexDirection="column" alignItems="center">
        {MINT_LOGO.map((line, i) => (
          <Text key={i} color="cyan">{line}</Text>
        ))}
      </Box>

      {/* Subtitle */}
      <Box marginTop={0}>
        <Text color="cyan" dimColor>{'          AI CODING CLI'}</Text>
      </Box>

      {/* Stats Row */}
      <Box marginTop={1} gap={4}>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>{String(modelCount)}</Text>
          <Text dimColor>models</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>{String(agentCount)}</Text>
          <Text dimColor>agents</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>{savingsLabel}</Text>
          <Text dimColor>cheaper</Text>
        </Box>
      </Box>

      {/* Info Cards */}
      <Box marginTop={1} gap={2}>
        {/* Quick Start */}
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={30}>
          <Text dimColor bold>{'QUICK START'}</Text>
          <Text><Text color="cyan">mint init</Text><Text dimColor> — index project</Text></Text>
          <Text><Text color="cyan">/models </Text><Text dimColor> — all models</Text></Text>
          <Text><Text color="cyan">/agent  </Text><Text dimColor> — switch mode</Text></Text>
          <Text><Text color="cyan">/usage  </Text><Text dimColor> — session stats</Text></Text>
        </Box>

        {/* Keyboard */}
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={30}>
          <Text dimColor bold>{'KEYBOARD'}</Text>
          <Text><Text color="yellow">Esc   </Text><Text dimColor> → normal mode</Text></Text>
          <Text><Text color="yellow">i     </Text><Text dimColor> → insert mode</Text></Text>
          <Text><Text color="yellow">Enter </Text><Text dimColor> → send message</Text></Text>
          <Text><Text color="yellow">Tab   </Text><Text dimColor> → live inspector</Text></Text>
          <Text><Text color="yellow">PgUp  </Text><Text dimColor> → scroll faster</Text></Text>
          <Text><Text color="yellow">Ctrl+C</Text><Text dimColor> → exit</Text></Text>
        </Box>
      </Box>
    </Box>
  );
}
