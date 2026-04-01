import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { initChalkLevel } from './utils/colorize.js';
import { MessageList, ChatMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { useAgentEvents } from './hooks/useAgentEvents.js';
import { calculateCost } from '../providers/router.js';
import { getTier } from '../providers/tiers.js';
import type { ModelId } from '../providers/types.js';
import { MODELS } from '../providers/types.js';
import { config } from '../utils/config.js';
import { createUsageTracker, calculateOpusCost, calculateSonnetCost } from '../usage/tracker.js';
import { runPipeline, type PipelineChunk } from '../pipeline/index.js';
import type { PipelinePhaseData, ContextChip } from './types.js';

initChalkLevel();

interface AppProps {
  initialPrompt?: string;
  modelPreference?: string;
  agentMode?: 'yolo' | 'plan' | 'diff' | 'auto';
}

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
  const [savingsPct, setSavingsPct] = useState<number | undefined>(undefined);
  const [contextChips, setContextChips] = useState<ContextChip[] | null>(null);

  const { panelState, pipelinePhases, onCostUpdate, onPhaseStart, onPhaseDone, resetPhases } = useAgentEvents();

  const streamRef = useRef('');
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const trackerRef = useRef(createUsageTracker(Date.now().toString(36), 'chat'));

  // Load context chips from .mint/context.json on mount
  useEffect(() => {
    loadContextChips().then(setContextChips).catch(() => {});
  }, []);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Handle terminal resize — clear screen to prevent ghost artifacts
  const [termSize, setTermSize] = useState({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 });
  useEffect(() => {
    const onResize = () => {
      // Clear the entire screen and move cursor to top-left
      process.stdout.write('\x1B[2J\x1B[H');
      setTermSize({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 });
    };
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      abortRef.current?.abort();
      exit();
    }
  });

  const handleSubmit = useCallback(async (userInput: string) => {
    const trimmed = userInput.trim();
    if (!trimmed || busyRef.current) return;

    // Handle slash commands
    if (trimmed === '/help') {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: [
            'Commands:',
            '  /help    — this help',
            '  /clear   — clear chat',
            '  /model   — current model',
            '  /models  — list all models',
            '  /agent   — agent mode',
            '  /usage   — session stats',
            '',
            'Keyboard:',
            '  Esc      — normal mode',
            '  i        — insert mode',
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
      setSavingsPct(undefined);
      resetPhases();
      return;
    }

    if (trimmed === '/model') {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content: `Current model: ${currentModel ?? 'auto'}` },
      ]);
      setInput('');
      return;
    }

    // Add user message
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
    resetPhases();

    // Resolve model
    const modelMap: Record<string, ModelId> = {
      deepseek: 'deepseek-v3', sonnet: 'claude-sonnet-4', opus: 'claude-opus-4',
    };
    const preferredModel = (modelPreference && modelPreference !== 'auto')
      ? (modelMap[modelPreference] ?? modelPreference) as ModelId
      : undefined;

    // Create streaming placeholder with phase tracking
    const assistantMsgId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true, phases: [] },
    ]);

    streamRef.current = '';
    setStreamingContent('');

    const controller = new AbortController();
    abortRef.current = controller;

    const history = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    try {
      for await (const chunk of runPipeline(trimmed, {
        cwd: process.cwd(),
        model: preferredModel,
        signal: controller.signal,
        history,
      })) {
        switch (chunk.type) {
          case 'search':
            setIsRouting(false);
            if (chunk.filesFound && chunk.filesFound.length > 0) {
              onPhaseStart('SCOUT');
              onPhaseDone('SCOUT', {
                summary: `${chunk.filesFound.length} files found`,
              });
            }
            break;

          case 'context':
            if (chunk.contextTokens) {
              onPhaseStart('ARCHITECT');
              onPhaseDone('ARCHITECT', {
                summary: `${chunk.contextTokens.toLocaleString()} context tokens`,
              });
            }
            break;

          case 'phase-start':
            if (chunk.phase) {
              onPhaseStart(chunk.phase, chunk.phaseModel);
            }
            break;

          case 'phase-done':
            if (chunk.phase) {
              onPhaseDone(chunk.phase, {
                duration: chunk.phaseDuration,
                cost: chunk.phaseCost,
                summary: chunk.phaseSummary,
              });
            }
            break;

          case 'text':
            if (chunk.text) {
              // First text chunk means model is generating — start BUILDER phase
              if (streamRef.current === '') {
                onPhaseStart('BUILDER');
              }
              streamRef.current += chunk.text;
              setStreamingContent(streamRef.current);
            }
            break;

          case 'done': {
            const r = chunk.result!;
            setCurrentModel(r.model);

            const cost = calculateCost(r.model, r.inputTokens, r.outputTokens);
            setSessionTokens((t) => t + r.inputTokens + r.outputTokens);
            setSessionCost((c) => c + cost.total);
            onCostUpdate(cost.total, r.inputTokens + r.outputTokens);

            const savPct = r.opusCost > 0
              ? Math.round((1 - r.cost / r.opusCost) * 100)
              : 0;
            if (savPct > 0) setSavingsPct(savPct);

            // Complete any remaining active phases
            onPhaseDone('BUILDER', {
              duration: r.duration,
              cost: r.cost,
              summary: `${r.model} · ${r.filesSearched.length} files`,
            });

            trackerRef.current.track({
              model: r.model,
              provider: MODELS[r.model]?.provider ?? 'unknown',
              tier: getTier(r.model),
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens,
              cost: cost.total,
              opusCost: r.opusCost,
              savedAmount: Math.max(0, r.opusCost - cost.total),
              routingReason: `pipeline → ${r.model}`,
              taskPreview: trimmed,
              latencyMs: r.duration,
              costSonnet: calculateSonnetCost(r.inputTokens, r.outputTokens),
            });

            // Finalize message with phases
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: streamRef.current,
                      cost: cost.total,
                      model: r.model,
                      isStreaming: false,
                      phases: [...pipelinePhases],
                    }
                  : m
              )
            );
            setStreamingContent('');
            break;
          }

          case 'error':
            throw new Error(chunk.error);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Error: ${errMsg}`);
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
    } finally {
      busyRef.current = false;
      setIsBusy(false);
      setIsRouting(false);
      streamRef.current = '';
    }
  }, [messages, currentModel, modelPreference, pipelinePhases]);

  // Auto-submit initialPrompt on mount
  useEffect(() => {
    if (initialPrompt?.trim()) {
      const timer = setTimeout(() => handleSubmit(initialPrompt), 100);
      return () => clearTimeout(timer);
    }
  }, []);

  const showWelcome = messages.length === 0 && !isBusy && !isRouting;

  return (
    <Box flexDirection="column" height={termSize.rows}>
      {errorMsg && (
        <Box paddingX={1}>
          <Text color="red">{errorMsg}</Text>
        </Box>
      )}

      {showWelcome ? (
        <WelcomeScreen />
      ) : (
        <MessageList
          messages={messages}
          streamingContent={streamingContent}
          livePhases={pipelinePhases}
          availableHeight={termSize.rows - 6}
        />
      )}

      <InputBox
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isBusy={isBusy}
        isRouting={isRouting}
        contextChips={contextChips}
      />

      <StatusBar
        currentModel={currentModel}
        sessionTokens={sessionTokens}
        sessionCost={sessionCost}
        savingsPct={savingsPct}
        agentMode={agentMode ?? 'auto'}
      />
    </Box>
  );
}

/** Load context chips from .mint/context.json if it exists. */
async function loadContextChips(): Promise<ContextChip[] | null> {
  try {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const indexPath = join(process.cwd(), '.mint', 'context.json');
    const raw = readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(raw);

    const chips: ContextChip[] = [];
    if (index.language) chips.push({ label: index.language, color: 'green' });
    if (index.totalFiles) chips.push({ label: `${index.totalFiles} files`, color: 'blue' });
    if (index.framework) chips.push({ label: index.framework, color: 'yellow' });
    chips.push({ label: 'indexed', color: 'cyan' });

    return chips.length > 0 ? chips : null;
  } catch {
    return null;
  }
}
