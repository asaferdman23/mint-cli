/**
 * Chat transcript with opencode-style thick left-border messages.
 * User messages: secondary (blue) border
 * Assistant messages: primary (orange) border
 */
import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { currentTheme } from '../theme/manager.js';
import { renderMarkdown } from '../styles/markdown.js';
import { Icons } from '../styles/icons.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  cost?: number;
  durationMs?: number;
  isStreaming?: boolean;
  phases?: unknown[];
}

interface MessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  availableHeight?: number;
  livePhases?: unknown[];
  scrollOffset?: number;
}

// ─── Per-message line builders ───────────────────────────────────────────────

function buildUserLines(msg: ChatMessage, width: number): string[] {
  const t = currentTheme();
  const contentWidth = Math.max(20, width - 4);
  const border = chalk.hex(t.secondary)(Icons.thickBorder + ' ');
  const lines: string[] = [];

  // Name header
  lines.push(chalk.hex(t.secondary).bold('You'));

  // Content — treat user input as plain text (no markdown parse needed)
  const rawLines = msg.content.split('\n');
  for (const line of rawLines) {
    // Word-wrap long lines
    if (line.length <= contentWidth) {
      lines.push(border + line);
    } else {
      let remaining = line;
      while (remaining.length > 0) {
        lines.push(border + remaining.slice(0, contentWidth));
        remaining = remaining.slice(contentWidth);
      }
    }
  }

  return lines;
}

function buildAssistantLines(msg: ChatMessage, content: string, width: number): string[] {
  const t = currentTheme();
  const contentWidth = Math.max(20, width - 4);
  const border = chalk.hex(t.primary)(Icons.thickBorder + ' ');
  const lines: string[] = [];

  if (!content.trim()) return lines;

  // Name header
  lines.push(chalk.hex(t.primary).bold('Mint'));

  // Markdown-rendered content
  const rendered = renderMarkdown(content, contentWidth, t);
  for (const line of rendered) {
    lines.push(border + line);
  }

  // Footer: model + duration
  if (msg.model || msg.durationMs != null || msg.cost != null) {
    const parts: string[] = [];
    if (msg.model) parts.push(msg.model);
    if (msg.durationMs != null) parts.push(formatDuration(msg.durationMs));
    if (msg.cost != null && msg.cost > 0) parts.push('$' + msg.cost.toFixed(4));
    lines.push(chalk.hex(t.textMuted)('  ' + parts.join('  ·  ')));
  }

  return lines;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MessageList({
  messages,
  streamingContent,
  availableHeight,
  scrollOffset = 0,
}: MessageListProps): React.ReactElement {
  const t = currentTheme();
  const termWidth = process.stdout.columns ?? 80;
  const maxHeight = availableHeight ?? Math.max(4, (process.stdout.rows ?? 24) - 6);

  // Flatten all messages into display lines
  const allLines: string[] = [];

  messages.forEach((msg, idx) => {
    // Separator between messages
    if (idx > 0) {
      allLines.push('');
    }

    const content = msg.isStreaming ? streamingContent : msg.content;

    if (msg.role === 'user') {
      allLines.push(...buildUserLines(msg, termWidth));
    } else {
      allLines.push(...buildAssistantLines(msg, content, termWidth));
    }
  });

  // Viewport: pin to bottom, scroll up by scrollOffset lines
  const windowSize = Math.max(1, maxHeight);
  const total = allLines.length;
  const clamped = Math.min(Math.max(0, scrollOffset), Math.max(0, total - windowSize));
  const end = total - clamped;
  const start = Math.max(0, end - windowSize);
  const visible = allLines.slice(start, end);

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden" height={maxHeight}>
      {visible.map((line, i) => (
        <Text key={`line-${start + i}`}>{line}</Text>
      ))}
      {clamped > 0 && (
        <Text>
          {chalk.hex(t.textMuted)(`${Icons.separator.repeat(2)} ${clamped} more below — ↓ to scroll`)}
        </Text>
      )}
    </Box>
  );
}
