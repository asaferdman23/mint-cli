/**
 * Brain-powered TUI — opencode-style layout.
 *
 * Layout (top to bottom):
 *   ┌─────────────────────────────────────────┐
 *   │  Messages viewport (scrollable)          │
 *   ├─────────────────────────────────────────┤
 *   │  Diff popup (conditional)                │
 *   ├─────────────────────────────────────────┤
 *   │  Input / activity area                   │
 *   ├─────────────────────────────────────────┤
 *   │  Status bar (1 row)                      │
 *   └─────────────────────────────────────────┘
 *
 * Overlays: help dialog (ctrl+h), rendered on top when active.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import chalk from 'chalk';
import { initChalkLevel } from './utils/colorize.js';
import { MessageList, type ChatMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { ListDialog, type ListDialogItem } from './components/ListDialog.js';
import { Sidebar } from './components/Sidebar.js';
import { useBrainEvents } from './hooks/useBrainEvents.js';
import { currentTheme, currentThemeName, setThemeByName } from './theme/manager.js';
import { THEMES } from './theme/themes.js';
import { Icons } from './styles/icons.js';
import { runBrain, type AgentEvent, type Mode } from '../brain/index.js';
import type { ModelId } from '../providers/types.js';

initChalkLevel();

interface BrainAppProps {
  initialPrompt?: string;
  agentMode?: Mode;
  modelPreference?: string;
}

let _msgId = 0;
const nextId = (): string => `m-${++_msgId}`;

function fmtEvent(event: AgentEvent): string {
  const t = new Date(event.ts).toISOString().slice(11, 19);
  switch (event.type) {
    case 'session.start':     return `${t}  ● session ${event.sessionId.slice(0, 12)}  mode=${event.mode}`;
    case 'classify':          return `${t}  ◆ ${event.kind}/${event.complexity}  model=${event.model}`;
    case 'context.retrieved': return `${t}  ▤ ${event.files.length} files  ${event.tokensUsed}/${event.tokenBudget} tok`;
    case 'tool.call':         return `${t}  → ${event.name}`;
    case 'tool.result':       return `${t}  ← ${event.ok ? 'ok' : 'err'} ${event.durationMs}ms`;
    case 'diff.applied':      return `${t}  + ${event.file} +${event.additions} -${event.deletions}`;
    case 'cost.delta':        return `${t}  $ ${event.usd.toFixed(5)}`;
    case 'done':              return `${t}  ✓ $${event.result.totalCostUsd.toFixed(4)}  ${event.result.iterations}it`;
    default:                  return `${t}  · ${(event as { type: string }).type}`;
  }
}

const HELP_LINES = [
  '─── Slash commands ──────────────────────────────',
  '/help              — this help',
  '/clear             — clear chat',
  '/trace             — recent session events',
  '/model [id|auto]   — list or switch model',
  '/login             — sign in via browser',
  '/logout            — sign out',
  '/usage             — quota + cost',
  '/diff              — diff mode (per-file approval)',
  '/auto              — auto mode (no approvals)',
  '/plan              — plan mode (read-only)',
  '/yolo              — yolo mode (full autonomy)',
  '─── Keyboard ────────────────────────────────────',
  'ctrl+h             — toggle this help',
  'ctrl+o             — model picker',
  'ctrl+t             — theme switcher',
  'ctrl+b             — toggle files sidebar',
  'ctrl+c             — exit',
  '↑/↓ PgUp/PgDn      — scroll messages',
];

export function BrainApp({ initialPrompt, agentMode: initMode, modelPreference: initModelPref }: BrainAppProps): React.ReactElement {
  const { exit } = useApp();
  const t = currentTheme();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(initMode ?? 'diff');
  const [modelPref, setModelPref] = useState<string | undefined>(initModelPref);
  const [currentModel, setCurrentModel] = useState<ModelId | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [quotaUsed, setQuotaUsed] = useState<number | undefined>();
  const [quotaLimit, setQuotaLimit] = useState<number | undefined>();

  // Overlay state machine — only one modal at a time.
  const [overlay, setOverlay] = useState<'none' | 'help' | 'model' | 'theme'>('none');
  const [overlayIndex, setOverlayIndex] = useState(0);
  const [showSidebar, setShowSidebar] = useState(false);
  const [themeName, setThemeNameState] = useState(currentThemeName());
  const [modelList, setModelList] = useState<Array<{ id: string; tier: string }>>([]);
  const [filePaths, setFilePaths] = useState<string[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const assistantIdRef = useRef('');
  const quotaWarnRef = useRef<'none' | 'approaching' | 'exceeded'>('none');
  const budgetWarnedRef = useRef(false);

  const [termSize, setTermSize] = useState({
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  });
  useEffect(() => {
    const onResize = () => setTermSize({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 });
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const {
    panelState, streamingText,
    pendingApproval, lastDiff, recentEvents, currentActivity,
    resolveApproval, apply, reset,
  } = useBrainEvents();

  // ─── Quota ────────────────────────────────────────────────────────────────

  const fetchQuota = useCallback(async () => {
    const { config } = await import('../utils/config.js');
    if (!config.isAuthenticated()) return;
    try {
      const response = await fetch(`${config.getGatewayUrl()}/auth/quota`, {
        headers: { Authorization: `Bearer ${config.get('gatewayToken')}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const data = await response.json() as { requests_used: number; requests_limit: number; plan_type?: string };
      setQuotaUsed(data.requests_used);
      setQuotaLimit(data.requests_limit);

      if (data.plan_type !== 'free' || data.requests_limit <= 0) return;
      const pct = (data.requests_used / data.requests_limit) * 100;
      const shown = quotaWarnRef.current;
      if (pct >= 100 && shown !== 'exceeded') {
        quotaWarnRef.current = 'exceeded';
        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: `${Icons.error} You've used all ${data.requests_limit} free requests.\n\nUpgrade: https://usemint.dev/upgrade\nOr add your own keys: mint config:set providers.anthropic <key>` }]);
      } else if (pct >= 80 && shown === 'none') {
        quotaWarnRef.current = 'approaching';
        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: `${Icons.warning}  ${data.requests_used}/${data.requests_limit} free requests used (${data.requests_limit - data.requests_used} remaining).` }]);
      }
    } catch { /* advisory */ }
  }, []);

  useEffect(() => { fetchQuota(); }, [fetchQuota]);

  // Load the model registry once for the model picker.
  useEffect(() => {
    (async () => {
      const { MODEL_TIERS } = await import('../providers/tiers.js');
      const list = Object.keys(MODEL_TIERS)
        .sort()
        .map((id) => ({ id, tier: (MODEL_TIERS as Record<string, string>)[id] }));
      setModelList(list);
    })();
  }, []);

  // Load project file paths for @-completion (best-effort; index may be absent).
  useEffect(() => {
    (async () => {
      try {
        const { loadIndex } = await import('../context/indexer.js');
        const index = await loadIndex(process.cwd());
        if (index) setFilePaths(Object.keys(index.files).sort());
      } catch { /* no index — @-completion stays empty */ }
    })();
  }, []);

  // ─── Overlay helpers ────────────────────────────────────────────────────────

  const openOverlay = useCallback((which: 'help' | 'model' | 'theme') => {
    setOverlay(which);
    if (which === 'model') {
      const idx = modelList.findIndex((m) => m.id === modelPref);
      setOverlayIndex(idx >= 0 ? idx : 0);
    } else if (which === 'theme') {
      const idx = THEMES.findIndex((th) => th.name === themeName);
      setOverlayIndex(idx >= 0 ? idx : 0);
    } else {
      setOverlayIndex(0);
    }
  }, [modelList, modelPref, themeName]);

  // ─── Global keyboard ──────────────────────────────────────────────────────

  useInput((keypress, key) => {
    // Ctrl+C always exits.
    if (key.ctrl && keypress === 'c') { abortRef.current?.abort(); exit(); return; }

    // ── Overlay-active: capture navigation, swallow everything else ──
    if (overlay !== 'none') {
      if (key.escape) {
        // Revert any live theme preview back to the committed theme.
        if (overlay === 'theme' && currentThemeName() !== themeName) {
          setThemeByName(themeName);
        }
        setOverlay('none');
        return;
      }

      if (overlay === 'help') { setOverlay('none'); return; }

      const len = overlay === 'model' ? modelList.length : THEMES.length;
      if (len === 0) { if (key.escape) setOverlay('none'); return; }

      if (key.upArrow)   { setOverlayIndex((i) => (i - 1 + len) % len); return; }
      if (key.downArrow) { setOverlayIndex((i) => (i + 1) % len); return; }

      if (key.return) {
        if (overlay === 'model') {
          const picked = modelList[overlayIndex];
          if (picked) {
            setModelPref(picked.id);
            setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: `Model: **${picked.id}**` }]);
          }
        } else if (overlay === 'theme') {
          const picked = THEMES[overlayIndex];
          if (picked && setThemeByName(picked.name)) {
            setThemeNameState(picked.name);
          }
        }
        setOverlay('none');
        return;
      }

      // Live-preview theme as you navigate.
      if (overlay === 'theme') {
        const previewing = THEMES[overlayIndex];
        if (previewing && previewing.name !== currentThemeName()) {
          setThemeByName(previewing.name);
        }
      }
      return;
    }

    // ── Overlay open shortcuts ──
    if (key.ctrl && keypress === 'h') { openOverlay('help'); return; }
    if (key.ctrl && keypress === 'o') { openOverlay('model'); return; }
    if (key.ctrl && keypress === 't') { openOverlay('theme'); return; }
    if (key.ctrl && keypress === 'b') { setShowSidebar((v) => !v); return; }

    // ── Scroll ──
    const canScroll = messages.length > 0 && (isBusy || input.length === 0 || scrollOffset > 0);
    if (!canScroll) return;

    const page = Math.max(8, Math.floor(termSize.rows / 2));
    if (key.upArrow)   { setScrollOffset((n) => n + 3); return; }
    if (key.downArrow) { setScrollOffset((n) => Math.max(0, n - 3)); return; }
    if (key.pageUp)    { setScrollOffset((n) => n + page); return; }
    if (key.pageDown)  { setScrollOffset((n) => Math.max(0, n - page)); return; }
  });

  // ─── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    if (pendingApproval) {
      const ok = trimmed.toLowerCase() !== 'n' && trimmed.toLowerCase() !== 'no';
      resolveApproval(ok);
      setInput('');
      return;
    }
    if (isBusy) return;

    // ── Slash commands ──
    if (trimmed === '/help') {
      setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: HELP_LINES.join('\n') }]);
      setInput('');
      return;
    }
    if (trimmed === '/clear') {
      setMessages([]); reset(); budgetWarnedRef.current = false; setInput(''); return;
    }
    if (trimmed === '/trace') {
      const lines = recentEvents.length ? recentEvents.slice(-60).map(fmtEvent) : ['(no events yet)'];
      setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: ['Recent events:', ...lines].join('\n') }]);
      setInput(''); return;
    }
    if (['/auto', '/diff', '/plan', '/yolo'].includes(trimmed)) {
      const newMode = trimmed.slice(1) as Mode;
      setMode(newMode);
      setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: `Mode: **${newMode}**` }]);
      setInput(''); return;
    }
    if (trimmed === '/model' || trimmed.startsWith('/model ')) {
      const arg = trimmed.slice('/model'.length).trim();
      const { MODEL_TIERS } = await import('../providers/tiers.js');
      const all = Object.keys(MODEL_TIERS).sort();
      if (!arg) {
        const lines = all.map((m) => `  ${m.padEnd(28)} [${(MODEL_TIERS as Record<string, string>)[m]}]${m === modelPref ? '  ◀ active' : ''}`);
        setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: [`Active: ${modelPref ?? 'auto (routed)'}`, '', ...lines].join('\n') }]);
        setInput(''); return;
      }
      if (arg === 'auto') { setModelPref(undefined); setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: 'Model: auto (routed)' }]); setInput(''); return; }
      if (!all.includes(arg)) { setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: `Unknown model "${arg}". Run /model to list.` }]); setInput(''); return; }
      setModelPref(arg);
      setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: `Model: **${arg}**` }]);
      setInput(''); return;
    }
    if (trimmed === '/login') {
      setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: 'Opening browser to sign in…' }]);
      setInput('');
      try {
        const { loginWithBrowser } = await import('../cli/commands/login-browser.js');
        const res = await loginWithBrowser({ silent: true });
        setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: `Signed in as **${res.email}** (${res.plan})` }]);
        fetchQuota();
      } catch (err) {
        setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: `Sign-in failed: ${err instanceof Error ? err.message : String(err)}` }]);
      }
      return;
    }
    if (trimmed === '/logout') {
      try {
        const { config } = await import('../utils/config.js');
        config.del('gatewayToken'); config.del('email');
        setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: 'Signed out.' }]);
      } catch (err) {
        setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: `Logout failed: ${err instanceof Error ? err.message : String(err)}` }]);
      }
      setInput(''); return;
    }
    if (trimmed === '/usage') {
      const used = quotaUsed ?? 0, limit = quotaLimit ?? 50;
      setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: `Free quota: **${used}/${limit}** (${Math.max(0, limit - used)} remaining)\nSession cost: **$${panelState.totalCost.toFixed(4)}**` }]);
      setInput(''); return;
    }

    // ── User turn ──
    setScrollOffset(0);
    setMessages((p) => [...p, { id: nextId(), role: 'user', content: trimmed }]);
    assistantIdRef.current = nextId();
    setMessages((p) => [...p, { id: assistantIdRef.current, role: 'assistant', content: '', isStreaming: true }]);
    setInput('');
    setIsBusy(true);
    setErrorMsg(null);
    reset();

    const controller = new AbortController();
    abortRef.current = controller;
    const overrideModel = modelPref && modelPref !== 'auto' ? (modelPref as ModelId) : undefined;

    try {
      for await (const event of runBrain({ task: trimmed, cwd: process.cwd(), mode, signal: controller.signal, model: overrideModel })) {
        apply(event);

        if (event.type === 'classify') {
          setCurrentModel(event.model);
        }
        if (event.type === 'cost.delta' && !budgetWarnedRef.current) {
          try {
            const { config } = await import('../utils/config.js');
            const budget = (config.get('brain') as { sessionBudgetUsd?: number } | undefined)?.sessionBudgetUsd ?? 0.5;
            if (budget > 0 && panelState.totalCost + event.usd > budget) {
              budgetWarnedRef.current = true;
              setMessages((p) => [...p, { id: nextId(), role: 'assistant', content: `${Icons.warning}  Session cost exceeded $${budget.toFixed(2)}. Press Ctrl+C to abort or continue — warned once per session.` }]);
            }
          } catch { /* best-effort */ }
        }
        if (event.type === 'error') setErrorMsg(event.error);
        if (event.type === 'done') {
          setMessages((p) => p.map((m) =>
            m.id === assistantIdRef.current
              ? { ...m, content: event.result.output || '(no output)', isStreaming: false, cost: event.result.totalCostUsd, model: event.result.model, durationMs: event.result.durationMs }
              : m
          ));
          try {
            const { trackBrainRun } = await import('../usage/tracker.js');
            trackBrainRun({ sessionId: Date.now().toString(36), task: trimmed, model: event.result.model, inputTokens: event.result.inputTokens, outputTokens: event.result.outputTokens, cost: event.result.totalCostUsd, durationMs: event.result.durationMs, cacheReadTokens: event.result.cacheReadInputTokens, cacheCreationTokens: event.result.cacheCreationInputTokens });
          } catch { /* best-effort */ }
          fetchQuota();
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setMessages((p) => p.filter((m) => m.id !== assistantIdRef.current));
    } finally {
      setIsBusy(false);
      abortRef.current = null;
    }
  }, [isBusy, mode, modelPref, pendingApproval, resolveApproval, apply, reset, panelState.totalCost, recentEvents, quotaUsed, quotaLimit, fetchQuota]);

  useEffect(() => {
    if (initialPrompt?.trim()) {
      const id = setTimeout(() => handleSubmit(initialPrompt), 100);
      return () => clearTimeout(id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Layout math ──────────────────────────────────────────────────────────

  const showDiff = pendingApproval?.reason === 'diff' && lastDiff !== null;
  const diffRows = showDiff ? Math.min(12, 2 + lastDiff!.hunks.reduce((a, h) => a + h.lines.length, 0)) : 0;
  const approvalNotice = pendingApproval ? `Approve ${pendingApproval.reason}? [y/Enter] yes  [n] no` : null;
  const inputAreaH = approvalNotice ? 4 : isBusy && currentActivity ? Math.min(5, 2 + (currentActivity.detail ? 1 : 0) + (currentActivity.lastResult ? 1 : 0)) : 3;
  const statusH = 1;
  const errorH = errorMsg ? 1 : 0;
  const msgAreaH = Math.max(1, termSize.rows - inputAreaH - statusH - errorH - diffRows);

  // Sidebar shows when toggled (ctrl+b) and the terminal is wide enough.
  const sidebarVisible = showSidebar && termSize.cols >= 80;
  const sidebarWidth = sidebarVisible ? Math.min(32, Math.floor(termSize.cols * 0.28)) : 0;

  // ─── Overlays (modal — replace the whole view) ──────────────────────────────

  if (overlay === 'help') {
    return (
      <Box flexDirection="column" height={termSize.rows}>
        <Box flexDirection="column" borderStyle="round" borderColor={t.borderFocused as Parameters<typeof Box>[0]['borderColor']} paddingX={2} paddingY={1} margin={2}>
          <Text>{chalk.hex(t.primary).bold(`${Icons.logo} Mint CLI — Help`)}</Text>
          <Text>{chalk.hex(t.borderNormal)(Icons.separator.repeat(46))}</Text>
          {HELP_LINES.map((line, i) => (
            <Text key={i}>
              {line.startsWith('───')
                ? chalk.hex(t.borderNormal)(line)
                : line.includes('—')
                  ? chalk.hex(t.secondary)(line.split('—')[0]) + chalk.hex(t.textMuted)('— ' + line.split('—').slice(1).join('—'))
                  : chalk.hex(t.textMuted)(line)
              }
            </Text>
          ))}
          <Text>{chalk.hex(t.borderNormal)(Icons.separator.repeat(46))}</Text>
          <Text>{chalk.hex(t.textMuted)('Press any key to close')}</Text>
        </Box>
      </Box>
    );
  }

  if (overlay === 'model') {
    const items: ListDialogItem[] = modelList.map((m) => ({
      label: m.id,
      hint: `[${m.tier}]`,
      active: m.id === modelPref,
    }));
    return (
      <Box flexDirection="column" height={termSize.rows}>
        <ListDialog title="Select model" items={items} selectedIndex={overlayIndex} />
      </Box>
    );
  }

  if (overlay === 'theme') {
    const items: ListDialogItem[] = THEMES.map((th) => ({
      label: th.name,
      active: th.name === themeName,
    }));
    return (
      <Box flexDirection="column" height={termSize.rows}>
        <ListDialog title="Select theme" items={items} selectedIndex={overlayIndex} footer="↑/↓ preview · Enter apply · Esc cancel" />
      </Box>
    );
  }

  // ─── Normal layout ────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" height={termSize.rows}>
      {errorMsg && (
        <Box paddingX={1} height={errorH}>
          <Text>{chalk.hex(t.error)(`${Icons.error} ${errorMsg}`)}</Text>
        </Box>
      )}

      {messages.length === 0 && !isBusy ? (
        <Box height={msgAreaH} overflow="hidden">
          <WelcomeScreen />
        </Box>
      ) : sidebarVisible ? (
        <Box height={msgAreaH} flexDirection="row" overflow="hidden">
          <Box flexGrow={1} overflow="hidden">
            <MessageList
              messages={messages}
              streamingContent={streamingText}
              availableHeight={msgAreaH}
              scrollOffset={scrollOffset}
            />
          </Box>
          <Sidebar
            files={panelState.files}
            totalCost={panelState.totalCost}
            totalTokens={panelState.totalTokens}
            width={sidebarWidth}
            height={msgAreaH}
          />
        </Box>
      ) : (
        <MessageList
          messages={messages}
          streamingContent={streamingText}
          availableHeight={msgAreaH}
          scrollOffset={scrollOffset}
        />
      )}

      {showDiff && lastDiff && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.warning as Parameters<typeof Box>[0]['borderColor']} paddingX={1} height={diffRows} overflow="hidden">
          <Text>{chalk.hex(t.warning).bold(`Diff: ${lastDiff.file}`)}</Text>
          {lastDiff.hunks.flatMap((h, hi) =>
            h.lines.slice(0, 8).map((l, li) => (
              <Text key={`${hi}-${li}`}>
                {chalk.hex(l.type === 'add' ? t.success : l.type === 'remove' ? t.error : t.textMuted)(
                  (l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ') + ' ' + l.content
                )}
              </Text>
            ))
          )}
        </Box>
      )}

      <Box height={inputAreaH} overflow="hidden" flexDirection="column">
        {approvalNotice && (
          <Box paddingX={1}>
            <Text>{chalk.hex(t.warning)(approvalNotice)}</Text>
          </Box>
        )}
        <InputBox
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isBusy={isBusy}
          isRouting={false}
          currentActivity={currentActivity}
          filePaths={filePaths}
        />
      </Box>

      <Box height={statusH} overflow="hidden">
        <StatusBar
          currentModel={currentModel}
          sessionTokens={panelState.totalTokens}
          sessionCost={panelState.totalCost}
          agentMode={mode}
          quotaUsed={quotaUsed}
          quotaLimit={quotaLimit}
        />
      </Box>
    </Box>
  );
}

export type { AgentEvent };
