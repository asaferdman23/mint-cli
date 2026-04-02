/**
 * Simple markdown renderer for terminal (Ink).
 * Strips code fences, styles code blocks, handles bold/inline-code.
 */
import React from 'react';
import { Box, Text } from 'ink';

interface MarkdownContentProps {
  content: string;
  /** If set, only render lines [lineOffset, lineOffset+maxLines) */
  lineOffset?: number;
  maxLines?: number;
  maxWidth?: number;
}

interface ContentBlock {
  type: 'text' | 'code';
  lang?: string;
  lines: string[];
}

interface RenderableLine {
  key: string;
  kind: 'text' | 'code' | 'code-header' | 'code-footer' | 'diff';
  text: string;
  bold?: boolean;
  color?: string;
  dimColor?: boolean;
}

function parseBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const rawLines = content.split('\n');
  let inCode = false;
  let codeLang = '';
  let current: ContentBlock = { type: 'text', lines: [] };

  for (const line of rawLines) {
    const fenceMatch = line.match(/^```(\w*)$/);
    if (fenceMatch && !inCode) {
      // Start code block — flush current text block
      if (current.lines.length > 0) blocks.push(current);
      codeLang = fenceMatch[1] ?? '';
      current = { type: 'code', lang: codeLang, lines: [] };
      inCode = true;
    } else if (line.match(/^```$/) && inCode) {
      // End code block
      blocks.push(current);
      current = { type: 'text', lines: [] };
      inCode = false;
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) blocks.push(current);
  return blocks;
}

function normalizeTextLine(line: string): { text: string; bold?: boolean; color?: 'cyan' } {
  // Strip inline code backticks → just show the content
  const stripped = line.replace(/`([^`]*)`/g, '$1');
  // Strip **bold** markers — Ink can't bold inline, just show text
  const plain = stripped.replace(/\*\*([^*]*)\*\*/g, '$1');

  // Detect headers
  const headerMatch = plain.match(/^(#{1,3})\s+(.*)/);
  if (headerMatch) {
    return { text: headerMatch[2], bold: true, color: 'cyan' };
  }

  return { text: plain };
}

export function wrapContentLine(line: string, maxWidth: number): string[] {
  const width = Math.max(1, maxWidth);

  if (line.length === 0) return [''];

  const wrapped: string[] = [];
  let remaining = line;

  while (remaining.length > width) {
    const breakAt = remaining.lastIndexOf(' ', width);
    const splitAt = breakAt > 0 ? breakAt : width;
    wrapped.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
    if (breakAt > 0) {
      remaining = remaining.replace(/^ /, '');
    }
  }

  wrapped.push(remaining);
  return wrapped;
}

export function countWrappedLines(content: string, maxWidth: number): number {
  if (content.length === 0) return 0;

  return content
    .split('\n')
    .reduce((total, line) => total + wrapContentLine(line, maxWidth).length, 0);
}

function buildRenderableLines(content: string, maxWidth: number): RenderableLine[] {
  if (content.length === 0) return [];

  const blocks = parseBlocks(content);
  const lineEls: RenderableLine[] = [];
  const textWidth = Math.max(1, maxWidth);
  const codeWidth = Math.max(1, maxWidth - 4);

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (block.type === 'code') {
      if (block.lang === 'diff') {
        for (let li = 0; li < block.lines.length; li++) {
          const line = block.lines[li] ?? '';
          const wrapped = wrapContentLine(line, textWidth);
          const diffStyle = getDiffLineStyle(line);
          for (let wi = 0; wi < wrapped.length; wi++) {
            lineEls.push({
              key: `b${bi}-l${li}-w${wi}`,
              kind: 'diff',
              text: wrapped[wi],
              bold: wi === 0 ? diffStyle.bold : false,
              color: diffStyle.color,
              dimColor: diffStyle.dimColor,
            });
          }
        }
        continue;
      }

      lineEls.push({
        key: `b${bi}-header`,
        kind: 'code-header',
        text: block.lang ? `  ╭─ ${block.lang} ` : '  ╭─',
      });

      for (let li = 0; li < block.lines.length; li++) {
        const wrapped = wrapContentLine(block.lines[li], codeWidth);
        for (let wi = 0; wi < wrapped.length; wi++) {
          lineEls.push({
            key: `b${bi}-l${li}-w${wi}`,
            kind: 'code',
            text: wrapped[wi],
            color: 'yellow',
          });
        }
      }

      lineEls.push({
        key: `b${bi}-footer`,
        kind: 'code-footer',
        text: '  ╰─',
      });
      continue;
    }

    for (let li = 0; li < block.lines.length; li++) {
      const normalized = normalizeTextLine(block.lines[li]);
      const wrapped = wrapContentLine(normalized.text, textWidth);
      for (let wi = 0; wi < wrapped.length; wi++) {
        lineEls.push({
          key: `b${bi}-l${li}-w${wi}`,
          kind: 'text',
          text: wrapped[wi],
          bold: normalized.bold,
          color: normalized.color,
        });
      }
    }
  }

  return lineEls;
}

export function renderMarkdownLineElements(
  content: string,
  maxWidth: number,
  keyPrefix = 'markdown',
): React.ReactElement[] {
  return buildRenderableLines(content, maxWidth).map((line, index) => {
    const key = `${keyPrefix}-${index}-${line.key}`;
    switch (line.kind) {
      case 'text':
        return (
          <Text key={key} bold={line.bold} color={line.color as Parameters<typeof Text>[0]['color']}>
            {line.text || ' '}
          </Text>
        );

      case 'code':
        return (
          <Box key={key}>
            <Text dimColor>  │ </Text>
            <Text color={line.color as Parameters<typeof Text>[0]['color']}>{line.text || ' '}</Text>
          </Box>
        );

      case 'code-header':
      case 'code-footer':
        return (
          <Text key={key} dimColor>
            {line.text}
          </Text>
        );

      case 'diff':
        return (
          <Text
            key={key}
            bold={line.bold}
            dimColor={line.dimColor}
            color={line.color as Parameters<typeof Text>[0]['color']}
          >
            {line.text || ' '}
          </Text>
        );
    }
  });
}

export function MarkdownContent({ content, lineOffset = 0, maxLines, maxWidth }: MarkdownContentProps): React.ReactElement {
  const renderWidth = Math.max(20, maxWidth ?? (process.stdout.columns ?? 80) - 4);
  const lineEls = renderMarkdownLineElements(content, renderWidth);

  // Apply slice
  const sliced = lineEls.slice(lineOffset, maxLines !== undefined ? lineOffset + maxLines : undefined);

  return (
    <Box flexDirection="column">
      {sliced}
    </Box>
  );
}

/** Count total renderable lines in content (for scroll calculations) */
export function countContentLines(content: string, maxWidth?: number): number {
  const renderWidth = Math.max(20, maxWidth ?? (process.stdout.columns ?? 80) - 4);
  return buildRenderableLines(content, renderWidth).length;
}

function getDiffLineStyle(line: string): {
  color?: string;
  dimColor?: boolean;
  bold?: boolean;
} {
  if (line.startsWith('+++ ') || line.startsWith('--- ')) {
    return { color: 'cyan', bold: true };
  }

  if (line.startsWith('@@')) {
    return { color: 'cyan' };
  }

  if (line.startsWith('+')) {
    return { color: 'green' };
  }

  if (line.startsWith('-')) {
    return { color: 'red' };
  }

  if (line.startsWith('diff --git') || line.startsWith('index ')) {
    return { dimColor: true };
  }

  return { dimColor: true };
}
