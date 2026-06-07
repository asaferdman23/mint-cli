/**
 * opencode-style centered list dialog (modal overlay).
 * Used by the model picker, theme switcher, and session switcher.
 *
 * Renders a bordered box with a title, a scrollable list (max ~10 visible),
 * and arrow-key navigation. The parent owns the selected index and key input.
 */
import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { currentTheme } from '../theme/manager.js';
import { Icons } from '../styles/icons.js';

export interface ListDialogItem {
  /** Primary label (left). */
  label: string;
  /** Optional dim hint (right). */
  hint?: string;
  /** Marker shown when this is the currently-active item (e.g. active model). */
  active?: boolean;
}

interface ListDialogProps {
  title: string;
  items: ListDialogItem[];
  selectedIndex: number;
  /** Max visible rows before scrolling. Default 10. */
  maxVisible?: number;
  /** Footer hint line. */
  footer?: string;
}

export function ListDialog({
  title,
  items,
  selectedIndex,
  maxVisible = 10,
  footer = '↑/↓ navigate · Enter select · Esc cancel',
}: ListDialogProps): React.ReactElement {
  const t = currentTheme();

  // Window the list around the selection so it stays visible.
  const total = items.length;
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, selectedIndex - half);
  const end = Math.min(total, start + maxVisible);
  start = Math.max(0, end - maxVisible);
  const visible = items.slice(start, end);

  // Width: longest label + hint, clamped.
  const longest = items.reduce((m, it) => Math.max(m, it.label.length + (it.hint?.length ?? 0) + 6), title.length);
  const innerWidth = Math.min(Math.max(longest, 32), (process.stdout.columns ?? 80) - 8);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={t.borderFocused as Parameters<typeof Box>[0]['borderColor']}
      paddingX={2}
      paddingY={1}
      margin={2}
      width={innerWidth + 6}
    >
      <Text>{chalk.hex(t.primary).bold(`${Icons.logo} ${title}`)}</Text>
      <Text>{chalk.hex(t.borderNormal)(Icons.separator.repeat(innerWidth))}</Text>

      {start > 0 && (
        <Text>{chalk.hex(t.textMuted)(`  ${Icons.separator.repeat(2)} ${start} above`)}</Text>
      )}

      {visible.map((item, i) => {
        const realIdx = start + i;
        const selected = realIdx === selectedIndex;
        const pointer = selected ? chalk.hex(t.primary)(Icons.pointer + ' ') : '  ';
        const labelColor = selected ? t.text : t.textMuted;
        const label = selected
          ? chalk.hex(labelColor).bold(item.label)
          : chalk.hex(labelColor)(item.label);
        const activeMark = item.active ? chalk.hex(t.success)(`  ${Icons.check} active`) : '';
        const hint = item.hint ? chalk.hex(t.borderNormal)(`  ${item.hint}`) : '';
        return (
          <Text key={realIdx}>{pointer}{label}{hint}{activeMark}</Text>
        );
      })}

      {end < total && (
        <Text>{chalk.hex(t.textMuted)(`  ${Icons.separator.repeat(2)} ${total - end} below`)}</Text>
      )}

      <Text>{chalk.hex(t.borderNormal)(Icons.separator.repeat(innerWidth))}</Text>
      <Text>{chalk.hex(t.textMuted)(footer)}</Text>
    </Box>
  );
}
