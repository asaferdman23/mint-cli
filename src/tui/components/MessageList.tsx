// src/tui/components/MessageList.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PipelinePhase } from './PipelinePhase.js';
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
}

/**
 * Estimate how many terminal rows a message will occupy.
 * Rough heuristic: 1 line per ~(termWidth - 4) chars + header + separator + phases.
 */
function estimateMessageHeight(msg: ChatMessage, termWidth: number, livePhases?: PipelinePhaseData[]): number {
  const contentWidth = Math.max(40, termWidth - 4);
  let lines = 0;

  // Separator line (for all except first)
  lines += 1;

  // Role header ("You" or "Mint [model]")
  lines += 1;

  // Content lines
  if (msg.content) {
    const contentLines = msg.content.split('\n');
    for (const line of contentLines) {
      lines += Math.max(1, Math.ceil((line.length || 1) / contentWidth));
    }
  }

  // Phase lines
  const phases = msg.isStreaming ? livePhases : msg.phases;
  if (phases && phases.length > 0) {
    for (const phase of phases) {
      lines += 1; // phase header
      if (phase.summary) lines += 1;
      if (phase.status === 'active' && phase.streamingContent) {
        const streamLines = phase.streamingContent.split('\n').length;
        lines += Math.min(streamLines, 5);
      }
    }
  }

  // Bottom margin
  lines += 1;

  return lines;
}

export function MessageList({
  messages,
  streamingContent,
  availableHeight,
  livePhases,
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
      const msgHeight = estimateMessageHeight(allMessages[i], termWidth, livePhases);
      if (totalLines + msgHeight > maxHeight && i < allMessages.length - 1) {
        break;
      }
      totalLines += msgHeight;
      startIdx = i;
    }

    visibleMessages = allMessages.slice(startIdx);
  }

  const truncated = visibleMessages.length < allMessages.length;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      {allMessages.length === 0 && (
        <Box paddingTop={1}>
          <Text dimColor>Type a message to start chatting. /help for commands. Ctrl+C to exit.</Text>
        </Box>
      )}

      {truncated && (
        <Text dimColor>{'  ↑ '}{allMessages.length - visibleMessages.length} earlier messages</Text>
      )}

      {visibleMessages.map((msg, idx) => {
        const isFirst = idx === 0 && !truncated;

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
                <Text color="cyan" bold>You</Text>
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
                    <Text wrap="wrap">{msg.content}</Text>
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
