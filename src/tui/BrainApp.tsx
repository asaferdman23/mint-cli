/**
 * Brain-powered TUI — renders a Mint session driven by runBrain().
 *
 * Intentionally minimal: reuses MessageList, InputBox, StatusBar, and
 * LiveTaskInspector from the legacy app so the user-facing UI is stable.
 * The legacy App.tsx remains as the default path; this component is only
 * mounted when MINT_BRAIN=1 is set.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { initChalkLevel } from './utils/colorize.js';
import { MessageList, type ChatMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { BrainToolInspector } from './components/BrainToolInspector.js';
import { useBrainEvents } from './hooks/useBrainEvents.js';
import { runBrain, type AgentEvent, type Mode } from '../brain/index.js';
import type { ModelId } from '../providers/types.js';

initChalkLevel();

interface BrainAppProps {
  initialPrompt?: string;
  agentMode?: Mode;
  modelPreference?: string;
}

let messageIdCounter = 0;
const nextId = (): string => `brain-${++messageIdCounter}`;

export function BrainApp({ initialPrompt, agentMode: initialMode, modelPreference }: BrainAppProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode ?? 'diff');
  const [currentModel, setCurrentModel] = useState<ModelId | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [quotaUsed, setQuotaUsed] = useState<number | undefined>(undefined);
  const [quotaLimit, setQuotaLimit] = useState<number | undefined>(undefined);

  const abortRef = useRef<AbortController | null>(null);
  const assistantMsgIdRef = useRef<string>('');

  const {
    panelState,
    pipelinePhases,
    recentToolCalls,
    streamingText,
    pendingApproval,
    resolveApproval,
    apply,
    reset,
  } = useBrainEvents();

  // Terminal size tracking
  const [termSize, setTermSize] = useState({
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  });
  useEffect(() => {
    const onResize = () => {
      process.stdout.write('\x1B[2J\x1B[H');
      setTermSize({
        cols: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
      });
    };
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Fetch quota on mount and after each task
  const fetchQuota = useCallback(async () => {
    try {
      const { config } = await import('../utils/config.js');
      if (!config.isAuthenticated()) return;

      const gatewayUrl = config.getGatewayUrl();
      const apiToken = config.get('gatewayToken');

      const response = await fetch(`${gatewayUrl}/auth/quota`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json() as { requests_used: number; requests_limit: number; plan_type?: string };
        setQuotaUsed(data.requests_used);
        setQuotaLimit(data.requests_limit);

        // Show warning if free tier and >= 80% used
        if (data.plan_type === 'free' && data.requests_limit > 0) {
          const usagePercent = (data.requests_used / data.requests_limit) * 100;
          if (usagePercent >= 80 && usagePercent < 100) {
            const remaining = data.requests_limit - data.requests_used;
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content: `⚠️  You've used ${data.requests_used} of your ${data.requests_limit} free requests (${remaining} remaining).\n\nTo continue after your quota:\n  • Upgrade to Pro for unlimited requests\n  • Add your own API keys with: mint config:set providers.deepseek <key>`,
              },
            ]);
          } else if (usagePercent >= 100) {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content: `🚫 You've used all ${data.requests_limit} free requests.\n\nTo continue:\n  • Upgrade to Pro at https://usemint.dev/upgrade\n  • Add your own API keys: mint config:set providers.deepseek <key>`,
              },
            ]);
          }
        }
      }
    } catch {
      // Silently fail - quota is optional
    }
  }, []);

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  useInput(
    (keypress, key) => {
      if (key.ctrl && keypress === 'c') {
        abortRef.current?.abort();
        exit();
        return;
      }
      if (key.tab && (recentToolCalls.length > 0 || pipelinePhases.length > 0) && (isBusy || input.length === 0)) {
        setIsInspectorOpen((v) => !v);
        return;
      }

      // Scroll the transcript when there's something to scroll through.
      // Only capture arrow keys when the input is empty or a run is in
      // progress, so ordinary cursor movement inside the input still works.
      const canScroll = messages.length > 0 && (isBusy || input.length === 0 || scrollOffset > 0);
      if (!canScroll) return;

      const pageStep = Math.max(8, Math.floor(termSize.rows / 2));

      if (key.upArrow) {
        setScrollOffset((n) => n + 3);
        return;
      }
      if (key.downArrow) {
        setScrollOffset((n) => Math.max(0, n - 3));
        return;
      }
      if (key.pageUp) {
        setScrollOffset((n) => n + pageStep);
        return;
      }
      if (key.pageDown) {
        setScrollOffset((n) => Math.max(0, n - pageStep));
        return;
      }
    },
    { isActive: messages.length > 0 },
  );

  const handleSubmit = useCallback(
    async (userInput: string) => {
      const trimmed = userInput.trim();
      if (!trimmed) return;

      // Approval gate — if a resolve is pending, treat Enter as "yes", `no` as reject
      if (pendingApproval) {
        const approve = trimmed.toLowerCase() !== 'n' && trimmed.toLowerCase() !== 'no';
        resolveApproval(approve);
        setInput('');
        return;
      }

      if (isBusy) return;

      // Slash commands
      if (trimmed === '/help') {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: [
              'Brain commands:',
              '  /help    — this help',
              '  /clear   — clear chat',
              '  /auto    — auto mode (no approvals)',
              '  /diff    — diff mode (per-file approval)',
              '  /plan    — plan mode (no writes)',
              '  /yolo    — yolo mode (full autonomy)',
              '  Ctrl+C   — exit',
            ].join('\n'),
          },
        ]);
        setInput('');
        return;
      }
      if (trimmed === '/clear') {
        setMessages([]);
        reset();
        setInput('');
        return;
      }
      if (trimmed === '/auto' || trimmed === '/diff' || trimmed === '/plan' || trimmed === '/yolo') {
        const newMode = trimmed.slice(1) as Mode;
        setMode(newMode);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: `Mode: ${newMode}` },
        ]);
        setInput('');
        return;
      }

      // User turn — reset scroll so the new message is visible at the bottom.
      setScrollOffset(0);
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: trimmed }]);
      assistantMsgIdRef.current = nextId();
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgIdRef.current, role: 'assistant', content: '', isStreaming: true, phases: [] },
      ]);
      setInput('');
      setIsBusy(true);
      setErrorMsg(null);
      reset();

      const controller = new AbortController();
      abortRef.current = controller;

      const overrideModel =
        modelPreference && modelPreference !== 'auto'
          ? (modelPreference as ModelId)
          : undefined;

      try {
        for await (const event of runBrain({
          task: trimmed,
          cwd: process.cwd(),
          mode,
          signal: controller.signal,
          model: overrideModel,
        })) {
          apply(event);

          if (event.type === 'classify') {
            setCurrentModel(event.model);
          }
          if (event.type === 'error') {
            setErrorMsg(event.error);
          }
          if (event.type === 'done') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgIdRef.current
                  ? {
                      ...m,
                      content: event.result.output || '(no output)',
                      isStreaming: false,
                      cost: event.result.totalCostUsd,
                      model: event.result.model,
                    }
                  : m,
              ),
            );
            // Track real Opus comparison from actual token counts — replaces
            // the legacy App.tsx's hardcoded `result.totalCost * 50` multiplier.
            try {
              const { trackBrainRun } = await import('../usage/tracker.js');
              trackBrainRun({
                sessionId: Date.now().toString(36),
                task: trimmed,
                model: event.result.model,
                inputTokens: event.result.inputTokens,
                outputTokens: event.result.outputTokens,
                cost: event.result.totalCostUsd,
                durationMs: event.result.durationMs,
              });
            } catch {
              /* best-effort */
            }

            // Refresh quota after task completion
            fetchQuota();
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgIdRef.current));
      } finally {
        setIsBusy(false);
        abortRef.current = null;
      }
    },
    [isBusy, mode, modelPreference, pendingApproval, resolveApproval, apply, reset],
  );

  // Auto-submit an initial prompt
  useEffect(() => {
    if (initialPrompt?.trim()) {
      const timer = setTimeout(() => handleSubmit(initialPrompt), 100);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showWelcome = messages.length === 0 && !isBusy;
  const inspectorHeight = isInspectorOpen && recentToolCalls.length > 0
    ? Math.min(12, Math.max(6, Math.floor(termSize.rows * 0.32)))
    : 0;
  const approvalNotice = pendingApproval
    ? `Approval needed (${pendingApproval.reason}). Enter = yes, 'n' = no.`
    : null;
  const inputAreaHeight = approvalNotice ? 4 : 3;
  const reservedRows = (errorMsg ? 1 : 0) + inspectorHeight + inputAreaHeight + 1;
  const messageAreaHeight = Math.max(1, termSize.rows - reservedRows);

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
          streamingContent={streamingText}
          livePhases={pipelinePhases}
          availableHeight={messageAreaHeight}
          scrollOffset={scrollOffset}
        />
      )}

      {isInspectorOpen && !showWelcome && (
        <BrainToolInspector calls={recentToolCalls} maxHeight={inspectorHeight} />
      )}

      <Box height={inputAreaHeight} overflow="hidden" flexDirection="column">
        {approvalNotice && (
          <Box paddingX={1}>
            <Text color="yellow">{approvalNotice}</Text>
          </Box>
        )}
        <InputBox
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isBusy={isBusy}
          isRouting={false}
        />
      </Box>

      <Box height={1} overflow="hidden">
        <StatusBar
          currentModel={currentModel}
          sessionTokens={panelState.totalTokens}
          sessionCost={panelState.totalCost}
          monthlyCost={0}
          agentMode={mode}
          inspectorHint={recentToolCalls.length > 0 ? 'Tab tools' : undefined}
          quotaUsed={quotaUsed}
          quotaLimit={quotaLimit}
        />
      </Box>
    </Box>
  );
}

/** Helper for callers that want to inspect events instead of rendering. */
export type { AgentEvent };
