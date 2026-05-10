/**
 * `mint trace` — reliability/observability UI for the agent trace stream.
 *
 * Three modes:
 *   mint trace               → list recent sessions (newest first)
 *   mint trace <sessionId>   → replay one session as a readable transcript
 *   mint trace --tail        → follow the most recent live session
 *
 * Every brain session writes JSONL to ~/.mint/traces/<sessionId>.jsonl. This
 * command reads those files and renders them — no network, no DB dependency.
 */
import { readdirSync, readFileSync, statSync, existsSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import type { AgentEvent } from '../../brain/index.js';

interface SessionSummary {
  id: string;
  path: string;
  mtime: number;
  task: string;
  mode: string;
  model?: string;
  kind?: string;
  complexity?: string;
  toolCalls: number;
  costUsd: number;
  durationMs: number;
  success: boolean | null;
  endedAt: number | null;
}

// ─── List ───────────────────────────────────────────────────────────────────

export function runTraceList(limit = 20): void {
  const dir = traceDir();
  if (!existsSync(dir)) {
    console.log(chalk.dim('  No traces yet. Run `mint "…"` to create one.'));
    return;
  }

  const summaries = loadAllSummaries(dir).slice(0, limit);
  if (summaries.length === 0) {
    console.log(chalk.dim('  No traces yet.'));
    return;
  }

  console.log('');
  console.log(chalk.cyan(`  Last ${summaries.length} session${summaries.length === 1 ? '' : 's'}`));
  console.log('');

  for (const s of summaries) {
    const when = formatRelative(s.mtime);
    const cost = s.costUsd === 0 ? chalk.dim('-') : chalk.dim(formatCost(s.costUsd));
    const dur = s.durationMs > 0 ? chalk.dim(formatDuration(s.durationMs)) : chalk.dim('·');
    const tag = statusTag(s);
    const model = s.model ? chalk.dim(s.model) : chalk.dim('?');
    const task = truncate(s.task || '(empty)', 60);

    console.log(`  ${tag}  ${chalk.bold(s.id)}  ${chalk.dim(when)}`);
    console.log(`      ${task}`);
    console.log(`      ${model}  ${dur}  ${cost}  ${chalk.dim(`${s.toolCalls} tools`)}`);
    console.log('');
  }

  console.log(chalk.dim(`  Replay one:   mint trace <sessionId>`));
  console.log(chalk.dim(`  Tail live:    mint trace --tail`));
  console.log('');
}

// ─── Replay ─────────────────────────────────────────────────────────────────

export function runTraceReplay(sessionIdPrefix: string): void {
  const dir = traceDir();
  const match = findSession(dir, sessionIdPrefix);
  if (!match) {
    console.error(chalk.red(`  No trace found for '${sessionIdPrefix}'`));
    console.error(chalk.dim(`  Try: mint trace (to list)`));
    process.exit(1);
  }

  const events = readEvents(match);
  console.log('');
  console.log(chalk.cyan(`  Session ${chalk.bold(basename(match))}`));
  console.log('');
  for (const event of events) printEvent(event);
  console.log('');
}

// ─── Tail ───────────────────────────────────────────────────────────────────

export async function runTraceTail(signal?: AbortSignal): Promise<void> {
  const dir = traceDir();
  if (!existsSync(dir)) {
    console.error(chalk.red('  No traces yet. Start a session to tail.'));
    process.exit(1);
  }

  const initial = loadAllSummaries(dir);
  if (initial.length === 0) {
    console.error(chalk.red('  No traces yet. Start a session to tail.'));
    process.exit(1);
  }

  const target = initial[0];
  console.log(chalk.cyan(`  Tailing ${chalk.bold(target.id)} — Ctrl+C to exit\n`));

  let offset = 0;
  const flush = () => {
    try {
      const content = readFileSync(target.path, 'utf-8');
      const lines = content.slice(offset).split('\n');
      offset = content.length;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as AgentEvent;
          printEvent(event);
        } catch {
          /* skip malformed lines */
        }
      }
    } catch {
      /* file may be rotated or deleted */
    }
  };

  flush();
  const watcher = watch(target.path, { persistent: true }, () => flush());
  await new Promise<void>((resolve) => {
    signal?.addEventListener('abort', () => resolve(), { once: true });
    process.on('SIGINT', () => resolve());
  });
  watcher.close();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function traceDir(): string {
  return join(homedir(), '.mint', 'traces');
}

function loadAllSummaries(dir: string): SessionSummary[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const summaries: SessionSummary[] = [];
  for (const name of files) {
    const path = join(dir, name);
    try {
      const stat = statSync(path);
      summaries.push(summarize(path, stat.mtimeMs));
    } catch {
      /* skip */
    }
  }
  summaries.sort((a, b) => b.mtime - a.mtime);
  return summaries;
}

function readEvents(path: string): AgentEvent[] {
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as AgentEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is AgentEvent => e !== null);
  } catch {
    return [];
  }
}

function summarize(path: string, mtime: number): SessionSummary {
  const events = readEvents(path);
  const id = basename(path);
  let task = '';
  let mode = 'diff';
  let model: string | undefined;
  let kind: string | undefined;
  let complexity: string | undefined;
  let toolCalls = 0;
  let costUsd = 0;
  let durationMs = 0;
  let success: boolean | null = null;
  let endedAt: number | null = null;

  for (const event of events) {
    if (event.type === 'session.start') {
      task = event.task;
      mode = event.mode;
    } else if (event.type === 'classify') {
      model = event.model;
      kind = event.kind;
      complexity = event.complexity;
    } else if (event.type === 'tool.call') {
      toolCalls += 1;
    } else if (event.type === 'cost.delta') {
      costUsd += event.usd;
    } else if (event.type === 'done') {
      success = event.result.success;
      durationMs = event.result.durationMs;
      endedAt = event.ts;
      if (!model) model = event.result.model;
    } else if (event.type === 'error') {
      success = false;
      endedAt = event.ts;
    }
  }

  return {
    id,
    path,
    mtime,
    task,
    mode,
    model,
    kind,
    complexity,
    toolCalls,
    costUsd,
    durationMs,
    success,
    endedAt,
  };
}

function findSession(dir: string, prefix: string): string | null {
  if (!existsSync(dir)) return null;
  const match = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith('.jsonl'));
  return match ? join(dir, match) : null;
}

function basename(path: string): string {
  return path.replace(/.*[\\/]/, '').replace(/\.jsonl$/, '');
}

function statusTag(s: SessionSummary): string {
  if (s.success === true) return chalk.green('✓');
  if (s.success === false) return chalk.red('✗');
  return chalk.yellow('…');
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  const s = Math.round(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `${(usd * 100).toFixed(3)}¢`;
  return `$${usd.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// ─── Event renderer ─────────────────────────────────────────────────────────

function printEvent(event: AgentEvent): void {
  const time = new Date(event.ts).toISOString().slice(11, 19);
  const prefix = chalk.dim(`  ${time}`);

  switch (event.type) {
    case 'session.start':
      console.log(`${prefix}  ${chalk.cyan('●')} session ${chalk.bold(event.sessionId)}`);
      console.log(`${prefix}         mode=${event.mode}  cwd=${chalk.dim(event.cwd)}`);
      console.log(`${prefix}         ${chalk.bold(truncate(event.task, 100))}`);
      break;
    case 'classify':
      console.log(
        `${prefix}  ${chalk.magenta('◆')} classify ${chalk.bold(event.kind)}/${event.complexity}` +
          chalk.dim(`  model=${event.model} conf=${event.confidence.toFixed(2)} (${event.source})`),
      );
      if (event.reasoning) console.log(`${prefix}         ${chalk.dim(event.reasoning)}`);
      break;
    case 'context.retrieved':
      console.log(
        `${prefix}  ${chalk.blue('▤')} context ${event.files.length} files` +
          chalk.dim(`  ${event.tokensUsed}/${event.tokenBudget} tokens`) +
          (event.outcomesMatched.length > 0 ? chalk.dim(`  ${event.outcomesMatched.length} prior outcomes`) : ''),
      );
      for (const f of event.files.slice(0, 8)) {
        console.log(`${prefix}         ${chalk.dim('-')} ${f.path}`);
      }
      break;
    case 'phase':
      {
        const stepLabel = event.name === 'build' && event.stepId ? ` step ${event.stepId}` : '';
        const indent = event.name === 'build' && event.stepId ? '   ' : '';
        console.log(
          `${prefix}  ${indent}${chalk.yellow('§')} phase ${event.name}${stepLabel} ${chalk.dim(event.status)}` +
            (event.durationMs != null ? chalk.dim(`  ${formatDuration(event.durationMs)}`) : ''),
        );
      }
      break;
    case 'tool.call':
      console.log(
        `${prefix}  ${chalk.cyan('→')} tool ${chalk.bold(event.name)}` +
          chalk.dim(`  iter=${event.iteration} id=${event.id.slice(0, 10)}`),
      );
      {
        const preview = truncate(JSON.stringify(event.input), 120);
        console.log(`${prefix}         ${chalk.dim(preview)}`);
      }
      break;
    case 'tool.result': {
      const mark = event.ok ? chalk.green('←') : chalk.red('←');
      console.log(
        `${prefix}  ${mark} result ${event.ok ? chalk.green('ok') : chalk.red('err')}` +
          chalk.dim(`  ${formatDuration(event.durationMs)}  ${event.tokens} tokens`),
      );
      const preview = truncate(event.output.replace(/\s+/g, ' '), 140);
      console.log(`${prefix}         ${chalk.dim(preview)}`);
      break;
    }
    case 'diff.proposed':
      console.log(
        `${prefix}  ${chalk.yellow('~')} diff ${chalk.bold(event.file)} ${chalk.dim(`${event.hunks.length} hunks`)}`,
      );
      break;
    case 'diff.applied':
      console.log(
        `${prefix}  ${chalk.green('+')} applied ${chalk.bold(event.file)}` +
          chalk.dim(`  +${event.additions} -${event.deletions}`),
      );
      break;
    case 'approval.needed':
      console.log(
        `${prefix}  ${chalk.yellow('?')} approval ${chalk.bold(event.reason)}`,
      );
      break;
    case 'compact':
      console.log(
        `${prefix}  ${chalk.gray('⇢')} compact ${chalk.dim(`${event.beforeTokens} → ${event.afterTokens}`)}`,
      );
      break;
    case 'cost.delta':
      console.log(
        `${prefix}  ${chalk.dim('$')} cost ${chalk.dim(formatCost(event.usd))}` +
          chalk.dim(`  ${event.inputTokens}+${event.outputTokens} tokens  ${event.model}`),
      );
      break;
    case 'text.delta':
      // Skip streaming text — too noisy in the transcript view.
      break;
    case 'warn':
      console.log(`${prefix}  ${chalk.yellow('!')} warn ${event.message}`);
      break;
    case 'error':
      console.log(
        `${prefix}  ${chalk.red('✗')} error ${event.error}` +
          (event.recoverable ? chalk.dim('  (recoverable)') : ''),
      );
      break;
    case 'done':
      console.log(
        `${prefix}  ${event.result.success ? chalk.green('●') : chalk.red('●')} done` +
          chalk.dim(
            `  ${formatDuration(event.result.durationMs)}  ` +
              `${formatCost(event.result.totalCostUsd)}  ` +
              `${event.result.toolCalls} tools  ` +
              `${event.result.filesTouched.length} files`,
          ),
      );
      break;
    default:
      /* unknown event type — ignore */
      break;
  }
}
