import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

interface InputBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
  isBusy: boolean;
  isRouting: boolean;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function InputBox({
  value,
  onChange,
  onSubmit,
  isBusy,
  isRouting,
}: InputBoxProps): React.ReactElement {
  const tokenEst = estimateTokens(value);

  if (isRouting) {
    return (
      <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="row" gap={1}>
        <Text color="yellow">
          <Spinner type="dots" />
        </Text>
        <Text dimColor>Routing to best model…</Text>
      </Box>
    );
  }

  if (isBusy) {
    return (
      <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="row" gap={1}>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text dimColor>Thinking…</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" gap={0} flexGrow={1}>
        <Text color="cyan">{'> '}</Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder="Ask anything…"
        />
      </Box>
      {value.length > 0 && (
        <Text dimColor>{` ~${tokenEst}t`}</Text>
      )}
    </Box>
  );
}
