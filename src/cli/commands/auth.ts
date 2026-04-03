import chalk from 'chalk';
import boxen from 'boxen';
import { createInterface } from 'node:readline';
import { config } from '../../utils/config.js';

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    // Disable echo for password input
    if (process.stdin.isTTY) process.stdin.setRawMode?.(true);
    process.stdout.write(question);
    let password = '';
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (c === '\u007f' || c === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit(1);
      } else {
        password += c;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

export async function signup(): Promise<void> {
  if (config.isAuthenticated()) {
    console.log(chalk.yellow('Already logged in. Run `mint logout` first.'));
    return;
  }

  console.log(chalk.bold.cyan('\n  Create your Mint account\n'));

  const email = await prompt('  Email: ');
  const password = await promptHidden('  Password (min 8 chars): ');
  const name = await prompt('  Name (optional): ');

  if (!email || !password) {
    console.log(chalk.red('\n  Email and password are required.'));
    return;
  }

  if (password.length < 8) {
    console.log(chalk.red('\n  Password must be at least 8 characters.'));
    return;
  }

  const gatewayUrl = config.getGatewayUrl();

  try {
    const res = await fetch(`${gatewayUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: name || undefined }),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      console.log(chalk.red(`\n  Signup failed: ${data.error || res.statusText}`));
      return;
    }

    // Store credentials
    config.setAll({
      apiKey: data.api_token,
      userId: data.user.id,
      email: data.user.email,
    });

    console.log(boxen(
      `${chalk.bold.green('Account created!')}\n\n` +
      `Email: ${chalk.cyan(data.user.email)}\n` +
      `API Token: ${chalk.dim(data.api_token.slice(0, 20))}...\n\n` +
      `${chalk.dim('Token saved. You can now use mint commands.')}`,
      { padding: 1, borderColor: 'green', borderStyle: 'round' }
    ));
  } catch (err) {
    console.log(chalk.red(`\n  Network error: ${(err as Error).message}`));
  }
}

export async function login(): Promise<void> {
  if (config.isAuthenticated()) {
    const email = config.get('email');
    console.log(chalk.yellow(`Already logged in as ${email}`));
    console.log(chalk.dim('Run `mint logout` to switch accounts'));
    return;
  }

  console.log(chalk.bold.cyan('\n  Login to Mint\n'));

  const email = await prompt('  Email: ');
  const password = await promptHidden('  Password: ');

  if (!email || !password) {
    console.log(chalk.red('\n  Email and password are required.'));
    return;
  }

  const gatewayUrl = config.getGatewayUrl();

  try {
    const res = await fetch(`${gatewayUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      console.log(chalk.red(`\n  Login failed: ${data.error || res.statusText}`));
      return;
    }

    // Login returns JWT but we need an API token for CLI use
    // Request a new API token using the JWT
    const tokenRes = await fetch(`${gatewayUrl}/auth/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${data.jwt}`,
      },
      body: JSON.stringify({ name: 'cli' }),
    });

    const tokenData = await tokenRes.json() as any;

    if (!tokenRes.ok) {
      console.log(chalk.red(`\n  Failed to create API token: ${tokenData.error}`));
      return;
    }

    // Store credentials
    config.setAll({
      apiKey: tokenData.token,
      userId: data.user.id,
      email: data.user.email,
    });

    console.log(chalk.green(`\n  Logged in as ${data.user.email}`));
  } catch (err) {
    console.log(chalk.red(`\n  Network error: ${(err as Error).message}`));
  }
}

export async function logout(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(chalk.yellow('Not currently logged in'));
    return;
  }

  const email = config.get('email');
  config.clear();
  console.log(chalk.green(`Logged out from ${email}`));
}

export async function whoami(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(chalk.yellow('Not logged in'));
    console.log(chalk.dim('Run `mint login` or `mint signup` to authenticate'));
    return;
  }

  const email = config.get('email');
  const configPath = config.getConfigPath();

  console.log(boxen(
    `${chalk.bold('Current User')}\n\n` +
    `Email: ${chalk.cyan(email)}\n` +
    `Config: ${chalk.dim(configPath)}`,
    { padding: 1, borderColor: 'green', borderStyle: 'round' }
  ));
}
