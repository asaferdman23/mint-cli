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
import { QueuedPrompts } from './components/QueuedPrompts.js';
import { ApprovalDialog } from './components/ApprovalDialog.js';
import { CostBanner } from './components/CostBanner.js';
import { ErrorToast } from './components/ErrorToast.js';
import { DiffView, type DiffHunk } from './components/DiffView.js';
import { SLASH_COMMANDS } from './components/SlashAutocomplete.js';
import { useBrainEvents } from './hooks/useBrainEvents.js';
import { useInputHistory } from './hooks/useInputHistory.js';
import { useMouseScroll } from './hooks/useMouseScroll.js';
import { useApprovalFlow } from './hooks/useApprovalFlow.js';
import { useQuotaWarnings } from './hooks/useQuotaWarnings.js';
import { useSlashCommands } from './hooks/useSlashCommands.js';
import { useSessionMemory } from './hooks/useSessionMemory.js';
import { runBrain, type AgentEvent, type Mode } from '../brain/index.js';
import type { ModelId } from '../providers/types.js';
import type { TaskKind } from '../brain/events.js';

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
  // Sticky-route memory: the (kind, model) chosen for the most recent turn.
  // Passed into the next `runBrain` so the loop can reuse the same model
  // when the classifier picks the same kind — avoids jarring provider swaps
  // when complexity wobbles (trivial ↔ simple). Reset on /clear.
  const [lastTurnRoute, setLastTurnRoute] = useState<{ kind: TaskKind; model: ModelId } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Inspector visibility is a three-state to prevent mid-turn layout shift:
  //   'collapsed' — single-row "Trace (Tab to expand)" strip, always reserved
  //   'open'      — full ~12-row inspector with plan + events
  //   'hidden'    — no row at all (only used pre-session, when nothing to show)
  // We always reserve at least the 1-row strip from session start, so when
  // events start flowing the message area never shrinks.
  const [inspectorView, setInspectorView] = useState<'collapsed' | 'open'>('collapsed');
  const [scrollOffset, setScrollOffset] = useState(0);
  // Track the last `g` key for the vim-style `g g → top` chord.
  const lastGAtRef = useRef<number>(0);
  // FIFO queue of prompts the user typed while a turn was in flight.
  // The dequeue effect (below) shifts the head when isBusy flips false.
  const [queue, setQueue] = useState<string[]>([]);
  // Transient cost-budget banner. When non-null, BrainApp reserves a row
  // budget above the input (similar to ApprovalDialog) and renders <CostBanner>.
  // Cleared on next handleSubmit or on Esc inside the banner — never sticks
  // into the chat transcript (Batch G #16).
  const [costBannerMessage, setCostBannerMessage] = useState<string | null>(null);
  // Transient red error toast. Driven by `error` notices from the brain
  // (rate limits, gateway failures). Cleared on Esc or next submit.
  const [errorToastMessage, setErrorToastMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const assistantMsgIdRef = useRef<string>('');

  const {
    panelState,
    pipelinePhases,
    recentToolCalls,
    streamingText,
    pendingApproval,
    lastDiff,
    recentEvents,
    currentActivity,
    notices,
    consumeNotices,
    resolveApproval,
    apply,
    reset,
  } = useBrainEvents();

  const history = useInputHistory();
  const session = useSessionMemory();
  // L3 project memories — loaded once on session start from
  // <cwd>/.mint/memory.sqlite. We pass these into runBrain() so the dynamic
  // tier of the system prompt gets a <project_memory> block. Memories are
  // appended to during the session (fire-and-forget in loop.ts) but we don't
  // reload them mid-session — the next mint launch picks them up.
  const [projectMemories, setProjectMemories] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { openMemoryStore } = await import('../brain/memory/store.js');
        const store = openMemoryStore(process.cwd());
        const rows = await store.query({ k: 10 });
        // Silent nightly-style eviction (PR6): drop low-confidence stale
        // entries (`confidence < 0.3 AND lastSeen < now-30d`). Fire-and-forget
        // shape, but we await it before close() to avoid use-after-close.
        // Never surfaced to the user; failures are swallowed.
        try {
          await store.evict();
        } catch {
          /* eviction is best-effort */
        }
        store.close();
        if (!cancelled) setProjectMemories(rows.map((r) => r.text));
      } catch {
        /* best-effort — no memories on error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // L4 user preferences — loaded once from ~/.mint/memory.sqlite. Passed into
  // every runBrain call as userPreferences; surfaces as a <user_preferences>
  // block at the top of the project tier. Same fire-and-forget shape as the
  // L3 project loader above so the native sqlite binding stays off the render
  // path.
  const [userPreferences, setUserPreferences] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { openUserMemoryStore } = await import('../brain/memory/store.js');
        const store = openUserMemoryStore();
        const rows = await store.query({ kinds: ['preference'], k: 10 });
        try {
          await store.evict();
        } catch {
          /* eviction is best-effort */
        }
        store.close();
        if (!cancelled) setUserPreferences(rows.map((r) => r.text));
      } catch {
        /* best-effort — no prefs on error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Drain warn/error notices from the brain event stream into the chat
  // transcript as styled rows (kind: 'warn' | 'error'). Keeps the assistant
  // body clean while still surfacing the warning to the user.
  // One-time hint: if this repo has accumulated enough recorded outcomes and
  // routing has never been tuned, surface `/tune` so the learned-routing moat
  // is discoverable without leaving the TUI. Calm, one line (AGENT.md §1.2).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        const cwd = process.cwd();
        if (existsSync(join(cwd, '.mint', 'routing.json'))) return; // already tuned
        if (!existsSync(join(cwd, '.mint', 'outcomes.sqlite'))) return;
        const { openOutcomesStore } = await import('../brain/memory/outcomes.js');
        const store = openOutcomesStore(cwd);
        const count = store.count();
        store.close();
        if (cancelled || count < 30) return;
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: `Mint has learned this repo — ${count} sessions recorded. Run /tune to optimize routing for your tasks.`,
            kind: 'warn',
          },
        ]);
      } catch {
        /* best-effort hint — never block startup */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (notices.length === 0) return;
    const drained = consumeNotices();
    if (drained.length === 0) return;
    setMessages((prev) => [
      ...prev,
      ...drained.map((n) => ({
        id: n.id,
        role: 'assistant' as const,
        content: n.text,
        kind: n.kind,
      })),
    ]);
    // Surface the most recent error as a red toast above the input. The
    // chat row stays as historical record; the toast is the in-your-face
    // signal so the user doesn't miss a rate limit / gateway failure.
    const lastError = drained.filter((n) => n.kind === 'error').pop();
    if (lastError) setErrorToastMessage(lastError.text);
  }, [notices, consumeNotices]);

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

  // Mouse wheel scrolling. Step size matches the keyboard arrow step (3 lines)
  // so the feel is consistent whether the user reaches for the arrow keys or
  // the wheel. Wheel-down past the bottom (scrollOffset=0) is a no-op.
  useMouseScroll({
    onWheelUp: useCallback(() => setScrollOffset((n) => n + 3), []),
    onWheelDown: useCallback(() => setScrollOffset((n) => Math.max(0, n - 3)), []),
  });

  // Quota fetch + threshold warnings live in useQuotaWarnings. Threshold
  // notices render as styled notice rows (kind: 'error' | 'warn') — never
  // plain assistant messages, which would render with an empty "Mint"
  // header. We also promote the friendlier quota text into the error toast,
  // displacing the raw gateway 429 error which is less actionable.
  const handleQuotaNotice = useCallback((notice: { level: 'approaching' | 'exceeded'; text: string }) => {
    const isExceeded = notice.level === 'exceeded';
    // Strip leading glyph — MessageList adds its own per kind.
    const stripped = notice.text.replace(/^[✗⚠]\s+/, '');
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: 'assistant',
        content: stripped,
        kind: isExceeded ? 'error' : 'warn',
      },
    ]);
    if (isExceeded) {
      // Replace any raw gateway toast with the friendlier first line.
      const firstLine = stripped.split('\n')[0] ?? stripped;
      setErrorToastMessage(firstLine);
    }
  }, []);
  const { quotaUsed, quotaLimit, fetchQuota } = useQuotaWarnings({
    onNotice: handleQuotaNotice,
  });

  // Slash-command dispatch. Returns true if the input was a recognized
  // command — BrainApp short-circuits without sending it to the brain.
  // Wrap `reset` so /clear also drops the L2 session-memory ring. We don't
  // touch `apply`/`reset` from useBrainEvents — that's mid-turn state; the
  // session summaries ring is parallel and survives a single reset() call.
  const resetWithSession = useCallback(() => {
    reset();
    session.clear();
    setLastTurnRoute(null);
  }, [reset, session]);

  const { handleSlashCommand } = useSlashCommands({
    setMessages,
    setMode,
    setModelPreference,
    setInput,
    setQueue,
    reset: resetWithSession,
    fetchQuota,
    formatEventLine,
    resetBudgetWarn: useCallback(() => {
      budgetWarnedRef.current = false;
    }, []),
    clearCostBanner: useCallback(() => setCostBannerMessage(null), []),
    nextId,
    queue,
    modelPreference,
    recentEvents,
    quotaUsed,
    quotaLimit,
    sessionCost: panelState.totalCost,
  });

  useInput(
    (keypress, key) => {
      if (key.ctrl && keypress === 'c') {
        // Finalize any in-flight streaming assistant row so MessageList stops
        // merging streamingContent into it and the spinner stops.
        const inflightId = assistantMsgIdRef.current;
        if (inflightId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === inflightId && m.isStreaming
                ? { ...m, isStreaming: false, interrupted: true }
                : m,
            ),
          );
        }
        // Drop pending queued items — interrupting the train, not one item.
        if (queue.length > 0) {
          const cleared = queue.length;
          setQueue([]);
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              content: `Queue cleared (${cleared} item${cleared === 1 ? '' : 's'})`,
              kind: 'warn',
            },
          ]);
        }
        abortRef.current?.abort();
        // Drain in-flight memory writes so the last turn's extraction
        // doesn't get lost when the user hits Ctrl+C. 2s soft timeout —
        // never block longer (AGENT.md §1.6 keystroke is sacred). Then
        // exit unconditionally.
        void (async () => {
          try {
            const { awaitPendingMemoryWrites } = await import(
              '../brain/memory/pending.js'
            );
            await awaitPendingMemoryWrites(2000);
          } catch {
            /* shutdown drain is best-effort */
          } finally {
            exit();
          }
        })();
        return;
      }
      // Esc — when scrolled, jumps back to bottom (clears the indicator). This
      // takes priority over the abort behavior because the hint in StatusBar
      // tells the user Esc dismisses the scroll view.
      if (
        key.escape &&
        scrollOffset > 0 &&
        !pendingApproval &&
        !costBannerMessage &&
        !errorToastMessage
      ) {
        setScrollOffset(0);
        return;
      }
      // Esc aborts the running task (but keeps the CLI alive — Ctrl+C is
      // the hard exit). Only claims Esc when nothing else owns it: dialogs,
      // banners, and toasts have their own Esc handlers when visible.
      if (
        key.escape &&
        isBusy &&
        !pendingApproval &&
        !costBannerMessage &&
        !errorToastMessage
      ) {
        const inflightId = assistantMsgIdRef.current;
        if (inflightId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === inflightId && m.isStreaming
                ? { ...m, isStreaming: false, interrupted: true }
                : m,
            ),
          );
        }
        if (queue.length > 0) {
          const cleared = queue.length;
          setQueue([]);
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              content: `Queue cleared (${cleared} item${cleared === 1 ? '' : 's'})`,
              kind: 'warn',
            },
          ]);
        }
        abortRef.current?.abort();
        return;
      }
      // Single source of truth for slash-autocomplete gating: mirror the
      // exact condition used in InputBox so up/down/Tab don't double-fire
      // (autocomplete nav + transcript scroll on the same key).
      const slashOpen =
        input.startsWith('/') && input.length >= 1 && !isBusy;
      const hasAutocomplete =
        slashOpen &&
        SLASH_COMMANDS.some((cmd) => `/${cmd.name}`.startsWith(input.toLowerCase()));

      if (
        (key.tab || (key.ctrl && keypress === 'o')) &&
        !hasAutocomplete &&
        (recentToolCalls.length > 0 || pipelinePhases.length > 0) &&
        (isBusy || input.length === 0)
      ) {
        setInspectorView((v) => (v === 'open' ? 'collapsed' : 'open'));
        return;
      }

      // Up/down ownership cascade (AGENT.md §1.6 — no double-handlers):
      //   1. autocomplete (handled inside InputBox, gated above)
      //   2. history recall (handled inside InputBox when input is empty)
      //   3. transcript scroll (here, only when history can't claim the key)
      //
      // History claims up/down whenever the input is empty and we're not busy,
      // so we restrict transcript scroll on arrow keys to: a run is in
      // progress, or the user is already scrolled up. PageUp/PageDown always
      // scroll the transcript when there's anything to scroll.
      const canScroll = messages.length > 0 && !hasAutocomplete;
      if (!canScroll) return;

      const pageStep = Math.max(8, Math.floor(termSize.rows / 2));
      const halfPageStep = Math.max(4, Math.floor(termSize.rows / 4));
      const arrowCanScroll = isBusy || scrollOffset > 0;
      // BIG_JUMP is "scroll past everything"; clamping happens in MessageList.
      const BIG_JUMP = 1_000_000;

      if (key.upArrow && arrowCanScroll) {
        setScrollOffset((n) => n + 3);
        return;
      }
      if (key.downArrow && arrowCanScroll) {
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
      // Ctrl+U / Ctrl+D — vim/less half-page scroll. Always-on, no arrow gate.
      if (key.ctrl && keypress === 'u') {
        setScrollOffset((n) => n + halfPageStep);
        return;
      }
      if (key.ctrl && keypress === 'd') {
        setScrollOffset((n) => Math.max(0, n - halfPageStep));
        return;
      }
      // Home / End — terminals send different escape sequences; Ink strips
      // the leading ESC and we see the tail. Cover the common variants.
      const isHome =
        keypress === 'home' || keypress.endsWith('[H') ||
        keypress.endsWith('OH') || keypress === '[1~' || keypress === '[7~';
      const isEnd =
        keypress === 'end' || keypress.endsWith('[F') ||
        keypress.endsWith('OF') || keypress === '[4~' || keypress === '[8~';
      if (isHome) { setScrollOffset(BIG_JUMP); return; }
      if (isEnd) { setScrollOffset(0); return; }
      // Vim shortcuts: g g → top, G → bottom. Only when input is empty so they
      // don't fight typing. `g` waits for a second `g` within ~700ms.
      if (input.length === 0 && !slashOpen) {
        if (keypress === 'G') {
          setScrollOffset(0);
          return;
        }
        if (keypress === 'g') {
          const now = Date.now();
          if (lastGAtRef.current && now - lastGAtRef.current < 700) {
            setScrollOffset(BIG_JUMP);
            lastGAtRef.current = 0;
          } else {
            lastGAtRef.current = now;
          }
          return;
        }
      }
    },
    { isActive: messages.length > 0 },
  );

  const handleSubmit = useCallback(
    async (userInput: string, opts?: { skipHistory?: boolean }) => {
      const trimmed = userInput.trim();
      if (!trimmed) return;

      // Any user submission dismisses the cost-budget banner (Batch G #16)
      // and the error toast — both are single transient nudges.
      setCostBannerMessage(null);
      setErrorToastMessage(null);

      // Approval is now handled entirely inside <ApprovalDialog> — the dialog
      // owns y/n/a/Enter/Esc when pendingApproval is set, and InputBox is
      // paused for the duration. handleSubmit should never see input while a
      // dialog is open; defensively drop anything that slips through.
      if (pendingApproval) {
        setInput('');
        return;
      }

      // /clear-queue — drop any pending queued items. Runs immediately even
      // while busy, since it's the explicit out for an over-eager train.
      if (trimmed === '/clear-queue') {
        const n = queue.length;
        setQueue([]);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: n === 0 ? 'Queue is already empty.' : `Queue cleared (${n} item${n === 1 ? '' : 's'})`,
            kind: 'warn',
          },
        ]);
        setInput('');
        return;
      }

      // Busy → queue the submission. History is recorded at enqueue time so
      // the user can recall it later via up-arrow (Batch D contract).
      if (isBusy) {
        history.recordSubmission(trimmed);
        setQueue((q) => [...q, trimmed]);
        setInput('');
        return;
      }

      // Persist to history (Batch D). Skip approval responses (handled above)
      // but record slash commands and prompts alike — users want /clear, /trace
      // etc. recalled the same as any other input. Dequeue-replay path passes
      // skipHistory=true since the prompt was already recorded at enqueue.
      if (!opts?.skipHistory) history.recordSubmission(trimmed);

      // Slash commands — delegated to useSlashCommands. Returns true if the
      // input was a recognized command (in which case we short-circuit and
      // do not push it to the brain).
      if (await handleSlashCommand(trimmed)) {
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
      const recentUserTurns = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .slice(-4);

      // Settle the prior turn's summarizer before the next runBrain reads
      // `session.summaryTexts`. Bounded at 1.5s so a hung summary never
      // blocks the user — `awaitPending` resolves on timeout if needed
       // (AGENT.md §1.6 — keystroke is sacred).
      await session.awaitPending(1500);

      try {
        for await (const event of runBrain({
          task: trimmed,
          cwd: process.cwd(),
          mode,
          signal: controller.signal,
          model: overrideModel,
          recentUserTurns,
          priorTurnSummaries: session.summaryTexts,
          projectMemories,
          userPreferences,
          priorModel: lastTurnRoute?.model,
          priorKind: lastTurnRoute?.kind,
        })) {
          apply(event);

          if (event.type === 'classify') {
            setCurrentModel(event.model);
            // Remember (kind, model) for next-turn sticky routing. Set here
            // (not on `done`) so the value is recorded as soon as the route
            // is committed — even if the turn aborts mid-stream.
            setLastTurnRoute({ kind: event.kind, model: event.model });
            // Attach the routing rationale to the in-flight assistant message
            // so MessageList can render it as a one-line chip ABOVE the
            // assistant header. Every turn doubles as a visible demo of the
            // brain's decision — the core wedge made non-silent.
            const routing = {
              model: event.model,
              kind: event.kind,
              complexity: event.complexity,
              reasoning: event.reasoning,
              confidence: event.confidence,
              source: event.source,
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgIdRef.current
                  ? { ...m, model: event.model, routing }
                  : m,
              ),
            );
          }
          if (event.type === 'plan.draft') {
            // Attach the structured plan to the in-flight assistant row so
            // MessageList can render it as a framed `Plan` panel ABOVE the
            // Mint header — the response body that follows reads as nested
            // under the plan rather than competing with it.
            const planSteps = event.steps;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgIdRef.current
                  ? { ...m, planSteps }
                  : m,
              ),
            );
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
                setCostBannerMessage(
                  `Session cost has exceeded $${budget.toFixed(2)}. Press Ctrl+C to abort, or continue — you'll only be warned once per session. Adjust with: mint config:set brain.sessionBudgetUsd <usd>`,
                );
              }
            } catch {
              /* config read is best-effort */
            }
          }
          if (event.type === 'error') {
            setErrorMsg(event.error);
            // Finalize the in-flight assistant row so it doesn't sit with
            // `isStreaming: true` forever. If no content arrived, drop the
            // row entirely — otherwise mark it interrupted.
            const inFlightId = assistantMsgIdRef.current;
            setMessages((prev) => {
              const target = prev.find((m) => m.id === inFlightId);
              if (!target) return prev;
              if (target.content.trim().length === 0) {
                return prev.filter((m) => m.id !== inFlightId);
              }
              return prev.map((m) =>
                m.id === inFlightId
                  ? { ...m, isStreaming: false, interrupted: true }
                  : m,
              );
            });
          }
          if (event.type === 'done') {
            const output = event.result.output || '(no output)';
            const content = output;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgIdRef.current
                  ? {
                      ...m,
                      content,
                      isStreaming: false,
                      cost: event.result.totalCostUsd,
                      model: event.result.model,
                    }
                  : m,
              ),
            );
            // L2 session memory — fire-and-forget summarize. Picks up this turn's
            // user prompt, the final assistant content, the files actually touched
            // by tool calls, and the brain's success flag. Does not block the
            // render thread (see useSessionMemory.recordTurn).
            session.recordTurn({
              userTask: trimmed,
              finalAssistant: output,
              filesTouched: event.result.filesTouched,
              toolCalls: event.result.toolCalls,
              outcome: event.result.success ? 'success' : 'partial',
              model: event.result.model,
            });
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
                cacheReadTokens: event.result.cacheReadInputTokens,
                cacheCreationTokens: event.result.cacheCreationInputTokens,
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
        // Keep an already-interrupted row so the "(interrupted)" line stays
        // visible; drop only the orphan empty streaming row from a real error.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgIdRef.current && m.isStreaming
              ? { ...m, isStreaming: false, interrupted: true }
              : m,
          ),
        );
      } finally {
        setIsBusy(false);
        abortRef.current = null;
      }
    },
    [isBusy, mode, modelPreference, pendingApproval, apply, reset, history, queue.length, handleSlashCommand, session],
  );

  // Dequeue head when the in-flight turn finishes. Use a ref to guard against
  // re-dispatch within the same tick: handleSubmit calls setIsBusy(true)
  // synchronously, but React batches state updates — if isBusy is briefly
  // observed false while the next render is pending, we could double-dispatch
  // the same head. The ref breaks that race.
  const dequeueLockRef = useRef(false);
  useEffect(() => {
    if (isBusy || queue.length === 0 || pendingApproval) return;
    if (dequeueLockRef.current) return;
    dequeueLockRef.current = true;
    const [head, ...rest] = queue;
    setQueue(rest);
    // Submit asynchronously so React commits the queue shift first; handleSubmit
    // will set isBusy=true which re-locks the effect.
    Promise.resolve().then(() => {
      dequeueLockRef.current = false;
      if (head) handleSubmit(head, { skipHistory: true });
    });
  }, [isBusy, queue, pendingApproval, handleSubmit]);

  // Auto-submit an initial prompt
  useEffect(() => {
    if (initialPrompt?.trim()) {
      const timer = setTimeout(() => handleSubmit(initialPrompt), 100);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showWelcome = messages.length === 0 && !isBusy;
  // Inspector reserves space proactively so message area never reflows
  // mid-turn (AGENT.md §1.6 — no layout shifts when a spinner starts).
  // While the agent is working we *render* the strip even if recentEvents is
  // empty; pre-session we hide it entirely so the welcome screen owns the
  // full height.
  const inspectorAvailable = recentEvents.length > 0 || isBusy;
  const showInspectorOpen = inspectorView === 'open' && inspectorAvailable && !showWelcome;
  const showInspectorStrip = inspectorView === 'collapsed' && inspectorAvailable && !showWelcome;
  const openInspectorHeight = Math.min(12, Math.max(6, Math.floor(termSize.rows * 0.32)));
  const inspectorHeight = showInspectorOpen
    ? openInspectorHeight
    : showInspectorStrip
      ? 1
      : 0;
  // Convert hook's hunk shape ({type:'context'|'add'|'remove', content}) to
  // DiffView's compact shape ({kind:'+'|'-'|' ', text}) once per render.
  const convertedDiffHunks: DiffHunk[] | null = lastDiff
    ? lastDiff.hunks.map((h) => ({
        header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
        lines: h.lines.map((l) => ({
          kind: l.type === 'add' ? ('+' as const) : l.type === 'remove' ? ('-' as const) : (' ' as const),
          text: l.content,
        })),
      }))
    : null;

  // Pull tool/file hints + diff out of the approval payload (delegated to
  // useApprovalFlow). The hook also computes the row budget reserved above
  // the input so the message area never reflows when the dialog appears.
  const approvalLastDiff =
    lastDiff && convertedDiffHunks ? { file: lastDiff.file, hunks: convertedDiffHunks } : null;
  const approvalDisplay = useApprovalFlow(pendingApproval, approvalLastDiff);
  const approvalToolName = approvalDisplay.toolName;
  const approvalFilePath = approvalDisplay.filePath;
  const approvalDiff = approvalDisplay.diff;

  // Standalone diff popup (when there's a proposed diff but no live approval
  // gate — e.g. auto mode applied the change). Replaces the legacy inline
  // popup. We hide it while the approval dialog is open since the dialog
  // already embeds the diff.
  const showStandaloneDiff = lastDiff !== null && !pendingApproval;
  const standaloneDiffRows = showStandaloneDiff && convertedDiffHunks
    ? Math.min(
        20,
        // 1 file header + N rendered rows (capped).
        1 +
          convertedDiffHunks.reduce(
            (acc, h) => acc + (h.header ? 1 : 0) + h.lines.length,
            0,
          ),
      ) + 2 // paddingX adds top/bottom internal padding budget
    : 0;

  // Approval dialog row budget — reserved from the moment pendingApproval
  // becomes truthy so the message area never reflows under the user (AGENT.md
  // §1.6 — no layout shifts when a spinner starts; §1.5 — trust requires the
  // dialog to be visible immediately, not after the next render tick).
  // Computed by useApprovalFlow.
  const approvalDialogRows = pendingApproval ? approvalDisplay.rows : 0;

  // When busy, InputBox renders a 1-row spinner strip above the bordered input.
  const inputAreaHeight = 3 + (isBusy ? 1 : 0);
  // Queue strip: 1 header + N items.
  const queueHeight = queue.length > 0 ? queue.length + 1 : 0;
  // Cost banner: round-bordered single line — 1 body row + 2 border rows.
  // Reserved from the moment costBannerMessage is non-null (AGENT.md §1.6).
  const costBannerHeight = costBannerMessage ? 3 : 0;
  // Same shape as cost banner — red round box, 1 body + 2 border rows.
  const errorToastHeight = errorToastMessage ? 3 : 0;
  // One row of breathing room between the scrolling message area and whatever
  // sits above the input (trace strip, queue, banners, dialog, or just the
  // input itself). Without it, a long assistant message's bottom border
  // visually fuses with the input box and the screen looks claustrophobic.
  const inputGapHeight = 1;
  const reservedRows =
    (errorMsg ? 1 : 0) +
    inspectorHeight +
    standaloneDiffRows +
    approvalDialogRows +
    costBannerHeight +
    errorToastHeight +
    queueHeight +
    inputGapHeight +
    inputAreaHeight +
    1;
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

      {showInspectorOpen && (
        <BrainToolInspector
          calls={recentToolCalls}
          currentActivity={currentActivity}
          events={recentEvents}
          panelState={panelState}
          maxHeight={inspectorHeight}
        />
      )}

      {showInspectorStrip && (
        <Box height={1} paddingX={1} overflow="hidden">
          <Text dimColor>
            <Text color="cyan">› </Text>
            {currentActivity?.label ?? 'Trace'}
            <Text dimColor>  (Tab to expand)</Text>
          </Text>
        </Box>
      )}

      {showStandaloneDiff && lastDiff && convertedDiffHunks && (
        <Box height={standaloneDiffRows} overflow="hidden" flexDirection="column">
          <DiffView
            file={lastDiff.file}
            hunks={convertedDiffHunks}
            maxRows={20}
            termCols={termSize.cols}
          />
        </Box>
      )}

      {/* Approval dialog — reserves rows from the moment pendingApproval is
          set so the message area doesn't reflow when the gate appears. */}
      {pendingApproval && (
        <Box height={approvalDialogRows} overflow="hidden" flexDirection="column">
          <ApprovalDialog
            reason={pendingApproval.reason === 'diff'
              ? `Apply the proposed edit?`
              : pendingApproval.reason === 'iteration'
                ? `Continue with this iteration's destructive tool calls?`
                : pendingApproval.reason === 'spend_limit'
                  ? `Spend cap reached — $${Number(pendingApproval.payload.spentUsd ?? 0).toFixed(4)} of $${Number(pendingApproval.payload.capUsd ?? 0).toFixed(2)}. Keep going?`
                  : `Run ${approvalToolName ?? 'this tool'}?`}
            toolName={approvalToolName}
            filePath={approvalFilePath}
            diffPreview={approvalDiff}
            iterationCalls={approvalDisplay.iterationCalls}
            onApprove={() => resolveApproval(true)}
            onReject={() => resolveApproval(false)}
            termCols={termSize.cols}
          />
        </Box>
      )}

      {queue.length > 0 && (
        <Box height={queueHeight} overflow="hidden">
          <QueuedPrompts items={queue} termCols={termSize.cols} />
        </Box>
      )}

      {/* Cost-budget banner — transient, dismiss on Esc or next submit.
          Reserves rows the moment the message is set (AGENT.md §1.6). */}
      {costBannerMessage && (
        <Box height={costBannerHeight} overflow="hidden" flexDirection="column">
          <CostBanner
            message={costBannerMessage}
            onDismiss={() => setCostBannerMessage(null)}
            termCols={termSize.cols}
          />
        </Box>
      )}

      {/* Error toast — red round box surfaced for rate-limit / gateway
          failures. Dismiss on Esc or next submit. */}
      {errorToastMessage && (
        <Box height={errorToastHeight} overflow="hidden" flexDirection="column">
          <ErrorToast
            message={errorToastMessage}
            onDismiss={() => setErrorToastMessage(null)}
            termCols={termSize.cols}
          />
        </Box>
      )}

      {/* 1-row spacer — keeps the input visually separated from the message
          area, trace strip, or any banner directly above it. */}
      <Box height={inputGapHeight} />

      <Box height={inputAreaHeight} overflow="hidden" flexDirection="column">
        <InputBox
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isBusy={isBusy}
          isRouting={false}
          currentActivity={currentActivity}
          inspectorHint={recentToolCalls.length > 0 ? `ctrl+o to ${inspectorView === 'open' ? 'collapse' : 'expand'}` : undefined}
          onHistoryPrev={history.recallPrev}
          onHistoryNext={history.recallNext}
          onHistoryExit={history.exitHistory}
          isPaused={pendingApproval !== null}
        />
      </Box>

      <Box height={1} overflow="hidden">
        <StatusBar
          currentModel={currentModel}
          sessionTokens={panelState.totalTokens}
          sessionCost={panelState.totalCost}
          monthlyCost={0}
          agentMode={mode}
          inspectorHint={recentToolCalls.length > 0 ? 'Ctrl+O trace' : undefined}
          quotaUsed={quotaUsed}
          quotaLimit={quotaLimit}
          termCols={termSize.cols}
          cacheHitRatio={panelState.cacheHitRatio}
          scrollOffset={scrollOffset}
        />
      </Box>
    </Box>
  );
}

/** Helper for callers that want to inspect events instead of rendering. */
export type { AgentEvent };
