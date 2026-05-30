/**
 * `mint bench` — run a fixed task suite, capture cost/cache/quality, write
 * a structured result JSON, and aggregate to a markdown report.
 *
 * This is the proof system. The "frontier-by-default with caching is cheap"
 * claim is only credible if you can produce a screenshot from your own data
 * on a fixed, reproducible task set. That's what this command exists for.
 *
 *   mint bench                         run full suite, prompt for ratings
 *   mint bench --tasks=./mine.json     custom task file
 *   mint bench --no-rate               skip rating prompts (CI mode)
 *   mint bench --auto                  auto mode (no per-diff approval)
 *   mint bench report                  aggregate the latest run → markdown
 *   mint bench report --run=<id>       aggregate a specific run
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { runHeadless } from '../../brain/index.js';
import type { AgentEvent } from '../../brain/index.js';

interface BenchTask {
  id: string;
  kind: string;
  task: string;
  expectModel?: string;
  expectComplexity?: string;
  expectNeedsPlan?: boolean;
  rubric?: string;
}

interface BenchTasksFile {
  _meta?: { description?: string; version?: number; createdAt?: string };
  tasks: BenchTask[];
}

interface BenchTaskResult {
  id: string;
  kind: string;
  task: string;
  sessionId: string | null;
  modelUsed: string | null;
  classifiedAs: { kind: string; complexity: string; confidence: number } | null;
  success: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitPct: number | null;
  iterations: number;
  toolCalls: number;
  filesTouched: string[];
  durationMs: number;
  userRating: 'good' | 'meh' | 'bad' | 'skip' | 'auto' | null;
  ratingNote?: string;
  errorMessage?: string;
}

interface BenchRun {
  runId: string;
  startedAt: number;
  finishedAt: number;
  tasksFile: string;
  mintVersion: string;
  defaults: {
    mode: 'plan' | 'diff' | 'auto' | 'yolo';
    spendCap: number | null;
  };
  results: BenchTaskResult[];
}

export interface BenchOptions {
  tasks?: string;
  noRate?: boolean;
  auto?: boolean;
  cap?: number;
}

function loadTasks(path: string): BenchTask[] {
  if (!existsSync(path)) {
    throw new Error(`Tasks file not found: ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as BenchTasksFile;
  if (!Array.isArray(parsed.tasks)) {
    throw new Error(`Tasks file missing 'tasks' array: ${path}`);
  }
  return parsed.tasks;
}

function newRunId(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function getMintVersion(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Prompt the user with a single-key-style question and resolve to their answer. */
function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

async function askRating(task: BenchTask): Promise<{ rating: BenchTaskResult['userRating']; note?: string }> {
  if (task.rubric) {
    console.log(chalk.dim(`    rubric: ${task.rubric}`));
  }
  const ans = (await prompt(chalk.cyan('    rate: [g]ood / [m]eh / [b]ad / [s]kip > '))).toLowerCase();
  let rating: BenchTaskResult['userRating'] = 'skip';
  if (ans.startsWith('g')) rating = 'good';
  else if (ans.startsWith('m')) rating = 'meh';
  else if (ans.startsWith('b')) rating = 'bad';
  else rating = 'skip';
  const note = (await prompt(chalk.dim('    note (optional, Enter to skip): '))).trim();
  return { rating, note: note || undefined };
}

async function runOneTask(
  task: BenchTask,
  opts: BenchOptions,
  index: number,
  total: number,
): Promise<BenchTaskResult> {
  console.log('');
  console.log(chalk.cyan(`  [${index + 1}/${total}] ${chalk.bold(task.id)} · ${task.kind}`));
  console.log(chalk.dim(`    ${task.task}`));
  if (task.expectModel) console.log(chalk.dim(`    expect: ${task.expectModel}`));

  const events: AgentEvent[] = [];
  let modelUsed: string | null = null;
  let classifiedAs: BenchTaskResult['classifiedAs'] = null;

  const result: BenchTaskResult = {
    id: task.id,
    kind: task.kind,
    task: task.task,
    sessionId: null,
    modelUsed: null,
    classifiedAs: null,
    success: false,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheHitPct: null,
    iterations: 0,
    toolCalls: 0,
    filesTouched: [],
    durationMs: 0,
    userRating: null,
  };

  const startedAt = Date.now();
  try {
    const headless = await runHeadless({
      task: task.task,
      cwd: process.cwd(),
      mode: opts.auto ? 'auto' : 'diff',
      spendCap: opts.cap,
      // In bench, auto-approve everything so the run is non-interactive.
      // The user gates quality after the fact via the rating prompt.
      approve: () => true,
      onEvent: (e) => {
        events.push(e);
        if (e.type === 'classify') {
          modelUsed = e.model;
          classifiedAs = { kind: e.kind, complexity: e.complexity, confidence: e.confidence };
        }
        if (e.type === 'session.start') {
          result.sessionId = e.sessionId;
          process.stderr.write(chalk.dim(`    session ${e.sessionId.slice(0, 12)} · `));
        }
        if (e.type === 'tool.call') {
          process.stderr.write(chalk.dim('·'));
        }
      },
    });
    if (headless.result) {
      const r = headless.result;
      result.success = r.success;
      result.costUsd = r.totalCostUsd;
      result.inputTokens = r.inputTokens;
      result.outputTokens = r.outputTokens;
      result.cacheReadTokens = r.cacheReadInputTokens ?? 0;
      result.cacheCreationTokens = r.cacheCreationInputTokens ?? 0;
      result.iterations = r.iterations;
      result.toolCalls = r.toolCalls;
      result.filesTouched = r.filesTouched;
      result.durationMs = r.durationMs;
      result.modelUsed = r.model;
    }
    result.classifiedAs = classifiedAs;
    if (modelUsed && !result.modelUsed) result.modelUsed = modelUsed;
    if (headless.error) result.errorMessage = headless.error;
  } catch (err) {
    result.errorMessage = err instanceof Error ? err.message : String(err);
  }

  // Cache hit ratio: cacheRead / (input + cacheRead + cacheWrite). Null when no
  // billable input happened — distinct from 0% (which means "we sent tokens but
  // none hit").
  const billable = result.inputTokens + result.cacheReadTokens + result.cacheCreationTokens;
  result.cacheHitPct = billable > 0 ? (result.cacheReadTokens / billable) * 100 : null;
  result.durationMs = Date.now() - startedAt;

  process.stderr.write('\n');
  console.log(
    chalk.dim(
      `    ${result.modelUsed ?? '?'} · ${result.iterations} iter · ${result.toolCalls} tools · ` +
        `$${result.costUsd.toFixed(4)} · ` +
        `${result.cacheHitPct != null ? result.cacheHitPct.toFixed(0) + '% cache' : 'no cache data'}`,
    ),
  );
  if (result.errorMessage) console.log(chalk.red(`    error: ${result.errorMessage}`));

  if (opts.noRate) {
    result.userRating = 'auto';
  } else {
    const { rating, note } = await askRating(task);
    result.userRating = rating;
    if (note) result.ratingNote = note;
  }
  return result;
}

function resultsDir(cwd: string): string {
  return join(cwd, 'bench', 'results');
}

function writeRun(cwd: string, run: BenchRun): string {
  const dir = resultsDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${run.runId}.json`);
  writeFileSync(path, JSON.stringify(run, null, 2) + '\n', 'utf-8');
  return path;
}

function loadRun(cwd: string, runId: string): BenchRun {
  const path = join(resultsDir(cwd), `${runId}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as BenchRun;
}

function latestRunId(cwd: string): string | null {
  const dir = resultsDir(cwd);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return null;
  return files
    .map((f) => ({ id: f.replace(/\.json$/, ''), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].id;
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtPct(p: number | null): string {
  return p == null ? '—' : `${p.toFixed(0)}%`;
}

/** Aggregate a run into a markdown report. Written to stdout AND saved
 *  alongside the JSON so the artifact is easy to share. */
function renderReport(cwd: string, run: BenchRun): string {
  const lines: string[] = [];
  lines.push(`# Mint benchmark — run ${run.runId}`);
  lines.push('');
  lines.push(`- Tasks: ${run.results.length} (from \`${run.tasksFile}\`)`);
  lines.push(`- Mode: \`${run.defaults.mode}\``);
  if (run.defaults.spendCap != null) lines.push(`- Spend cap per task: $${run.defaults.spendCap.toFixed(2)}`);
  lines.push(`- Mint version: ${run.mintVersion}`);
  lines.push(`- Duration: ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`);
  lines.push('');

  const totalCost = run.results.reduce((a, r) => a + r.costUsd, 0);
  const good = run.results.filter((r) => r.userRating === 'good').length;
  const meh = run.results.filter((r) => r.userRating === 'meh').length;
  const bad = run.results.filter((r) => r.userRating === 'bad').length;
  const skipped = run.results.filter((r) => r.userRating === 'skip' || r.userRating === 'auto').length;
  const cacheHits = run.results.filter((r) => r.cacheHitPct != null);
  const avgCacheHit = cacheHits.length > 0
    ? cacheHits.reduce((a, r) => a + (r.cacheHitPct ?? 0), 0) / cacheHits.length
    : null;

  lines.push('## Aggregate');
  lines.push('');
  lines.push(`- **Total cost:** ${fmtCost(totalCost)}`);
  lines.push(`- **Average cache hit (when available):** ${fmtPct(avgCacheHit)}`);
  lines.push(`- **Quality:** ${good} good · ${meh} meh · ${bad} bad · ${skipped} skipped/auto`);
  lines.push('');

  lines.push('## Per-task');
  lines.push('');
  lines.push('| ID | Kind | Model | Cost | Cache | Iter | Quality | Notes |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of run.results) {
    const quality = r.userRating ?? '—';
    const noteFrag = r.ratingNote ? r.ratingNote.replace(/\|/g, '\\|').slice(0, 60) : '';
    const errFrag = r.errorMessage ? `❌ ${r.errorMessage.slice(0, 40)}` : '';
    const notes = [errFrag, noteFrag].filter(Boolean).join(' · ');
    lines.push(
      `| ${r.id} | ${r.kind} | ${r.modelUsed ?? '?'} | ${fmtCost(r.costUsd)} | ${fmtPct(r.cacheHitPct)} | ${r.iterations} | ${quality} | ${notes} |`,
    );
  }
  lines.push('');

  if (bad > 0) {
    lines.push('## Bad-rated tasks (investigate before publishing)');
    lines.push('');
    for (const r of run.results.filter((x) => x.userRating === 'bad')) {
      lines.push(`### ${r.id} — ${r.task}`);
      if (r.ratingNote) lines.push(`> ${r.ratingNote}`);
      lines.push(`- model: ${r.modelUsed} · cost: ${fmtCost(r.costUsd)} · session: \`${r.sessionId}\``);
      lines.push(`- replay: \`mint trace ${r.sessionId}\``);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function runBench(opts: BenchOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const tasksPath = opts.tasks ?? join(cwd, 'bench', 'tasks.json');
  const tasks = loadTasks(tasksPath);

  const run: BenchRun = {
    runId: newRunId(),
    startedAt: Date.now(),
    finishedAt: 0,
    tasksFile: tasksPath,
    mintVersion: getMintVersion(cwd),
    defaults: {
      mode: opts.auto ? 'auto' : 'diff',
      spendCap: opts.cap ?? null,
    },
    results: [],
  };

  console.log('');
  console.log(chalk.cyan(`  mint bench — ${tasks.length} tasks · run ${chalk.bold(run.runId)}`));
  console.log(chalk.dim(`  Mode: ${run.defaults.mode}${run.defaults.spendCap != null ? ` · cap $${run.defaults.spendCap.toFixed(2)}` : ''}`));

  for (let i = 0; i < tasks.length; i++) {
    const result = await runOneTask(tasks[i], opts, i, tasks.length);
    run.results.push(result);
  }
  run.finishedAt = Date.now();

  const jsonPath = writeRun(cwd, run);
  const report = renderReport(cwd, run);
  const mdPath = jsonPath.replace(/\.json$/, '.md');
  writeFileSync(mdPath, report + '\n', 'utf-8');
  if (!existsSync(dirname(mdPath))) mkdirSync(dirname(mdPath), { recursive: true });

  console.log('');
  console.log(chalk.green(`  ✓ Run complete: ${run.results.length} tasks · ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`));
  console.log(chalk.dim(`  Results: ${jsonPath}`));
  console.log(chalk.dim(`  Report:  ${mdPath}`));
  console.log('');
  console.log(report);
}

export function runBenchReport(opts: { run?: string } = {}): void {
  const cwd = process.cwd();
  const runId = opts.run ?? latestRunId(cwd);
  if (!runId) {
    console.error(chalk.red('  No bench runs found. Run `mint bench` first.'));
    process.exit(1);
  }
  const run = loadRun(cwd, runId);
  console.log(renderReport(cwd, run));
}
