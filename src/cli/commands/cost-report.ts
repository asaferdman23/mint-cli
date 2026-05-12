import chalk from 'chalk';
import { createHash } from 'node:crypto';
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
  by?: string; // 'developer' | 'model' | 'day'
  developer?: string; // filter to one developer
  /**
   * Emit a tamper-evident CSV. Implies --export csv and adds a `row_hash`
   * column where each row's hash is sha256(prev_hash || canonical_row).
   * The first row's prev_hash is the literal string "GENESIS".
   *
   * To verify a chain: recompute each row's hash from the canonical row
   * content + the previous row's hash and compare. Any mutation breaks
   * the chain at that row and every subsequent one.
   */
  audit?: boolean;
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
  let rows = all.filter((r) => r.timestamp >= since);
  if (opts.developer) {
    rows = rows.filter((r) => (r.developer ?? 'unknown') === opts.developer);
  }
  rows = rows.slice(0, limit);

  // --audit forces csv export and adds tamper-evident hash chain.
  if (opts.audit) {
    return emitAuditCsv(rows);
  }

  // Grouped view (e.g. --by developer). Aggregates take priority over the
  // per-run table; --export still works for grouped output.
  if (opts.by) {
    const validGroups = new Set(['developer', 'model', 'day']);
    if (!validGroups.has(opts.by)) {
      throw new Error(`--by must be one of: ${[...validGroups].join(', ')}`);
    }
    return renderGrouped(rows, opts.by as 'developer' | 'model' | 'day', { days, exportFmt: opts.export });
  }

  if (opts.export === 'csv') {
    const headers = [
      'timestamp',
      'sessionId',
      'developer',
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
        r.developer ?? 'unknown',
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

// ─── Grouped views ──────────────────────────────────────────────────────────

interface GroupAgg {
  key: string;
  runs: number;
  cost: number;
  opusCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

function groupKey(row: UsageRecord, by: 'developer' | 'model' | 'day'): string {
  if (by === 'developer') return row.developer ?? 'unknown';
  if (by === 'model') return row.model;
  // by === 'day'
  return new Date(row.timestamp).toISOString().slice(0, 10);
}

function renderGrouped(
  rows: UsageRecord[],
  by: 'developer' | 'model' | 'day',
  ctx: { days: number; exportFmt?: string },
): void {
  const map = new Map<string, GroupAgg>();
  for (const r of rows) {
    const key = groupKey(r, by);
    const cur = map.get(key) ?? {
      key,
      runs: 0,
      cost: 0,
      opusCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    cur.runs += 1;
    cur.cost += r.cost;
    cur.opusCost += r.opusCost;
    cur.inputTokens += r.inputTokens;
    cur.outputTokens += r.outputTokens;
    cur.cacheReadTokens += r.cacheReadTokens ?? 0;
    cur.cacheCreationTokens += r.cacheCreationTokens ?? 0;
    map.set(key, cur);
  }

  const groups = [...map.values()].sort((a, b) => b.cost - a.cost);

  if (ctx.exportFmt === 'csv') {
    process.stdout.write(`${by},runs,inputTokens,outputTokens,cacheReadTokens,cacheCreationTokens,cost,opusCost,savings,cacheHitPct\n`);
    for (const g of groups) {
      const inputEq = g.inputTokens + g.cacheReadTokens + g.cacheCreationTokens;
      const hit = inputEq > 0 ? (g.cacheReadTokens / inputEq) * 100 : 0;
      const savings = Math.max(0, g.opusCost - g.cost);
      process.stdout.write(
        [
          JSON.stringify(g.key),
          g.runs,
          g.inputTokens,
          g.outputTokens,
          g.cacheReadTokens,
          g.cacheCreationTokens,
          g.cost.toFixed(6),
          g.opusCost.toFixed(6),
          savings.toFixed(6),
          hit.toFixed(2),
        ].join(',') + '\n',
      );
    }
    return;
  }

  if (ctx.exportFmt === 'json') {
    process.stdout.write(JSON.stringify(groups, null, 2) + '\n');
    return;
  }

  const label = by === 'developer' ? 'Developer' : by === 'model' ? 'Model' : 'Day';
  console.log('');
  console.log(chalk.bold.cyan(`  Cost Report — by ${by}, last ${ctx.days} days  `));
  console.log(chalk.dim(`  ${groups.length} ${by}(s) · sorted by spend desc`));
  console.log('');

  console.log(
    '  ' +
      chalk.bold(truncate(label, 30)) + ' ' +
      chalk.bold(truncate('Runs', 6)) + ' ' +
      chalk.bold(truncate('In', 8)) + ' ' +
      chalk.bold(truncate('Out', 8)) + ' ' +
      chalk.bold(truncate('Cache R/W', 16)) + ' ' +
      chalk.bold(truncate('Hit%', 6)) + ' ' +
      chalk.bold(truncate('Cost', 10)) + ' ' +
      chalk.bold(truncate('Saved', 10)),
  );
  console.log('  ' + chalk.dim('─'.repeat(100)));

  let totalCost = 0;
  let totalOpus = 0;
  for (const g of groups) {
    totalCost += g.cost;
    totalOpus += g.opusCost;
    const inputEq = g.inputTokens + g.cacheReadTokens + g.cacheCreationTokens;
    const hit = inputEq > 0 ? (g.cacheReadTokens / inputEq) * 100 : 0;
    const hitStr = hit > 0 ? `${hit.toFixed(0)}%` : '-';
    const hitColored = hit >= 50 ? chalk.green(truncate(hitStr, 6))
      : hit >= 20 ? chalk.yellow(truncate(hitStr, 6))
      : chalk.dim(truncate(hitStr, 6));
    const savings = Math.max(0, g.opusCost - g.cost);
    const savingsStr = savings > 0 ? chalk.green(truncate(fmtUsd(savings), 10)) : truncate('-', 10);

    console.log(
      '  ' +
        truncate(g.key, 30) + ' ' +
        truncate(String(g.runs), 6) + ' ' +
        truncate(fmtTokens(g.inputTokens), 8) + ' ' +
        truncate(fmtTokens(g.outputTokens), 8) + ' ' +
        truncate(`${fmtTokens(g.cacheReadTokens)}/${fmtTokens(g.cacheCreationTokens)}`, 16) + ' ' +
        hitColored + ' ' +
        truncate(fmtUsd(g.cost), 10) + ' ' +
        savingsStr,
    );
  }

  if (groups.length === 0) {
    console.log(chalk.dim('  No data in this window.'));
    return;
  }

  console.log('');
  console.log(chalk.bold(`  Total: ${chalk.bold(fmtUsd(totalCost))} · vs Opus baseline ${fmtUsd(totalOpus)} · saved ${chalk.green(fmtUsd(Math.max(0, totalOpus - totalCost)))}`));
  console.log('');
}

// ─── Audit-grade CSV with tamper-evident hash chain ─────────────────────────

/**
 * Columns of the audit CSV (order is part of the spec — auditors hash the
 * canonical row, so changing order silently invalidates external verifiers).
 */
const AUDIT_COLUMNS = [
  'timestamp_iso',
  'developer',
  'sessionId',
  'model',
  'provider',
  'tier',
  'task',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'costUSD',
  'opusBaselineUSD',
  'savingsUSD',
  'cacheHitPct',
  'durationMs',
  'routingReason',
] as const;

/** Convert one row to its canonical string form used in the hash. */
function canonicalAuditRow(row: UsageRecord): string {
  const d = derive(row);
  const cells: Record<(typeof AUDIT_COLUMNS)[number], string> = {
    timestamp_iso: new Date(row.timestamp).toISOString(),
    developer: row.developer ?? 'unknown',
    sessionId: row.sessionId,
    model: row.model,
    provider: row.provider,
    tier: row.tier,
    task: row.taskPreview,
    inputTokens: String(row.inputTokens),
    outputTokens: String(row.outputTokens),
    cacheReadTokens: String(row.cacheReadTokens ?? 0),
    cacheCreationTokens: String(row.cacheCreationTokens ?? 0),
    costUSD: row.cost.toFixed(6),
    opusBaselineUSD: row.opusCost.toFixed(6),
    savingsUSD: row.savedAmount.toFixed(6),
    cacheHitPct: d.cacheHitPct.toFixed(2),
    durationMs: String(row.latencyMs),
    routingReason: row.routingReason,
  };
  // Canonical form: TAB-separated key=value pairs in fixed column order. We
  // don't use JSON because JSON has multiple valid encodings of the same
  // object (key order, whitespace). TSV with a fixed column list is one form.
  return AUDIT_COLUMNS.map((k) => `${k}=${cells[k]}`).join('\t');
}

/** Hash one row given the previous row's hash (or "GENESIS" for row 0). */
export function auditRowHash(row: UsageRecord, prevHash: string): string {
  const h = createHash('sha256');
  h.update(prevHash);
  h.update('\n');
  h.update(canonicalAuditRow(row));
  return h.digest('hex');
}

/** CSV-escape: wrap in double quotes, double any inner quotes. */
function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function emitAuditCsv(rows: UsageRecord[]): void {
  process.stdout.write([...AUDIT_COLUMNS, 'prev_hash', 'row_hash'].join(',') + '\n');
  let prevHash = 'GENESIS';
  for (const r of rows) {
    const d = derive(r);
    const ordered: string[] = [
      new Date(r.timestamp).toISOString(),
      r.developer ?? 'unknown',
      r.sessionId,
      r.model,
      r.provider,
      r.tier,
      r.taskPreview,
      String(r.inputTokens),
      String(r.outputTokens),
      String(r.cacheReadTokens ?? 0),
      String(r.cacheCreationTokens ?? 0),
      r.cost.toFixed(6),
      r.opusCost.toFixed(6),
      r.savedAmount.toFixed(6),
      d.cacheHitPct.toFixed(2),
      String(r.latencyMs),
      r.routingReason,
    ];
    const rowHash = auditRowHash(r, prevHash);
    process.stdout.write([...ordered.map(csvEscape), prevHash, rowHash].join(',') + '\n');
    prevHash = rowHash;
  }
}

/**
 * Verify an audit chain in-process. Used by tests; can also be invoked from
 * a verifier script. Returns true iff the rows form a valid chain starting
 * from "GENESIS".
 */
export function verifyAuditChain(rows: UsageRecord[], hashes: string[]): boolean {
  if (rows.length !== hashes.length) return false;
  let prev = 'GENESIS';
  for (let i = 0; i < rows.length; i++) {
    const expected = auditRowHash(rows[i], prev);
    if (expected !== hashes[i]) return false;
    prev = hashes[i];
  }
  return true;
}
