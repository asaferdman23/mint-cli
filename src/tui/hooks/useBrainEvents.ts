/**
 * Thin TUI adapter for the brain AgentEvent stream.
 *
 * Does NOT rewrite any existing components — translates the new typed events
 * into the existing PipelinePhaseData / TrackedFile / PanelState shapes so
 * MessageList, LiveTaskInspector, StatusBar render without modification.
 *
 * App.tsx drives this hook when MINT_BRAIN=1 is set; the legacy path stays on
 * useAgentEvents() from the pipeline.
 */
import { useCallback, useRef, useState } from 'react';
import type { AgentEvent, PhaseName as BrainPhaseName } from '../../brain/index.js';
import type { PipelinePhaseData, PhaseName, SubtaskData } from '../types.js';

// ─── Panel state types (moved inline from the deleted useAgentEvents hook) ──

export type FileStatus = 'READ' | 'EDIT' | 'NEW' | 'BASH';

export interface TrackedFile {
  path: string;
  status: FileStatus;
  timestamp: number;
}

export interface ToolCall {
  name: string;
  count: number;
}

export interface PanelState {
  files: TrackedFile[];
  toolCalls: ToolCall[];
  totalCost: number;
  totalTokens: number;
  iterationCount: number;
  /** Cumulative cache-read input tokens (Anthropic prompt-cache hits). */
  cacheReadTokens: number;
  /** Cumulative cache-creation input tokens (first-write cache cost). */
  cacheCreationTokens: number;
  /** Cumulative input tokens that bypassed the cache (fresh reads). */
  uncachedInputTokens: number;
  /** Cache hit ratio in [0,1] — cacheRead / (cacheRead + cacheCreation + uncachedInput).
   *  Undefined while no cache-aware turns have run yet. */
  cacheHitRatio?: number;
}

// Brain's "scout|plan|build|review" → the legacy Pipeline's "SCOUT|ARCHITECT|BUILDER|REVIEWER"
// We keep the existing vocabulary so the renderer doesn't need new enums.
const BRAIN_PHASE_TO_PIPELINE: Record<BrainPhaseName, PhaseName> = {
  scout: 'SCOUT',
  plan: 'ARCHITECT',
  build: 'BUILDER',
  review: 'REVIEWER',
};

export interface RecentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  startedAt: number;
  /** Tool output — populated on tool.result. */
  output?: string;
  ok?: boolean;
  durationMs?: number;
}

export interface CurrentActivity {
  /** Human-readable summary of what the agent is doing right now. */
  label: string;
  /** Optional secondary detail (e.g. file path, command). */
  detail?: string;
  /** Last tool result to display under the activity (e.g. "\u2713 read 142 lines"). */
  lastResult?: { ok: boolean; text: string };
}

export interface NoticeMessage {
  id: string;
  kind: 'warn' | 'error';
  text: string;
}

export interface UseBrainEventsReturn {
  panelState: PanelState;
  pipelinePhases: PipelinePhaseData[];
  recentToolCalls: RecentToolCall[];
  streamingText: string;
  pendingApproval: PendingApproval | null;
  /** Last `diff.proposed` event — used to render a diff preview popup
   *  alongside `pendingApproval` when reason === 'diff'. */
  lastDiff: LastDiff | null;
  /** Rolling buffer of the most recent events (last 200), for /trace. */
  recentEvents: AgentEvent[];
  /** What the agent is doing right now (drives the live activity panel). */
  currentActivity: CurrentActivity | null;
  /** Synthetic warn/error notices emitted as their own rows. BrainApp drains
   *  these into the chat transcript so the assistant body stays clean. */
  notices: NoticeMessage[];
  consumeNotices: () => NoticeMessage[];
  resolveApproval: (ok: boolean) => void;
  apply: (event: AgentEvent) => void;
  reset: () => void;
}

export interface LastDiff {
  file: string;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: Array<{ type: 'context' | 'add' | 'remove'; content: string }>;
  }>;
}

export interface PendingApproval {
  reason: 'tool' | 'diff' | 'iteration' | 'spend_limit';
  payload: Record<string, unknown>;
  resolve: (ok: boolean) => void;
}

/**
 * React hook wrapping the brain's event stream into TUI-renderable state.
 * Call `apply(event)` for each event the async iterable yields.
 */
const RECENT_EVENT_CAP = 200;

export function useBrainEvents(): UseBrainEventsReturn {
  const [panelState, setPanelState] = useState<PanelState>(emptyPanel());
  const [pipelinePhases, setPipelinePhases] = useState<PipelinePhaseData[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [recentToolCalls, setRecentToolCalls] = useState<RecentToolCall[]>([]);
  const [lastDiff, setLastDiff] = useState<LastDiff | null>(null);
  const [recentEvents, setRecentEvents] = useState<AgentEvent[]>([]);
  const [currentActivity, setCurrentActivity] = useState<CurrentActivity | null>(null);
  const [notices, setNotices] = useState<NoticeMessage[]>([]);

  // Map tool.call.id → { name, timestamp } so we can pair results correctly
  // even when tools run in parallel.
  const pendingToolCalls = useRef<Map<string, { name: string; input: Record<string, unknown>; startedAt: number }>>(new Map());
  const noticeIdRef = useRef(0);

  const resolveApproval = useCallback((ok: boolean) => {
    setPendingApproval((cur) => {
      cur?.resolve(ok);
      return null;
    });
  }, []);

  const apply = useCallback((event: AgentEvent) => {
    setRecentEvents((prev) => {
      const next = prev.length >= RECENT_EVENT_CAP ? prev.slice(-RECENT_EVENT_CAP + 1) : prev;
      return [...next, event];
    });
    switch (event.type) {
      case 'session.start':
        setStreamingText('');
        pendingToolCalls.current.clear();
        setCurrentActivity({ label: 'Starting session\u2026' });
        break;

      case 'classify':
        setCurrentActivity({
          label: event.planModel
            ? `Planner ${event.planModel} → executor ${event.model}`
            : `Routed to ${event.model}`,
          detail: `${event.kind} \u00b7 ${event.complexity} \u00b7 confidence ${event.confidence.toFixed(2)}`,
        });
        setPipelinePhases((prev) => [
          ...prev,
          {
            name: 'SCOUT',
            status: 'done',
            model: event.model,
            summary: `${event.kind} · ${event.complexity} · ${event.confidence.toFixed(2)} (${event.source})`,
          },
        ]);
        break;

      case 'context.retrieved':
        setCurrentActivity({
          label: `Read ${event.files.length} file${event.files.length === 1 ? '' : 's'} for context`,
          detail: `${event.tokensUsed} / ${event.tokenBudget} context tokens`,
        });
        setPipelinePhases((prev) => [
          ...prev,
          {
            name: 'ARCHITECT',
            status: 'done',
            summary: `${event.files.length} files · ${event.tokensUsed}/${event.tokenBudget} ctx tokens`,
          },
        ]);
        break;

      case 'phase': {
        const pipelineName = BRAIN_PHASE_TO_PIPELINE[event.name];
        if (event.status === 'start') {
          setCurrentActivity((prev) => ({
            label: `${capitalize(event.name)}\u2026`,
            detail: prev?.detail,
          }));
          setPipelinePhases((prev) => [
            ...prev,
            { name: pipelineName, status: 'active' as const },
          ]);
        } else {
          setPipelinePhases((prev) =>
            prev.map((p) =>
              p.name === pipelineName && p.status === 'active'
                ? { ...p, status: 'done' as const, duration: event.durationMs }
                : p,
            ),
          );
        }
        break;
      }

      case 'text.delta':
        setStreamingText((prev) => prev + event.text);
        break;

      case 'tool.call': {
        pendingToolCalls.current.set(event.id, {
          name: event.name,
          input: event.input,
          startedAt: event.ts,
        });
        const activeTools = Array.from(pendingToolCalls.current.values());
        setCurrentActivity({
          label: summarizeActiveTools(activeTools),
        });
        setRecentToolCalls((prev) =>
          [
            ...prev,
            {
              id: event.id,
              name: event.name,
              input: event.input,
              startedAt: event.ts,
            },
          ].slice(-10), // keep last 10 for the inspector
        );
        setPanelState((prev) => ({
          ...prev,
          files: updateTrackedFiles(prev.files, event.name, event.input),
          toolCalls: bumpToolCall(prev.toolCalls, event.name),
          iterationCount: prev.iterationCount + 1,
        }));
        break;
      }

      case 'tool.result': {
        const pending = pendingToolCalls.current.get(event.id);
        pendingToolCalls.current.delete(event.id);
        const toolName = pending?.name ?? 'tool';
        const resultText = event.ok
          ? summarizeToolOutput(toolName, event.output)
          : `failed: ${truncateText(event.output ?? 'no output', 60)}`;
        setCurrentActivity((prev) => ({
          label: prev?.label ?? 'Thinking\u2026',
          detail: prev?.detail,
          lastResult: { ok: event.ok, text: `${toolName}: ${resultText}` },
        }));
        setRecentToolCalls((prev) =>
          prev.map((t) =>
            t.id === event.id
              ? { ...t, output: event.output, ok: event.ok, durationMs: event.durationMs }
              : t,
          ),
        );
        break;
      }

      case 'diff.applied':
        setPanelState((prev) => ({
          ...prev,
          files: markFileEdited(prev.files, event.file),
        }));
        // Clear the popup once the diff has been written.
        setLastDiff((cur) => (cur && cur.file === event.file ? null : cur));
        break;

      case 'diff.proposed':
        setLastDiff({ file: event.file, hunks: event.hunks });
        break;

      case 'cost.delta':
        setPanelState((prev) => {
          const cacheRead = event.cacheReadInputTokens ?? 0;
          const cacheCreation = event.cacheCreationInputTokens ?? 0;
          // event.inputTokens is the total billed input (including cached
          // tokens on Anthropic); subtract cache reads + writes to isolate
          // the cold/uncached portion. Floor at 0 for safety.
          const uncached = Math.max(0, event.inputTokens - cacheRead - cacheCreation);
          const nextCacheRead = prev.cacheReadTokens + cacheRead;
          const nextCacheCreation = prev.cacheCreationTokens + cacheCreation;
          const nextUncached = prev.uncachedInputTokens + uncached;
          const denom = nextCacheRead + nextCacheCreation + nextUncached;
          const ratio = denom > 0 ? nextCacheRead / denom : undefined;
          return {
            ...prev,
            totalCost: prev.totalCost + event.usd,
            totalTokens: prev.totalTokens + event.inputTokens + event.outputTokens,
            cacheReadTokens: nextCacheRead,
            cacheCreationTokens: nextCacheCreation,
            uncachedInputTokens: nextUncached,
            cacheHitRatio: ratio,
          };
        });
        break;

      case 'compact':
        // Render as a "done" architect-phase marker so it shows in the
        // pipeline timeline without needing a new phase type.
        setPipelinePhases((prev) => [
          ...prev,
          {
            name: 'ARCHITECT',
            status: 'done',
            summary: `compacted ${event.beforeTokens} → ${event.afterTokens} tokens`,
          },
        ]);
        break;

      case 'approval.needed':
        setPendingApproval({
          reason: event.reason,
          payload: event.payload,
          resolve: event.resolve,
        });
        break;

      case 'warn':
        setNotices((prev) => [
          ...prev,
          { id: `notice-${++noticeIdRef.current}`, kind: 'warn', text: event.message },
        ]);
        break;

      case 'error':
        setNotices((prev) => [
          ...prev,
          { id: `notice-${++noticeIdRef.current}`, kind: 'error', text: event.error },
        ]);
        break;

      case 'done':
        setCurrentActivity(null);
        // Clear per-turn streamingText so pre-`session.start` frames of the
        // next turn don't render stale partial text from the previous turn.
        setStreamingText('');
        // Final state is the accumulated panel + phases.
        // The caller gets the full result from the done event directly.
        break;

      default:
        /* unknown event — ignore */
        break;
    }
  }, []);

  const reset = useCallback(() => {
    setPanelState(emptyPanel());
    setPipelinePhases([]);
    setStreamingText('');
    setPendingApproval(null);
    setRecentToolCalls([]);
    setLastDiff(null);
    setRecentEvents([]);
    setCurrentActivity(null);
    setNotices([]);
    pendingToolCalls.current.clear();
  }, []);

  const consumeNotices = useCallback((): NoticeMessage[] => {
    let drained: NoticeMessage[] = [];
    setNotices((cur) => {
      drained = cur;
      return [];
    });
    return drained;
  }, []);

  return {
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
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function emptyPanel(): PanelState {
  return {
    files: [],
    toolCalls: [],
    totalCost: 0,
    totalTokens: 0,
    iterationCount: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    uncachedInputTokens: 0,
    cacheHitRatio: undefined,
  };
}

function inferFileStatus(toolName: string): FileStatus | null {
  switch (toolName) {
    case 'read_file':
      return 'READ';
    case 'write_file':
      return 'NEW';
    case 'edit_file':
    case 'search_replace':
      return 'EDIT';
    case 'bash':
    case 'run_command':
      return 'BASH';
    default:
      return null;
  }
}

function updateTrackedFiles(
  files: TrackedFile[],
  toolName: string,
  input: Record<string, unknown>,
): TrackedFile[] {
  const status = inferFileStatus(toolName);
  if (!status) return files;
  const path = String(input.path ?? input.file ?? input.command ?? '');
  if (!path) return files;

  const idx = files.findIndex((f) => f.path === path);
  if (idx >= 0) {
    const next = [...files];
    next[idx] = { path, status, timestamp: Date.now() };
    return next;
  }
  return [...files, { path, status, timestamp: Date.now() }];
}

function bumpToolCall(tools: ToolCall[], name: string): ToolCall[] {
  const idx = tools.findIndex((t) => t.name === name);
  if (idx >= 0) {
    const next = [...tools];
    next[idx] = { name, count: tools[idx].count + 1 };
    return next;
  }
  return [...tools, { name, count: 1 }];
}

function markFileEdited(files: TrackedFile[], path: string): TrackedFile[] {
  const idx = files.findIndex((f) => f.path === path);
  const entry: TrackedFile = { path, status: 'EDIT', timestamp: Date.now() };
  if (idx >= 0) {
    const next = [...files];
    next[idx] = entry;
    return next;
  }
  return [...files, entry];
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function truncateText(s: string, max: number): string {
  const cleaned = s.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + '\u2026' : cleaned;
}

/** Friendly verb for the live activity panel. */
function describeTool(name: string): string {
  const verbs: Record<string, string> = {
    read_file: 'Reading',
    write_file: 'Writing',
    edit_file: 'Editing',
    search_replace: 'Editing',
    bash: 'Running command',
    run_command: 'Running command',
    grep: 'Searching',
    glob: 'Listing files',
    list_dir: 'Listing files',
    git_diff: 'Reading git diff',
    web_fetch: 'Fetching',
    run_tests: 'Running tests',
  };
  if (verbs[name]) return verbs[name];
  // Unknown tool — humanize "foo_bar" to "Using foo bar" instead of "Calling foo_bar".
  const human = name.split(/[_\-.]+/).filter(Boolean).join(' ').toLowerCase();
  return `Using ${human}`;
}

function summarizeActiveTools(calls: Array<{ name: string; input: Record<string, unknown> }>): string {
  if (calls.length === 0) return 'Thinking...';

  const buckets = new Map<string, { verb: string; noun: string; count: number }>();
  for (const call of calls) {
    const bucket = classifyToolActivity(call.name, call.input);
    const key = `${bucket.verb}:${bucket.noun}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { ...bucket, count: 1 });
    }
  }

  const phrases = Array.from(buckets.values()).map((bucket, index) => {
    const verb = index === 0 ? capitalize(bucket.verb) : bucket.verb;
    const noun = bucket.count === 1 ? bucket.noun : pluralize(bucket.noun);
    return `${verb} ${bucket.count} ${noun}`;
  });
  return `${phrases.join(', ')}...`;
}

function classifyToolActivity(name: string, input: Record<string, unknown>): { verb: string; noun: string } {
  if (name === 'read_file') return { verb: 'reading', noun: 'file' };
  if (name === 'write_file') return { verb: 'writing', noun: 'file' };
  if (name === 'edit_file' || name === 'search_replace') return { verb: 'editing', noun: 'file' };
  if (name === 'list_dir' || name === 'glob') return { verb: 'listing', noun: 'directory' };
  if (name === 'grep') return { verb: 'searching', noun: 'pattern' };
  if (name === 'run_tests') return { verb: 'running', noun: 'test' };
  if (name === 'git_diff') return { verb: 'reading', noun: 'diff' };
  if (name === 'web_fetch') return { verb: 'fetching', noun: 'page' };

  if (name === 'bash' || name === 'run_command') {
    const command = String(input.command ?? '').trim().toLowerCase();
    if (/^(cat|sed|head|tail|nl)\b/.test(command)) return { verb: 'reading', noun: 'file' };
    if (/^(ls|find|rg --files)\b/.test(command)) return { verb: 'listing', noun: 'directory' };
    if (/\b(test|vitest|jest|mocha|playwright)\b/.test(command)) return { verb: 'running', noun: 'test' };
    if (/^git\s+(diff|show|status|log)\b/.test(command)) return { verb: 'reading', noun: 'git state' };
    return { verb: 'running', noun: 'command' };
  }

  return { verb: describeTool(name).replace(/\u2026$/, '').toLowerCase(), noun: 'tool' };
}

function pluralize(noun: string): string {
  if (noun === 'directory') return 'directories';
  if (noun === 'git state') return 'git states';
  return `${noun}s`;
}

function summarizeToolInput(input: Record<string, unknown>): string {
  const target = input.path ?? input.file ?? input.command ?? input.pattern ?? input.query ?? input.url;
  if (typeof target === 'string') return truncateText(target, 80);
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  return truncateText(JSON.stringify(input), 80);
}

function summarizeToolOutput(toolName: string, output?: string): string {
  if (!output) return 'done';
  if (toolName === 'read_file') {
    const lines = output.split('\n').length;
    return `read ${lines} line${lines === 1 ? '' : 's'}`;
  }
  if (toolName === 'grep' || toolName === 'glob') {
    const matches = output.split('\n').filter((l) => l.trim()).length;
    return `${matches} match${matches === 1 ? '' : 'es'}`;
  }
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'search_replace') {
    return 'wrote file';
  }
  return truncateText(output, 60);
}
