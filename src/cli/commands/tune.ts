/**
 * `mint tune` — analyze recent outcomes and propose routing changes.
 *
 * Reads `<cwd>/.mint/outcomes.sqlite`, computes per-(kind, model) success rates
 * + average cost, and surfaces:
 *   - Routes where an alternative model has materially better success rate
 *     with enough samples to be statistically meaningful.
 *   - (Future) Refit classifier weights via least-squares against recorded
 *     classifierFeatures vs. observed success.
 *
 * Defaults to dry-run. `--apply` writes proposed changes to `.mint/routing.json`.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import chalk from 'chalk';
import { openOutcomesStore, type OutcomeRow } from '../../brain/memory/outcomes.js';

interface TuneOptions {
  apply?: boolean;
  minSamples?: number;
  limit?: number;
}

interface RouteStat {
  kind: string;
  model: string;
  count: number;
  successRate: number;
  avgCostUsd: number;
  avgIterations: number;
}

interface RouteSwap {
  kind: string;
  from: string;
  to: string;
  fromStat: RouteStat;
  toStat: RouteStat;
  liftPct: number;
}

const SUCCESS_LIFT_THRESHOLD = 0.10; // 10 percentage points

export async function runTune(opts: TuneOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const minSamples = opts.minSamples ?? 30;
  const limit = opts.limit ?? 200;

  if (!existsSync(join(cwd, '.mint', 'outcomes.sqlite'))) {
    console.error(chalk.red('  No outcomes.sqlite found.'));
    console.error(chalk.dim(`  Expected: ${join(cwd, '.mint', 'outcomes.sqlite')}`));
    console.error(chalk.dim('  Run a few brain sessions first, then `mint tune`.'));
    process.exit(1);
  }

  const store = openOutcomesStore(cwd);
  const rows = store.recent(limit);
  store.close();

  if (rows.length < minSamples) {
    console.log('');
    console.log(
      chalk.yellow(
        `  Only ${rows.length} outcomes recorded (need ≥${minSamples}). Run more tasks first.`,
      ),
    );
    console.log(chalk.dim('  Override: mint tune --min-samples=10'));
    console.log('');
    return;
  }

  const stats = aggregateByRoute(rows);
  const swaps = findSwaps(stats, minSamples);

  console.log('');
  console.log(chalk.cyan(`  mint tune — analyzing ${rows.length} recent outcomes`));
  console.log('');

  printRouteTable(stats);

  if (swaps.length === 0) {
    console.log('');
    console.log(chalk.dim(`  No routing swaps suggested (threshold: ≥${(SUCCESS_LIFT_THRESHOLD * 100).toFixed(0)}pp lift, ≥${minSamples} samples).`));
    console.log(chalk.dim('  Your current routes look reasonable for the data we have.'));
    console.log('');
    return;
  }

  console.log('');
  console.log(chalk.cyan('  Suggested route changes:'));
  console.log('');
  for (const s of swaps) {
    const arrow = chalk.bold('→');
    console.log(
      `  ${chalk.bold(s.kind)}:  ${chalk.red(s.from)} ${arrow} ${chalk.green(s.to)}` +
        chalk.dim(
          `  (${(s.fromStat.successRate * 100).toFixed(0)}% n=${s.fromStat.count} ${arrow} ` +
            `${(s.toStat.successRate * 100).toFixed(0)}% n=${s.toStat.count}, +${(s.liftPct * 100).toFixed(0)}pp)`,
        ),
    );
  }
  console.log('');

  if (!opts.apply) {
    console.log(chalk.dim(`  Dry-run only. Apply with: mint tune --apply`));
    console.log(chalk.dim(`  Tighten threshold:        mint tune --min-samples=50`));
    console.log('');
    return;
  }

  writeRoutingOverride(cwd, swaps);
  console.log(chalk.green(`  ✓ Wrote routing override to ${join('.mint', 'routing.json')}`));
  console.log(chalk.dim('  Restart any running mint session to pick up the changes.'));
  console.log('');
}

// ─── Aggregation ───────────────────────────────────────────────────────────

function aggregateByRoute(rows: OutcomeRow[]): RouteStat[] {
  const groups = new Map<string, OutcomeRow[]>();
  for (const r of rows) {
    const key = `${r.kind}::${r.model}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const stats: RouteStat[] = [];
  for (const [key, arr] of groups) {
    const [kind, model] = key.split('::');
    const successes = arr.filter((r) => r.success).length;
    const totalCost = arr.reduce((acc, r) => acc + (r.costUsd || 0), 0);
    const totalIter = arr.reduce((acc, r) => acc + r.iterations, 0);
    stats.push({
      kind,
      model,
      count: arr.length,
      successRate: successes / arr.length,
      avgCostUsd: totalCost / arr.length,
      avgIterations: totalIter / arr.length,
    });
  }
  // Sort: kind, then count desc.
  stats.sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind.localeCompare(b.kind)));
  return stats;
}

function findSwaps(stats: RouteStat[], minSamples: number): RouteSwap[] {
  const byKind = new Map<string, RouteStat[]>();
  for (const s of stats) {
    if (s.count < minSamples) continue;
    const arr = byKind.get(s.kind) ?? [];
    arr.push(s);
    byKind.set(s.kind, arr);
  }

  const swaps: RouteSwap[] = [];
  for (const [kind, arr] of byKind) {
    if (arr.length < 2) continue;
    // Most-used = current "default" route; best = highest success rate.
    arr.sort((a, b) => b.count - a.count);
    const current = arr[0];
    const best = [...arr].sort((a, b) => b.successRate - a.successRate)[0];
    if (best.model === current.model) continue;
    const lift = best.successRate - current.successRate;
    if (lift < SUCCESS_LIFT_THRESHOLD) continue;
    swaps.push({
      kind,
      from: current.model,
      to: best.model,
      fromStat: current,
      toStat: best,
      liftPct: lift,
    });
  }
  return swaps;
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function printRouteTable(stats: RouteStat[]): void {
  console.log(
    chalk.dim(
      '  kind            model                 n     success    avg cost    avg iter',
    ),
  );
  console.log(chalk.dim('  ' + '─'.repeat(72)));
  for (const s of stats) {
    const success = `${(s.successRate * 100).toFixed(0)}%`.padStart(8);
    const cost = `$${s.avgCostUsd.toFixed(4)}`.padStart(10);
    const iter = s.avgIterations.toFixed(1).padStart(8);
    const n = String(s.count).padStart(4);
    console.log(
      `  ${s.kind.padEnd(16)}${s.model.padEnd(22)}${n}    ${success}  ${cost}    ${iter}`,
    );
  }
}

// ─── Write-out ─────────────────────────────────────────────────────────────

function writeRoutingOverride(cwd: string, swaps: RouteSwap[]): void {
  const path = join(cwd, '.mint', 'routing.json');
  let existing: { routes?: Record<string, { model: string; fallbacks?: string[] }> } = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      // Corrupted override file — back it up and start clean.
      try {
        const backup = `${path}.corrupted-${Date.now()}`;
        const fs = require('node:fs') as typeof import('node:fs');
        fs.renameSync(path, backup);
        process.stderr.write(`[mint tune] backed up corrupted routing.json to ${backup}\n`);
      } catch {
        /* ignore */
      }
      existing = {};
    }
  }

  existing.routes = existing.routes ?? {};
  for (const s of swaps) {
    const prior = existing.routes[s.kind] ?? { model: s.from, fallbacks: [] };
    existing.routes[s.kind] = {
      model: s.to,
      fallbacks: dedupe([s.from, ...(prior.fallbacks ?? [])]).slice(0, 3),
    };
  }

  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
