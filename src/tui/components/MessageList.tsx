import React from 'react';
import { Box, Text } from 'ink';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  cost?: number;
  isStreaming?: boolean;
}

interface MessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
          {/* Separator between turns (not before first message) */}
          {idx > 0 && (
            <Text dimColor>{'─'.repeat(40)}</Text>
          )}

          {msg.role === 'user' ? (
            <Box flexDirection="column">
              <Text color="cyan" bold>You</Text>
              <Text color="cyan">{msg.content}</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color="green" bold>
                {'Axon'}
                {msg.model ? <Text dimColor> [{msg.model}]</Text> : null}
              </Text>
              <Text wrap="wrap">{msg.content}</Text>
              {msg.isStreaming && (
                <Text color="cyan">{'▋'}</Text>
              )}
              {!msg.isStreaming && msg.model && (
                <Text dimColor>
                  {`  ~${estimateTokens(msg.content)} tokens`}
                  {msg.cost !== undefined ? `  ${formatCostDisplay(msg.cost)}` : ''}
                </Text>
              )}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

function formatCostDisplay(cost: number): string {
  if (cost < 0.01) {
    return `${(cost * 100).toFixed(3)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}
