/**
 * `mint doctor` — diagnose common setup issues.
 *
 * Runs a short series of health checks and prints a green/red summary.
 * Reduces support load — most "mint doesn't work" questions can be answered
 * by one doctor run.
 */
import chalk from 'chalk';
import boxen from 'boxen';
import { existsSync, statSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../utils/config.js';
import { gatewayFetch, GatewayError } from '../../utils/gateway-fetch.js';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  hint?: string;
}

export async function runDoctor(): Promise<void> {
  console.log(chalk.cyan('\n  Running Mint health checks...\n'));

  const checks: CheckResult[] = [];

  // 1. Node version
  checks.push(checkNodeVersion());

  // 2. Config file writable
  checks.push(checkConfigWritable());

  // 3. Authentication present
  checks.push(checkAuth());

  // 4. Gateway reachable
  checks.push(await checkGatewayReachable());

  // 5. Auth token valid
  if (config.isAuthenticated()) {
    checks.push(await checkAuthToken());
  } else {
    checks.push({
      name: 'Auth token valid',
      status: 'skip',
      message: 'skipped (not logged in)',
    });
  }

  // 6. Project indexed
  checks.push(checkProjectIndexed());

  // 7. BYOK keys configured (informational)
  checks.push(checkByokKeys());

  // Print results
  const maxName = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const badge = statusBadge(c.status);
    const padded = c.name.padEnd(maxName);
    console.log(`  ${badge} ${chalk.bold(padded)}  ${chalk.dim(c.message)}`);
    if (c.hint) {
      console.log(chalk.dim(`     ↳ ${c.hint}`));
    }
  }

  // Summary
  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');

  console.log('');
  if (failed.length === 0 && warned.length === 0) {
    console.log(
      boxen(chalk.green.bold('All checks passed — you\'re ready to go! 🎉'), {
        padding: 1,
        borderColor: 'green',
        borderStyle: 'round',
      }),
    );
  } else if (failed.length === 0) {
    console.log(
      boxen(
        chalk.yellow.bold(`${warned.length} warning${warned.length === 1 ? '' : 's'}`) +
          ' — Mint should work but some features may be limited.',
        { padding: 1, borderColor: 'yellow', borderStyle: 'round' },
      ),
    );
  } else {
    console.log(
      boxen(
        chalk.red.bold(`${failed.length} failed check${failed.length === 1 ? '' : 's'}`) +
          '\n' +
          chalk.dim('Fix the issues above before continuing.'),
        { padding: 1, borderColor: 'red', borderStyle: 'round' },
      ),
    );
  }
  console.log('');
}

function statusBadge(status: CheckResult['status']): string {
  switch (status) {
    case 'pass': return chalk.green('✓');
    case 'fail': return chalk.red('✗');
    case 'warn': return chalk.yellow('⚠');
    case 'skip': return chalk.dim('·');
  }
}

// ─── Individual checks ──────────────────────────────────────────────────────

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 20) {
    return { name: 'Node.js version', status: 'pass', message: `${version} (required: 20+)` };
  }
  return {
    name: 'Node.js version',
    status: 'fail',
    message: `${version} is too old`,
    hint: 'Install Node.js 20+ from https://nodejs.org',
  };
}

function checkConfigWritable(): CheckResult {
  const path = config.getConfigPath();
  try {
    // If the file doesn't exist yet, check the parent dir.
    const target = existsSync(path) ? path : require('node:path').dirname(path);
    accessSync(target, constants.W_OK);
    return { name: 'Config file writable', status: 'pass', message: path };
  } catch (err) {
    return {
      name: 'Config file writable',
      status: 'fail',
      message: `not writable: ${path}`,
      hint: `Check permissions: ${(err as Error).message}`,
    };
  }
}

function checkAuth(): CheckResult {
  if (!config.isAuthenticated()) {
    return {
      name: 'Authentication',
      status: 'warn',
      message: 'not logged in',
      hint: 'Run `mint signup` for 50 free requests or `mint login` to sign in',
    };
  }
  const email = config.get('email');
  const kind = config.get('gatewayTokenKind');
  if (kind === 'jwt') {
    return {
      name: 'Authentication',
      status: 'warn',
      message: `signed in as ${email} (JWT — short-lived)`,
      hint: 'Run `mint login` again to refresh to a long-lived token',
    };
  }
  return { name: 'Authentication', status: 'pass', message: `signed in as ${email}` };
}

async function checkGatewayReachable(): Promise<CheckResult> {
  const url = config.getGatewayUrl();
  try {
    const res = await gatewayFetch(`${url}/health`, { timeoutMs: 5_000 });
    if (res.ok) {
      return { name: 'Gateway reachable', status: 'pass', message: url };
    }
    return {
      name: 'Gateway reachable',
      status: 'fail',
      message: `${url} returned ${res.status}`,
      hint: 'The gateway may be down. Try again in a few minutes.',
    };
  } catch (err) {
    if (err instanceof GatewayError) {
      return {
        name: 'Gateway reachable',
        status: 'fail',
        message: err.message,
        hint: 'Check your internet connection or run `mint config:set apiBaseUrl <url>` to use a different gateway.',
      };
    }
    return {
      name: 'Gateway reachable',
      status: 'fail',
      message: (err as Error).message,
    };
  }
}

async function checkAuthToken(): Promise<CheckResult> {
  const url = config.getGatewayUrl();
  const token = config.get('gatewayToken') ?? config.get('apiKey');
  try {
    const res = await gatewayFetch(`${url}/auth/quota`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 5_000,
    });
    if (res.ok) {
      return { name: 'Auth token valid', status: 'pass', message: 'token accepted by gateway' };
    }
    if (res.status === 401) {
      return {
        name: 'Auth token valid',
        status: 'fail',
        message: 'token rejected (401)',
        hint: 'Run `mint login` again to refresh your credentials',
      };
    }
    return {
      name: 'Auth token valid',
      status: 'warn',
      message: `gateway returned ${res.status}`,
    };
  } catch (err) {
    return {
      name: 'Auth token valid',
      status: 'warn',
      message: `could not verify (${(err as Error).message})`,
    };
  }
}

function checkProjectIndexed(): CheckResult {
  const cwd = process.cwd();
  const indexPath = join(cwd, '.mint', 'context.json');
  if (!existsSync(indexPath)) {
    return {
      name: 'Project indexed',
      status: 'warn',
      message: 'no .mint/context.json in this directory',
      hint: 'Run `mint init` to scan this project',
    };
  }
  try {
    const ageMs = Date.now() - statSync(indexPath).mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 7) {
      return {
        name: 'Project indexed',
        status: 'warn',
        message: `indexed ${Math.round(ageDays)} days ago`,
        hint: 'Run `mint init` to refresh the index',
      };
    }
    return { name: 'Project indexed', status: 'pass', message: `indexed ${ageDays < 1 ? 'today' : `${Math.round(ageDays)}d ago`}` };
  } catch {
    return { name: 'Project indexed', status: 'pass', message: 'index file exists' };
  }
}

function checkByokKeys(): CheckResult {
  const providers = config.get('providers') ?? {};
  const configured = Object.entries(providers).filter(([, v]) => !!v).map(([k]) => k);
  if (configured.length === 0) {
    return {
      name: 'BYOK keys',
      status: 'skip',
      message: 'none configured (using gateway)',
    };
  }
  return {
    name: 'BYOK keys',
    status: 'pass',
    message: `${configured.length} configured: ${configured.join(', ')}`,
  };
}
