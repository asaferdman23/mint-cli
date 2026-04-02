// src/tui/components/MessageList.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PipelinePhase, countPhaseRenderLines, renderPipelinePhaseLines } from './PipelinePhase.js';
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
  /** Available height in terminal rows for the message area. */
  availableHeight?: number;
  /** Live pipeline phases for the currently streaming message. */
  livePhases?: PipelinePhaseData[];
  /** Line scroll offset (lines scrolled up from bottom). */
  scrollOffset?: number;
}

function estimateMessageHeight(
  msg: ChatMessage,
  termWidth: number,
  isFirst: boolean,
  livePhases?: PipelinePhaseData[],
): number {
  const contentWidth = Math.max(20, termWidth - 4);
  const phases = msg.isStreaming ? livePhases : msg.phases;
  let lines = isFirst ? 0 : 1;

  if (msg.role === 'user') {
    lines += countContentLines(msg.content, contentWidth);
    return lines;
  }

  lines += countPhaseRenderLines(phases, contentWidth);
  if (msg.content || msg.isStreaming) {
    lines += 1;
    lines += countContentLines(msg.content, contentWidth);
    if (msg.isStreaming) {
      lines += 1;
    }
  }

  return lines;
}

function buildAssistantRenderLines(
  msg: ChatMessage,
  termWidth: number,
  isFirst: boolean,
  livePhases?: PipelinePhaseData[],
): React.ReactElement[] {
  const contentWidth = Math.max(20, termWidth - 4);
  const phases = msg.isStreaming ? livePhases : msg.phases;
  const lines: React.ReactElement[] = [];

  if (!isFirst) {
    lines.push(
      <Box key={`${msg.id}-separator`} marginTop={0} marginBottom={0}>
        <Text dimColor>{'─'.repeat(Math.min(60, termWidth - 2))}</Text>
      </Box>,
    );
  }

  if (phases && phases.length > 0) {
    lines.push(
      ...phases.flatMap((phase, phaseIndex) =>
        renderPipelinePhaseLines(phase, contentWidth, `${msg.id}-phase-${phaseIndex}`),
      ),
    );
  }

  if (msg.content || msg.isStreaming) {
    lines.push(
      <Text key={`${msg.id}-assistant-header`} color="green" bold>
        {'Mint'}
        {msg.model ? <Text dimColor> [{msg.model}]</Text> : null}
      </Text>,
    );
    lines.push(...renderMarkdownLineElements(msg.content, contentWidth, `${msg.id}-content`));
    if (msg.isStreaming) {
      lines.push(
        <Text key={`${msg.id}-assistant-cursor`} color="cyan">▋</Text>,
      );
    }
  }

  return lines;
}

export function MessageList({
  messages,
  streamingContent,
  availableHeight,
  livePhases,
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

  // Window: show as many recent messages as fit in available height
  let visibleMessages = allMessages;
  if (maxHeight > 0 && allMessages.length > 0) {
    let totalLines = 0;
    let startIdx = allMessages.length;

    for (let i = allMessages.length - 1; i >= 0; i--) {
      const isFirst = i === 0;
      const msgHeight = estimateMessageHeight(allMessages[i], termWidth, isFirst, livePhases);
      if (totalLines + msgHeight > maxHeight && i < allMessages.length - 1) {
        break;
      }
      totalLines += msgHeight;
      startIdx = i;
    }

    visibleMessages = allMessages.slice(startIdx);
  }

  const truncated = visibleMessages.length < allMessages.length;
  const contentWidth = Math.max(20, termWidth - 4);
  const baseNoticeLines = truncated ? 1 : 0;
  const lastVisibleIndex = visibleMessages.length - 1;
  const lastVisibleMessage = lastVisibleIndex >= 0 ? visibleMessages[lastVisibleIndex] : undefined;

  let effectiveScrollOffset = 0;
  let lastMessageLineOffset = 0;
  let lastMessageMaxLines: number | undefined;

  if (
    maxHeight > 0 &&
    lastVisibleMessage &&
    lastVisibleMessage.role === 'assistant'
  ) {
    const linesBeforeLastMessage = visibleMessages.slice(0, -1).reduce((total, msg, idx) => {
      const isFirst = idx === 0 && !truncated;
      return total + estimateMessageHeight(msg, termWidth, isFirst, livePhases);
    }, 0);
    const lastIsFirst = lastVisibleIndex === 0 && !truncated;
    const totalMessageLines = estimateMessageHeight(lastVisibleMessage, termWidth, lastIsFirst, livePhases);

    const computeViewport = (showScrollNotice: boolean) => {
      const noticeLines = baseNoticeLines + (showScrollNotice ? 1 : 0);
      const availableContentLines = Math.max(1, maxHeight - noticeLines - linesBeforeLastMessage);
      const maxScrollableLines = Math.max(0, totalMessageLines - availableContentLines);
      const clampedScrollOffset = Math.max(0, Math.min(scrollOffset, maxScrollableLines));

      return {
        availableContentLines,
        clampedScrollOffset,
      };
    };

    let viewport = computeViewport(scrollOffset > 0);
    if ((scrollOffset > 0) !== (viewport.clampedScrollOffset > 0)) {
      viewport = computeViewport(viewport.clampedScrollOffset > 0);
    }

    effectiveScrollOffset = viewport.clampedScrollOffset;
    lastMessageLineOffset = Math.max(0, totalMessageLines - viewport.availableContentLines - effectiveScrollOffset);
    lastMessageMaxLines = viewport.availableContentLines;
  }

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="flex-end" paddingX={1} overflow="hidden">
      {allMessages.length === 0 && (
        <Box paddingTop={1}>
          <Text dimColor>Type a message to start chatting. /help for commands. Ctrl+C to exit.</Text>
        </Box>
      )}

      {truncated && (
        <Text dimColor>{'  ↑ '}{allMessages.length - visibleMessages.length} earlier messages</Text>
      )}
      {effectiveScrollOffset > 0 && (
        <Text dimColor>{'  ↑ '}scrolled {effectiveScrollOffset} lines · ↓ to scroll down</Text>
      )}

      {visibleMessages.map((msg, idx) => {
        const isFirst = idx === 0 && !truncated;
        const isLast = idx === visibleMessages.length - 1;

        if (msg.role === 'assistant' && isLast) {
          const assistantLines = buildAssistantRenderLines(msg, termWidth, isFirst, livePhases);
          const visibleLines = assistantLines.slice(
            lastMessageLineOffset,
            lastMessageMaxLines !== undefined ? lastMessageLineOffset + lastMessageMaxLines : undefined,
          );

          return (
            <Box key={msg.id} flexDirection="column" marginBottom={0}>
              {visibleLines}
            </Box>
          );
        }

        return (
          <Box key={msg.id} flexDirection="column" marginBottom={0}>
            {/* Separator between turns (not before very first message) */}
            {!isFirst && (
              <Box marginTop={0} marginBottom={0}>
                <Text dimColor>{'─'.repeat(Math.min(60, termWidth - 2))}</Text>
              </Box>
            )}

            {msg.role === 'user' ? (
              <Box flexDirection="column">
                <Text color="cyan">{msg.content}</Text>
              </Box>
            ) : (
              <Box flexDirection="column">
                {/* Pipeline phases — use live phases for streaming message */}
                {(() => {
                  const phases = msg.isStreaming ? livePhases : msg.phases;
                  if (phases && phases.length > 0) {
                    return (
                      <Box flexDirection="column" marginBottom={0}>
                        {phases.map((phase) => (
                          <PipelinePhase key={phase.name} phase={phase} />
                        ))}
                      </Box>
                    );
                  }
                  return null;
                })()}

                {/* Assistant response text */}
                {(msg.content || msg.isStreaming) && (
                  <Box flexDirection="column">
                    <Text color="green" bold>
                      {'Mint'}
                      {msg.model ? <Text dimColor> [{msg.model}]</Text> : null}
                    </Text>
                    {(() => {
                      const content = msg.content;
                      const isLast = idx === visibleMessages.length - 1;
                      return (
                        <MarkdownContent
                          content={content}
                          lineOffset={isLast ? lastMessageLineOffset : 0}
                          maxLines={isLast ? lastMessageMaxLines : undefined}
                          maxWidth={contentWidth}
                        />
                      );
                    })()}
                    {msg.isStreaming && (
                      <Text color="cyan">▋</Text>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
