import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { login, logout, whoami, signup } from './commands/auth.js';
import { loginWithBrowser } from './commands/login-browser.js';
import { showConfig, setConfig } from './commands/config.js';
import { showUsage } from './commands/usage.js';
import { showQuota } from './commands/quota.js';
import { showAccount } from './commands/account.js';
import { runDoctor } from './commands/doctor.js';
import { config } from '../utils/config.js';

const program = new Command();

program
  .name('mint')
  .description('AI coding CLI with smart model routing')
  .version('0.1.0');

// Main command - run a prompt
program
  .argument('[prompt...]', 'The prompt to send to the AI')
  .option('-m, --model <model>', 'Model to use (auto, deepseek, sonnet, opus)', 'auto')
  .option('-v, --verbose', 'Show detailed output including tokens and cost')
  .option('--auto', 'Auto mode — apply changes without asking')
  .option('--yolo', 'Full autonomy — no approvals at all')
  .option('--plan', 'Plan mode — dry run, no writes')
  .option('--diff', 'Diff mode — review each file change')
  .option('--think', 'Prefer reasoning-enabled models')
  .option('--fast', 'Prefer low-latency models')
  .action(async (promptParts: string[], options) => {
    const prompt = promptParts.join(' ').trim();
    const brainMode: 'plan' | 'diff' | 'auto' | 'yolo' = options.yolo
      ? 'yolo'
      : options.plan
      ? 'plan'
      : options.diff
      ? 'diff'
      : options.auto
      ? 'auto'
      : 'diff';

    if (!prompt) {
      // No args → run onboarding checks first.
      // If user is not authenticated or project isn't indexed, route them
      // through a friendly welcome flow instead of dropping into an empty TUI.
      const { runOnboarding } = await import('./onboarding.js');
      const onboardingHandled = await runOnboarding();
      if (onboardingHandled) return;

      // Ready — open the TUI.
      const { render } = await import('ink');
      const React = await import('react');
      const { BrainApp } = await import('../tui/BrainApp.js');
      const app = render(
        React.default.createElement(BrainApp, {
          modelPreference: options.model,
          agentMode: brainMode,
        })
      );
      await app.waitUntilExit();
      return;
    }

    await runOneShotBrain(prompt, {
      model: options.model,
      think: options.think,
      fast: options.fast,
      auto: options.auto || options.yolo,
    });
  });

// Exec command — headless mode for agent integration
program
  .command('exec')
  .description('Run a task headless — JSON output to stdout, for agent integration')
  .argument('<task...>', 'Task description')
  .option('--apply', 'Auto-apply diffs to files on disk')
  .option('--think', 'Force deepseek-reasoner (thinking mode)')
  .option('--fast', 'Force deepseek-chat (fast mode)')
  .option('--pipe', 'Read task from stdin as JSON')
  .option('--max-tool-calls <n>', 'Max tool calls per task', '5')
  .option('-w, --workdir <dir>', 'Working directory')
  .action(async (taskParts: string[], options) => {
    if (options.pipe) {
      const { runPipeMode } = await import('./protocol.js');
      await runPipeMode();
      return;
    }

    const task = taskParts.join(' ').trim();
    if (!task) {
      process.stderr.write('[mint] Error: task description required\n');
      process.exit(1);
    }

    const { runExec } = await import('./exec.js');
    const result = await runExec({
      task,
      apply: options.apply ?? false,
      think: options.think ?? false,
      fast: options.fast ?? false,
      maxToolCalls: parseInt(options.maxToolCalls, 10) || 5,
      workdir: options.workdir,
    });

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');

    if (!result.success) process.exit(1);
    else if (!result.diffs?.length && result.message) process.exit(2);
    else process.exit(0);
  });

// Cost history command
program
  .command('cost')
  .description('Show cost history from recent tasks')
  .action(async () => {
    const { getUsageDb } = await import('../usage/tracker.js');
    const db = getUsageDb();
    const summary = db.getSummary();
    console.log(chalk.cyan('\n  Mint Cost Summary\n'));
    console.log(`  Total requests: ${summary.totalRequests}`);
    console.log(`  Total cost:     $${summary.totalCost.toFixed(4)}`);
    const totalSaved = db.getTotalSaved();
    console.log(`  Saved vs Opus:  $${totalSaved.toFixed(2)}`);
    console.log('');
  });

// Auth commands
program
  .command('signup')
  .description('Sign in with GitHub or Google in your browser (recommended)')
  .action(async () => { await loginWithBrowser(); });

program
  .command('login')
  .description('Sign in via the browser (GitHub / Google) — same as `signup`')
  .action(async () => { await loginWithBrowser(); });

program
  .command('login:password')
  .description('Sign in with email + password (legacy)')
  .action(login);

program
  .command('signup:password')
  .description('Create an account with email + password (legacy)')
  .action(signup);

program
  .command('logout')
  .description('Clear local credentials')
  .action(logout);

program
  .command('whoami')
  .description('Show current user info')
  .action(whoami);

// Config commands
program
  .command('config')
  .description('Show current configuration')
  .action(showConfig);

program
  .command('config:set <key> <value>')
  .description('Set a configuration value')
  .action(setConfig);

// Trace command — reliability/observability for brain runs
program
  .command('trace [sessionId]')
  .description('List recent agent sessions, or replay one by session id')
  .option('-n, --limit <n>', 'How many sessions to list', '20')
  .option('--tail', 'Follow the most recent live session')
  .action(async (sessionId: string | undefined, options: { limit?: string; tail?: boolean }) => {
    const { runTraceList, runTraceReplay, runTraceTail } = await import('./commands/trace.js');
    if (options.tail) {
      await runTraceTail();
      return;
    }
    if (sessionId) {
      runTraceReplay(sessionId);
      return;
    }
    runTraceList(parseInt(options.limit ?? '20', 10) || 20);
  });

// Resume command — re-open a session with prior task context as a hint
program
  .command('resume <sessionId>')
  .description('Open the TUI seeded with the context of a prior session')
  .action(async (sessionId: string) => {
    const { runResume } = await import('./commands/resume.js');
    await runResume(sessionId);
  });

// Tune command — outcomes-driven classifier and route tuning
program
  .command('tune')
  .description('Analyze recent outcomes and propose routing changes')
  .option('--apply', 'Write proposed changes to .mint/routing.json (default is dry-run)')
  .option('--min-samples <n>', 'Minimum outcomes per (kind, model) before suggesting a swap', '30')
  .option('--limit <n>', 'How many recent outcomes to analyze', '200')
  .action(async (options: { apply?: boolean; minSamples?: string; limit?: string }) => {
    const { runTune } = await import('./commands/tune.js');
    await runTune({
      apply: options.apply,
      minSamples: parseInt(options.minSamples ?? '30', 10) || 30,
      limit: parseInt(options.limit ?? '200', 10) || 200,
    });
  });

// Usage command (legacy text view)
program
  .command('usage:legacy')
  .description('Show usage statistics (legacy text view)')
  .option('-d, --days <days>', 'Number of days to show', '7')
  .action(showUsage);

// Usage dashboard command (Ink TUI)
program
  .command('usage')
  .description('Show interactive usage dashboard with savings vs Claude Opus')
  .action(async () => {
    const { renderDashboard } = await import('../usage/dashboard.js');
    await renderDashboard();
  });

// Quota command — show remaining free requests
program
  .command('quota')
  .description('Show your free tier usage and remaining requests')
  .action(showQuota);

// Cost report — per-session cost with prompt-cache breakdown.
program
  .command('cost-report')
  .description('Per-session cost breakdown with cache hit rate + savings')
  .option('--since <days>', 'How many days back to include', '30')
  .option('--limit <n>', 'Max rows to show', '100')
  .option('--by <field>', 'Group by: developer | model | day')
  .option('--developer <id>', 'Filter to a single developer (email / username)')
  .option('--export <fmt>', 'Export format: csv | json')
  .action(async (opts) => {
    const { runCostReport } = await import('./commands/cost-report.js');
    await runCostReport(opts);
  });

// Account dashboard command
program
  .command('account')
  .description('Show account overview with usage, quota, and settings')
  .action(showAccount);

// Doctor command — diagnose common setup issues
program
  .command('doctor')
  .description('Run health checks to diagnose setup issues')
  .action(runDoctor);

// Savings command — one-liner for sharing
program
  .command('savings')
  .description('Show total $ saved vs Claude Opus (shareable one-liner)')
  .action(async () => {
    const { getUsageDb } = await import('../usage/tracker.js');
    const db = getUsageDb();
    const summary = db.getSummary();
    const totalSaved = db.getTotalSaved();
    const { totalRequests, totalCost } = summary;
    const avgSavingsPct = totalCost + totalSaved > 0
      ? Math.round((totalSaved / (totalCost + totalSaved)) * 100)
      : 0;
    console.log(
      chalk.green(`$${totalSaved.toFixed(2)} saved vs Claude Opus`) +
      chalk.dim(` (${totalRequests} requests · ${avgSavingsPct}% avg savings)`)
    );
  });

// Chat TUI command
program
  .command('chat')
  .description('Start interactive AI chat session')
  .argument('[prompt...]', 'Optional initial prompt')
  .option('-m, --model <model>', 'Model to use (auto, deepseek, sonnet, opus)', 'auto')
  .option('--auto', 'Auto mode — apply changes without asking')
  .option('--yolo', 'Full autonomy — no approvals at all')
  .option('--plan', 'Plan mode — ask clarifying questions first')
  .option('--diff', 'Diff mode — review each file change')
  .action(async (promptParts: string[], options) => {
    const { render } = await import('ink');
    const React = await import('react');
    const { BrainApp } = await import('../tui/BrainApp.js');
    const initialPrompt = promptParts.join(' ').trim();
    const brainMode: 'plan' | 'diff' | 'auto' | 'yolo' = options.yolo
      ? 'yolo'
      : options.plan
      ? 'plan'
      : options.diff
      ? 'diff'
      : options.auto
      ? 'auto'
      : 'diff';

    const app = render(
      React.default.createElement(BrainApp, {
        initialPrompt: initialPrompt || undefined,
        modelPreference: options.model,
        agentMode: brainMode,
      })
    );
    await app.waitUntilExit();
  });

// Agent command
program
  .command('agent')
  .description('Run the AI coding agent on a task (autonomous tool use)')
  .argument('[task...]', 'Task description for the agent')
  .option('-m, --model <model>', 'Model to use (default: deepseek-v3)', 'deepseek-v3')
  .option('-v, --verbose', 'Show verbose output')
  .option('--auto', 'Auto mode — skip approval prompts except risky bash commands')
  .option('--yolo', 'No approvals — full autonomy mode')
  .option('--plan', 'Plan only — no writes, show intent')
  .option('--diff', 'Show diffs and require approval for each change')
  .action(async (taskParts: string[], options) => {
    const task = taskParts.join(' ').trim();
    if (!task) {
      console.error(chalk.red('Error: task description required. Example: mint agent "add a hello world function"'));
      process.exit(1);
    }
    const mode: 'yolo' | 'plan' | 'diff' | 'auto' = resolveAgentMode(options);
    await runOneShotBrain(task, {
      model: options.model,
      auto: mode === 'auto' || mode === 'yolo',
    });
  });

// Models command
program
  .command('models')
  .description('List available models and their tiers')
  .action(async () => {
    const { listModels } = await import('../providers/index.js');
    const { getTier } = await import('../providers/tiers.js');
    for (const m of listModels()) {
      const tier = getTier(m.id as import('../providers/types.js').ModelId);
      console.log(`${m.id.padEnd(22)} ${m.provider.padEnd(12)} ${tier}`);
    }
  });

// Init command — scan project, build search index
program
  .command('init')
  .description('Scan project and build search index')
  .option('-f, --force', 'Re-index even if a recent index already exists')
  .action(async (options: { force?: boolean }) => {
    const { indexProject } = await import('../context/index.js');
    const cwd = process.cwd();

    // Warn about re-init when a recent index already exists. We don't block —
    // re-indexing is cheap and sometimes needed — but we let the user cancel
    // if they ran `mint init` accidentally.
    if (!options.force) {
      try {
        const { existsSync, statSync } = await import('node:fs');
        const indexPath = join(cwd, '.mint', 'context.json');
        if (existsSync(indexPath)) {
          const ageMs = Date.now() - statSync(indexPath).mtimeMs;
          const ageHours = ageMs / (1000 * 60 * 60);
          if (ageHours < 1) {
            const mins = Math.max(1, Math.round(ageMs / 60_000));
            const { createInterface } = await import('node:readline');
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise<string>((resolve) => {
              rl.question(
                chalk.yellow(`  This project was indexed ${mins}m ago. Re-index now? [y/N] `),
                (a) => { rl.close(); resolve(a.trim().toLowerCase()); }
              );
            });
            if (answer !== 'y' && answer !== 'yes') {
              console.log(chalk.dim('  Skipped. Run ') + chalk.cyan('mint init --force') + chalk.dim(' to override.\n'));
              return;
            }
          }
        }
      } catch { /* stat failed — just proceed with init */ }
    }

    console.log(chalk.cyan('\n  Mint Init\n'));
    console.log(chalk.dim('  Scanning project...\n'));

    const index = await indexProject(cwd, {
      onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
    });

    // Show summary
    const languages = new Map<string, number>();
    for (const file of Object.values(index.files)) {
      const lang = file.language || 'other';
      languages.set(lang, (languages.get(lang) ?? 0) + 1);
    }
    const topLangs = [...languages.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, count]) => `${lang} (${count})`)
      .join(', ');

    // Check for package.json dependencies
    let depCount = 0;
    try {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      depCount = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    } catch { /* no package.json */ }

    // Generate MINT.md with auto-detected conventions
    const { existsSync, readFileSync: readFs, writeFileSync: writeFs, mkdirSync: mkFs } = await import('node:fs');
    const { join: joinPath } = await import('node:path');
    const mintMdPath = joinPath(cwd, 'MINT.md');

    if (!existsSync(mintMdPath)) {
      const mintMd = await generateMintMd(cwd, index, topLangs, depCount);
      writeFs(mintMdPath, mintMd, 'utf-8');
      console.log(chalk.dim(`  Generated MINT.md`));
    } else {
      console.log(chalk.dim(`  MINT.md already exists — skipped`));
    }

    // Generate starter skills
    const { generateStarterSkills } = await import('../context/project-rules.js');
    const createdSkills = await generateStarterSkills(cwd);
    if (createdSkills.length > 0) {
      console.log(chalk.dim(`  Generated ${createdSkills.length} starter skill(s) in .mint/skills/`));
    } else {
      console.log(chalk.dim(`  Skills already exist — skipped`));
    }

    // Generate golden examples
    const { generateExamples } = await import('../context/examples.js');
    const examplesIndex = await generateExamples(cwd);
    const exCount = examplesIndex.examples.length;
    if (exCount > 0) {
      const cats = [...new Set(examplesIndex.examples.map(e => e.category))];
      console.log(chalk.dim(`  Found ${exCount} golden example(s): ${cats.join(', ')}`));
    } else {
      console.log(chalk.dim(`  No golden examples found (project may be too small)`));
    }

    // Generate .mint/config.json
    const { initMintConfig } = await import('../utils/mint-config.js');
    await initMintConfig(cwd);
    console.log(chalk.dim(`  Config: .mint/config.json`));

    console.log(chalk.green(`\n  Ready.`));
    console.log(chalk.dim(`  ${index.totalFiles} files · ${index.totalLOC.toLocaleString()} lines of code`));
    console.log(chalk.dim(`  Languages: ${topLangs}`));
    if (depCount > 0) console.log(chalk.dim(`  ${depCount} dependencies`));
    console.log(chalk.dim(`  Index: .mint/context.json`));
    console.log(chalk.dim(`\n  Run ${chalk.cyan('mint')} to start editing.\n`));

    // Track init (fire and forget)
    try {
      const { config: appConfig } = await import('../utils/config.js');
      const gatewayUrl = appConfig.get('apiBaseUrl') as string ?? 'https://api.usemint.dev';
      fetch(`${gatewayUrl}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'init', files_indexed: index.totalFiles, language: index.language }),
      }).catch(() => {});
    } catch { /* ignore */ }
  });

// Skills command
program
  .command('skills')
  .description('List all skills in .mint/skills/')
  .action(async () => {
    const { loadSkills } = await import('../context/skills.js');
    const skills = loadSkills(process.cwd());
    if (skills.length === 0) {
      console.log(chalk.dim('No skills found. Run mint init to generate starter skills.'));
      return;
    }
    for (const skill of skills) {
      const applies = skill.appliesTo === 'all' ? 'all' : (skill.appliesTo as string[]).join(', ');
      console.log(`  ${chalk.cyan(skill.name)} ${chalk.dim(`\u2192 ${applies}`)}`);
    }
  });

// Parse and run
program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});

function resolveAgentMode(options: {
  auto?: boolean;
  yolo?: boolean;
  plan?: boolean;
  diff?: boolean;
}): 'yolo' | 'plan' | 'diff' | 'auto' {
  if (options.yolo) return 'yolo';
  if (options.plan) return 'plan';
  if (options.auto) return 'auto';
  if (options.diff) return 'diff';

  const envMode = process.env.MINT_AGENT_MODE?.trim().toLowerCase();
  if (envMode === 'yolo' || envMode === 'plan' || envMode === 'diff' || envMode === 'auto') {
    return envMode;
  }

  const humanInLoop = parseHumanInLoopEnv(process.env.MINT_HUMAN_IN_THE_LOOP);
  if (humanInLoop != null) {
    return humanInLoop ? 'diff' : 'auto';
  }

  return 'diff';
}

function parseHumanInLoopEnv(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined;

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return true;
}

// ─── MINT.md generator ─────────────────────────────────────────────────────

async function generateMintMd(
  cwd: string,
  index: { totalFiles: number; totalLOC: number; language: string; files: Record<string, unknown> },
  topLangs: string,
  depCount: number,
): Promise<string> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const lines: string[] = ['# Project Instructions for Mint CLI', ''];

  // Detect framework
  let framework = '';
  let buildCmd = '';
  let testCmd = '';
  let lintCmd = '';

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['next']) { framework = 'Next.js'; buildCmd = 'npm run build'; }
    else if (deps['vite']) { framework = 'Vite'; buildCmd = 'npm run build'; }
    else if (deps['react']) { framework = 'React'; buildCmd = 'npm run build'; }
    else if (deps['vue']) { framework = 'Vue'; buildCmd = 'npm run build'; }
    else if (deps['svelte']) { framework = 'Svelte'; buildCmd = 'npm run build'; }
    else if (deps['express'] || deps['hono'] || deps['fastify']) { framework = 'Node.js server'; buildCmd = 'npm run build'; }

    if (pkg.scripts?.build) buildCmd = 'npm run build';
    if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') testCmd = 'npm test';
    if (pkg.scripts?.lint) lintCmd = 'npm run lint';
    if (deps['typescript'] || deps['tsup'] || deps['tsc']) {
      if (!buildCmd) buildCmd = 'npx tsc --noEmit';
    }

    lines.push(`## Project`);
    lines.push(`- **Name**: ${pkg.name ?? 'unnamed'}`);
    if (framework) lines.push(`- **Framework**: ${framework}`);
    lines.push(`- **Language**: ${index.language}`);
    lines.push(`- **Files**: ${index.totalFiles} (${index.totalLOC.toLocaleString()} LOC)`);
    if (depCount > 0) lines.push(`- **Dependencies**: ${depCount}`);
    lines.push('');
  } catch {
    lines.push(`## Project`);
    lines.push(`- **Language**: ${index.language}`);
    lines.push(`- **Files**: ${index.totalFiles} (${index.totalLOC.toLocaleString()} LOC)`);
    lines.push('');
  }

  // Commands
  lines.push(`## Commands`);
  if (buildCmd) lines.push(`- **Build**: \`${buildCmd}\``);
  if (testCmd) lines.push(`- **Test**: \`${testCmd}\``);
  if (lintCmd) lines.push(`- **Lint**: \`${lintCmd}\``);
  if (!buildCmd && !testCmd && !lintCmd) lines.push('- No build/test/lint scripts detected');
  lines.push('');

  // Conventions
  lines.push(`## Conventions`);
  lines.push(`- Match existing code style (indentation, naming, imports)`);
  if (index.language === 'typescript') {
    lines.push(`- Use TypeScript types — no \`any\` unless necessary`);
    lines.push(`- Prefer \`const\` over \`let\``);
  }
  lines.push(`- Keep changes minimal and focused`);
  lines.push(`- Run build after changes to verify`);
  lines.push('');

  // Structure hints
  const dirs = new Set<string>();
  for (const filePath of Object.keys(index.files)) {
    const parts = filePath.split('/');
    if (parts.length > 1) dirs.add(parts[0]);
  }
  if (dirs.size > 0) {
    lines.push(`## Key Directories`);
    for (const dir of [...dirs].sort().slice(0, 10)) {
      const count = Object.keys(index.files).filter((f) => f.startsWith(dir + '/')).length;
      lines.push(`- \`${dir}/\` (${count} files)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Brain one-shot runner ──────────────────────────────────────────────────

async function runOneShotBrain(
  prompt: string,
  options: { model?: string; think?: boolean; fast?: boolean; auto?: boolean },
): Promise<void> {
  const { runHeadless } = await import('../brain/index.js');
  const cwd = process.cwd();

  const abort = new AbortController();
  const onSigint = () => {
    abort.abort();
    console.log(chalk.yellow('\n  Interrupted'));
  };
  process.on('SIGINT', onSigint);

  const overrideModel = options.model && options.model !== 'auto' ? options.model : undefined;

  try {
    const { result, error } = await runHeadless({
      task: prompt,
      cwd,
      mode: options.auto ? 'auto' : 'auto',
      signal: abort.signal,
      model: overrideModel as import('../providers/types.js').ModelId | undefined,
      reasoning: options.think ? true : options.fast ? false : undefined,
      onEvent: (event) => {
        switch (event.type) {
          case 'classify':
            process.stderr.write(
              chalk.dim(
                `  [classify] ${event.kind} · ${event.complexity} · ${event.model} (conf ${event.confidence.toFixed(2)})\n`,
              ),
            );
            break;
          case 'context.retrieved':
            process.stderr.write(
              chalk.dim(`  [context] ${event.files.length} files · ${event.tokensUsed} tokens\n`),
            );
            break;
          case 'tool.call':
            process.stderr.write(chalk.dim(`  [tool] ${event.name}\n`));
            break;
          case 'tool.result':
            if (!event.ok) {
              process.stderr.write(chalk.red(`  [error] ${event.output.slice(0, 120)}\n`));
            }
            break;
          case 'diff.applied':
            process.stderr.write(
              chalk.green(`  + ${event.file}`) +
                chalk.dim(` (+${event.additions} -${event.deletions})\n`),
            );
            break;
          case 'text.delta':
            process.stdout.write(event.text);
            break;
          case 'warn':
            process.stderr.write(chalk.yellow(`  [warn] ${event.message}\n`));
            break;
          case 'error':
            process.stderr.write(chalk.red(`  [error] ${event.error}\n`));
            break;
        }
      },
    });

    process.stdout.write('\n');

    if (error) {
      console.error(chalk.red(`  Error: ${error}`));
      process.exit(1);
    }

    if (!result) {
      console.error(chalk.red('  Brain produced no result'));
      process.exit(1);
    }

    try {
      const { trackBrainRun } = await import('../usage/tracker.js');
      trackBrainRun({
        sessionId: Date.now().toString(36),
        task: prompt,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.totalCostUsd,
        durationMs: result.durationMs,
      });
    } catch {
      /* best-effort */
    }

    const filesCount = result.filesTouched.length;
    if (filesCount > 0) {
      console.log(chalk.cyan(`\n  Touched ${filesCount} file${filesCount === 1 ? '' : 's'}:`));
      for (const f of result.filesTouched) console.log(chalk.dim(`  - ${f}`));
    }

    const totalTokens = result.inputTokens + result.outputTokens;
    console.log(
      chalk.dim(
        `\n  $${result.totalCostUsd.toFixed(4)} · ${(result.durationMs / 1000).toFixed(1)}s · ${totalTokens} tokens · ${result.model}`,
      ),
    );
    console.log('');
  } finally {
    process.off('SIGINT', onSigint);
  }
}
