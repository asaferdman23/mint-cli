/**
 * `mint tune` — analyze recent outcomes and propose routing changes.
 *
 * Reads `<cwd>/.mint/outcomes.sqlite`, computes per-(kind, model) success rates
 * + average cost, and surfaces:
 *   - Routes where an alternative model has materially better success rate
 *     with enough samples to be statistically meaningful.
 *   - Refit classifier weights via ridge-regularized least-squares against
 *     recorded `classifierFeatures` vectors and an iteration-derived
 *     "true complexity" target. The recorded fallback scorer uses
 *     `sigmoid(4 · w·x)` ∈ [0, 1] which is bucketed into trivial/simple/
 *     moderate/complex; we invert that mapping when fitting.
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

interface WeightRefit {
  current: Record<string, number>;
  proposed: Record<string, number>;
  trainingSamples: number;
  rmseBefore: number;
  rmseAfter: number;
}

const SUCCESS_LIFT_THRESHOLD = 0.10; // 10 percentage points
const FEATURE_KEYS = [
  'fileCount',
  'taskLength',
  'verbComplex',
  'hasMultipleFiles',
  'mentionsTest',
  'pastSuccess',
] as const;

// Inline default weights — kept in sync with src/brain/routing.default.json.
// Embedding them avoids a runtime read of a JSON file that's bundled into the
// CLI build.
const DEFAULT_WEIGHTS: Record<string, number> = {
  fileCount: 0.35,
  taskLength: 0.15,
  verbComplex: 0.25,
  hasMultipleFiles: 0.2,
  mentionsTest: 0.1,
  pastSuccess: -0.25,
};

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
  const refit = refitClassifierWeights(rows, cwd);

  console.log('');
  console.log(chalk.cyan(`  mint tune — analyzing ${rows.length} recent outcomes`));
  console.log('');

  printRouteTable(stats);

  if (swaps.length === 0) {
    console.log('');
    console.log(chalk.dim(`  No routing swaps suggested (threshold: ≥${(SUCCESS_LIFT_THRESHOLD * 100).toFixed(0)}pp lift, ≥${minSamples} samples).`));
  } else {
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
  }

  if (refit) {
    console.log('');
    console.log(chalk.cyan('  Classifier weight refit:'));
    console.log('');
    console.log(
      chalk.dim(`    feature              current  →  proposed   delta`),
    );
    for (const k of FEATURE_KEYS) {
      const cur = refit.current[k] ?? 0;
      const next = refit.proposed[k] ?? 0;
      const delta = next - cur;
      const dStr = (delta >= 0 ? '+' : '') + delta.toFixed(3);
      const color = Math.abs(delta) < 0.02 ? chalk.dim : delta >= 0 ? chalk.green : chalk.red;
      console.log(
        `    ${k.padEnd(20)}${cur.toFixed(3).padStart(7)}     ${next.toFixed(3).padStart(7)}   ${color(dStr.padStart(7))}`,
      );
    }
    console.log('');
    console.log(
      chalk.dim(
        `    fit RMSE: ${refit.rmseBefore.toFixed(3)} → ${refit.rmseAfter.toFixed(3)}` +
          ` (${refit.trainingSamples} training samples)`,
      ),
    );
  }
  console.log('');

  if (!opts.apply) {
    if (swaps.length > 0 || refit) {
      console.log(chalk.dim(`  Dry-run only. Apply with: mint tune --apply`));
    } else {
      console.log(chalk.dim('  Your current routes look reasonable for the data we have.'));
    }
    console.log(chalk.dim(`  Tighten threshold:        mint tune --min-samples=50`));
    console.log('');
    return;
  }

  if (swaps.length === 0 && !refit) {
    console.log(chalk.dim('  Nothing to apply.'));
    console.log('');
    return;
  }

  writeRoutingOverride(cwd, swaps, refit);
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
  for (const [, arr] of byKind) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => b.count - a.count);
    const current = arr[0];
    const best = [...arr].sort((a, b) => b.successRate - a.successRate)[0];
    if (best.model === current.model) continue;
    const lift = best.successRate - current.successRate;
    if (lift < SUCCESS_LIFT_THRESHOLD) continue;
    swaps.push({
      kind: current.kind,
      from: current.model,
      to: best.model,
      fromStat: current,
      toStat: best,
      liftPct: lift,
    });
  }
  return swaps;
}

// ─── Classifier weight refit ────────────────────────────────────────────────

/**
 * Fit classifier weights via ridge regression on (recorded features → target
 * complexity score). The current scorer is `sigmoid(4 · w·x)` bucketed into
 * trivial/simple/moderate/complex. We invert that bucketing for each row to
 * get a target raw score `r`, then solve `w = (XᵀX + λI)⁻¹ Xᵀ r`.
 *
 * Target derivation:
 *   - Each row's recorded `complexity` gives us a coarse target band.
 *   - We refine the band by looking at iterations / toolCalls — runs that
 *     burned a lot of iterations were "harder" than the original bucket
 *     might suggest, so we nudge the target up. Successful trivial runs that
 *     finished in 1–2 iterations stay low.
 *
 * This is intentionally a mild correction, not a full classifier retrain —
 * we want to nudge the deterministic fallback scorer toward observed reality
 * while keeping it stable enough that tomorrow's tasks behave like today's.
 */
function refitClassifierWeights(rows: OutcomeRow[], cwd: string): WeightRefit | null {
  const trainable = rows.filter(
    (r) =>
      r.classifierFeatures &&
      typeof r.classifierFeatures === 'object' &&
      FEATURE_KEYS.every((k) => typeof r.classifierFeatures![k] === 'number'),
  );
  if (trainable.length < 20) return null;

  // Build target raw scores.
  const COMPLEXITY_BAND: Record<string, number> = {
    trivial: 0.30,
    simple: 0.50,
    moderate: 0.68,
    complex: 0.85,
  };
  const X: number[][] = [];
  const y: number[] = [];
  for (const r of trainable) {
    const band = COMPLEXITY_BAND[r.complexity] ?? 0.5;
    // Iteration-based correction: more iterations than expected → harder.
    const iterFactor = Math.min(1, r.iterations / 20);
    const blended = clamp(band + (iterFactor - 0.5) * 0.15, 0.05, 0.95);
    // Invert sigmoid(4r) = blended  →  r = logit(blended) / 4
    const raw = Math.log(blended / (1 - blended)) / 4;
    X.push(FEATURE_KEYS.map((k) => r.classifierFeatures![k] as number));
    y.push(raw);
  }

  const current = readCurrentWeights(cwd);
  const rmseBefore = rmse(predict(X, FEATURE_KEYS.map((k) => current[k] ?? 0)), y);

  const proposedVec = ridgeLeastSquares(X, y, /* lambda */ 0.5);
  if (!proposedVec) return null;

  // Re-center proposed weights toward the current ones to keep behaviour
  // smooth — small dataset, big jumps would be unstable.
  const blendAlpha = Math.min(0.7, trainable.length / 100);
  const proposed: Record<string, number> = {};
  FEATURE_KEYS.forEach((k, i) => {
    const cur = current[k] ?? 0;
    proposed[k] = cur * (1 - blendAlpha) + proposedVec[i] * blendAlpha;
  });

  const rmseAfter = rmse(predict(X, FEATURE_KEYS.map((k) => proposed[k] ?? 0)), y);
  return {
    current,
    proposed,
    trainingSamples: trainable.length,
    rmseBefore,
    rmseAfter,
  };
}

function readCurrentWeights(cwd: string): Record<string, number> {
  const local = join(cwd, '.mint', 'routing.json');
  if (existsSync(local)) {
    try {
      const parsed = JSON.parse(readFileSync(local, 'utf-8')) as {
        classifier?: { weights?: Record<string, number> };
      };
      const w = parsed?.classifier?.weights;
      if (w && typeof w === 'object') return { ...DEFAULT_WEIGHTS, ...w };
    } catch {
      /* fall through to defaults */
    }
  }
  return { ...DEFAULT_WEIGHTS };
}

function predict(X: number[][], w: number[]): number[] {
  return X.map((row) => row.reduce((acc, v, i) => acc + v * (w[i] ?? 0), 0));
}

function rmse(predicted: number[], actual: number[]): number {
  const n = predicted.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = predicted[i] - actual[i];
    s += d * d;
  }
  return Math.sqrt(s / n);
}

/**
 * Solve `(XᵀX + λI) w = Xᵀ y` via Gauss–Jordan elimination with partial
 * pivoting. No external linear-algebra dependency; we have ≤ 6 features, so
 * this is fast and exact.
 */
function ridgeLeastSquares(X: number[][], y: number[], lambda: number): number[] | null {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (n === 0 || p === 0) return null;

  // A = XᵀX + λI, b = Xᵀy
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b: number[] = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    const yi = y[i];
    for (let j = 0; j < p; j++) {
      b[j] += xi[j] * yi;
      for (let k = j; k < p; k++) {
        const v = xi[j] * xi[k];
        A[j][k] += v;
        if (j !== k) A[k][j] += v;
      }
    }
  }
  for (let j = 0; j < p; j++) A[j][j] += lambda;

  // Gauss-Jordan
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [M[pivot], M[col]] = [M[col], M[pivot]];
    const pv = M[col][col];
    for (let c = col; c <= p; c++) M[col][c] /= pv;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= p; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row[p]);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
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

function writeRoutingOverride(
  cwd: string,
  swaps: RouteSwap[],
  refit: WeightRefit | null,
): void {
  const path = join(cwd, '.mint', 'routing.json');
  let existing: {
    routes?: Record<string, { model: string; fallbacks?: string[] }>;
    classifier?: { weights?: Record<string, number> };
  } = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
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

  if (refit) {
    existing.classifier = existing.classifier ?? {};
    existing.classifier.weights = {
      ...(existing.classifier.weights ?? {}),
      ...refit.proposed,
    };
  }

  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
