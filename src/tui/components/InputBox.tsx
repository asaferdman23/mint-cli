// src/tui/components/InputBox.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { SlashAutocomplete, SLASH_COMMANDS } from './SlashAutocomplete.js';
import type { ContextChip } from '../types.js';
import { ContextChips } from './ContextChips.js';
import type { CurrentActivity } from '../hooks/useBrainEvents.js';

/** Threshold after which we start showing elapsed seconds in the spinner label.
 *  Under this, users don't need reassurance; over this, they're wondering if it's hung. */
const THINKING_ELAPSED_THRESHOLD_SEC = 8;

interface InputBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
  isBusy: boolean;
  isRouting: boolean;
  contextChips?: ContextChip[] | null;
  currentActivity?: CurrentActivity | null;
  inspectorHint?: string;
  /** Recall an older history entry. Returns the value, or null for no-op. */
  onHistoryPrev?: (currentValue: string) => string | null;
  /** Recall a newer history entry. Returns the value (possibly '') or null. */
  onHistoryNext?: () => string | null;
  /** Signal that the user typed/edited — leave history-recall mode. */
  onHistoryExit?: () => void;
  /** When true, suspend the input's keyboard handler so an overlay (e.g. the
   *  approval dialog) can claim y/n/a/Enter/Esc without conflict. */
  isPaused?: boolean;
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
  currentActivity,
  inspectorHint,
  onHistoryPrev,
  onHistoryNext,
  onHistoryExit,
  isPaused = false,
}: InputBoxProps): React.ReactElement {
  const tokenEst = estimateTokens(value);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  // When busy, tick a once-per-second counter so long "Thinking…" spins show
  // elapsed time. Prevents the "is this hung?" feeling during slow generations.
  useEffect(() => {
    if (!isBusy) {
      setElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isBusy]);

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
        onHistoryExit?.();
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
        if (hasAutocomplete) {
          setAutocompleteIndex((p) => Math.max(0, p - 1));
          return;
        }
        // History recall — only when the input is empty so cursor-up inside
        // a partially-typed prompt is preserved for future multiline edit.
        if (value.length === 0 && onHistoryPrev) {
          const recalled = onHistoryPrev(value);
          if (recalled !== null) {
            onChange(recalled);
            setCursorOffset(recalled.length);
          }
        }
        return;
      }
      if (key.downArrow) {
        if (hasAutocomplete) {
          setAutocompleteIndex((p) => Math.min(autocompleteMatches.length - 1, p + 1));
          return;
        }
        if (onHistoryNext) {
          const recalled = onHistoryNext();
          if (recalled !== null) {
            onChange(recalled);
            setCursorOffset(recalled.length);
          }
        }
        return;
      }

      if (key.tab) {
        // Only consume Tab when we have something to autocomplete.
        // Otherwise let it bubble to BrainApp (tool inspector toggle).
        if (hasAutocomplete) {
          const selected = autocompleteMatches[autocompleteIndex % autocompleteMatches.length];
          if (selected) {
            onChange(`/${selected.name} `);
            setCursorOffset(`/${selected.name} `.length);
            setAutocompleteIndex(0);
          }
          return;
        }
        // No autocomplete active → don't return, let the outer handler see it.
        // We can't actually let it "bubble" in Ink useInput, so instead we just
        // no-op here and rely on BrainApp's own useInput(isActive: messages.length>0)
        // to have already fired on the same keystroke.
        return;
      }

      // Printable character
      if (input && !key.meta && !key.escape && input.charCodeAt(0) >= 32) {
        const newText = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
        onChange(newText);
        setCursorOffset(cursorOffset + input.length);
        onHistoryExit?.();
      }
    },
    { isActive: !isRouting && !isPaused },
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
        <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="row" gap={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text dimColor>Routing to best model…</Text>
        </Box>
      </Box>
    );
  }

  // Render text with cursor block
  const before = value.slice(0, cursorOffset);
  const at = value[cursorOffset] ?? ' ';
  const after = value.slice(cursorOffset + 1);
  const showElapsed = elapsedSec >= THINKING_ELAPSED_THRESHOLD_SEC;
  const activityLabel = currentActivity?.label ?? 'Thinking…';
  const placeholder = isBusy
    ? 'Type to queue your next prompt…'
    : 'Ask anything… or try "add a pricing section"';

  return (
    <Box flexDirection="column">
      {isBusy && (
        <Box paddingX={1} flexDirection="row" gap={1}>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text bold>{activityLabel}</Text>
          {inspectorHint && <Text dimColor>({inspectorHint})</Text>}
          {showElapsed && <Text dimColor>({elapsedSec}s) · Esc to stop · Ctrl+C to exit</Text>}
        </Box>
      )}

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

      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="row">
        <Box flexGrow={1}>
          {value.length === 0 ? (
            <Text dimColor>{placeholder}<Text inverse> </Text></Text>
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
