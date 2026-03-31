import { Command } from 'commander';
import chalk from 'chalk';
import { runPrompt } from './commands/run.js';
import { login, logout, whoami } from './commands/auth.js';
import { showConfig, setConfig } from './commands/config.js';
import { compareModels } from './commands/compare.js';
import { showUsage } from './commands/usage.js';

const program = new Command();

// ASCII Art Banner
const banner = `
  ███╗   ███╗██╗███╗   ██╗████████╗
  ████╗ ████║██║████╗  ██║╚══██╔══╝
  ██╔████╔██║██║██╔██╗ ██║   ██║
  ██║╚██╔╝██║██║██║╚██╗██║   ██║
  ██║ ╚═╝ ██║██║██║ ╚████║   ██║
  ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝
`;

program
  .name('mint')
  .description('AI coding CLI with smart model routing')
  .version('0.1.0')
  .addHelpText('beforeAll', chalk.cyan(banner));

// Main command - run a prompt
program
  .argument('[prompt...]', 'The prompt to send to the AI')
  .option('-m, --model <model>', 'Model to use (auto, deepseek, sonnet, opus)', 'auto')
  .option('-c, --compare', 'Compare results across models')
  .option('--no-context', 'Disable automatic context gathering')
  .option('-v, --verbose', 'Show detailed output including tokens and cost')
  .action(async (promptParts: string[], options) => {
    const prompt = promptParts.join(' ');
    if (!prompt) {
      program.help();
      return;
    }
    await runPrompt(prompt, options);
  });

// Auth commands
program
  .command('login')
  .description('Login via SSO (opens browser)')
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
  .action(async (promptParts: string[], options) => {
    const { render } = await import('ink');
    const React = await import('react');
    const { App } = await import('../tui/App.js');
    const initialPrompt = promptParts.join(' ').trim();
    const app = render(
      React.default.createElement(App, {
        initialPrompt: initialPrompt || undefined,
        modelPreference: options.model,
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
    const mode: AgentMode =
      options.yolo ? 'yolo' :
      options.plan ? 'plan' :
      options.diff ? 'diff' : 'auto';

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
      console.log(chalk.blue(`\n--- diff: ${filePath} ---`));
      console.log(diff);
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

// Parse and run
program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
