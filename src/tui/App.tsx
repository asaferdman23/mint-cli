import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Banner } from './components/Banner.js';
import { MessageList, ChatMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { RightPanel } from './components/RightPanel.js';
import { useAgentEvents } from './hooks/useAgentEvents.js';
import { streamComplete, isModelAvailable } from '../providers/index.js';
import { selectModel, selectModelWithReason, calculateCost } from '../providers/router.js';
import { getTier } from '../providers/tiers.js';
import type { ModelId, Message } from '../providers/types.js';
import { MODELS } from '../providers/types.js';
import { config } from '../utils/config.js';
import { createUsageTracker, calculateOpusCost } from '../usage/tracker.js';

interface AppProps {
  initialPrompt?: string;
  modelPreference?: string;
  agentMode?: 'yolo' | 'plan' | 'diff' | 'auto';
}

const SYSTEM_PROMPT = `You are Mint, a cost-aware AI coding assistant. Be concise and precise.
Prefer direct answers. Show code changes clearly with diffs.`;

let messageIdCounter = 0;
function nextId(): string {
  return `msg-${++messageIdCounter}`;
}

export function App({ initialPrompt, modelPreference, agentMode }: AppProps): React.ReactElement {
  const { exit } = useApp();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [currentModel, setCurrentModel] = useState<ModelId | null>(null);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [sessionCost, setSessionCost] = useState(0);
  const [streamingContent, setStreamingContent] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [routingReason, setRoutingReason] = useState<string | undefined>(undefined);
  const [savingsPct, setSavingsPct] = useState<number | undefined>(undefined);

  const { panelState, onCostUpdate } = useAgentEvents();

  const streamRef = useRef('');
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const trackerRef = useRef(createUsageTracker(Date.now().toString(36), 'chat'));

  // Abort in-flight stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Handle Ctrl+C
  useInput((_, key) => {
    if (key.ctrl && key.name === 'c') {
      abortRef.current?.abort();
      exit();
    }
    // Escape clears input
    if (key.escape && !busyRef.current) {
      setInput('');
    }
  });

  const handleSubmit = useCallback(async (userInput: string) => {
    const trimmed = userInput.trim();
    if (!trimmed || busyRef.current) return;

    // Handle slash commands
    if (trimmed === '/help') {
      const helpId = nextId();
      setMessages((prev) => [
        ...prev,
        {
          id: helpId,
          role: 'assistant',
          content: [
            'Available commands:',
            '  /help    — show this help',
            '  /clear   — clear chat history',
            '  /model   — show current model',
            '  Ctrl+C   — exit',
          ].join('\n'),
        },
      ]);
      setInput('');
      return;
    }

    if (trimmed === '/clear') {
      setMessages([]);
      setInput('');
      setSessionTokens(0);
      setSessionCost(0);
      return;
    }

    if (trimmed === '/model') {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: `Current model: ${currentModel ?? 'auto (will be selected on next message)'}`,
        },
      ]);
      setInput('');
      return;
    }

    // Check for DeepSeek API key if model would use DeepSeek
    const providers = config.get('providers') as Record<string, string> | undefined;
    const hasDeepseekKey = providers?.deepseek;

    // 1. Add user message
    const userMsgId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: trimmed },
    ]);
    setInput('');
    busyRef.current = true;
    setIsBusy(true);
    setIsRouting(true);
    setErrorMsg(null);

    // 2. Select model
    let selectedModel: ModelId;
    try {
      if (modelPreference && modelPreference !== 'auto') {
        // Map shorthand to ModelId
        const modelMap: Record<string, ModelId> = {
          deepseek: 'deepseek-v3',
          sonnet: 'claude-sonnet-4',
          opus: 'claude-opus-4',
        };
        selectedModel = (modelMap[modelPreference] ?? modelPreference) as ModelId;
      } else {
        const decision = selectModelWithReason(trimmed);
        selectedModel = decision.model;
        setRoutingReason(decision.reason);
        setSavingsPct(decision.savingsPct > 0 ? decision.savingsPct : undefined);
      }
    } catch {
      selectedModel = 'deepseek-v3';
    }

    // Fallback if router picked a model whose provider isn't registered yet
    if (!isModelAvailable(selectedModel)) {
      selectedModel = 'deepseek-v3';
    }

    // Warn if DeepSeek selected but no key configured
    if (selectedModel.startsWith('deepseek') && !hasDeepseekKey) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: `No DeepSeek API key configured. Run:\n  axon config:set providers.deepseek YOUR_KEY\n\nOr use: axon chat -m sonnet`,
        },
      ]);
      busyRef.current = false;
      setIsBusy(false);
      setIsRouting(false);
      return;
    }

    setCurrentModel(selectedModel);
    setIsRouting(false);

    // 3. Build messages array
    const historyMessages: Message[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const allMessages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historyMessages,
      { role: 'user', content: trimmed },
    ];

    // 4. Create streaming placeholder message
    const assistantMsgId = nextId();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        model: selectedModel,
        isStreaming: true,
      },
    ]);

    streamRef.current = '';
    setStreamingContent('');

    // 5. Stream
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      for await (const chunk of streamComplete({ model: selectedModel, messages: allMessages, signal: controller.signal })) {
        streamRef.current += chunk;
        setStreamingContent(streamRef.current);
      }

      const finalContent = streamRef.current;
      const inputTokens = Math.ceil(
        allMessages.reduce((sum, m) => sum + m.content.length, 0) / 4
      );
      const outputTokens = Math.ceil(finalContent.length / 4);
      const cost = calculateCost(selectedModel, inputTokens, outputTokens);

      // Update session totals
      setSessionTokens((t) => t + inputTokens + outputTokens);
      setSessionCost((c) => c + cost.total);
      onCostUpdate(cost.total, inputTokens + outputTokens);

      // Track usage for savings dashboard
      const opusCost = calculateOpusCost(inputTokens, outputTokens);
      trackerRef.current.track({
        model: selectedModel,
        provider: MODELS[selectedModel]?.provider ?? 'unknown',
        tier: getTier(selectedModel),
        inputTokens,
        outputTokens,
        cost: cost.total,
        opusCost,
        savedAmount: Math.max(0, opusCost - cost.total),
        routingReason: routingReason ?? selectedModel,
        taskPreview: trimmed,
      });

      // Finalize the streaming message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: finalContent,
                cost: cost.total,
                isStreaming: false,
              }
            : m
        )
      );
      setStreamingContent('');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Error: ${errMsg}`);
      // Remove the empty streaming placeholder
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
    } finally {
      busyRef.current = false;
      setIsBusy(false);
      setIsRouting(false);
      streamRef.current = '';
    }
  }, [messages, currentModel, modelPreference]);

  // Auto-submit initialPrompt on mount
  useEffect(() => {
    if (initialPrompt?.trim()) {
      // Small delay so the UI renders first
      const timer = setTimeout(() => {
        handleSubmit(initialPrompt);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []); // intentionally run only once on mount

  const terminalWidth = process.stdout.columns ?? 80;

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? 24}>
      <Banner />

      {errorMsg && (
        <Box paddingX={1}>
          <Text color="red">{errorMsg}</Text>
        </Box>
      )}

      {/* Main split-pane */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Left: chat */}
        <Box flexDirection="column" flexGrow={1}>
          <MessageList messages={messages} streamingContent={streamingContent} />

          <InputBox
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            isBusy={isBusy}
            isRouting={isRouting}
          />
        </Box>

        {/* Right: panel — always visible when terminal is wide enough */}
        {terminalWidth >= 80 && (
          <RightPanel
            state={panelState}
            currentModel={currentModel}
            mode={agentMode ?? 'auto'}
            width={26}
            savingsPct={savingsPct}
          />
        )}
      </Box>

      <StatusBar
        currentModel={currentModel}
        sessionTokens={sessionTokens}
        sessionCost={sessionCost}
        messageCount={messages.length}
        routingReason={routingReason}
      />
    </Box>
  );
}
