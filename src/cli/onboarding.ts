import chalk from 'chalk';
import boxen from 'boxen';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { config } from '../utils/config.js';

/**
 * Shows a beautiful welcome screen for first-time users
 * and routes them to the right starting point.
 *
 * Returns true if onboarding handled the flow (user should NOT enter TUI).
 * Returns false if user is ready → proceed to TUI.
 */
export async function runOnboarding(): Promise<boolean> {
  const authed = config.isAuthenticated();
  const cwd = process.cwd();
  const indexed = existsSync(join(cwd, '.mint', 'context.json'));
  const hasOwnKeys = hasAnyProviderKey();

  // Path 1: Brand new user — not authenticated, no keys
  if (!authed && !hasOwnKeys) {
    await showFirstRunWelcome();
    return true;
  }

  // Path 2: Authenticated but project not indexed
  if (!indexed) {
    const proceed = await showInitPrompt();
    if (!proceed) return true;
    // Run init, then fall through to TUI
    await runInit();
    return false;
  }

  // Path 3: Ready to go — show a quick hint then enter TUI
  return false;
}

function hasAnyProviderKey(): boolean {
  const providers = config.get('providers') ?? {};
  return Object.values(providers).some((v) => !!v);
}

function printLogo(): void {
  const LOGO = [
    '  ███╗   ███╗██╗███╗   ██╗████████╗     ██████╗██╗     ██╗',
    '  ████╗ ████║██║████╗  ██║╚══██╔══╝    ██╔════╝██║     ██║',
    '  ██╔████╔██║██║██╔██╗ ██║   ██║       ██║     ██║     ██║',
    '  ██║╚██╔╝██║██║██║╚██╗██║   ██║       ██║     ██║     ██║',
    '  ██║ ╚═╝ ██║██║██║ ╚████║   ██║       ╚██████╗███████╗██║',
    '  ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝╚══════╝╚═╝',
  ];
  console.log('');
  for (const line of LOGO) console.log(chalk.cyan(line));
  console.log('');
  console.log(chalk.dim('  AI coding assistant · 98% cheaper than Claude Opus'));
  console.log('');
}

async function showFirstRunWelcome(): Promise<void> {
  printLogo();

  console.log(
    boxen(
      chalk.bold.cyan('Welcome to Mint! 🎉') +
        '\n\n' +
        chalk.white('Get started in 30 seconds:') +
        '\n\n' +
        chalk.green('  1.') +
        ' Create a free account ' +
        chalk.dim('(50 requests/month, no card)') +
        '\n' +
        chalk.green('  2.') +
        ' Run ' +
        chalk.cyan('mint init') +
        ' in your project folder\n' +
        chalk.green('  3.') +
        ' Type ' +
        chalk.cyan('mint "your task"') +
        ' and watch it code\n\n' +
        chalk.dim('  — or —') +
        '\n\n' +
        chalk.white('Bring your own API keys ') +
        chalk.dim('(free forever, BYOK):') +
        '\n\n' +
        chalk.cyan('  mint config:set providers.deepseek <your-key>'),
      { padding: 1, borderColor: 'cyan', borderStyle: 'round', width: 64 },
    ),
  );

  console.log('');
  const choice = await promptChoice(
    '  What would you like to do?',
    [
      { key: '1', label: 'Create free account (recommended)', cmd: 'signup' },
      { key: '2', label: 'Sign in to existing account', cmd: 'login' },
      { key: '3', label: 'Use my own API keys', cmd: 'byok' },
      { key: '4', label: 'Show me more info', cmd: 'info' },
    ],
  );

  console.log('');

  switch (choice) {
    case 'signup': {
      const { signup } = await import('./commands/auth.js');
      await signup();
      console.log(chalk.dim('\n  Next: ') + chalk.cyan('mint init') + chalk.dim(' to scan your project\n'));
      return;
    }
    case 'login': {
      const { login } = await import('./commands/auth.js');
      await login();
      console.log(chalk.dim('\n  Next: ') + chalk.cyan('mint init') + chalk.dim(' to scan your project\n'));
      return;
    }
    case 'byok': {
      console.log(
        boxen(
          chalk.bold('Bring Your Own Keys') +
            '\n\n' +
            chalk.dim('Get keys from any of these:') +
            '\n\n' +
            chalk.cyan('  DeepSeek') +
            chalk.dim('  https://platform.deepseek.com') +
            chalk.dim('  (cheapest)') +
            '\n' +
            chalk.cyan('  Anthropic') +
            chalk.dim(' https://console.anthropic.com') +
            '\n' +
            chalk.cyan('  OpenAI') +
            chalk.dim('    https://platform.openai.com') +
            '\n' +
            chalk.cyan('  Gemini') +
            chalk.dim('    https://ai.google.dev') +
            chalk.dim('              (free tier)') +
            '\n\n' +
            chalk.white('Then run:') +
            '\n\n' +
            chalk.cyan('  mint config:set providers.deepseek <your-key>'),
          { padding: 1, borderColor: 'yellow', borderStyle: 'round' },
        ),
      );
      console.log('');
      return;
    }
    case 'info':
    default: {
      console.log(chalk.bold('  Why Mint?\n'));
      console.log('  ' + chalk.green('✓') + ' 98% cheaper than Claude Opus');
      console.log('  ' + chalk.green('✓') + ' Smart routing — cheap for easy tasks, powerful for complex');
      console.log('  ' + chalk.green('✓') + ' Most tasks under $0.01');
      console.log('  ' + chalk.green('✓') + ' 50 free requests/month to try it out');
      console.log('  ' + chalk.green('✓') + ' Own your keys, fully local if you want');
      console.log('');
      console.log(chalk.dim('  Docs: https://usemint.dev'));
      console.log(chalk.dim('  Run ') + chalk.cyan('mint') + chalk.dim(' again when you are ready.\n'));
      return;
    }
  }
}

async function showInitPrompt(): Promise<boolean> {
  console.log('');
  console.log(
    boxen(
      chalk.bold.yellow('One more step') +
        '\n\n' +
        chalk.white('This project hasn\'t been indexed yet.') +
        '\n' +
        chalk.dim('Indexing builds a search index so Mint can find relevant files fast.') +
        '\n\n' +
        chalk.dim('It takes ~5 seconds and only runs once.'),
      { padding: 1, borderColor: 'yellow', borderStyle: 'round' },
    ),
  );
  console.log('');

  const answer = await promptYesNo('  Run ' + chalk.cyan('mint init') + ' now?', true);
  if (!answer) {
    console.log('');
    console.log(chalk.dim('  No problem. Run ') + chalk.cyan('mint init') + chalk.dim(' when you are ready.\n'));
    return false;
  }
  return true;
}

async function runInit(): Promise<void> {
  console.log('');
  // Reuse the existing init flow
  const { indexProject } = await import('../context/index.js');
  const cwd = process.cwd();
  console.log(chalk.cyan('  Indexing...'));
  const index = await indexProject(cwd, {
    onProgress: (msg: string) => console.log(chalk.dim(`  ${msg}`)),
  });
  console.log(
    chalk.green('  ✓ Indexed ') +
      chalk.bold(String(index.totalFiles)) +
      chalk.dim(' files (') +
      chalk.bold(index.totalLOC.toLocaleString()) +
      chalk.dim(' lines)'),
  );
  console.log('');
}

// ─── Simple input helpers ──────────────────────────────────────────────────

function promptChoice(
  question: string,
  options: Array<{ key: string; label: string; cmd: string }>,
): Promise<string> {
  console.log(chalk.white(question) + '\n');
  for (const opt of options) {
    console.log('  ' + chalk.cyan.bold(opt.key) + chalk.dim(')') + ' ' + opt.label);
  }
  console.log('');

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.dim('  Choose [1-' + options.length + ']: '), (answer) => {
      rl.close();
      const trimmed = answer.trim();
      const match = options.find((o) => o.key === trimmed);
      resolve(match?.cmd ?? options[0].cmd);
    });
  });
}

function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const hint = defaultYes ? chalk.dim(' [Y/n] ') : chalk.dim(' [y/N] ');
    rl.question(question + hint, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) return resolve(defaultYes);
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}
