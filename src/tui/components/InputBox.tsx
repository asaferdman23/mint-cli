/**
 * opencode-style input editor.
 * Idle: bordered input with cursor and placeholder.
 * Busy: spinner with live activity label + detail + last result.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import { currentTheme } from '../theme/manager.js';
import { SlashAutocomplete, SLASH_COMMANDS } from './SlashAutocomplete.js';
import { FileCompletion } from './FileCompletion.js';
import type { CurrentActivity } from '../hooks/useBrainEvents.js';
import { Icons } from '../styles/icons.js';

interface InputBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
  isBusy: boolean;
  isRouting: boolean;
  currentActivity?: CurrentActivity | null;
  /** Project file paths for @-completion. */
  filePaths?: string[];
  // legacy compat
  contextChips?: unknown;
}

const FILE_COMPLETION_LIMIT = 50;

/** Find the active `@token` immediately before the cursor (no whitespace inside). */
function activeAtToken(value: string, cursor: number): { query: string; start: number } | null {
  const upto = value.slice(0, cursor);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  // Must be at start or preceded by whitespace.
  if (at > 0 && !/\s/.test(value[at - 1])) return null;
  const token = upto.slice(at + 1);
  if (/\s/.test(token)) return null;
  return { query: token, start: at };
}

const ELAPSED_THRESHOLD = 8; // seconds before we show elapsed time

export function InputBox({
  value,
  onChange,
  onSubmit,
  isBusy,
  isRouting,
  currentActivity,
  filePaths = [],
}: InputBoxProps): React.ReactElement {
  const t = currentTheme();
  const [cursor, setCursor] = useState(0);
  const [acIndex, setAcIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  // Elapsed timer while busy
  useEffect(() => {
    if (!isBusy) { setElapsed(0); return; }
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isBusy]);

  const showAc = value.startsWith('/') && !isBusy && !isRouting;
  const acMatches = showAc ? SLASH_COMMANDS.filter((c) => `/${c.name}`.startsWith(value.toLowerCase())) : [];
  const hasAc = acMatches.length > 0;

  // @-file completion: active token before cursor, filtered against project files.
  const atToken = !isBusy && !isRouting ? activeAtToken(value, cursor) : null;
  const fileMatches = atToken
    ? filePaths
        .filter((p) => p.toLowerCase().includes(atToken.query.toLowerCase()))
        .slice(0, FILE_COMPLETION_LIMIT)
    : [];
  const hasFiles = fileMatches.length > 0 && atToken !== null;

  const applyFile = (file: string): void => {
    if (!atToken) return;
    const after = value.slice(cursor);
    const next = value.slice(0, atToken.start) + '@' + file + after;
    const newCursor = atToken.start + 1 + file.length;
    onChange(next);
    setCursor(newCursor);
    setFileIndex(0);
  };

  useInput(
    (input, key) => {
      if (key.ctrl) return;

      if (key.return) {
        // File completion takes priority when active.
        if (hasFiles) {
          const sel = fileMatches[fileIndex % fileMatches.length];
          if (sel) { applyFile(sel); return; }
        }
        if (hasAc) {
          const sel = acMatches[acIndex % acMatches.length];
          if (sel) { onChange(`/${sel.name} `); setCursor(`/${sel.name} `.length); setAcIndex(0); return; }
        }
        onSubmit(value);
        setCursor(0);
        setAcIndex(0);
        return;
      }

      if (key.backspace || key.delete) {
        if (cursor === 0) return;
        const next = value.slice(0, cursor - 1) + value.slice(cursor);
        onChange(next);
        setCursor(cursor - 1);
        return;
      }

      if (key.leftArrow)  { setCursor(Math.max(0, cursor - 1)); return; }
      if (key.rightArrow) { setCursor(Math.min(value.length, cursor + 1)); return; }

      if (key.upArrow) {
        if (hasFiles) { setFileIndex((p) => Math.max(0, p - 1)); return; }
        if (hasAc) setAcIndex((p) => Math.max(0, p - 1));
        return;
      }
      if (key.downArrow) {
        if (hasFiles) { setFileIndex((p) => Math.min(fileMatches.length - 1, p + 1)); return; }
        if (hasAc) setAcIndex((p) => Math.min(acMatches.length - 1, p + 1));
        return;
      }

      if (key.tab) {
        if (hasFiles) {
          const sel = fileMatches[fileIndex % fileMatches.length];
          if (sel) applyFile(sel);
          return;
        }
        if (hasAc) {
          const sel = acMatches[acIndex % acMatches.length];
          if (sel) { onChange(`/${sel.name} `); setCursor(`/${sel.name} `.length); setAcIndex(0); }
        }
        return;
      }

      if (input && !key.meta && !key.escape && input.charCodeAt(0) >= 32) {
        const next = value.slice(0, cursor) + input + value.slice(cursor);
        onChange(next);
        setCursor(cursor + input.length);
      }
    },
    { isActive: !isBusy && !isRouting },
  );

  // Sync cursor on external clear
  React.useEffect(() => { if (value.length === 0) setCursor(0); }, [value]);
  React.useEffect(() => { setAcIndex(0); setFileIndex(0); }, [value]);

  if (isRouting || isBusy) {
    const label = currentActivity?.label ?? 'Thinking…';
    const detail = currentActivity?.detail;
    const lastResult = currentActivity?.lastResult;
    const showElapsed = elapsed >= ELAPSED_THRESHOLD;

    return (
      <Box flexDirection="column">
        <Box
          borderStyle="single"
          borderColor={t.borderFocused as Parameters<typeof Box>[0]['borderColor']}
          paddingX={1}
          flexDirection="column"
        >
          <Box flexDirection="row" gap={1}>
            <Text color={t.primary as Parameters<typeof Text>[0]['color']}><Spinner type="dots" /></Text>
            <Text bold>{label}</Text>
            {showElapsed && (
              <Text dimColor>({elapsed}s) · Ctrl+C to cancel</Text>
            )}
          </Box>
          {detail && (
            <Box paddingLeft={2}>
              <Text>
                {chalk.hex(t.textMuted)(`${Icons.arrow} ${detail}`)}
              </Text>
            </Box>
          )}
          {lastResult && (
            <Box paddingLeft={2}>
              <Text>
                {chalk.hex(lastResult.ok ? t.success : t.error)(
                  (lastResult.ok ? Icons.check : Icons.error) + ' ' + lastResult.text
                )}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  const before = value.slice(0, cursor);
  const at = value[cursor] ?? ' ';
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="column">
      {hasFiles && (
        <FileCompletion matches={fileMatches} selectedIndex={fileIndex} />
      )}
      {!hasFiles && hasAc && (
        <SlashAutocomplete input={value} commands={SLASH_COMMANDS} selectedIndex={acIndex} />
      )}
      <Box
        borderStyle="single"
        borderColor={t.borderFocused as Parameters<typeof Box>[0]['borderColor']}
        paddingX={1}
        flexDirection="row"
      >
        <Box flexGrow={1}>
          {value.length === 0 ? (
            <Text>
              {chalk.hex(t.textMuted)('Ask anything… / for commands · @ for files')}
              <Text inverse> </Text>
            </Text>
          ) : (
            <Text>
              {before}
              <Text inverse>{at}</Text>
              {after}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
