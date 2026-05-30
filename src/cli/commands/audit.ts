/**
 * `mint audit` — measure how well prompt caching + context engineering are
 * actually working across recent traces.
 *
 * The "frontier-by-default, engineered cheap" thesis only holds if:
 *   - the cache is hitting (cacheRead tokens dominate input tokens after turn 1)
 *   - per-turn input tokens stay tight (precise retrieval, no whole-repo dumps)
 *
 * This command reads ~/.mint/traces/*.jsonl and surfaces those numbers per
 * model, so the claim is backed by data not vibes.
 *
 *   mint audit              → aggregate across all recent sessions
 *   mint audit --limit=50   → over the last N sessions
 *   mint audit <sessionId>  → one session's per-turn breakdown
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import type { AgentEvent } from '../../brain/index.js';

interface TurnMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

interface ModelStats {
  model: string;
  turns: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
}

function traceDir(): string {
  return join(homedir(), '.mint', 'traces');
}

function listTraces(dir: string, limit: number): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((e) => e.path);
}

function readTurns(path: string): TurnMetrics[] {
  const turns: TurnMetrics[] = [];
  try {
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let event: AgentEvent;
      try {
        event = JSON.parse(line) as AgentEvent;
      } catch {
        continue;
      }
      if (event.type !== 'cost.delta') continue;
      turns.push({
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadInputTokens ?? 0,
        cacheCreationTokens: event.cacheCreationInputTokens ?? 0,
        costUsd: event.usd,
      });
    }
  } catch {
    /* skip unreadable traces */
  }
  return turns;
}

function aggregate(turns: TurnMetrics[]): Map<string, ModelStats> {
  const byModel = new Map<string, ModelStats>();
  for (const t of turns) {
    const cur = byModel.get(t.model) ?? {
      model: t.model,
      turns: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
    };
    cur.turns += 1;
    cur.totalInput += t.inputTokens;
    cur.totalOutput += t.outputTokens;
    cur.totalCacheRead += t.cacheReadTokens;
    cur.totalCacheWrite += t.cacheCreationTokens;
    cur.totalCost += t.costUsd;
    byModel.set(t.model, cur);
  }
  return byModel;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function pct(n: number, d: number): string {
  if (d === 0) return '—';
  return `${((n / d) * 100).toFixed(0)}%`;
}

/** Render the per-model summary table. */
function renderSummary(stats: Map<string, ModelStats>, sessions: number): void {
  console.log('');
  console.log(chalk.cyan(`  mint audit — ${sessions} session${sessions === 1 ? '' : 's'}`));
  console.log('');
  console.log(
    chalk.dim(
      '  model                 turns   in/turn   cache hit   cache savings   total cost',
    ),
  );
  console.log(chalk.dim('  ' + '─'.repeat(82)));

  const rows = [...stats.values()].sort((a, b) => b.turns - a.turns);
  let grandCost = 0;
  let grandSavings = 0;
  for (const s of rows) {
    const inPerTurn = Math.round(s.totalInput / Math.max(1, s.turns));
    // Anthropic-style: cacheRead billed at ~10% of fresh input → 90% saving on
    // every cached token vs sending it fresh again. This is an estimate; only
    // meaningful for providers that actually cache (Anthropic today).
    const billableInput = s.totalInput + s.totalCacheRead + s.totalCacheWrite;
    const cacheHit = pct(s.totalCacheRead, billableInput);
    // Hypothetical cost if cacheRead tokens had been billed as fresh input.
    // Uses a 0.9× saving estimate per cached token — accurate for Anthropic
    // (cache read is 10% of fresh), conservative for any future cache models.
    // We don't have per-row pricing here, so we approximate via the realized
    // cost share: savings ≈ totalCacheRead / billableInput × totalCost × 9.
    const savings = billableInput > 0
      ? (s.totalCacheRead / billableInput) * s.totalCost * 9
      : 0;
    grandCost += s.totalCost;
    grandSavings += savings;
    console.log(
      `  ${s.model.padEnd(20)}  ${String(s.turns).padStart(5)}   ${fmtTokens(inPerTurn).padStart(7)}   ${cacheHit.padStart(9)}   ${fmtCost(savings).padStart(13)}   ${fmtCost(s.totalCost).padStart(10)}`,
    );
  }

  console.log(chalk.dim('  ' + '─'.repeat(82)));
  console.log(
    `  ${'TOTAL'.padEnd(20)}  ${''.padStart(5)}   ${''.padStart(7)}   ${''.padStart(9)}   ${fmtCost(grandSavings).padStart(13)}   ${fmtCost(grandCost).padStart(10)}`,
  );

  console.log('');
  console.log(chalk.dim('  Read this:'));
  console.log(
    chalk.dim(
      '  • cache hit % rising over time = caching is working (Anthropic only today).',
    ),
  );
  console.log(
    chalk.dim(
      '  • in/turn ballooning above ~10k = retrieval is over-fetching; tighten the context.',
    ),
  );
  console.log(
    chalk.dim(
      '  • cache savings ≈ what you would have spent re-sending cached tokens uncached.',
    ),
  );
  console.log('');
}

function renderSession(path: string, sessionId: string): void {
  const turns = readTurns(path);
  if (turns.length === 0) {
    console.log(chalk.yellow(`  No cost.delta events in trace ${sessionId}`));
    return;
  }
  console.log('');
  console.log(chalk.cyan(`  mint audit — session ${chalk.bold(sessionId)}`));
  console.log('');
  console.log(
    chalk.dim(
      '  turn   model                 input    output    cacheRead   cacheWrite   cost',
    ),
  );
  console.log(chalk.dim('  ' + '─'.repeat(80)));
  turns.forEach((t, i) => {
    console.log(
      `  ${String(i + 1).padStart(4)}   ${t.model.padEnd(20)}  ${fmtTokens(t.inputTokens).padStart(6)}   ${fmtTokens(t.outputTokens).padStart(6)}   ${fmtTokens(t.cacheReadTokens).padStart(9)}   ${fmtTokens(t.cacheCreationTokens).padStart(10)}   ${fmtCost(t.costUsd).padStart(8)}`,
    );
  });
  console.log('');
}

export function runAudit(opts: { limit?: number; session?: string } = {}): void {
  const dir = traceDir();
  if (!existsSync(dir)) {
    console.log(chalk.dim('  No traces yet. Run a few `mint "…"` tasks first.'));
    return;
  }

  if (opts.session) {
    const all = listTraces(dir, 1000);
    const match = all.find((p) => p.endsWith(`/${opts.session}.jsonl`)) ??
      all.find((p) => p.includes(opts.session!));
    if (!match) {
      console.error(chalk.red(`  No trace matching '${opts.session}'`));
      process.exit(1);
    }
    const sessionId = match.split('/').pop()!.replace(/\.jsonl$/, '');
    renderSession(match, sessionId);
    return;
  }

  const limit = opts.limit ?? 50;
  const paths = listTraces(dir, limit);
  if (paths.length === 0) {
    console.log(chalk.dim('  No traces yet.'));
    return;
  }
  const allTurns: TurnMetrics[] = [];
  for (const p of paths) allTurns.push(...readTurns(p));
  const stats = aggregate(allTurns);
  renderSummary(stats, paths.length);
}
