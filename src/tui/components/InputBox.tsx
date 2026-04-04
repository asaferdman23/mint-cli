// src/tui/components/InputBox.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
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

export function InputBox({
  value,
  onChange,
  onSubmit,
  isBusy,
  isRouting,
  contextChips,
}: InputBoxProps): React.ReactElement {
  const tokenEst = estimateTokens(value);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  const showAutocomplete = value.startsWith('/') && value.length >= 1 && !isBusy && !isRouting;
  const autocompleteMatches = showAutocomplete
    ? SLASH_COMMANDS.filter((cmd) => `/${cmd.name}`.startsWith(value.toLowerCase()))
    : [];
  const hasAutocomplete = autocompleteMatches.length > 0 && showAutocomplete;

  useInput(
    (input, key) => {
      if (key.ctrl) return; // handled by App (Ctrl+C)

      if (key.return) {
        if (hasAutocomplete) {
          const selected = autocompleteMatches[autocompleteIndex % autocompleteMatches.length];
          if (selected) {
            onChange(`/${selected.name} `);
            setCursorOffset(`/${selected.name} `.length);
            setAutocompleteIndex(0);
            return;
          }
        }
        onSubmit(value);
        setCursorOffset(0);
        setAutocompleteIndex(0);
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorOffset === 0) return;
        const newText = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
        onChange(newText);
        setCursorOffset(cursorOffset - 1);
        return;
      }

      if (key.leftArrow) {
        setCursorOffset(Math.max(0, cursorOffset - 1));
        return;
      }
      if (key.rightArrow) {
        setCursorOffset(Math.min(value.length, cursorOffset + 1));
        return;
      }

      if (key.upArrow) {
        if (hasAutocomplete) setAutocompleteIndex((p) => Math.max(0, p - 1));
        return;
      }
      if (key.downArrow) {
        if (hasAutocomplete) setAutocompleteIndex((p) => Math.min(autocompleteMatches.length - 1, p + 1));
        return;
      }

      if (key.tab) {
        if (hasAutocomplete) {
          const selected = autocompleteMatches[autocompleteIndex % autocompleteMatches.length];
          if (selected) {
            onChange(`/${selected.name} `);
            setCursorOffset(`/${selected.name} `.length);
            setAutocompleteIndex(0);
          }
        }
        return;
      }

      // Printable character
      if (input && !key.meta && !key.escape && input.charCodeAt(0) >= 32) {
        const newText = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
        onChange(newText);
        setCursorOffset(cursorOffset + input.length);
      }
    },
    { isActive: !isBusy && !isRouting },
  );

  // Sync cursor when value is cleared externally (after submit)
  React.useEffect(() => {
    if (value.length === 0) setCursorOffset(0);
  }, [value]);

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

  // Render text with cursor block
  const before = value.slice(0, cursorOffset);
  const at = value[cursorOffset] ?? ' ';
  const after = value.slice(cursorOffset + 1);

  return (
    <Box flexDirection="column">
      {contextChips && contextChips.length > 0 && (
        <ContextChips chips={contextChips} />
      )}

      {hasAutocomplete && (
        <SlashAutocomplete
          input={value}
          commands={SLASH_COMMANDS}
          selectedIndex={autocompleteIndex}
        />
      )}

      <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="row">
        <Box flexGrow={1}>
          {value.length === 0 ? (
            <Text dimColor>Ask anything… or try "add a pricing section"<Text inverse> </Text></Text>
          ) : (
            <Text>
              {before}
              <Text inverse>{at}</Text>
              {after}
            </Text>
          )}
        </Box>
        {value.length > 0 && (
          <Text dimColor>{` ~${tokenEst}t`}</Text>
        )}
      </Box>
    </Box>
  );
}
