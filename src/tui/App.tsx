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
import { createUsageTracker, calculateSonnetCost, getMonthCost } from '../usage/tracker.js';
import { runPipeline, type PipelineChunk } from '../pipeline/index.js';
import type { PipelineTaskInfo } from '../pipeline/types.js';
import type { PipelinePhaseData, ContextChip, SubtaskData } from './types.js';

initChalkLevel();

// ── Diff approval selector (arrow keys + enter) ─────────────────────────────

const APPROVAL_OPTIONS = [
  { label: 'Apply all changes', key: 'apply' },
  { label: 'Skip — tell me what to change', key: 'skip' },
] as const;

function DiffApprovalSelect({ onSelect }: { onSelect: (key: 'apply' | 'skip') => void }): React.ReactElement {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || key.leftArrow) setSelected((s) => (s - 1 + APPROVAL_OPTIONS.length) % APPROVAL_OPTIONS.length);
    if (key.downArrow || key.rightArrow) setSelected((s) => (s + 1) % APPROVAL_OPTIONS.length);
    if (key.return) onSelect(APPROVAL_OPTIONS[selected].key);
    if (input === 'y' || input === 'Y') onSelect('apply');
    if (input === 'n' || input === 'N') onSelect('skip');
  });

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="cyan">
      {APPROVAL_OPTIONS.map((opt, i) => (
        <Box key={opt.key}>
          <Text color={i === selected ? 'cyan' : undefined} bold={i === selected}>
            {i === selected ? '❯ ' : '  '}{opt.label}
          </Text>
        </Box>
      ))}
      <Box marginTop={0}>
        <Text dimColor>  ↑↓ select · Enter confirm · y/n shortcut</Text>
      </Box>
    </Box>
  );
}

interface AppProps {
  initialPrompt?: string;
  modelPreference?: string;
  agentMode?: 'yolo' | 'plan' | 'diff' | 'auto';
  useOrchestrator?: boolean;
}

let messageIdCounter = 0;
function nextId(): string {
  return `msg-${++messageIdCounter}`;
}

function formatDiffForDisplay(diffs: import('../pipeline/types.js').ParsedDiff[]): string {
  return diffs.map((d) => {
    const isNew = d.oldContent === '';
    const added = d.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add'));
    const removed = d.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'remove'));
    const header = isNew
      ? `+++ ${d.filePath} (new file · ${added.length} lines)`
      : `--- ${d.filePath} (+${added.length} -${removed.length})`;

    const lines: string[] = [];
    for (const hunk of d.hunks) {
      for (const line of hunk.lines) {
        if (lines.length >= 20) { break; }
        if (line.type === 'add') lines.push(`+ ${line.content}`);
        else if (line.type === 'remove') lines.push(`- ${line.content}`);
      }
    }
    const totalChanged = added.length + removed.length;
    if (totalChanged > lines.length) {
      lines.push(`  ... ${totalChanged - lines.length} more lines`);
    }

    return `${header}\n${lines.join('\n')}`;
  }).join('\n\n');
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

export function App({ initialPrompt, modelPreference, agentMode, useOrchestrator = true }: AppProps): React.ReactElement {
  const { exit } = useApp();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [currentModel, setCurrentModel] = useState<ModelId | null>(null);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [sessionCost, setSessionCost] = useState(0);
  const [monthlyCost, setMonthlyCost] = useState(0);
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
  const orchestratorMessagesRef = useRef<import('../providers/types.js').Message[]>([]);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const clarificationResolveRef = useRef<((answer: string) => void) | null>(null);
  const pendingDiffsRef = useRef<{ diffs: import('../pipeline/types.js').ParsedDiff[]; resolve: (apply: boolean) => void } | null>(null);
  const assistantMsgIdRef = useRef('');
  const trackerRef = useRef(createUsageTracker(Date.now().toString(36), 'chat'));
  const pipelinePhasesRef = useRef<PipelinePhaseData[]>([]);
  const lastIdleInputHeightRef = useRef(3);

  // Load context chips + monthly cost on mount
  useEffect(() => {
    loadContextChips().then(setContextChips).catch(() => {});
    try { setMonthlyCost(getMonthCost().cost); } catch { /* ignore */ }
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
    if (!trimmed) return;

    // If pipeline is paused waiting for clarification answers, resolve it
    if (clarificationResolveRef.current) {
      const resolve = clarificationResolveRef.current;
      clarificationResolveRef.current = null;
      // Add user's answer
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: trimmed }]);
      // Create a FRESH streaming message for the resumed pipeline (below the Q&A)
      assistantMsgIdRef.current = nextId();
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgIdRef.current, role: 'assistant', content: '', isStreaming: true, phases: [] },
      ]);
      setInput('');
      setScrollOffset(0);
      resetPhases();
      streamRef.current = '';
      busyRef.current = true;
      setIsBusy(true);
      setIsRouting(true);
      resolve(trimmed);
      return;
    }

    if (busyRef.current) return;

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

    if (trimmed === '/usage') {
      setScrollOffset(0);
      const month = getMonthCost();
      const formatUsd = (n: number) => n < 0.01 ? `${(n * 100).toFixed(3)}¢` : `$${n.toFixed(4)}`;
      const savPct = month.opusCost > 0 ? Math.round((1 - month.cost / month.opusCost) * 100) : 0;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: [
            `This month:`,
            `  Workflows:  ${month.requests}`,
            `  Spent:      ${formatUsd(month.cost)}`,
            `  Opus equiv: ${formatUsd(month.opusCost)}`,
            `  Saved:      ${formatUsd(month.saved)}${savPct > 0 ? ` (-${savPct}%)` : ''}`,
            '',
            `This session:`,
            `  Spent:      ${formatUsd(sessionCost)}`,
            `  Tokens:     ${sessionTokens.toLocaleString()}`,
          ].join('\n'),
        },
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
    assistantMsgIdRef.current = nextId();
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgIdRef.current, role: 'assistant', content: '', isStreaming: true, phases: [] },
    ]);

    streamRef.current = '';
    setStreamingContent('');

    const controller = new AbortController();
    abortRef.current = controller;

    const history = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // ── V2 Orchestrator path ─────────────────────────────────────────────
    if (useOrchestrator) {
      setIsRouting(false);
      try {
        const { runOrchestrator } = await import('../orchestrator/loop.js');
        let responseText = '';
        let currentToolLine = '';
        const result = await runOrchestrator(trimmed, process.cwd(), {

          onLog: () => {
            // Internal logs — don't show to user
          },
          onText: (text) => {
            responseText += text;
            currentToolLine = '';
            streamRef.current = responseText;
            setStreamingContent(responseText);
          },
          onToolCall: (name, input) => {
            const preview = name === 'write_code'
              ? `writing code...`
              : name === 'read_file'
                ? `reading ${String(input.path ?? '')}`
                : name === 'grep_file'
                  ? `searching in ${String(input.path ?? '')}`
                  : name === 'search_files'
                    ? `searching "${String(input.query ?? '')}"`
                  : name === 'edit_file'
                    ? `editing ${String(input.path ?? '')}`
                    : name === 'write_file'
                      ? `creating ${String(input.path ?? '')}`
                      : name === 'run_command'
                        ? `running ${String(input.command ?? '').slice(0, 40)}`
                        : name;
            currentToolLine = `> ${preview}`;
            streamRef.current = responseText + (responseText ? '\n' : '') + currentToolLine;
            setStreamingContent(streamRef.current);
          },
          onApprovalNeeded: async (description) => {
            // Show the proposed change and wait for user approval
            return new Promise<boolean>((resolve) => {
              responseText += `\n${description}\n`;
              streamRef.current = responseText;
              setStreamingContent(responseText);

              // Temporarily release the input for the user to respond
              setIsBusy(false);
              busyRef.current = false;

              const handleApproval = (answer: string) => {
                busyRef.current = true;
                setIsBusy(true);
                const rejected = answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no';
                resolve(!rejected);
              };

              // Store the resolver so the input handler can call it
              clarificationResolveRef.current = handleApproval;
            });
          },
        }, controller.signal, orchestratorMessagesRef.current);

        // Persist messages for follow-up turns
        orchestratorMessagesRef.current = result.messages;

        // Show final result — response text + cost, no tool call history
        const costLine = `\nCost: $${result.totalCost.toFixed(4)} · ${(result.duration / 1000).toFixed(1)}s · ${result.iterations} steps`;
        responseText += costLine;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgIdRef.current
              ? { ...m, content: responseText, isStreaming: false }
              : m
          )
        );
        setStreamingContent('');

        // Track usage
        trackerRef.current.track({
          model: result.orchestratorModel,
          provider: 'grok',
          tier: getTier(result.orchestratorModel),
          inputTokens: 0,
          outputTokens: 0,
          cost: result.totalCost,
          opusCost: result.totalCost * 50,
          savedAmount: result.totalCost * 49,
          routingReason: 'orchestrator',
          taskPreview: trimmed,
          latencyMs: result.duration,
          costSonnet: 0,
        });
        setSessionCost((prev) => prev + result.totalCost);
        setMonthlyCost(getMonthCost());
        setCurrentModel(result.orchestratorModel);
      } catch (err) {
        const raw = err instanceof Error ? err.message : typeof err === 'object' ? JSON.stringify(err) : String(err);
        const friendly = raw.includes('401') ? 'Auth failed. Run `mint login`.'
          : raw.includes('429') ? 'Rate limited. Try again in a moment.'
          : raw.includes('500') ? 'Provider temporarily unavailable.'
          : raw.includes('timeout') ? 'Request timed out.'
          : raw.includes('fetch failed') ? 'Network error.'
          : raw.length > 150 ? raw.slice(0, 150) + '...' : raw;
        setErrorMsg(friendly);
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgIdRef.current));
      } finally {
        busyRef.current = false;
        setIsBusy(false);
        abortRef.current = null;
      }
      return;
    }

    // ── Legacy pipeline path ─────────────────────────────────────────────
    try {
      for await (const chunk of runPipeline(trimmed, {
        cwd: process.cwd(),
        model: preferredModel,
        signal: controller.signal,
        history,
        agentMode,
        onClarificationNeeded: async (questions: string[]) => {
          return new Promise<string>((resolve) => {
            // Finalize the current streaming message (phases rendered so far)
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgIdRef.current
                  ? { ...m, content: streamRef.current, isStreaming: false, phases: [...pipelinePhasesRef.current] }
                  : m
              )
            );

            // Show clarification questions as a new message
            const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
            setMessages((prev) => [...prev, {
              id: nextId(),
              role: 'assistant',
              content: `Before I keep going, I need a few quick answers:\n\n${questionsText}\n\nAnswer all of the above to proceed.`,
            }]);

            // Release the input box while we wait
            setIsRouting(false);
            busyRef.current = false;
            setIsBusy(false);
            clarificationResolveRef.current = resolve;
          });
        },
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
              streamRef.current += chunk.text;
            }
            break;

          case 'done': {
            const r = chunk.result!;
            setCurrentModel(r.model);
            setSessionTokens((t) => t + r.inputTokens + r.outputTokens);
            setSessionCost((c) => c + r.cost);
            setMonthlyCost((m) => m + r.cost);
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
                m.id === assistantMsgIdRef.current
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

            // If diffs were generated, apply or ask
            if (r.diffs && r.diffs.length > 0) {
              const autoApply = agentMode === 'auto' || agentMode === 'yolo';

              // Build a recap with diffs so user sees what changed (original output may have scrolled off)
              const phaseRecap = pipelinePhasesRef.current
                .filter((p) => p.status === 'done' && p.summary)
                .map((p) => `  ${p.name} · ${p.summary}`)
                .join('\n');

              const diffSummary = r.diffs.map((d) => {
                const isNew = d.oldContent === '';
                const added = d.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add'));
                const removed = d.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'remove'));
                const header = isNew
                  ? `+ ${d.filePath} (new · ${added.length} lines)`
                  : `~ ${d.filePath} (+${added.length} -${removed.length})`;

                // Show a compact preview: up to 8 changed lines per file
                const previewLines: string[] = [];
                for (const hunk of d.hunks) {
                  for (const line of hunk.lines) {
                    if (previewLines.length >= 8) break;
                    if (line.type === 'add') previewLines.push(`    + ${line.content}`);
                    else if (line.type === 'remove') previewLines.push(`    - ${line.content}`);
                  }
                }
                const moreCount = added.length + removed.length - previewLines.length;
                if (moreCount > 0) previewLines.push(`    ... ${moreCount} more lines`);

                return `  ${header}\n${previewLines.join('\n')}`;
              }).join('\n\n');

              const costLine = `Cost: ${r.cost < 0.01 ? (r.cost * 100).toFixed(3) + '¢' : '$' + r.cost.toFixed(4)} · ${(r.duration / 1000).toFixed(1)}s`;

              // Always show diffs and ask for approval — agents work freely, user approves at the end
              if (false) {
                const { applyDiffsToProject } = await import('../pipeline/diff-apply.js');
                const results = applyDiffsToProject(r.diffs, process.cwd());
                const resultLines = results.map((res) => {
                  if (res.ok) return res.action === 'created' ? `  + ${res.file}` : `  ~ ${res.file}`;
                  return `  ! ${res.file}: ${res.error}`;
                }).join('\n');
                const diffDisplay = formatDiffForDisplay(r.diffs);
                setMessages((prev) => [...prev, {
                  id: nextId(),
                  role: 'assistant',
                  content: [
                    phaseRecap ? `Pipeline:\n${phaseRecap}` : null,
                    `Applied ${results.filter((res) => res.ok).length}/${results.length} files:\n${resultLines}`,
                    `\`\`\`diff\n${diffDisplay}\n\`\`\``,
                    costLine,
                  ].filter(Boolean).join('\n\n'),
                }]);
              } else {
                setMessages((prev) => [...prev, {
                  id: nextId(),
                  role: 'assistant',
                  content: [
                    phaseRecap ? `Pipeline:\n${phaseRecap}` : null,
                    `Changes:\n\n${diffSummary}`,
                    costLine,
                  ].filter(Boolean).join('\n\n'),
                }]);
                busyRef.current = false;
                setIsBusy(false);
                pendingDiffsRef.current = {
                  diffs: r.diffs,
                  resolve: () => {},
                };
              }
            }
            break;
          }

          case 'error':
            throw new Error(chunk.error);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Error: ${errMsg}`);
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsgIdRef.current));
    } finally {
      clarificationResolveRef.current = null;
      // Don't clear pendingDiffsRef here — it persists after pipeline completes
      if (!pendingDiffsRef.current) {
        busyRef.current = false;
        setIsBusy(false);
      }
      setIsRouting(false);
      streamRef.current = '';
    }
  }, [messages, currentModel, modelPreference, agentMode, pipelinePhases]);

  // Auto-submit initialPrompt on mount
  useEffect(() => {
    if (initialPrompt?.trim()) {
      const timer = setTimeout(() => handleSubmit(initialPrompt), 100);
      return () => clearTimeout(timer);
    }
  }, []);

  const showApproval = pendingDiffsRef.current != null && !isBusy;

  const handleDiffApproval = useCallback(async (choice: 'apply' | 'skip') => {
    if (!pendingDiffsRef.current) return;
    const { diffs } = pendingDiffsRef.current;
    pendingDiffsRef.current = null;

    if (choice === 'apply') {
      const { applyDiffsToProject } = await import('../pipeline/diff-apply.js');
      const results = applyDiffsToProject(diffs, process.cwd());
      const resultLines = results.map((res) => {
        if (res.ok) return res.action === 'created' ? `  + ${res.file}` : `  ~ ${res.file}`;
        return `  ! ${res.file}: ${res.error}`;
      }).join('\n');
      const diffDisplay = formatDiffForDisplay(diffs);
      setMessages((prev) => [...prev, {
        id: nextId(),
        role: 'assistant',
        content: `Applied ${results.filter((res) => res.ok).length}/${results.length} files:\n${resultLines}\n\n\`\`\`diff\n${diffDisplay}\n\`\`\``,
      }]);
    } else {
      setMessages((prev) => [...prev, {
        id: nextId(),
        role: 'assistant',
        content: 'Got it — changes skipped, your files are untouched. Tell me what to change and I\'ll rebuild it.',
      }]);
    }
  }, []);

  const showWelcome = messages.length === 0 && !isBusy && !isRouting;
  const inspectorHeight = isInspectorOpen && pipelinePhases.length > 0
    ? Math.min(10, Math.max(6, Math.floor(termSize.rows * 0.28)))
    : 0;
  const estimatedInputHeight = estimateInputAreaHeight(input, isBusy, isRouting, contextChips, termSize.cols);
  if (!isBusy && !isRouting) {
    lastIdleInputHeightRef.current = estimatedInputHeight;
  }
  const inputAreaHeight = (isBusy || isRouting)
    ? Math.max(estimatedInputHeight, lastIdleInputHeightRef.current)
    : estimatedInputHeight;
  const reservedRows =
    (errorMsg ? 1 : 0)
    + inspectorHeight
    + inputAreaHeight
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

      <Box height={inputAreaHeight} overflow="hidden" flexDirection="column">
        {showApproval ? (
          <DiffApprovalSelect onSelect={handleDiffApproval} />
        ) : (
          <InputBox
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            isBusy={isBusy}
            isRouting={isRouting}
            contextChips={contextChips}
          />
        )}
      </Box>

      <Box height={1} overflow="hidden">
        <StatusBar
          currentModel={currentModel}
          sessionTokens={sessionTokens}
          sessionCost={sessionCost}
          monthlyCost={monthlyCost}
          savingsPct={savingsPct}
          agentMode={agentMode ?? 'auto'}
          inspectorHint={pipelinePhases.length > 0 ? 'Tab inspector' : undefined}
        />
      </Box>
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
