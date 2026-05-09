import chalk from 'chalk';
import boxen from 'boxen';
import { createInterface } from 'node:readline';
import { config } from '../../utils/config.js';

function getGatewayUrl(): string {
  return process.env.MINT_GATEWAY_URL ?? config.getGatewayUrl();
}

function ask(prompt: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      // Hide password input
      process.stdout.write(prompt);
      const stdin = process.stdin;
      const oldRaw = stdin.isRaw;
      stdin.setRawMode(true);
      stdin.resume();
      let input = '';
      const onData = (ch: Buffer) => {
        const c = ch.toString();
        if (c === '\n' || c === '\r') {
          stdin.setRawMode(oldRaw ?? false);
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (c === '\u0003') { // Ctrl+C
          process.exit(0);
        } else if (c === '\u007f' || c === '\b') { // Backspace
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
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

export async function signup(): Promise<void> {
  const gatewayUrl = getGatewayUrl();

  console.log(chalk.cyan('\n  Create a Mint account\n'));

  const email = await ask('  Email: ');
  if (!email) { console.log(chalk.red('  Email required.')); return; }

  const password = await ask('  Password (min 8 chars): ', true);
  if (!password || password.length < 8) { console.log(chalk.red('  Password must be at least 8 characters.')); return; }

  try {
    const res = await fetch(`${gatewayUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json() as { user?: { id: string; email: string }; api_token?: string; jwt?: string; error?: string };

    if (!res.ok) {
      console.log(chalk.red(`\n  ${data.error ?? 'Signup failed'}\n`));
      return;
    }

    // Save the API token (used for /v1/* requests)
    if (data.api_token) {
      config.set('gatewayToken', data.api_token);
    }
    if (data.user) {
      config.set('email', data.user.email);
      config.set('userId', data.user.id);
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
    console.log(chalk.red(`\n  Error: ${(err as Error).message}\n`));
  }
}

export async function login(): Promise<void> {
  if (config.isAuthenticated()) {
    const email = config.get('email');
    console.log(chalk.yellow(`\n  Already logged in as ${email}`));
    console.log(chalk.dim('  Run `mint logout` to switch accounts.\n'));
    return;
  }

  const gatewayUrl = getGatewayUrl();

  console.log(chalk.cyan('\n  Sign in to Mint\n'));

  const email = await ask('  Email: ');
  if (!email) { console.log(chalk.red('  Email required.')); return; }

  const password = await ask('  Password: ', true);
  if (!password) { console.log(chalk.red('  Password required.')); return; }

  try {
    // Login to get JWT
    const loginRes = await fetch(`${gatewayUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const loginData = await loginRes.json() as { user?: { id: string; email: string }; jwt?: string; error?: string };

    if (!loginRes.ok) {
      console.log(chalk.red(`\n  ${loginData.error ?? 'Login failed'}\n`));
      return;
    }

    const jwt = loginData.jwt;
    if (!jwt) {
      console.log(chalk.red('\n  No token received. Try again.\n'));
      return;
    }

    // Use JWT to create an API token for CLI use
    const tokenRes = await fetch(`${gatewayUrl}/auth/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({ name: 'mint-cli' }),
    });

    const tokenData = await tokenRes.json() as { token?: string; prefix?: string; error?: string };

    if (!tokenRes.ok || !tokenData.token) {
      // Fallback: save JWT directly (works for /auth/* routes but not /v1/*)
      console.log(chalk.yellow('\n  Warning: Could not create API token. Saving JWT instead.\n'));
      config.set('apiKey', jwt);
    } else {
      config.set('gatewayToken', tokenData.token);
    }

    if (loginData.user) {
      config.set('email', loginData.user.email);
      config.set('userId', loginData.user.id);
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
    console.log(chalk.red(`\n  Error: ${(err as Error).message}\n`));
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
  console.log(boxen(
    `${chalk.bold('Signed in')}\n\n` +
    `Email: ${chalk.cyan(email)}\n` +
    `Auth:  ${hasGateway ? chalk.green('API token') : chalk.yellow('JWT (limited)')}`,
    { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
  ));
}
