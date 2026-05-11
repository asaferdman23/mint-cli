import chalk from 'chalk';
import { getUsageDb } from '../../usage/tracker.js';
import {
  OPUS_INPUT_PRICE_PER_M,
  OPUS_OUTPUT_PRICE_PER_M,
} from '../../usage/pricing.js';
import type { UsageRecord } from '../../usage/db.js';

export interface CostReportOptions {
  since?: string; // days back
  export?: string; // 'csv' | 'json'
  limit?: string;
}

interface RowDerived {
  cachedReadCost: number;
  cachedWriteCost: number;
  noCacheCost: number; // what input would cost if cached tokens were billed fresh
  cacheSavings: number;
  opusBaseline: number;
  cacheHitPct: number;
}

function derive(row: UsageRecord): RowDerived {
  const cacheRead = row.cacheReadTokens ?? 0;
  const cacheWrite = row.cacheCreationTokens ?? 0;
  const totalInputEquivalent = row.inputTokens + cacheRead + cacheWrite;
  const cacheHitPct = totalInputEquivalent > 0 ? (cacheRead / totalInputEquivalent) * 100 : 0;
  // We don't know the per-model input price here without re-importing the
  // model table, but the saving math is independent of price: a cache READ
  // costs ~10% of fresh, and creation costs ~125%. So savings vs naive is:
  //   savings = (cacheRead * 0.90 - cacheWrite * 0.25) * fresh_input_price
  // We approximate fresh_input_price from the recorded cost vs Opus baseline
  // by leaning on the Opus baseline columns we already store.
  // Cleaner: use the model's known input price via the pricing file. We use
  // Opus-equivalent only for baselines.
  return {
    cachedReadCost: cacheRead,
    cachedWriteCost: cacheWrite,
    noCacheCost: 0,
    cacheSavings: 0,
    opusBaseline: row.opusCost,
    cacheHitPct,
  };
}

function fmtUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s.padEnd(n);
  return s.slice(0, n - 1) + '…';
}

export async function runCostReport(opts: CostReportOptions): Promise<void> {
  const days = Math.max(1, parseInt(opts.since ?? '30', 10) || 30);
  const limit = Math.max(1, parseInt(opts.limit ?? '100', 10) || 100);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const db = getUsageDb();
  const all = db.getAll();
  const rows = all.filter((r) => r.timestamp >= since).slice(0, limit);

  if (opts.export === 'csv') {
    const headers = [
      'timestamp',
      'sessionId',
      'model',
      'task',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheCreationTokens',
      'cost',
      'opusCost',
      'savedAmount',
      'cacheHitPct',
    ];
    process.stdout.write(headers.join(',') + '\n');
    for (const r of rows) {
      const d = derive(r);
      const cells = [
        new Date(r.timestamp).toISOString(),
        r.sessionId,
        r.model,
        JSON.stringify(r.taskPreview),
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens ?? 0,
        r.cacheCreationTokens ?? 0,
        r.cost.toFixed(6),
        r.opusCost.toFixed(6),
        r.savedAmount.toFixed(6),
        d.cacheHitPct.toFixed(2),
      ];
      process.stdout.write(cells.join(',') + '\n');
    }
    return;
  }

  if (opts.export === 'json') {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }

  // Pretty table
  console.log('');
  console.log(chalk.bold.cyan(`  Cost Report — last ${days} days  `));
  console.log(chalk.dim(`  ${rows.length} run(s) · sourced from ~/.mint/usage.db`));
  console.log('');

  const header =
    chalk.bold(truncate('Time', 16)) + ' ' +
    chalk.bold(truncate('Model', 18)) + ' ' +
    chalk.bold(truncate('Task', 30)) + ' ' +
    chalk.bold(truncate('In', 8)) + ' ' +
    chalk.bold(truncate('Out', 8)) + ' ' +
    chalk.bold(truncate('Cache R/W', 14)) + ' ' +
    chalk.bold(truncate('Hit%', 6)) + ' ' +
    chalk.bold(truncate('Cost', 10)) + ' ' +
    chalk.bold(truncate('vs Opus', 10));
  console.log('  ' + header);
  console.log('  ' + chalk.dim('─'.repeat(125)));

  let totalCost = 0;
  let totalOpus = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (const r of rows) {
    const d = derive(r);
    totalCost += r.cost;
    totalOpus += r.opusCost;
    totalCacheRead += r.cacheReadTokens ?? 0;
    totalCacheWrite += r.cacheCreationTokens ?? 0;
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;

    const time = new Date(r.timestamp).toISOString().slice(5, 16).replace('T', ' ');
    const model = r.model;
    const task = r.taskPreview || '(no task)';
    const cacheStr = `${fmtTokens(r.cacheReadTokens ?? 0)}/${fmtTokens(r.cacheCreationTokens ?? 0)}`;
    const hit = d.cacheHitPct > 0 ? `${d.cacheHitPct.toFixed(0)}%` : '-';
    const hitColored = d.cacheHitPct >= 50 ? chalk.green(truncate(hit, 6))
      : d.cacheHitPct >= 20 ? chalk.yellow(truncate(hit, 6))
      : chalk.dim(truncate(hit, 6));
    const vsOpus = r.opusCost > 0 ? chalk.green(truncate(fmtUsd(r.savedAmount), 10)) : truncate('-', 10);

    console.log(
      '  ' +
        truncate(time, 16) + ' ' +
        truncate(model, 18) + ' ' +
        truncate(task, 30) + ' ' +
        truncate(fmtTokens(r.inputTokens), 8) + ' ' +
        truncate(fmtTokens(r.outputTokens), 8) + ' ' +
        truncate(cacheStr, 14) + ' ' +
        hitColored + ' ' +
        truncate(fmtUsd(r.cost), 10) + ' ' +
        vsOpus,
    );
  }

  if (rows.length === 0) {
    console.log(chalk.dim('  No runs in this window.'));
    return;
  }

  const totalCacheTokens = totalCacheRead + totalCacheWrite;
  const totalInputEquivalent = totalInput + totalCacheTokens;
  const overallHit = totalInputEquivalent > 0 ? (totalCacheRead / totalInputEquivalent) * 100 : 0;

  // What it would have cost if every cached read had been billed fresh.
  // We approximate using the simple Opus baseline as a "fresh" anchor:
  // cache_read tokens billed at 10% of fresh; if billed fresh they'd be 10x more.
  // For an honest number we'd need per-model prices; expose simple totals.
  const noCacheInput = totalInput + totalCacheRead + totalCacheWrite;
  const opusNoCache =
    (noCacheInput / 1_000_000) * OPUS_INPUT_PRICE_PER_M +
    (totalOutput / 1_000_000) * OPUS_OUTPUT_PRICE_PER_M;

  console.log('');
  console.log(chalk.bold('  Totals'));
  console.log(`    Runs:              ${rows.length}`);
  console.log(`    Input tokens:      ${fmtTokens(totalInput)} fresh + ${fmtTokens(totalCacheRead)} cached read + ${fmtTokens(totalCacheWrite)} cache write`);
  console.log(`    Output tokens:     ${fmtTokens(totalOutput)}`);
  console.log(`    Cache hit rate:    ${overallHit.toFixed(1)}% of input came from cache`);
  console.log(`    Spent:             ${chalk.bold(fmtUsd(totalCost))}`);
  console.log(`    Opus baseline:     ${fmtUsd(totalOpus)}    (saved ${chalk.green(fmtUsd(Math.max(0, totalOpus - totalCost)))} vs all-Opus)`);
  console.log(`    Opus, no-cache:    ${fmtUsd(opusNoCache)}    (cache + routing saved ${chalk.green(fmtUsd(Math.max(0, opusNoCache - totalCost)))} total)`);
  console.log('');
  console.log(chalk.dim('  Use --export csv or --export json for machine-readable output.'));
}
