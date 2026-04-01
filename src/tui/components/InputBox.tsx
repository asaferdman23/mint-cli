import React from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useVimInput } from '../hooks/useVimInput.js';

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

/**
 * Render the text with a block cursor at `offset` (NORMAL mode).
 * The cursor character is shown in inverse video.
 */
function TextWithCursor({ text, offset }: { text: string; offset: number }): React.ReactElement {
  const before = text.slice(0, offset);
  const at = text[offset] ?? ' ';
  const after = text.slice(offset + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}

export function InputBox({
  value,
  onChange,
  onSubmit,
  isBusy,
  isRouting,
}: InputBoxProps): React.ReactElement {
  const tokenEst = estimateTokens(value);

  const vim = useVimInput({ value, onChange, onSubmit });

  // Hook into Ink's input system — useVimInput handles all editing logic
  useInput(
    (input, key) => vim.handleKey(input, key),
    { isActive: !isBusy && !isRouting },
  );

  if (isRouting) {
    return (
      <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="row" gap={1}>
        <Text color="yellow"><Spinner type="dots" /></Text>
        <Text dimColor>Routing to best model…</Text>
      </Box>
    );
  }

  if (isBusy) {
    return (
      <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="row" gap={1}>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text dimColor>Thinking…</Text>
      </Box>
    );
  }

  const isNormal = vim.mode === 'NORMAL';
  const borderColor = isNormal ? 'yellow' : 'cyan';
  const promptColor = isNormal ? 'yellow' : 'cyan';

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      {/* Mode indicator pill */}
      <Text color={promptColor} bold>{isNormal ? '[N] ' : '[I] '}</Text>

      <Box flexDirection="row" flexGrow={1}>
        {isNormal ? (
          // NORMAL mode: render text with block cursor, no ink-text-input
          value.length === 0
            ? <Text dimColor>— NORMAL —</Text>
            : <TextWithCursor text={value} offset={vim.cursorOffset} />
        ) : (
          // INSERT mode: show text with a trailing cursor indicator
          <>
            <Text>{value}</Text>
            <Text inverse> </Text>
            {value.length === 0 && <Text dimColor>Ask anything…</Text>}
          </>
        )}
      </Box>

      {value.length > 0 && (
        <Text dimColor>{` ~${tokenEst}t`}</Text>
      )}
    </Box>
  );
}
