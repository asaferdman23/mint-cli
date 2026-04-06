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
          <Text color="cyan" bold>DeepSeek V3.2</Text>
          <Text dimColor>model</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>~$0.01</Text>
          <Text dimColor>per task</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>95%+</Text>
          <Text dimColor>cheaper</Text>
        </Box>
      </Box>

      {/* Info Cards — top row */}
      <Box marginTop={1} gap={2}>
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={30}>
          <Text dimColor bold>{'CHAT (here)'}</Text>
          <Text dimColor>{'Type a task below to start.'}</Text>
          <Text dimColor>{'Runs via gateway — no key needed.'}</Text>
          <Text> </Text>
          <Text><Text color="cyan">/help  </Text><Text dimColor> — show all commands</Text></Text>
          <Text><Text color="cyan">/auto  </Text><Text dimColor> — skip approvals</Text></Text>
          <Text><Text color="cyan">/yolo  </Text><Text dimColor> — full autonomy</Text></Text>
        </Box>

        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={38}>
          <Text dimColor bold>{'CLI ONE-SHOT'}</Text>
          <Text><Text color="green">{'mint '}</Text><Text dimColor>{'"add a health check"'}</Text></Text>
          <Text><Text color="green">{'mint '}</Text><Text color="yellow">{'--think '}</Text><Text dimColor>{'"refactor auth"'}</Text></Text>
          <Text><Text color="green">{'mint '}</Text><Text color="yellow">{'--fast  '}</Text><Text dimColor>{'"rename variable"'}</Text></Text>
          <Text> </Text>
          <Text dimColor>{'Needs DEEPSEEK_API_KEY'}</Text>
          <Text dimColor>{'or falls back to gateway.'}</Text>
        </Box>
      </Box>

      {/* Info Cards — bottom row */}
      <Box marginTop={0} gap={2}>
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={30}>
          <Text dimColor bold>{'KEYBOARD'}</Text>
          <Text><Text color="yellow">i     </Text><Text dimColor> → insert mode</Text></Text>
          <Text><Text color="yellow">Esc   </Text><Text dimColor> → normal mode</Text></Text>
          <Text><Text color="yellow">Enter </Text><Text dimColor> → send message</Text></Text>
          <Text><Text color="yellow">Ctrl+C</Text><Text dimColor> → exit</Text></Text>
        </Box>

        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={38}>
          <Text dimColor bold>{'HEADLESS (for agents/scripts)'}</Text>
          <Text><Text color="green">{'mint exec '}</Text><Text dimColor>{'"fix lint errors"'}</Text></Text>
          <Text><Text color="green">{'mint exec '}</Text><Text color="yellow">{'--apply '}</Text><Text dimColor>{'"fix bug"'}</Text></Text>
          <Text><Text color="green">{'mint exec '}</Text><Text color="yellow">{'--think '}</Text><Text dimColor>{'"redesign db"'}</Text></Text>
          <Text> </Text>
          <Text dimColor>{'JSON output to stdout.'}</Text>
          <Text dimColor>{'Pipe: echo \'{"task":"..."}\' | mint exec --pipe'}</Text>
        </Box>
      </Box>
    </Box>
  );
}
