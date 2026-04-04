import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { runPrompt } from './commands/run.js';
import { login, logout, whoami, signup } from './commands/auth.js';
import { showConfig, setConfig } from './commands/config.js';
import { compareModels } from './commands/compare.js';
import { showUsage } from './commands/usage.js';

const program = new Command();

program
  .name('mint')
  .description('AI coding CLI with smart model routing')
  .version('0.1.0');

// Main command - run a prompt
program
  .argument('[prompt...]', 'The prompt to send to the AI')
  .option('-m, --model <model>', 'Model to use (auto, deepseek, sonnet, opus)', 'auto')
  .option('-c, --compare', 'Compare results across models')
  .option('--no-context', 'Disable automatic context gathering')
  .option('-v, --verbose', 'Show detailed output including tokens and cost')
  .option('--v2', 'V2 orchestrator mode — single smart loop with tool calling')
  .option('--simple', 'Simple mode — one LLM call, no agents, just diffs')
  .option('--legacy', 'Use legacy single-call mode instead of pipeline')
  .option('--auto', 'Auto mode — apply changes without asking')
  .option('--yolo', 'Full autonomy — no approvals at all')
  .option('--plan', 'Plan mode — ask clarifying questions first')
  .option('--diff', 'Diff mode — review each file change')
  .action(async (promptParts: string[], options) => {
    const prompt = promptParts.join(' ').trim();
    const agentMode = options.yolo ? 'yolo' : options.plan ? 'plan' : options.diff ? 'diff' : options.auto ? 'auto' : undefined;

    if (options.simple && prompt) {
      const { runSimple } = await import('./commands/simple.js');
      await runSimple(prompt);
      return;
    }

    if (!prompt) {
      // No args → open TUI with orchestrator
      const { render } = await import('ink');
      const React = await import('react');
      const { App } = await import('../tui/App.js');
      const app = render(
        React.default.createElement(App, {
          modelPreference: options.model,
          agentMode,
          useOrchestrator: !options.legacy,
        })
      );
      await app.waitUntilExit();
      return;
    }

    // Legacy pipeline mode
    if (options.legacy) {
      await runOneShotPipeline(prompt, options);
      return;
    }

    // Default: v2 orchestrator
    const { runOrchestratorCLI } = await import('./commands/orchestrator.js');
    await runOrchestratorCLI(prompt);
  });

// Auth commands
program
  .command('signup')
  .description('Create a new Mint account')
  .action(signup);

program
  .command('login')
  .description('Login with email and password')
  .action(login);

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

// Compare command
program
  .command('compare <prompt...>')
  .description('Run prompt on multiple models and compare results')
  .option('--models <models>', 'Comma-separated list of models', 'deepseek,sonnet')
  .action(async (promptParts: string[], options) => {
    const prompt = promptParts.join(' ');
    await compareModels(prompt, options);
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
    const { App } = await import('../tui/App.js');
    const initialPrompt = promptParts.join(' ').trim();
    const agentMode = options.yolo ? 'yolo' : options.plan ? 'plan' : options.diff ? 'diff' : options.auto ? 'auto' : undefined;
    const app = render(
      React.default.createElement(App, {
        initialPrompt: initialPrompt || undefined,
        modelPreference: options.model,
        agentMode,
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
      console.error(chalk.red('Error: task description required. Example: axon agent "add a hello world function"'));
      process.exit(1);
    }
    const { runAgent } = await import('../agent/index.js');
    type AgentMode = 'yolo' | 'plan' | 'diff' | 'auto';
    const mode: AgentMode = resolveAgentMode(options);

    const abortController = new AbortController();

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      abortController.abort();
      process.stdout.write('\n' + chalk.yellow('[agent] Interrupted\n'));
      process.exit(0);
    });

    console.log(chalk.cyan(`\n[axon agent] Task: ${task}`));
    console.log(chalk.gray(`[axon agent] Model: ${options.model} | Mode: ${mode} | cwd: ${process.cwd()}\n`));

    // Interactive approval callbacks (used in auto/diff modes)
    const readline = await import('node:readline');

    const onIterationApprovalNeeded = async (
      iteration: number,
      toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
    ): Promise<boolean> => {
      console.log(chalk.blue(`\n[review] Iteration ${iteration} proposes destructive actions:`));
      for (const toolCall of toolCalls) {
        const preview = JSON.stringify(toolCall.input).slice(0, 120);
        console.log(chalk.dim(`  - ${toolCall.name} ${preview}`));
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise(resolve => {
        rl.question(chalk.yellow('Continue with this iteration? [y/N] '), (answer) => {
          rl.close();
          resolve(answer.trim().toLowerCase() === 'y');
        });
      });
    };

    const onApprovalNeeded = async (toolName: string, toolInput: Record<string, unknown>): Promise<boolean> => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise(resolve => {
        rl.question(
          chalk.yellow(`\n[approve] ${toolName}(${JSON.stringify(toolInput).slice(0, 80)})\nAllow? [y/n] `),
          (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
          }
        );
      });
    };

    const onDiffProposed = async (filePath: string, diff: string): Promise<boolean> => {
      const { formatRawUnifiedDiff } = await import('../pipeline/index.js');
      console.log(chalk.blue(`\n--- diff: ${filePath} ---`));
      console.log(formatRawUnifiedDiff(diff));
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise(resolve => {
        rl.question(chalk.yellow('Apply? [y/n] '), (answer) => {
          rl.close();
          resolve(answer.trim().toLowerCase() === 'y');
        });
      });
    };

    try {
      await runAgent(task, {
        model: options.model,
        cwd: process.cwd(),
        signal: abortController.signal,
        verbose: options.verbose ?? false,
        mode,
        onApprovalNeeded: mode !== 'yolo' ? onApprovalNeeded : undefined,
        onDiffProposed: mode === 'diff' ? onDiffProposed : undefined,
        onIterationApprovalNeeded: mode === 'diff' ? onIterationApprovalNeeded : undefined,
      });
    } catch (err) {
      console.error(chalk.red('[agent error]'), err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
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
  .action(async () => {
    const { indexProject } = await import('../context/index.js');
    const cwd = process.cwd();

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

    console.log(chalk.green(`\n  Ready.`));
    console.log(chalk.dim(`  ${index.totalFiles} files · ${index.totalLOC.toLocaleString()} lines of code`));
    console.log(chalk.dim(`  Languages: ${topLangs}`));
    if (depCount > 0) console.log(chalk.dim(`  ${depCount} dependencies`));
    console.log(chalk.dim(`  Index: .mint/context.json`));
    console.log(chalk.dim(`\n  Run ${chalk.cyan('mint')} to start editing.\n`));

    // Track init (fire and forget)
    try {
      const gatewayUrl = config.get('apiBaseUrl') as string ?? 'https://api.usemint.dev';
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
): string {
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

// ─── One-shot pipeline ──────────────────────────────────────────────────────

async function runOneShotPipeline(
  task: string,
  options: { model?: string; verbose?: boolean },
): Promise<void> {
  const { runPipeline, formatDiffs, formatCostSummary } = await import('../pipeline/index.js');
  const { createUsageTracker } = await import('../usage/tracker.js');
  const { MODELS } = await import('../providers/types.js');
  const { getTier } = await import('../providers/tiers.js');
  const cwd = process.cwd();

  const modelMap: Record<string, string> = {
    deepseek: 'deepseek-v3', sonnet: 'claude-sonnet-4', opus: 'claude-opus-4',
    gemini: 'gemini-2-flash', groq: 'groq-llama-70b',
  };
  const modelId = options.model && options.model !== 'auto'
    ? (modelMap[options.model] ?? options.model) as import('../providers/types.js').ModelId
    : undefined;

  console.log(chalk.cyan(`\n  Task: ${task}\n`));

  const abortController = new AbortController();
  process.on('SIGINT', () => {
    abortController.abort();
    console.log(chalk.yellow('\n  Interrupted'));
    process.exit(0);
  });

  try {
    let result: import('../pipeline/types.js').PipelineResult | undefined;

    // Stream pipeline events — show each phase as it happens
    for await (const chunk of runPipeline(task, {
      cwd,
      model: modelId,
      signal: abortController.signal,
    })) {
      switch (chunk.type) {
        case 'phase-start': {
          const model = chunk.phaseModel ? chalk.dim(` · ${chunk.phaseModel}`) : '';
          process.stdout.write(chalk.cyan(`  ⟳ ${chunk.phase}${model}...`));
          // Show subtask list for parallel builders
          if (chunk.subtasks && chunk.subtasks.length > 0) {
            process.stdout.write('\n');
            for (let i = 0; i < chunk.subtasks.length; i++) {
              const st = chunk.subtasks[i];
              const prefix = i === chunk.subtasks.length - 1 ? '  └─' : '  ├─';
              console.log(chalk.dim(`${prefix} #${st.id} ${st.description}`));
            }
          }
          break;
        }

        case 'phase-done': {
          // Clear the "⟳ PHASE..." line and replace with "✓ PHASE"
          process.stdout.write('\r\x1B[K'); // clear current line
          const dur = chunk.phaseDuration != null ? chalk.dim(` · ${chunk.phaseDuration < 1000 ? `${chunk.phaseDuration}ms` : `${(chunk.phaseDuration / 1000).toFixed(1)}s`}`) : '';
          const cost = chunk.phaseCost != null ? chalk.dim(` · ${chunk.phaseCost < 0.01 ? `${(chunk.phaseCost * 100).toFixed(3)}¢` : `$${chunk.phaseCost.toFixed(4)}`}`) : '';
          console.log(chalk.green(`  ✓ ${chunk.phase}${dur}${cost}`));
          if (chunk.phaseSummary) {
            console.log(chalk.dim(`    ${chunk.phaseSummary}`));
          }
          // Show completed subtasks
          if (chunk.subtasks && chunk.subtasks.length > 0) {
            for (let i = 0; i < chunk.subtasks.length; i++) {
              const st = chunk.subtasks[i];
              const prefix = i === chunk.subtasks.length - 1 ? '    └─' : '    ├─';
              const stDur = st.duration != null ? ` · ${st.duration < 1000 ? `${st.duration}ms` : `${(st.duration / 1000).toFixed(1)}s`}` : '';
              const stCost = st.cost != null ? ` · ${st.cost < 0.01 ? `${(st.cost * 100).toFixed(3)}¢` : `$${st.cost.toFixed(4)}`}` : '';
              console.log(chalk.dim(`${prefix} ✓ #${st.id} ${st.description}${stDur}${stCost}`));
            }
          }
          break;
        }

        case 'task-start':
          if (chunk.task) {
            console.log(chalk.cyan(`    ⟳ #${chunk.task.subtaskId ?? chunk.task.taskId} ${chunk.task.description}`));
          }
          break;

        case 'task-progress':
          if (chunk.task?.progressSummary) {
            console.log(chalk.dim(`      ${chunk.task.progressSummary}`));
          }
          break;

        case 'task-done':
          if (chunk.task) {
            const suffix = [
              chunk.task.model,
              chunk.task.duration != null ? (chunk.task.duration < 1000 ? `${chunk.task.duration}ms` : `${(chunk.task.duration / 1000).toFixed(1)}s`) : null,
              chunk.task.cost != null ? (chunk.task.cost < 0.01 ? `${(chunk.task.cost * 100).toFixed(3)}¢` : `$${chunk.task.cost.toFixed(4)}`) : null,
            ].filter(Boolean).join(' · ');
            console.log(chalk.green(`    ✓ #${chunk.task.subtaskId ?? chunk.task.taskId} ${chunk.task.description}${suffix ? ` · ${suffix}` : ''}`));
          }
          break;

        case 'task-failed':
          if (chunk.task) {
            console.log(chalk.red(`    ✗ #${chunk.task.subtaskId ?? chunk.task.taskId} ${chunk.task.description}`));
            if (chunk.task.progressSummary) {
              console.log(chalk.red(`      ${chunk.task.progressSummary}`));
            }
          }
          break;

        case 'task-notification':
        case 'task-log':
          break;

        case 'text':
          // Don't show raw text — we'll show formatted diffs from the result
          break;

        case 'done':
          result = chunk.result;
          break;

        case 'error':
          throw new Error(chunk.error);
      }
    }

    if (!result) throw new Error('Pipeline completed without producing a result');

    // Show the response text (without diff blocks or reasoning headers)
    let textWithoutDiffs = result.response
      .replace(/```diff[\s\S]*?```/g, '')
      .replace(/^#{1,3}\s*Reasoning\b.*$/im, '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    textWithoutDiffs = textWithoutDiffs.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (textWithoutDiffs) {
      console.log('\n' + textWithoutDiffs);
    }

    // Show colored diffs
    if (result.diffs.length > 0) {
      console.log(formatDiffs(result.diffs));
    }

    // Show cost summary
    console.log(formatCostSummary(
      result.cost,
      result.opusCost,
      result.duration,
      result.diffs.map(d => d.filePath),
    ));

    // Track usage
    const tracker = createUsageTracker(Date.now().toString(36), 'pipeline');
    const modelInfo = MODELS[result.model];
    tracker.track({
      model: result.model,
      provider: modelInfo?.provider ?? 'unknown',
      tier: getTier(result.model),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cost: result.cost,
      opusCost: result.opusCost,
      savedAmount: Math.max(0, result.opusCost - result.cost),
      routingReason: `pipeline → ${result.model}`,
      taskPreview: task,
      latencyMs: result.duration,
      costSonnet: 0,
    });

    // Apply diffs if any
    if (result.diffs.length > 0) {
      const answer = await askUser('\n  Apply changes? [Y/n] ');
      if (answer.toLowerCase() !== 'n') {
        applyDiffs(result.diffs, cwd);
      } else {
        console.log(chalk.dim('  Changes not applied.'));
      }
    }

    console.log('');
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

async function askUser(prompt: string): Promise<string> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function applyDiffs(
  diffs: import('../pipeline/types.js').ParsedDiff[],
  cwd: string,
): void {
  const cwdAbs = resolve(cwd);
  for (const diff of diffs) {
    const fullPath = resolve(cwdAbs, diff.filePath);
    if (!fullPath.startsWith(cwdAbs + sep) && fullPath !== cwdAbs) {
      console.log(chalk.red(`  ! Blocked path outside project: ${diff.filePath}`));
      continue;
    }

    try {
      // New file (old was /dev/null)
      if (diff.oldContent === '') {
        mkdirSync(dirname(fullPath), { recursive: true });
        const newContent = diff.hunks
          .flatMap(h => h.lines.filter(l => l.type !== 'remove').map(l => l.content))
          .join('\n');
        writeFileSync(fullPath, newContent + '\n', 'utf-8');
        console.log(chalk.green(`  + Created ${diff.filePath}`));
        continue;
      }

      // Edit existing file — apply hunks
      const current = readFileSync(fullPath, 'utf-8');
      let updated = current;

      for (const hunk of diff.hunks) {
        const removeLines = hunk.lines.filter(l => l.type === 'remove').map(l => l.content);
        const addLines = hunk.lines.filter(l => l.type === 'add').map(l => l.content);

        if (removeLines.length > 0) {
          const oldBlock = removeLines.join('\n');
          const newBlock = addLines.join('\n');
          if (updated.includes(oldBlock)) {
            updated = updated.replace(oldBlock, newBlock);
          } else {
            // Fallback: try matching each remove line individually (trimmed)
            // Handles minor whitespace differences in model output
            let fallbackUpdated = updated;
            let allFound = true;
            for (let i = 0; i < removeLines.length; i++) {
              const removeLine = removeLines[i];
              const addLine = addLines[i] ?? '';
              if (fallbackUpdated.includes(removeLine)) {
                fallbackUpdated = fallbackUpdated.replace(removeLine, addLine);
              } else {
                allFound = false;
                break;
              }
            }
            if (allFound && fallbackUpdated !== updated) {
              updated = fallbackUpdated;
            }
          }
        }
      }

      if (updated !== current) {
        writeFileSync(fullPath, updated, 'utf-8');
        console.log(chalk.green(`  ~ Modified ${diff.filePath}`));
      } else {
        console.log(chalk.yellow(`  ? Could not apply diff to ${diff.filePath} (text not found)`));
      }
    } catch (err) {
      console.log(chalk.red(`  ! Error applying to ${diff.filePath}: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}
