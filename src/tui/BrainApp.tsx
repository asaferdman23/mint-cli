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

/** One-line summary of an AgentEvent for the in-TUI /trace view. */
function formatEventLine(event: AgentEvent): string {
  const t = new Date(event.ts).toISOString().slice(11, 19);
  switch (event.type) {
    case 'session.start':
      return `${t}  ● session ${event.sessionId.slice(0, 12)}  mode=${event.mode}`;
    case 'classify':
      return `${t}  ◆ classify ${event.kind}/${event.complexity}  model=${event.model}`;
    case 'context.retrieved':
      return `${t}  ▤ context ${event.files.length} files (${event.tokensUsed}/${event.tokenBudget} tokens)`;
    case 'phase':
      return `${t}  § phase ${event.name}${event.stepId ? ` step ${event.stepId}` : ''} ${event.status}${event.durationMs ? ` ${event.durationMs}ms` : ''}`;
    case 'plan.draft':
      return `${t}  ◇ plan ${event.steps.length} steps`;
    case 'tool.call':
      return `${t}  → tool ${event.name}  iter=${event.iteration}`;
    case 'tool.result':
      return `${t}  ← result ${event.ok ? 'ok' : 'err'} ${event.durationMs}ms`;
    case 'diff.proposed':
      return `${t}  ~ diff ${event.file} (${event.hunks.length} hunks)`;
    case 'diff.applied':
      return `${t}  + applied ${event.file} +${event.additions} -${event.deletions}`;
    case 'cost.delta':
      return `${t}  $ ${event.usd.toFixed(5)} (${event.inputTokens}+${event.outputTokens} tok)`;
    case 'compact':
      return `${t}  ⇢ compact ${event.beforeTokens} → ${event.afterTokens}`;
    case 'approval.needed':
      return `${t}  ? approval ${event.reason}`;
    case 'warn':
      return `${t}  ⚠ ${event.message}`;
    case 'error':
      return `${t}  ✗ ${event.error}`;
    case 'done':
      return `${t}  ✓ done  cost=$${event.result.totalCostUsd.toFixed(4)}  ${event.result.iterations} iter  ${event.result.toolCalls} tools`;
    default:
      return `${t}  · ${(event as { type: string }).type}`;
  }
}

export function BrainApp({ initialPrompt, agentMode: initialMode, modelPreference: initialModelPref }: BrainAppProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode ?? 'diff');
  const [modelPreference, setModelPreference] = useState<string | undefined>(initialModelPref);
  const [currentModel, setCurrentModel] = useState<ModelId | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [quotaUsed, setQuotaUsed] = useState<number | undefined>(undefined);
  const [quotaLimit, setQuotaLimit] = useState<number | undefined>(undefined);

  const abortRef = useRef<AbortController | null>(null);
  const assistantMsgIdRef = useRef<string>('');
  // Track which quota thresholds we've warned about so we don't spam the chat
  // with the same message after every task.
  const quotaWarningShownRef = useRef<'none' | 'approaching' | 'exceeded'>('none');

  const {
    panelState,
    pipelinePhases,
    recentToolCalls,
    streamingText,
    pendingApproval,
    lastDiff,
    recentEvents,
    resolveApproval,
    apply,
    reset,
  } = useBrainEvents();

  // Whether the cost-budget warning has been shown for this session. Reset
  // on /clear via `reset()` below — we mirror it in a ref so a session can
  // only fire the warning once.
  const budgetWarnedRef = useRef(false);

  // Terminal size tracking. We let Ink re-layout on size change rather than
  // hard-clearing the screen — clearing wipes the user's scrollback mid-session.
  const [termSize, setTermSize] = useState({
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  });
  useEffect(() => {
    const onResize = () => {
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

  // Fetch quota on mount and after each task.
  // Deduplicates warnings: each threshold (approaching 80%, exceeded 100%) is
  // shown at most once per session — we use a ref so React state updates don't
  // cause re-fires.
  //
  // Offline UX: we cache the last successful response in ~/.mint-quota-cache.json
  // so the status bar keeps showing *something* when the gateway is unreachable.
  const fetchQuota = useCallback(async () => {
    const { config } = await import('../utils/config.js');
    if (!config.isAuthenticated()) return;

    const gatewayUrl = config.getGatewayUrl();
    const apiToken = config.get('gatewayToken');

    // Seed from cache on mount so the UI has something to show before the
    // fetch resolves (and so offline users see stale-but-useful numbers).
    try {
      const { readFileSync, existsSync } = await import('node:fs');
      const { join: joinPath } = await import('node:path');
      const { homedir } = await import('node:os');
      const cachePath = joinPath(homedir(), '.mint-quota-cache.json');
      if (existsSync(cachePath) && quotaUsed == null) {
        const cached = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
          requests_used?: number;
          requests_limit?: number;
        };
        if (cached.requests_used != null) setQuotaUsed(cached.requests_used);
        if (cached.requests_limit != null) setQuotaLimit(cached.requests_limit);
      }
    } catch {
      // Cache miss / parse error — continue with live fetch.
    }

    try {
      const response = await fetch(`${gatewayUrl}/auth/quota`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return;

      const data = await response.json() as {
        requests_used: number;
        requests_limit: number;
        plan_type?: string;
      };
      setQuotaUsed(data.requests_used);
      setQuotaLimit(data.requests_limit);

      // Persist cache for next cold start.
      try {
        const { writeFileSync } = await import('node:fs');
        const { join: joinPath } = await import('node:path');
        const { homedir } = await import('node:os');
        const cachePath = joinPath(homedir(), '.mint-quota-cache.json');
        writeFileSync(cachePath, JSON.stringify(data), 'utf-8');
      } catch {
        // Cache write failure is non-fatal.
      }

      // Only free-tier users get quota warnings; pro/enterprise have no cap.
      if (data.plan_type !== 'free' || data.requests_limit <= 0) return;

      const usagePercent = (data.requests_used / data.requests_limit) * 100;
      const shown = quotaWarningShownRef.current;

      if (usagePercent >= 100 && shown !== 'exceeded') {
        quotaWarningShownRef.current = 'exceeded';
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: `🚫 You've used all ${data.requests_limit} free requests.\n\nTo continue:\n  • Upgrade to Pro at https://usemint.dev/upgrade\n  • Add your own API keys: mint config:set providers.deepseek <key>`,
          },
        ]);
      } else if (usagePercent >= 80 && usagePercent < 100 && shown === 'none') {
        quotaWarningShownRef.current = 'approaching';
        const remaining = data.requests_limit - data.requests_used;
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: `⚠️  You've used ${data.requests_used} of your ${data.requests_limit} free requests (${remaining} remaining).\n\nTo continue after your quota:\n  • Upgrade to Pro for unlimited requests\n  • Add your own API keys with: mint config:set providers.deepseek <key>`,
          },
        ]);
      }
    } catch {
      // Quota is advisory — a fetch failure should never break the TUI.
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
              '  /help              — this help',
              '  /clear             — clear chat',
              '  /trace             — show recent events from this session',
              '  /model [id|auto]   — list models or switch (e.g. /model claude-sonnet-4)',
              '  /login             — sign in via browser (GitHub / Google)',
              '  /logout            — sign out of the gateway',
              '  /usage             — show free-tier quota + cost so far',
              '  /auto              — auto mode (no approvals)',
              '  /diff              — diff mode (per-file approval)',
              '  /plan              — plan mode (no writes)',
              '  /yolo              — yolo mode (full autonomy)',
              '  Ctrl+C             — exit',
            ].join('\n'),
          },
        ]);
        setInput('');
        return;
      }
      if (trimmed === '/clear') {
        setMessages([]);
        reset();
        budgetWarnedRef.current = false;
        setInput('');
        return;
      }
      if (trimmed === '/trace') {
        // Render the in-memory event buffer for this session. We render a
        // compact one-line summary per event — use `mint trace <id>` for the
        // full transcript.
        const lines: string[] = recentEvents.length === 0
          ? ['(no events yet — start a task)']
          : recentEvents.slice(-60).map(formatEventLine);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: ['Recent events (this session):', ...lines].join('\n'),
          },
        ]);
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

      // /model — list or switch active model (in-session, no relaunch)
      if (trimmed === '/model' || trimmed.startsWith('/model ')) {
        const arg = trimmed.slice('/model'.length).trim();
        const { MODEL_TIERS } = await import('../providers/tiers.js');
        const allModels = Object.keys(MODEL_TIERS).sort();
        if (!arg) {
          const lines = allModels.map((m) => {
            const tier = (MODEL_TIERS as Record<string, string>)[m];
            const active = m === modelPreference ? ' ◀ active' : '';
            return `  ${m.padEnd(24)} [${tier}]${active}`;
          });
          const activeLine = `Active: ${modelPreference ?? 'auto (routed)'}`;
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              content: [activeLine, '', 'Available models (use `/model <id>` or `/model auto`):', ...lines].join('\n'),
            },
          ]);
          setInput('');
          return;
        }
        if (arg === 'auto') {
          setModelPreference(undefined);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: 'Model: auto (routed per task)' },
          ]);
          setInput('');
          return;
        }
        if (!allModels.includes(arg)) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `Unknown model "${arg}". Run /model with no args to see the list.` },
          ]);
          setInput('');
          return;
        }
        setModelPreference(arg);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: `Model: ${arg} (applies to your next turn)` },
        ]);
        setInput('');
        return;
      }

      // /login — browser OAuth, in-session
      if (trimmed === '/login') {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: 'Opening browser to sign in… complete the flow in your browser, then return here.' },
        ]);
        setInput('');
        try {
          const { loginWithBrowser } = await import('../cli/commands/login-browser.js');
          const result = await loginWithBrowser({ silent: true });
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `Signed in as ${result.email} (${result.plan} plan).` },
          ]);
          fetchQuota();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `Sign-in failed: ${msg}` },
          ]);
        }
        return;
      }

      // /logout — clear stored gateway token
      if (trimmed === '/logout') {
        try {
          const { config } = await import('../utils/config.js');
          config.del('gatewayToken');
          config.del('email');
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: 'Signed out. Run /login or `mint login` to sign back in.' },
          ]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `Logout failed: ${msg}` },
          ]);
        }
        setInput('');
        return;
      }

      // /usage — show quota + session cost
      if (trimmed === '/usage') {
        const used = quotaUsed ?? 0;
        const limit = quotaLimit ?? 50;
        const remaining = Math.max(0, limit - used);
        const cost = panelState.totalCost.toFixed(4);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: [
              `Free quota: ${used}/${limit} used (${remaining} remaining this month)`,
              `Session cost: $${cost}`,
              '',
              'See full breakdown: `mint usage` or `mint account`',
            ].join('\n'),
          },
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
          if (event.type === 'cost.delta' && !budgetWarnedRef.current) {
            // Cost-budget warning: read threshold lazily so changes via
            // `mint config:set brain.sessionBudgetUsd <n>` take effect on the
            // next run without a restart.
            try {
              const { config } = await import('../utils/config.js');
              const budget = (config.get('brain') as { sessionBudgetUsd?: number } | undefined)?.sessionBudgetUsd ?? 0.5;
              if (budget > 0 && panelState.totalCost + event.usd > budget) {
                budgetWarnedRef.current = true;
                setMessages((prev) => [
                  ...prev,
                  {
                    id: nextId(),
                    role: 'assistant',
                    content: `⚠️  Session cost has exceeded $${budget.toFixed(2)}. Press Ctrl+C to abort, or continue — you'll only be warned once per session. Adjust with: mint config:set brain.sessionBudgetUsd <usd>`,
                  },
                ]);
              }
            } catch {
              /* config read is best-effort */
            }
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
  const showDiffPopup = pendingApproval?.reason === 'diff' && lastDiff !== null;
  const diffPopupRows = showDiffPopup
    ? Math.min(
        12,
        2 + lastDiff!.hunks.reduce((acc, h) => acc + h.lines.length, 0),
      )
    : 0;
  const approvalNotice = pendingApproval
    ? `Approve ${pendingApproval.reason}? Press y or Enter for yes, n for no.`
    : null;
  const inputAreaHeight = approvalNotice ? 4 : 3;
  const reservedRows = (errorMsg ? 1 : 0) + inspectorHeight + diffPopupRows + inputAreaHeight + 1;
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

      {showDiffPopup && lastDiff && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          height={diffPopupRows}
          overflow="hidden"
        >
          <Text color="yellow" bold>
            Diff: {lastDiff.file}
          </Text>
          {lastDiff.hunks.flatMap((h, hi) =>
            h.lines.slice(0, 8).map((l, li) => (
              <Text
                key={`${hi}-${li}`}
                color={l.type === 'add' ? 'green' : l.type === 'remove' ? 'red' : undefined}
                dimColor={l.type === 'context'}
              >
                {l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' '} {l.content}
              </Text>
            )),
          )}
        </Box>
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
