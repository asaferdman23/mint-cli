/**
 * BrainToolInspector — Claude-style trace panel for brain sessions.
 *
 * Shows one human trace sentence. Plan drafts expand into multiple steps.
 */
import React from 'react';
import { Box, Text } from 'ink';
import type { AgentEvent } from '../../brain/index.js';
import type { CurrentActivity, PanelState, RecentToolCall } from '../hooks/useBrainEvents.js';

interface BrainToolInspectorProps {
  calls: RecentToolCall[];
  currentActivity: CurrentActivity | null;
  events: AgentEvent[];
  panelState: PanelState;
  maxHeight: number;
}

export function BrainToolInspector({
  calls,
  currentActivity,
  events,
  panelState,
  maxHeight,
}: BrainToolInspectorProps): React.ReactElement | null {
  if (events.length === 0 || maxHeight <= 3) return null;

  const route = latest(events, 'classify');
  const context = latest(events, 'context.retrieved');
  const plan = latest(events, 'plan.draft');
  const warning = latestWarning(events);
  const runningCalls = calls.filter((call) => call.ok == null);
  const traceSentence = buildTraceSentence({
    route,
    context,
    plan,
    warning,
    runningCalls,
    lastCall: calls[calls.length - 1],
    currentActivity,
    panelState,
    events,
  });
  const planRows = plan?.steps.slice(0, Math.max(0, maxHeight - 4)) ?? [];

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="cyan" height={maxHeight}>
      <Box>
        <Text bold color="cyan">
          Trace
        </Text>
        <Text dimColor>{'  '}(Ctrl+O to close)</Text>
      </Box>

      <Text wrap="wrap">
        <Text color={warning?.type === 'error' ? 'red' : warning ? 'yellow' : 'cyan'}>› </Text>
        {traceSentence}
      </Text>

      {planRows.length > 0 && (
        <Box flexDirection="column">
          {planRows.map((step, index) => (
            <Text key={step.id} dimColor={index < planRows.length - 1} wrap="truncate-end">
              {index === planRows.length - 1 ? '› ' : '  '}
              {step.id}. {step.description}
              {step.filesHint?.length ? <Text dimColor>{` (${step.filesHint.join(', ')})`}</Text> : null}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

type EventOfType<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;
type WarningEvent = Extract<AgentEvent, { type: 'warn' | 'error' }>;

function latest<T extends AgentEvent['type']>(events: AgentEvent[], type: T): EventOfType<T> | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) return events[i] as EventOfType<T>;
  }
  return undefined;
}

function latestWarning(events: AgentEvent[]): WarningEvent | undefined {
  // Errors are surfaced as a red <ErrorToast> above the input — we don't
  // also echo them into the trace sentence (avoids duplicate red signal
  // and a noisy trace panel). Warnings still flow through here.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'warn') return event;
  }
  return undefined;
}

interface TraceSentenceInput {
  route?: EventOfType<'classify'>;
  context?: EventOfType<'context.retrieved'>;
  plan?: EventOfType<'plan.draft'>;
  warning?: WarningEvent;
  runningCalls: RecentToolCall[];
  lastCall?: RecentToolCall;
  currentActivity: CurrentActivity | null;
  panelState: PanelState;
  events: AgentEvent[];
}

function buildTraceSentence(input: TraceSentenceInput): string {
  const { route, context, plan, warning, runningCalls, lastCall, currentActivity, panelState, events } = input;

  if (warning) {
    return warning.type === 'error'
      ? `Stopped on error: ${truncate(warning.error, 120)}.`
      : `Warning: ${truncate(warning.message, 120)}.`;
  }

  if (runningCalls.length > 0) {
    return summarizeToolActivity(runningCalls);
  }

  if (lastCall?.ok != null) {
    return `${friendlyToolName(lastCall.name)} ${lastCall.ok ? 'finished' : 'failed'}${formatInputPhrase(lastCall.input)}${lastCall.durationMs != null ? ` in ${formatDuration(lastCall.durationMs)}` : ''}.`;
  }

  if (plan) {
    const planner = route?.planModel ?? route?.model ?? 'the planner';
    const executor = route?.model ? ` before ${route.model} executes` : '';
    return `${planner} drafted ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}${executor}.`;
  }

  const activePhase = latest(events, 'phase');
  if (context) {
    const model = route?.planModel
      ? `${route.planModel} is planning for ${route.model}`
      : route?.model
      ? `${route.model} is working`
      : 'Mint is working';
    return `${model} with ${context.files.length} context file${context.files.length === 1 ? '' : 's'}; ${formatTokens(panelState.totalTokens)} tokens and $${panelState.totalCost.toFixed(4)} so far.`;
  }

  if (route) {
    return route.planModel
      ? `Routing chose ${route.planModel} to plan and ${route.model} to execute.`
      : `Routing chose ${route.model} for this ${route.kind} task.`;
  }

  if (activePhase) {
    return `${activePhase.name} is ${activePhase.status === 'start' ? 'running' : 'done'}.`;
  }

  return `${currentActivity?.label ?? 'Mint is starting'}.`;
}

function summarizeInput(input: Record<string, unknown>): string {
  const path = input.path ?? input.file ?? input.command ?? input.query ?? input.pattern;
  if (typeof path === 'string') return truncate(path, 50);
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  return truncate(JSON.stringify(input), 50);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function friendlyToolName(name: string): string {
  const labels: Record<string, string> = {
    read_file: 'Read',
    write_file: 'Write',
    edit_file: 'Edit',
    search_replace: 'Edit',
    bash: 'Shell',
    run_command: 'Shell',
    grep: 'Search',
    glob: 'Find',
    list_dir: 'List',
    git_diff: 'Diff',
    web_fetch: 'Fetch',
    run_tests: 'Test',
  };
  if (labels[name]) return labels[name];
  // Unknown tool: humanize snake_case → Title Case ("mint_search" → "Mint search").
  return humanizeToolName(name);
}

/** Snake/kebab-case tool id → human-readable title-case label. */
function humanizeToolName(name: string): string {
  const parts = name.split(/[_\-.]+/).filter(Boolean);
  if (parts.length === 0) return name;
  const [first, ...rest] = parts;
  return [first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(), ...rest.map((p) => p.toLowerCase())].join(' ');
}

function summarizeToolActivity(calls: RecentToolCall[]): string {
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

  return { verb: friendlyToolName(name).toLowerCase(), noun: 'tool' };
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function pluralize(noun: string): string {
  if (noun === 'directory') return 'directories';
  if (noun === 'git state') return 'git states';
  return `${noun}s`;
}

function formatInputPhrase(input: Record<string, unknown>): string {
  const summary = summarizeInput(input);
  return summary ? ` on ${summary}` : '';
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
