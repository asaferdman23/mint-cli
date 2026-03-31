import React from 'react';
import { Box, Text } from 'ink';

export function Banner(): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan">{'⚡ mint  ·  smart routing · 18 models · /help'}</Text>
    </Box>
  );
}
