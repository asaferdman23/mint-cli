// src/tui/components/MessageList.tsx
//
// Renders the chat transcript. Pipeline phase rendering was removed when the
// brain took over — live tool calls are surfaced in BrainToolInspector, and
// phase summaries flow through the normal text delta stream.
import React from 'react';
import { Box, Text } from 'ink';
import { MarkdownContent, countContentLines, renderMarkdownLineElements } from './MarkdownContent.js';
import type { PipelinePhaseData } from '../types.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  cost?: number;
  isStreaming?: boolean;
  phases?: PipelinePhaseData[];
}

interface MessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  availableHeight?: number;
  livePhases?: PipelinePhaseData[];
  scrollOffset?: number;
}

function hasVisibleAssistantBody(msg: ChatMessage): boolean {
  return msg.content.trim().length > 0;
}

function estimateMessageHeight(
  msg: ChatMessage,
  termWidth: number,
  isFirst: boolean,
): number {
  const contentWidth = Math.max(20, termWidth - 4);
  let lines = isFirst ? 0 : 1;

  if (msg.role === 'user') {
    lines += countContentLines(msg.content, contentWidth);
    return lines;
  }

  if (hasVisibleAssistantBody(msg)) {
    lines += 1; // header
    lines += countContentLines(msg.content, contentWidth);
  }

  return lines;
}

function buildAssistantRenderLines(
  msg: ChatMessage,
  termWidth: number,
  isFirst: boolean,
): React.ReactElement[] {
  const contentWidth = Math.max(20, termWidth - 4);
  const lines: React.ReactElement[] = [];

  if (!isFirst) {
    lines.push(
      <Box key={`${msg.id}-separator`} marginTop={0} marginBottom={0}>
        <Text dimColor>{'─'.repeat(Math.min(60, termWidth - 2))}</Text>
      </Box>,
    );
  }

  if (hasVisibleAssistantBody(msg)) {
    lines.push(
      <Text key={`${msg.id}-assistant-header`} color="green" bold>
        {'Mint'}
        {msg.model ? <Text dimColor> [{msg.model}]</Text> : null}
      </Text>,
    );
    lines.push(...renderMarkdownLineElements(msg.content, contentWidth, `${msg.id}-content`));
  }

  return lines;
}

function buildUserRenderLines(
  msg: ChatMessage,
  termWidth: number,
  isFirst: boolean,
): React.ReactElement[] {
  const contentWidth = Math.max(20, termWidth - 4);
  const lines: React.ReactElement[] = [];
  if (!isFirst) {
    lines.push(
      <Box key={`${msg.id}-separator`} marginBottom={0}>
        <Text dimColor>{'─'.repeat(Math.min(60, termWidth - 2))}</Text>
      </Box>,
    );
  }
  lines.push(
    <Text key={`${msg.id}-header`} color="cyan" bold>
      You
    </Text>,
  );
  lines.push(...renderMarkdownLineElements(msg.content, contentWidth, `${msg.id}-user`));
  return lines;
}

export function MessageList({
  messages,
  streamingContent,
  availableHeight,
  scrollOffset = 0,
}: MessageListProps): React.ReactElement {
  const termWidth = process.stdout.columns ?? 80;
  const maxHeight = availableHeight ?? (process.stdout.rows ?? 24) - 6;

  const allMessages = messages.map((msg) => {
    if (msg.isStreaming) {
      return { ...msg, content: streamingContent };
    }
    return msg;
  });

  // Flatten every message into line-sized React elements so scrolling is
  // line-granular, not message-granular. Without this, long assistant
  // replies are effectively unscrollable past their message boundary.
  const allLines: React.ReactElement[] = [];
  allMessages.forEach((msg, idx) => {
    const isFirst = idx === 0;
    if (msg.role === 'user') {
      allLines.push(...buildUserRenderLines(msg, termWidth, isFirst));
    } else {
      allLines.push(...buildAssistantRenderLines(msg, termWidth, isFirst));
    }
  });

  // Window: pin to the bottom, move `scrollOffset` lines up from there.
  const windowSize = Math.max(1, maxHeight);
  const totalLines = allLines.length;
  const clampedOffset = Math.min(Math.max(0, scrollOffset), Math.max(0, totalLines - windowSize));
  const end = totalLines - clampedOffset;
  const start = Math.max(0, end - windowSize);
  const visibleLines = allLines.slice(start, end);

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden" height={maxHeight}>
      {visibleLines.map((element, i) => (
        <React.Fragment key={`line-${start + i}`}>{element}</React.Fragment>
      ))}
      {clampedOffset > 0 && (
        <Box marginTop={0}>
          <Text dimColor>
            ▲ {clampedOffset} more line{clampedOffset === 1 ? '' : 's'} below — ↓ / PgDn to scroll back
          </Text>
        </Box>
      )}
    </Box>
  );
}
