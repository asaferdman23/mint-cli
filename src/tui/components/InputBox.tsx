// src/tui/components/InputBox.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useVimInput } from '../hooks/useVimInput.js';
import { SlashAutocomplete, SLASH_COMMANDS } from './SlashAutocomplete.js';
import type { ContextChip } from '../types.js';
import { ContextChips } from './ContextChips.js';

interface InputBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
  isBusy: boolean;
  isRouting: boolean;
  contextChips?: ContextChip[] | null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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
  contextChips,
}: InputBoxProps): React.ReactElement {
  const tokenEst = estimateTokens(value);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  const showAutocomplete = value.startsWith('/') && value.length >= 1 && !isBusy && !isRouting;
  const autocompleteMatches = showAutocomplete
    ? SLASH_COMMANDS.filter((cmd) => `/${cmd.name}`.startsWith(value.toLowerCase()))
    : [];
  const hasAutocomplete = autocompleteMatches.length > 0 && showAutocomplete;

  const vim = useVimInput({
    value,
    onChange,
    startInNormal: true,
    onSubmit: (val: string) => {
      // If autocomplete is showing and user presses Enter, select the command
      if (hasAutocomplete) {
        const selected = autocompleteMatches[autocompleteIndex % autocompleteMatches.length];
        if (selected) {
          onChange(`/${selected.name} `);
          setAutocompleteIndex(0);
          return;
        }
      }
      onSubmit(val);
      setAutocompleteIndex(0);
    },
  });

  useInput(
    (input, key) => {
      // Intercept arrow keys for autocomplete navigation
      if (hasAutocomplete && vim.mode === 'INSERT') {
        if (key.upArrow) {
          setAutocompleteIndex((prev) => Math.max(0, prev - 1));
          return;
        }
        if (key.downArrow) {
          setAutocompleteIndex((prev) => Math.min(autocompleteMatches.length - 1, prev + 1));
          return;
        }
        if (key.tab) {
          const selected = autocompleteMatches[autocompleteIndex % autocompleteMatches.length];
          if (selected) {
            onChange(`/${selected.name} `);
            setAutocompleteIndex(0);
          }
          return;
        }
      }
      vim.handleKey(input, key);
    },
    { isActive: !isBusy && !isRouting },
  );

  // Reset autocomplete index when input changes
  React.useEffect(() => {
    setAutocompleteIndex(0);
  }, [value]);

  if (isRouting) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="row" gap={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text dimColor>Routing to best model…</Text>
        </Box>
      </Box>
    );
  }

  if (isBusy) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="row" gap={1}>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text dimColor>Thinking…</Text>
        </Box>
      </Box>
    );
  }

  const isNormal = vim.mode === 'NORMAL';
  const borderColor = isNormal ? 'yellow' : 'cyan';
  const promptColor = isNormal ? 'yellow' : 'cyan';

  // Multi-line: count lines and cap display height
  const lines = value.split('\n');
  const displayLines = Math.min(lines.length, 6);
  const heightVal = Math.max(1, displayLines);

  return (
    <Box flexDirection="column">
      {/* Context chips */}
      {contextChips && contextChips.length > 0 && (
        <ContextChips chips={contextChips} />
      )}

      {/* Autocomplete dropdown */}
      {hasAutocomplete && (
        <SlashAutocomplete
          input={value}
          commands={SLASH_COMMANDS}
          selectedIndex={autocompleteIndex}
        />
      )}

      {/* Input box */}
      <Box
        borderStyle="single"
        borderColor={borderColor}
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
        height={heightVal + 2}
      >
        {/* Mode indicator */}
        <Text color={promptColor} bold>{isNormal ? '[N] ' : '[I] '}</Text>

        <Box flexDirection="column" flexGrow={1}>
          {isNormal ? (
            value.length === 0
              ? <Text dimColor>— NORMAL —</Text>
              : <TextWithCursor text={value} offset={vim.cursorOffset} />
          ) : (
            <>
              <Text>{value}</Text>
              {value.length === 0 && <Text dimColor>Ask anything… or try "fix the auth bug"</Text>}
              {value.length > 0 && <Text inverse> </Text>}
            </>
          )}
        </Box>

        {value.length > 0 && (
          <Text dimColor>{` ~${tokenEst}t`}</Text>
        )}
      </Box>
    </Box>
  );
}
