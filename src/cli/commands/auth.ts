import chalk from 'chalk';
import boxen from 'boxen';
import { createServer } from 'node:http';
import { config } from '../../utils/config.js';

const SUPABASE_URL = 'https://srhoryezzsjmjdgfoxgd.supabase.co';
const AUTH_PAGE_URL = 'https://usemint.dev/auth';
const CALLBACK_PORT = 9876;

export async function login(): Promise<void> {
  if (config.isAuthenticated()) {
    const email = config.get('email');
    console.log(chalk.yellow(`\n  Already logged in as ${email}`));
    console.log(chalk.dim('  Run `mint logout` to switch accounts.\n'));
    return;
  }

  console.log(chalk.cyan('\n  Opening browser to sign in...\n'));

  // Start local server to receive callback
  const token = await waitForOAuthCallback();

  if (!token) {
    console.log(chalk.red('\n  Login failed. Try again with `mint login`.\n'));
    return;
  }

  // Validate token with Supabase to get user info
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': config.get('supabaseAnonKey') as string ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyaG9yeWV6enNqbWpkZ2ZveGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNjU4NTMsImV4cCI6MjA5MDk0MTg1M30.hQIf14rZiAl-NhC8HDa7ZIORWJiAa1Z5aw1LAzUtY2Q',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      console.log(chalk.red('\n  Invalid token received. Try again.\n'));
      return;
    }

    const user = await res.json() as { id: string; email: string };

    config.setAll({
      apiKey: token,
      userId: user.id,
      email: user.email,
    });

    console.log(boxen(
      `${chalk.bold.green('Signed in!')}\n\n` +
      `Email: ${chalk.cyan(user.email)}\n` +
      `Plan:  ${chalk.dim('Free — 20 tasks/day')}\n\n` +
      `${chalk.dim('Run `mint` to start coding.')}`,
      { padding: 1, borderColor: 'green', borderStyle: 'round' }
    ));
  } catch (err) {
    console.log(chalk.red(`\n  Error: ${(err as Error).message}\n`));
  }
}

function waitForOAuthCallback(): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      server.close();
      resolve(null);
    }, 120_000); // 2 minute timeout

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === '/callback') {
        const token = url.searchParams.get('access_token') ?? url.searchParams.get('token');

        // Send success page to browser
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="background:#07090d;color:#c8dae8;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
              <div style="text-align:center">
                <h1 style="color:#00d4ff">Connected!</h1>
                <p>You can close this tab and return to the terminal.</p>
              </div>
            </body>
          </html>
        `);

        clearTimeout(timeout);
        server.close();
        resolve(token);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(CALLBACK_PORT, () => {
      // Open browser
      const callbackUrl = `http://localhost:${CALLBACK_PORT}/callback`;
      const authUrl = `${AUTH_PAGE_URL}?callback=${encodeURIComponent(callbackUrl)}`;

      import('node:child_process').then(({ exec }) => {
        const cmd = process.platform === 'darwin' ? 'open' :
          process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} "${authUrl}"`);
      });
    });

    server.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

export async function signup(): Promise<void> {
  // OAuth replaces signup — just redirect to login
  await login();
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
    console.log(chalk.dim('  Run `mint login` to sign in.\n'));
    return;
  }

  const email = config.get('email');
  console.log(boxen(
    `${chalk.bold('Signed in')}\n\n` +
    `Email: ${chalk.cyan(email)}`,
    { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
  ));
}
