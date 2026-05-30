// src/tui/hooks/useSlashCommands.ts
// Owns the slash-command dispatch table extracted from BrainApp. Each handler
// is in-session — no relaunch, no transcript pollution beyond the assistant
// reply it emits. Returns true when the input was a recognized command (so
// BrainApp can short-circuit before treating it as a brain task).
//
// Kept structurally identical to the inline switch it replaced: same order,
// same string copy, same dynamic imports. Add a new command here, then a
// matching entry in SlashAutocomplete's SLASH_COMMANDS list.
import { useCallback } from 'react';
import type { ChatMessage } from '../components/MessageList.js';
import { formatHelpText } from '../components/SlashAutocomplete.js';
import type { AgentEvent, Mode } from '../../brain/index.js';

export interface UseSlashCommandsDeps {
  // State setters / inputs the handlers need. Kept as a flat record so
  // callers don't have to memoize an object on every render.
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setMode: (m: Mode) => void;
  setModelPreference: (m: string | undefined) => void;
  setInput: (v: string) => void;
  setQueue: React.Dispatch<React.SetStateAction<string[]>>;
  reset: () => void;
  fetchQuota: () => Promise<void> | void;
  formatEventLine: (event: AgentEvent) => string;
  /** Reset budget-warning so a new session can re-trigger it. */
  resetBudgetWarn: () => void;
  /** Clear the cost banner on /clear. */
  clearCostBanner: () => void;
  /** Append a fresh message id; mirrors BrainApp's nextId() generator. */
  nextId: () => string;
  // Read-mostly inputs.
  queue: string[];
  modelPreference: string | undefined;
  recentEvents: AgentEvent[];
  quotaUsed: number | undefined;
  quotaLimit: number | undefined;
  sessionCost: number;
}

export interface UseSlashCommandsReturn {
  /** Dispatch a trimmed input string. Returns true if it was handled.
   *  Async because /model and /login dynamic-import to keep cold-start fast. */
  handleSlashCommand: (trimmed: string) => Promise<boolean>;
}

/** Pure parser for slash commands. Returns `null` for non-slash input.
 *  Exported separately so it can be unit-tested without rendering Ink. */
export function parseSlashCommand(input: string): { name: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  // Split on whitespace; first token (without the leading '/') is the name.
  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0] ?? '';
  if (!name) return null;
  return { name, args: parts.slice(1) };
}

export function useSlashCommands(deps: UseSlashCommandsDeps): UseSlashCommandsReturn {
  const {
    setMessages,
    setMode,
    setModelPreference,
    setInput,
    setQueue,
    reset,
    fetchQuota,
    formatEventLine,
    resetBudgetWarn,
    clearCostBanner,
    nextId,
    queue,
    modelPreference,
    recentEvents,
    quotaUsed,
    quotaLimit,
    sessionCost,
  } = deps;

  const handleSlashCommand = useCallback(
    async (trimmed: string): Promise<boolean> => {
      if (trimmed === '/help') {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: formatHelpText(),
          },
        ]);
        setInput('');
        return true;
      }
      if (trimmed === '/clear') {
        setMessages([]);
        reset();
        resetBudgetWarn();
        clearCostBanner();
        setInput('');
        return true;
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
        return true;
      }
      // /tune — analyze recorded outcomes and surface learned routing changes.
      // `/tune apply` writes the override. Runs inline; we capture the command's
      // console output and render it as one assistant message (ANSI stripped).
      if (trimmed === '/tune' || trimmed.startsWith('/tune ')) {
        const apply = /\b(apply|--apply)\b/.test(trimmed);
        setInput('');
        try {
          const { existsSync } = await import('node:fs');
          const { join } = await import('node:path');
          if (!existsSync(join(process.cwd(), '.mint', 'outcomes.sqlite'))) {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content:
                  'No outcomes recorded yet. Run a few tasks, then /tune to let Mint learn this repo.',
                kind: 'warn',
              },
            ]);
            return true;
          }
          const lines: string[] = [];
          const stripAnsi = (s: string): string =>
            // eslint-disable-next-line no-control-regex
            s.replace(/\[[0-9;]*m/g, '');
          const origLog = console.log;
          const origErr = console.error;
          console.log = (...a: unknown[]) => lines.push(stripAnsi(a.join(' ')));
          console.error = (...a: unknown[]) => lines.push(stripAnsi(a.join(' ')));
          try {
            const { runTune } = await import('../../cli/commands/tune.js');
            await runTune({ apply });
          } finally {
            console.log = origLog;
            console.error = origErr;
          }
          const body = lines.join('\n').trim() || '(no output)';
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              content: apply
                ? body
                : `${body}\n\nApply these changes with /tune apply`,
            },
          ]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `tune failed: ${msg}`, kind: 'error' },
          ]);
        }
        return true;
      }

      // /audit — same as the CLI command, runs in-session. Aggregate by default,
      // or `/audit <sessionId>` for a per-turn breakdown. ANSI is stripped so
      // chalk colors don't leak into the message renderer.
      if (trimmed === '/audit' || trimmed.startsWith('/audit ')) {
        const sessionArg = trimmed.slice('/audit'.length).trim() || undefined;
        setInput('');
        const lines: string[] = [];
        const stripAnsi = (s: string): string =>
          // eslint-disable-next-line no-control-regex
          s.replace(/\[[0-9;]*m/g, '');
        const origLog = console.log;
        const origErr = console.error;
        console.log = (...a: unknown[]) => lines.push(stripAnsi(a.join(' ')));
        console.error = (...a: unknown[]) => lines.push(stripAnsi(a.join(' ')));
        try {
          const { runAudit } = await import('../../cli/commands/audit.js');
          runAudit({ session: sessionArg });
        } catch (err) {
          lines.push(`audit failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          console.log = origLog;
          console.error = origErr;
        }
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: lines.join('\n').trim() || '(no output)' },
        ]);
        return true;
      }

      // /budget — show or set the per-session spend cap (USD). Affects the
      // current run via config (next iteration honors it). `/budget` prints,
      // `/budget 0.50` sets, `/budget off` disables (sets 0).
      if (trimmed === '/budget' || trimmed.startsWith('/budget ')) {
        const arg = trimmed.slice('/budget'.length).trim();
        const { config } = await import('../../utils/config.js');
        if (!arg) {
          const current = config.getPath<number>('brain.spendCap') ?? 0;
          const spent = sessionCost;
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              content: [
                `Spend cap: ${current === 0 ? 'off' : `$${current.toFixed(2)}`}`,
                `Spent this session: $${spent.toFixed(4)}`,
                '',
                'Set with `/budget <usd>` or disable with `/budget off`.',
              ].join('\n'),
            },
          ]);
          setInput('');
          return true;
        }
        let next: number;
        if (arg === 'off' || arg === '0') {
          next = 0;
        } else {
          next = Number(arg);
          if (Number.isNaN(next) || next < 0) {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'assistant', content: `Invalid budget: '${arg}'. Use a positive number or 'off'.`, kind: 'warn' },
            ]);
            setInput('');
            return true;
          }
        }
        config.setPath('brain.spendCap', next);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: next === 0 ? 'Spend cap disabled.' : `Spend cap set to $${next.toFixed(2)}.` },
        ]);
        setInput('');
        return true;
      }

      if (trimmed === '/auto' || trimmed === '/diff' || trimmed === '/plan' || trimmed === '/yolo') {
        const newMode = trimmed.slice(1) as Mode;
        setMode(newMode);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: `Mode: ${newMode}` },
        ]);
        setInput('');
        return true;
      }

      // /model — list or switch active model (in-session, no relaunch)
      if (trimmed === '/model' || trimmed.startsWith('/model ')) {
        const arg = trimmed.slice('/model'.length).trim();
        const { MODEL_TIERS } = await import('../../providers/tiers.js');
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
          return true;
        }
        if (arg === 'auto') {
          setModelPreference(undefined);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: 'Model: auto (routed per task)' },
          ]);
          setInput('');
          return true;
        }
        if (!allModels.includes(arg)) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `Unknown model "${arg}". Run /model with no args to see the list.` },
          ]);
          setInput('');
          return true;
        }
        setModelPreference(arg);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: `Model: ${arg} (applies to your next turn)` },
        ]);
        setInput('');
        return true;
      }

      // /login — browser OAuth, in-session
      if (trimmed === '/login') {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: 'Opening browser to sign in… complete the flow in your browser, then return here.' },
        ]);
        setInput('');
        try {
          const { loginWithBrowser } = await import('../../cli/commands/login-browser.js');
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
        return true;
      }

      // /logout — clear stored gateway token
      if (trimmed === '/logout') {
        try {
          const { config } = await import('../../utils/config.js');
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
        return true;
      }

      // /remember <text> — save a preference to the L4 user-global store.
      // Secrets are rejected via containsSecret (mirrors store.ts write path,
      // but we surface the rejection as a visible warn row).
      if (trimmed === '/remember' || trimmed.startsWith('/remember ')) {
        const text = trimmed.slice('/remember'.length).trim();
        if (!text) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: 'Usage: /remember <text>', kind: 'warn' },
          ]);
          setInput('');
          return true;
        }
        try {
          const { containsSecret } = await import('../../brain/memory/redact.js');
          if (containsSecret(text)) {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content:
                  "Rejected — contains what looks like a secret. Memories are stored locally but we still don't save credentials.",
                kind: 'error',
              },
            ]);
            setInput('');
            return true;
          }
          const { openUserMemoryStore } = await import('../../brain/memory/store.js');
          const store = openUserMemoryStore();
          const result = await store.write('preference', { kind: 'preference', text });
          // Recover the newly inserted (or incremented) row to surface its id.
          const rows = await store.query({ kinds: ['preference'], k: 1 });
          const idStr = rows[0]?.id != null ? ` (id=${rows[0].id})` : '';
          store.close();
          if (result.action === 'rejected') {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'assistant', content: 'Could not save preference.', kind: 'warn' },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'assistant', content: `Saved preference: ${text}${idStr}` },
            ]);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `Could not save preference: ${msg}`, kind: 'error' },
          ]);
        }
        setInput('');
        return true;
      }

      // /forget <id> — delete a memory. Try user store first, then project.
      if (trimmed === '/forget' || trimmed.startsWith('/forget ')) {
        const arg = trimmed.slice('/forget'.length).trim();
        const id = Number(arg);
        if (!arg || !Number.isInteger(id) || id <= 0) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: 'Usage: /forget <id> (numeric)', kind: 'warn' },
          ]);
          setInput('');
          return true;
        }
        try {
          const { openUserMemoryStore, openMemoryStore } = await import('../../brain/memory/store.js');
          const userStore = openUserMemoryStore();
          let removed = userStore.deleteById(id);
          userStore.close();
          if (!removed) {
            const projStore = openMemoryStore(process.cwd());
            removed = projStore.deleteById(id);
            projStore.close();
          }
          if (removed) {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'assistant', content: `Forgot memory ${id}` },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'assistant', content: `No memory with id ${id}`, kind: 'warn' },
            ]);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `Could not forget memory: ${msg}`, kind: 'error' },
          ]);
        }
        setInput('');
        return true;
      }

      // /memory list|diff|clear — inspect/manage the typed memory stores.
      if (trimmed === '/memory' || trimmed.startsWith('/memory ')) {
        const parts = trimmed.slice('/memory'.length).trim().split(/\s+/).filter(Boolean);
        const sub = parts[0] ?? 'list';
        const rest = parts.slice(1);
        try {
          const { openUserMemoryStore, openMemoryStore } = await import('../../brain/memory/store.js');
          const { homedir } = await import('node:os');
          const { join } = await import('node:path');
          const userPath = join(homedir(), '.mint', 'memory.sqlite');
          const projPath = join(process.cwd(), '.mint', 'memory.sqlite');

          if (sub === 'status') {
            // PR8 — surface the runtime config knobs without leaving the TUI.
            const { config } = await import('../../utils/config.js');
            const enabled = config.getPath<boolean>('memory.extract.enabled') !== false;
            const kinds =
              config.getPath<string[]>('memory.extract.kinds') ?? [
                'preference',
                'fact',
                'episode',
              ];
            const k = config.getPath<number>('memory.retrieval.k') ?? 10;
            const halfLife = config.getPath<number>('memory.retrieval.halfLifeDays') ?? 14;
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content: [
                  'Memory config:',
                  `  extract.enabled: ${enabled}`,
                  `  extract.kinds:   ${kinds.join(', ')}`,
                  `  retrieval.k:     ${k}`,
                  `  retrieval.halfLifeDays: ${halfLife}`,
                  '',
                  'Change with `mint config:set memory.extract.enabled false` etc.',
                ].join('\n'),
              },
            ]);
            setInput('');
            return true;
          }

          if (sub === 'list' || sub === 'diff') {
            const kindFilter = sub === 'list' && rest[0] ? [rest[0]] : null;
            const sinceMs = sub === 'diff' ? Date.now() - 7 * 24 * 60 * 60 * 1000 : 0;

            const userStore = openUserMemoryStore();
            const projStore = openMemoryStore(process.cwd());
            const userRows = await userStore.query({ k: 100 });
            const projRows = await projStore.query({ k: 100 });
            userStore.close();
            projStore.close();

            const fmt = (rows: typeof userRows): string => {
              const groups = new Map<string, typeof userRows>();
              for (const r of rows) {
                if (sub === 'diff' && r.lastSeen <= sinceMs) continue;
                if (kindFilter && !kindFilter.includes(r.kind)) continue;
                const k = `${r.kind}s`;
                if (!groups.has(k)) groups.set(k, []);
                groups.get(k)!.push(r);
              }
              const order = ['preferences', 'facts', 'decisions', 'episodes', 'open_questions'];
              const lines: string[] = [];
              for (const g of order) {
                if (kindFilter && !kindFilter.map((k) => `${k}s`).includes(g)) continue;
                const items = groups.get(g) ?? [];
                lines.push(`  ${g}:`);
                if (items.length === 0) {
                  lines.push(sub === 'diff' ? '    (none in last 7 days)' : '    (none)');
                  continue;
                }
                const capped = items.slice(0, 10);
                for (const r of capped) {
                  lines.push(
                    `    ${r.id}. [conf ${r.confidence.toFixed(1)}] ${r.text}`,
                  );
                }
                if (items.length > capped.length) {
                  lines.push(`    and ${items.length - capped.length} more`);
                }
              }
              return lines.join('\n');
            };

            const header = sub === 'diff' ? 'Memories added or updated in the last 7 days:' : '';
            const body = [
              ...(header ? [header, ''] : []),
              `User memories (${userPath}):`,
              fmt(userRows),
              '',
              `Project memories (${projPath}):`,
              fmt(projRows),
            ].join('\n');

            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'assistant', content: body },
            ]);
            setInput('');
            return true;
          }

          if (sub === 'clear') {
            const confirm = rest.includes('--confirm');
            const userStore = openUserMemoryStore();
            const projStore = openMemoryStore(process.cwd());
            const userCount = userStore.count();
            const projCount = projStore.count();
            if (!confirm) {
              userStore.close();
              projStore.close();
              setMessages((prev) => [
                ...prev,
                {
                  id: nextId(),
                  role: 'assistant',
                  content: `This would delete ${userCount} user memories and ${projCount} project memories. Re-run with /memory clear --confirm to proceed.`,
                  kind: 'warn',
                },
              ]);
              setInput('');
              return true;
            }
            const removedUser = userStore.clearAll();
            const removedProj = projStore.clearAll();
            userStore.close();
            projStore.close();
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content: `Cleared ${removedUser} user + ${removedProj} project memories.`,
              },
            ]);
            setInput('');
            return true;
          }

          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              content:
                'Usage: /memory list [kind] | /memory diff | /memory status | /memory clear [--confirm]',
              kind: 'warn',
            },
          ]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `Memory error: ${msg}`, kind: 'error' },
          ]);
        }
        setInput('');
        return true;
      }

      // /usage — show quota + session cost
      if (trimmed === '/usage') {
        const used = quotaUsed ?? 0;
        const limit = quotaLimit ?? 50;
        const remaining = Math.max(0, limit - used);
        const cost = sessionCost.toFixed(4);
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
        return true;
      }

      return false;
    },
    [
      setMessages,
      setMode,
      setModelPreference,
      setInput,
      setQueue,
      reset,
      fetchQuota,
      formatEventLine,
      resetBudgetWarn,
      clearCostBanner,
      nextId,
      modelPreference,
      recentEvents,
      quotaUsed,
      quotaLimit,
      sessionCost,
      queue,
    ],
  );

  return { handleSlashCommand };
}
