import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { initChalkLevel } from './utils/colorize.js';
import { MessageList, ChatMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { LiveTaskInspector } from './components/LiveTaskInspector.js';
import { SLASH_COMMANDS } from './components/SlashAutocomplete.js';
import { useAgentEvents } from './hooks/useAgentEvents.js';
import { getTier } from '../providers/tiers.js';
import type { ModelId } from '../providers/types.js';
import { MODELS } from '../providers/types.js';
import { config } from '../utils/config.js';
import { createUsageTracker, calculateSonnetCost } from '../usage/tracker.js';
import { runPipeline, type PipelineChunk } from '../pipeline/index.js';
import type { PipelineTaskInfo } from '../pipeline/types.js';
import type { PipelinePhaseData, ContextChip, SubtaskData } from './types.js';

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

function estimateContextChipLines(contextChips: ContextChip[] | null | undefined, terminalWidth: number): number {
  if (!contextChips || contextChips.length === 0) return 0;

  const usableWidth = Math.max(20, terminalWidth - 2);
  let rows = 1;
  let currentWidth = 0;

  for (const chip of contextChips) {
    const chipWidth = chip.label.length + 2;
    const gap = currentWidth === 0 ? 0 : 1;

    if (currentWidth + gap + chipWidth > usableWidth) {
      rows += 1;
      currentWidth = chipWidth;
    } else {
      currentWidth += gap + chipWidth;
    }
  }

  return rows;
}

function estimateInputAreaHeight(
  input: string,
  isBusy: boolean,
  isRouting: boolean,
  contextChips: ContextChip[] | null | undefined,
  terminalWidth: number,
): number {
  if (isBusy || isRouting) {
    return 3;
  }

  let lines = 3;
  lines += estimateContextChipLines(contextChips, terminalWidth);

  const showAutocomplete = input.startsWith('/') && input.length >= 1;
  if (showAutocomplete) {
    const matches = SLASH_COMMANDS.filter((cmd) => `/${cmd.name}`.startsWith(input.toLowerCase()));
    lines += Math.min(matches.length, 5);
  }

  return lines;
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
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const {
    panelState,
    pipelinePhases,
    onCostUpdate,
    onPhaseStart,
    onPhaseDone,
    onTaskEvent,
    resetPhases,
  } = useAgentEvents();

  const streamRef = useRef('');
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const trackerRef = useRef(createUsageTracker(Date.now().toString(36), 'chat'));
  const pipelinePhasesRef = useRef<PipelinePhaseData[]>([]);

  // Load context chips from .mint/context.json on mount
  useEffect(() => {
    loadContextChips().then(setContextChips).catch(() => {});
  }, []);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    pipelinePhasesRef.current = pipelinePhases;
  }, [pipelinePhases]);

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

  useInput((keypress, key) => {
    if (key.ctrl && keypress === 'c') {
      abortRef.current?.abort();
      exit();
    }
    if (key.tab && pipelinePhases.length > 0 && (isBusy || isRouting || input.length === 0)) {
      setIsInspectorOpen((open) => !open);
      if (!isInspectorOpen) {
        setSelectedTaskId(null);
      }
      return;
    }
    if (isInspectorOpen && (isBusy || isRouting || input.length === 0) && (key.leftArrow || key.rightArrow)) {
      const taskIds = getInspectorTaskIds(pipelinePhases);
      if (taskIds.length > 0) {
        const currentId = selectedTaskId ?? selectDefaultInspectorTaskId(pipelinePhases);
        const currentIndex = Math.max(0, taskIds.indexOf(currentId ?? taskIds[0]!));
        const nextIndex = key.rightArrow
          ? (currentIndex + 1) % taskIds.length
          : (currentIndex - 1 + taskIds.length) % taskIds.length;
        setSelectedTaskId(taskIds[nextIndex]!);
      }
      return;
    }
    const canScroll = messages.length > 0 && (isBusy || isRouting || scrollOffset > 0 || input.length === 0);
    const pageStep = Math.max(8, Math.floor(termSize.rows / 2));

    if (key.upArrow && canScroll) {
      setScrollOffset((n) => n + 3);
      return;
    }
    if (key.downArrow && canScroll) {
      setScrollOffset((n) => Math.max(0, n - 3));
      return;
    }
    if (key.pageUp && canScroll) {
      setScrollOffset((n) => n + pageStep);
      return;
    }
    if (key.pageDown && canScroll) {
      setScrollOffset((n) => Math.max(0, n - pageStep));
      return;
    }
  }, { isActive: messages.length > 0 });

  const handleSubmit = useCallback(async (userInput: string) => {
    const trimmed = userInput.trim();
    if (!trimmed || busyRef.current) return;

    // Handle slash commands
    if (trimmed === '/help') {
      setScrollOffset(0);
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
            '  Enter      — send message',
            '  ↑ / ↓      — scroll response',
            '  PgUp / PgDn — faster scroll',
            '  Tab        — toggle live inspector',
            '  ← / →      — switch inspector task',
            '  Ctrl+C     — exit',
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
      setScrollOffset(0);
      resetPhases();
      return;
    }

    if (trimmed === '/model') {
      setScrollOffset(0);
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
    setScrollOffset(0);
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
              onPhaseStart(chunk.phase, chunk.phaseModel, chunk.subtasks as import('./types.js').SubtaskData[] | undefined);
            }
            break;

          case 'phase-done':
            if (chunk.phase) {
              onPhaseDone(chunk.phase, {
                duration: chunk.phaseDuration,
                cost: chunk.phaseCost,
                summary: chunk.phaseSummary,
                subtasks: chunk.subtasks as import('./types.js').SubtaskData[] | undefined,
              });
            }
            break;

          case 'task-start':
          case 'task-progress':
          case 'task-done':
          case 'task-failed':
          case 'task-notification':
            if (chunk.task) {
              onTaskEvent(chunk.task as PipelineTaskInfo);
            }
            break;

          case 'task-log':
            if (chunk.task) {
              onTaskEvent(chunk.task as PipelineTaskInfo, chunk.log);
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
            setSessionTokens((t) => t + r.inputTokens + r.outputTokens);
            setSessionCost((c) => c + r.cost);
            onCostUpdate(r.cost, r.inputTokens + r.outputTokens);

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
              cost: r.cost,
              opusCost: r.opusCost,
              savedAmount: Math.max(0, r.opusCost - r.cost),
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
                      cost: r.cost,
                      model: r.model,
                      isStreaming: false,
                      phases: [...pipelinePhasesRef.current],
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
  const inspectorHeight = isInspectorOpen && pipelinePhases.length > 0
    ? Math.min(10, Math.max(6, Math.floor(termSize.rows * 0.28)))
    : 0;
  const reservedRows =
    (errorMsg ? 1 : 0)
    + inspectorHeight
    + estimateInputAreaHeight(input, isBusy, isRouting, contextChips, termSize.cols)
    + 1;
  const messageAreaHeight = Math.max(1, termSize.rows - reservedRows);
  const effectiveSelectedTaskId = selectedTaskId ?? selectDefaultInspectorTaskId(pipelinePhases);

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
          availableHeight={messageAreaHeight}
          scrollOffset={scrollOffset}
        />
      )}

      {isInspectorOpen && !showWelcome && (
        <LiveTaskInspector
          phases={pipelinePhases}
          selectedTaskId={effectiveSelectedTaskId}
          maxHeight={inspectorHeight}
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
        inspectorHint={pipelinePhases.length > 0 ? 'Tab inspector' : undefined}
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

function getInspectorTaskIds(phases: PipelinePhaseData[]): string[] {
  return flattenInspectorTasks(phases).map((task) => task.taskId ?? task.id);
}

function selectDefaultInspectorTaskId(phases: PipelinePhaseData[]): string | null {
  const tasks = flattenInspectorTasks(phases);
  return tasks[0]?.taskId ?? tasks[0]?.id ?? null;
}

function flattenInspectorTasks(phases: PipelinePhaseData[]): SubtaskData[] {
  return [...phases.flatMap((phase) => phase.subtasks ?? [])].sort((left, right) => {
    return rankInspectorTask(right) - rankInspectorTask(left);
  });
}

function rankInspectorTask(task: SubtaskData): number {
  const statusRank = (() => {
    switch (task.status) {
      case 'waiting_approval': return 5;
      case 'running': return 4;
      case 'retry': return 3;
      case 'blocked': return 2;
      case 'queued': return 1;
      default: return 0;
    }
  })();
  return statusRank * 1000 + (task.recentLogs?.length ?? 0);
}
