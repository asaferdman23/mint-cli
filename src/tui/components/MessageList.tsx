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
}

export function MessageList({ messages, streamingContent }: MessageListProps): React.ReactElement {
  const allMessages = messages.map((msg) => {
    if (msg.isStreaming) {
      return { ...msg, content: streamingContent };
    }
    return msg;
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {allMessages.length === 0 && (
        <Box paddingTop={1}>
          <Text dimColor>Type a message to start chatting. /help for commands. Ctrl+C to exit.</Text>
        </Box>
      )}
      {allMessages.map((msg, idx) => (
        <Box key={msg.id} flexDirection="column" marginBottom={1}>
          {/* Separator between turns */}
          {idx > 0 && (
            <Text dimColor>{'─'.repeat(Math.min(60, process.stdout.columns ?? 60))}</Text>
          )}

          {msg.role === 'user' ? (
            <Box flexDirection="column">
              <Text color="cyan" bold>You</Text>
              <Text color="cyan">{msg.content}</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {/* Pipeline phases (if any) */}
              {msg.phases && msg.phases.length > 0 && (
                <Box flexDirection="column" marginBottom={1}>
                  {msg.phases.map((phase) => (
                    <PipelinePhase key={phase.name} phase={phase} />
                  ))}
                </Box>
              )}

              {/* Assistant response */}
              {(msg.content || msg.isStreaming) && (
                <Box flexDirection="column">
                  <Text color="green" bold>
                    {'Mint'}
                    {msg.model ? <Text dimColor> [{msg.model}]</Text> : null}
                  </Text>
                  <Text wrap="wrap">{msg.content}</Text>
                  {msg.isStreaming && !msg.phases && (
                    <Text color="cyan">▋</Text>
                  )}
                </Box>
              )}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
