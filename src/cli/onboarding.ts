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

  // Non-interactive terminals (piped input, CI, some IDEs) can't use readline
  // prompts. Print guidance and exit cleanly instead of hanging.
  const isInteractive = !!process.stdin.isTTY;

  // Path 1: Brand new user — not authenticated, no keys
  if (!authed && !hasOwnKeys) {
    if (!isInteractive) {
      printNonInteractiveHint();
      return true;
    }
    await showFirstRunWelcome();
    return true;
  }

  // Path 2: Authenticated but project not indexed
  if (!indexed) {
    if (!isInteractive) {
      console.log(chalk.dim('\n  Tip: run ') + chalk.cyan('mint init') + chalk.dim(' first to index this project.\n'));
      return false; // Still open TUI — the brain will index lazily.
    }
    const proceed = await showInitPrompt();
    if (!proceed) return true;
    // Run init, then fall through to TUI
    await runInit();
    return false;
  }

  // Path 3: Ready to go — show a quick hint then enter TUI
  return false;
}

function printNonInteractiveHint(): void {
  console.log(chalk.cyan('\n  Mint CLI\n'));
  console.log(chalk.white('  Get started:'));
  console.log('    ' + chalk.cyan('mint signup') + chalk.dim('  — create a free account (50 requests/month)'));
  console.log('    ' + chalk.cyan('mint login') + chalk.dim('   — sign in to an existing account'));
  console.log('    ' + chalk.cyan('mint config:set providers.anthropic <key>') + chalk.dim('  — bring your own keys'));
  console.log('');
  console.log(chalk.dim('  Then run ') + chalk.cyan('mint "your task"') + chalk.dim(' or open the TUI with ') + chalk.cyan('mint') + chalk.dim('.\n'));
}

function hasAnyProviderKey(): boolean {
  const providers = config.get('providers') ?? {};
  return Object.values(providers).some((v) => !!v);
}

/** Unicode box-drawing logo — looks great on modern terminals. */
const LOGO_UNICODE = [
  '  ███╗   ███╗██╗███╗   ██╗████████╗     ██████╗██╗     ██╗',
  '  ████╗ ████║██║████╗  ██║╚══██╔══╝    ██╔════╝██║     ██║',
  '  ██╔████╔██║██║██╔██╗ ██║   ██║       ██║     ██║     ██║',
  '  ██║╚██╔╝██║██║██║╚██╗██║   ██║       ██║     ██║     ██║',
  '  ██║ ╚═╝ ██║██║██║ ╚████║   ██║       ╚██████╗███████╗██║',
  '  ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝╚══════╝╚═╝',
];

/** ASCII fallback for legacy Windows terminals (cmd.exe, older PowerShell). */
const LOGO_ASCII = [
  '  #     #  ###  #   #  #######     #####  #       ###',
  '  ##   ##   #   ##  #     #        #      #        # ',
  '  # # # #   #   # # #     #        #      #        # ',
  '  #  #  #   #   #  ##     #        #      #        # ',
  '  #     #  ###  #   #     #        #####  #####   ###',
];

/**
 * Legacy Windows terminals don't render Unicode box-drawing correctly.
 * WT_SESSION is set by modern Windows Terminal; TERM_PROGRAM by most IDE terms.
 * Anything else on Windows gets the ASCII fallback.
 */
function useAsciiLogo(): boolean {
  if (process.platform !== 'win32') return false;
  return !process.env.WT_SESSION && !process.env.TERM_PROGRAM;
}

function printLogo(): void {
  const logo = useAsciiLogo() ? LOGO_ASCII : LOGO_UNICODE;
  console.log('');
  for (const line of logo) console.log(chalk.cyan(line));
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
        chalk.cyan('  mint config:set providers.anthropic <your-key>'),
      { padding: 1, borderColor: 'cyan', borderStyle: 'round', width: 64 },
    ),
  );

  console.log('');
  const choice = await promptChoice(
    '  What would you like to do?',
    [
      { key: '1', label: 'Sign in with GitHub or Google (recommended)', cmd: 'signup' },
      { key: '2', label: 'Use my own API keys', cmd: 'byok' },
      { key: '3', label: 'Show me more info', cmd: 'info' },
    ],
  );

  console.log('');

  switch (choice) {
    case 'signup': {
      const { loginWithBrowser } = await import('./commands/login-browser.js');
      try {
        await loginWithBrowser();
      } catch {
        // The error is already printed by loginWithBrowser; fall through so
        // the caller exits cleanly without a stack trace.
        return;
      }
      console.log(chalk.dim('\n  Next: ') + chalk.cyan('mint init') + chalk.dim(' to scan your project\n'));
      return;
    }
    case 'login': {
      const { loginWithBrowser } = await import('./commands/login-browser.js');
      try {
        await loginWithBrowser();
      } catch {
        return;
      }
      console.log(chalk.dim('\n  Next: ') + chalk.cyan('mint init') + chalk.dim(' to scan your project\n'));
      return;
    }
    case 'byok': {
      console.log(
        boxen(
          chalk.bold('Bring Your Own Keys') +
            '\n\n' +
            chalk.dim('Get a key from any provider:') +
            '\n\n' +
            chalk.cyan('  Anthropic') +
            chalk.dim(' https://console.anthropic.com') +
            chalk.dim('  (Claude — recommended)') +
            '\n' +
            chalk.cyan('  Gemini') +
            chalk.dim('    https://ai.google.dev') +
            chalk.dim('  (free tier)') +
            '\n' +
            chalk.cyan('  OpenAI') +
            chalk.dim('    https://platform.openai.com') +
            '\n' +
            chalk.cyan('  xAI Grok') +
            chalk.dim('  https://x.ai/api'),
          { padding: 1, borderColor: 'yellow', borderStyle: 'round' },
        ),
      );
      console.log('');

      // Offer to configure a key right now. If the user has the key handy this
      // finishes the whole setup; otherwise they can skip and do it later.
      const haveKeyNow = await promptYesNo('  Have a key ready now?', true);
      if (!haveKeyNow) {
        console.log(chalk.dim('\n  No problem. When you have one, run:'));
        console.log(chalk.cyan('    mint config:set providers.anthropic <your-key>\n'));
        return;
      }

      const provider = await promptChoice(
        '  Which provider is this key for?',
        [
          { key: '1', label: 'Anthropic (Claude, recommended)', cmd: 'anthropic' },
          { key: '2', label: 'Google (Gemini)', cmd: 'gemini' },
          { key: '3', label: 'OpenAI', cmd: 'openai' },
          { key: '4', label: 'xAI (Grok)', cmd: 'grok' },
        ],
      );

      const key = await promptText('  Paste your API key: ');
      if (!key) {
        console.log(chalk.dim('\n  Skipped — no key entered. Run ') + chalk.cyan('mint config:set providers.' + provider + ' <key>') + chalk.dim(' later.\n'));
        return;
      }

      try {
        const providers = (config.get('providers') ?? {}) as Record<string, string>;
        providers[provider] = key.trim();
        config.set('providers', providers as never);
        console.log(chalk.green('\n  ✓ Saved. You\'re ready to use Mint with your own key.'));
        console.log(chalk.dim('  Next: ') + chalk.cyan('mint init') + chalk.dim(' to scan your project.\n'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`\n  Could not save key: ${msg}\n`));
      }
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
//
// All helpers use a try/finally close pattern so Ctrl+C or errors during the
// prompt still release stdin — otherwise the TUI downstream would never get
// its raw-mode initialized properly.

function withReadline<T>(fn: (rl: ReturnType<typeof createInterface>) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Close on SIGINT as a last resort — without this, Ctrl+C during a prompt
  // can leave the terminal in a half-configured state.
  const onSigint = () => {
    try { rl.close(); } catch { /* already closed */ }
    process.exit(130);
  };
  rl.once('SIGINT', onSigint);
  return fn(rl).finally(() => {
    try { rl.removeListener('SIGINT', onSigint); } catch { /* ignore */ }
    try { rl.close(); } catch { /* already closed */ }
  });
}

function promptChoice(
  question: string,
  options: Array<{ key: string; label: string; cmd: string }>,
): Promise<string> {
  console.log(chalk.white(question) + '\n');
  for (const opt of options) {
    console.log('  ' + chalk.cyan.bold(opt.key) + chalk.dim(')') + ' ' + opt.label);
  }
  console.log('');

  return withReadline((rl) => new Promise<string>((resolve) => {
    rl.question(chalk.dim('  Choose [1-' + options.length + ']: '), (answer) => {
      const trimmed = answer.trim();
      const match = options.find((o) => o.key === trimmed);
      resolve(match?.cmd ?? options[0].cmd);
    });
  }));
}

function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  return withReadline((rl) => new Promise<boolean>((resolve) => {
    const hint = defaultYes ? chalk.dim(' [Y/n] ') : chalk.dim(' [y/N] ');
    rl.question(question + hint, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) return resolve(defaultYes);
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  }));
}

function promptText(question: string): Promise<string> {
  return withReadline((rl) => new Promise<string>((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  }));
}
