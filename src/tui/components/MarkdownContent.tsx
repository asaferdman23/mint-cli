/**
 * Markdown renderer — delegates to styles/markdown for opencode-style rendering.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { currentTheme } from '../theme/manager.js';
import { renderMarkdown, countMarkdownLines } from '../styles/markdown.js';

interface MarkdownContentProps {
  content: string;
  lineOffset?: number;
  maxLines?: number;
  maxWidth?: number;
}

export function MarkdownContent({ content, lineOffset = 0, maxLines, maxWidth }: MarkdownContentProps): React.ReactElement {
  const t = currentTheme();
  const width = Math.max(20, maxWidth ?? (process.stdout.columns ?? 80) - 4);
  const lines = renderMarkdown(content, width, t);
  const sliced = maxLines != null ? lines.slice(lineOffset, lineOffset + maxLines) : lines.slice(lineOffset);

  return (
    <Box flexDirection="column">
      {sliced.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}

export function countContentLines(content: string, maxWidth?: number): number {
  const t = currentTheme();
  const width = Math.max(20, maxWidth ?? (process.stdout.columns ?? 80) - 4);
  return countMarkdownLines(content, width, t);
}

export function renderMarkdownLineElements(
  content: string,
  maxWidth: number,
  keyPrefix = 'md',
): React.ReactElement[] {
  const t = currentTheme();
  return renderMarkdown(content, maxWidth, t).map((line, i) => (
    <Text key={`${keyPrefix}-${i}`}>{line}</Text>
  ));
}

// Legacy exports kept for any remaining callers
export function wrapContentLine(line: string, maxWidth: number): string[] {
  if (line.length === 0) return [''];
  const width = Math.max(1, maxWidth);
  const out: string[] = [];
  let rem = line;
  while (rem.length > width) {
    const bp = rem.lastIndexOf(' ', width);
    const at = bp > 0 ? bp : width;
    out.push(rem.slice(0, at));
    rem = rem.slice(at).replace(/^ /, '');
  }
  out.push(rem);
  return out;
}

export function countWrappedLines(content: string, maxWidth: number): number {
  return content.split('\n').reduce((t, l) => t + wrapContentLine(l, maxWidth).length, 0);
}
