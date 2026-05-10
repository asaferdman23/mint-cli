import chalk from 'chalk';
import boxen from 'boxen';
import { createInterface } from 'node:readline';
import { config } from '../../utils/config.js';
import {
  gatewayFetch,
  describeGatewayFailure,
  GatewayError,
} from '../../utils/gateway-fetch.js';

function getGatewayUrl(): string {
  return process.env.MINT_GATEWAY_URL ?? config.getGatewayUrl();
}

/** True when the terminal can hide password input. Windows terminals without
 *  raw mode support (older Windows Terminal, some IDEs) need visible input. */
function canHidePassword(): boolean {
  return !!(process.stdin.isTTY && typeof process.stdin.setRawMode === 'function');
}

function ask(prompt: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Closure-scoped so rl.close() runs on ANY exit path (data, error, Ctrl+C).
  const safeClose = () => {
    try { rl.close(); } catch { /* rl already closed */ }
  };

  return new Promise<string>((resolve, reject) => {
    // Visible-input fallback for terminals that can't hide.
    if (hidden && !canHidePassword()) {
      console.log(chalk.yellow('  Warning: your terminal doesn\'t support hidden input — password will be visible as you type.'));
    }

    if (hidden && canHidePassword()) {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      const oldRaw = stdin.isRaw;
      try { stdin.setRawMode(true); } catch { /* best effort */ }
      stdin.resume();
      let input = '';
      const onData = (ch: Buffer) => {
        const c = ch.toString();
        if (c === '\n' || c === '\r') {
          try { stdin.setRawMode(oldRaw ?? false); } catch { /* ignore */ }
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          safeClose();
          resolve(input);
        } else if (c === '') {
          // Ctrl+C — treat as cancellation rather than hard process.exit so
          // any outer cleanup/try-finally can run.
          try { stdin.setRawMode(oldRaw ?? false); } catch { /* ignore */ }
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          safeClose();
          reject(new Error('cancelled'));
        } else if (c === '' || c === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += c;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(prompt, (answer) => {
        safeClose();
        resolve(answer.trim());
      });
      rl.on('close', () => {
        // If the user Ctrl+C's during rl.question, close fires without data.
        // Resolving empty mimics pre-existing behavior.
      });
    }
  });
}

/** Ask a yes/no question with a default (defaults to capitalized letter). */
async function confirm(prompt: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? ' [Y/n] ' : ' [y/N] ';
  const answer = await ask(prompt + hint).catch(() => '');
  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) return defaultYes;
  return trimmed === 'y' || trimmed === 'yes';
}

/** Save config values, catching EACCES and similar permission failures. */
function safeConfigSet(values: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  try {
    for (const [key, value] of Object.entries(values)) {
      config.set(key as Parameters<typeof config.set>[0], value as never);
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

function printConfigSaveError(error: string): void {
  console.log(
    boxen(
      chalk.red.bold('Could not save credentials') + '\n\n' +
      chalk.dim('This usually means the config file or directory isn\'t writable.\n') +
      chalk.dim('Details: ') + error + '\n\n' +
      chalk.white('Try:') + '\n' +
      chalk.cyan(`  ${chalk.bold('rm -rf ~/.config/mint-cli')}   ${chalk.dim('(then run signup/login again)')}`) + '\n' +
      chalk.cyan(`  ${chalk.bold('chmod u+w ~/.config/mint-cli')} ${chalk.dim('(fix permissions)')}`),
      { padding: 1, borderColor: 'red', borderStyle: 'round' }
    )
  );
}

// ─── Commands ──────────────────────────────────────────────────────────────

export async function signup(): Promise<void> {
  const gatewayUrl = getGatewayUrl();

  console.log(chalk.cyan('\n  Create a Mint account\n'));

  let email: string;
  let password: string;
  try {
    email = await ask('  Email: ');
    if (!email) { console.log(chalk.red('  Email required.')); return; }

    password = await ask('  Password (min 8 chars): ', true);
    if (!password || password.length < 8) {
      console.log(chalk.red('  Password must be at least 8 characters.'));
      return;
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'cancelled') {
      console.log(chalk.dim('\n  Cancelled.\n'));
      return;
    }
    throw err;
  }

  try {
    const res = await gatewayFetch(`${gatewayUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await describeGatewayFailure(res);
      console.log(chalk.red(`\n  ${err.message}\n`));
      return;
    }

    const data = await res.json() as {
      user?: { id: string; email: string };
      api_token?: string;
      jwt?: string;
      error?: string;
    };

    // Persist credentials; bail with a clear message if the config is read-only.
    const saveResult = safeConfigSet({
      ...(data.api_token ? { gatewayToken: data.api_token, gatewayTokenKind: 'api' } : {}),
      ...(data.user ? { email: data.user.email, userId: data.user.id } : {}),
    });
    if (!saveResult.ok) {
      printConfigSaveError(saveResult.error);
      return;
    }

    console.log(boxen(
      `${chalk.bold.green('Account created! 🎉')}\n\n` +
      `Email: ${chalk.cyan(data.user?.email ?? email)}\n` +
      `Plan:  ${chalk.yellow('FREE')} ${chalk.dim('(50 requests/month)')}\n\n` +
      `${chalk.bold('Next steps:')}\n` +
      `  ${chalk.green('1.')} ${chalk.cyan('cd')} into your project\n` +
      `  ${chalk.green('2.')} Run ${chalk.cyan('mint init')} to scan files\n` +
      `  ${chalk.green('3.')} Run ${chalk.cyan('mint "your task"')} to code\n\n` +
      `${chalk.dim('Check quota anytime with ')} ${chalk.cyan('mint quota')}`,
      { padding: 1, borderColor: 'green', borderStyle: 'round' }
    ));
  } catch (err) {
    if (err instanceof GatewayError) {
      console.log(chalk.red('\n  ' + err.message + '\n'));
    } else {
      console.log(chalk.red(`\n  Error: ${(err as Error).message}\n`));
    }
  }
}

export async function login(): Promise<void> {
  // If already logged in, offer to switch accounts rather than just refusing.
  if (config.isAuthenticated()) {
    const currentEmail = config.get('email');
    console.log(chalk.yellow(`\n  Already signed in as ${chalk.bold(currentEmail ?? 'unknown')}.`));
    const shouldSwitch = await confirm('  Log out and sign in as a different user?', false);
    if (!shouldSwitch) {
      console.log(chalk.dim('  No changes.\n'));
      return;
    }
    config.clear();
    console.log(chalk.dim('  Signed out. Continuing to login...\n'));
  }

  const gatewayUrl = getGatewayUrl();

  console.log(chalk.cyan('\n  Sign in to Mint\n'));

  let email: string;
  let password: string;
  try {
    email = await ask('  Email: ');
    if (!email) { console.log(chalk.red('  Email required.')); return; }

    password = await ask('  Password: ', true);
    if (!password) { console.log(chalk.red('  Password required.')); return; }
  } catch (err) {
    if (err instanceof Error && err.message === 'cancelled') {
      console.log(chalk.dim('\n  Cancelled.\n'));
      return;
    }
    throw err;
  }

  try {
    // Login to get JWT
    const loginRes = await gatewayFetch(`${gatewayUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!loginRes.ok) {
      const err = await describeGatewayFailure(loginRes);
      // For 401 on login, the generic "session expired" message is wrong —
      // in this context it means wrong credentials.
      if (err.status === 401) {
        console.log(chalk.red('\n  Invalid email or password.'));
        console.log(chalk.dim('  If you don\'t have an account yet, run `mint signup`.\n'));
      } else {
        console.log(chalk.red('\n  ' + err.message + '\n'));
      }
      return;
    }

    const loginData = await loginRes.json() as {
      user?: { id: string; email: string };
      jwt?: string;
      error?: string;
    };

    const jwt = loginData.jwt;
    if (!jwt) {
      console.log(chalk.red('\n  No token received. Try again.\n'));
      return;
    }

    // Use JWT to create an API token for CLI use
    const tokenRes = await gatewayFetch(`${gatewayUrl}/auth/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({ name: 'mint-cli' }),
    });

    const tokenData = await tokenRes.json() as {
      token?: string;
      prefix?: string;
      error?: string;
    };

    // Figure out what to save: API token (preferred) or JWT (fallback).
    const valuesToSave: Record<string, unknown> = {};
    if (!tokenRes.ok || !tokenData.token) {
      console.log(chalk.yellow('\n  Warning: Could not create API token. Saving JWT instead (short-lived).\n'));
      valuesToSave.apiKey = jwt;
      valuesToSave.gatewayTokenKind = 'jwt';
    } else {
      valuesToSave.gatewayToken = tokenData.token;
      valuesToSave.gatewayTokenKind = 'api';
    }
    if (loginData.user) {
      valuesToSave.email = loginData.user.email;
      valuesToSave.userId = loginData.user.id;
    }

    const saveResult = safeConfigSet(valuesToSave);
    if (!saveResult.ok) {
      printConfigSaveError(saveResult.error);
      return;
    }

    console.log(boxen(
      `${chalk.bold.green('Signed in! 👋')}\n\n` +
      `Email: ${chalk.cyan(loginData.user?.email ?? email)}\n\n` +
      `${chalk.bold('Quick start:')}\n` +
      `  ${chalk.cyan('mint init')}  ${chalk.dim('- scan your project')}\n` +
      `  ${chalk.cyan('mint')}       ${chalk.dim('- start coding')}\n` +
      `  ${chalk.cyan('mint quota')} ${chalk.dim('- check your usage')}`,
      { padding: 1, borderColor: 'green', borderStyle: 'round' }
    ));
  } catch (err) {
    if (err instanceof GatewayError) {
      console.log(chalk.red('\n  ' + err.message + '\n'));
    } else {
      console.log(chalk.red(`\n  Error: ${(err as Error).message}\n`));
    }
  }
}

export async function logout(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(chalk.yellow('\n  Not logged in.\n'));
    return;
  }

  const email = config.get('email');
  config.clear();
  console.log(chalk.green(`\n  Logged out from ${email}\n`));
}

export async function whoami(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(chalk.yellow('\n  Not logged in.'));
    console.log(chalk.dim('  Run `mint signup` to create an account, or `mint login` to sign in.\n'));
    return;
  }

  const email = config.get('email');
  const hasGateway = !!(config.get('gatewayToken'));
  const tokenKind = config.get('gatewayTokenKind');
  const isJwt = tokenKind === 'jwt' || (!hasGateway && !!config.get('apiKey'));

  console.log(boxen(
    `${chalk.bold('Signed in')}\n\n` +
    `Email: ${chalk.cyan(email)}\n` +
    `Auth:  ${isJwt ? chalk.yellow('JWT (limited — run `mint login` to refresh)') : chalk.green('API token')}`,
    { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
  ));
}
