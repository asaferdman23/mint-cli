import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { config } from '../../utils/config.js';
import type { QuotaData } from './quota.js';

export async function showAccount(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(
      boxen(
        chalk.yellow.bold('No Account\n\n') +
        chalk.dim('Create a free account to get started:\n\n') +
        chalk.cyan('  mint signup') + chalk.dim(' - Get 50 free requests\n') +
        chalk.cyan('  mint login') + chalk.dim('  - Sign in to existing account\n\n') +
        chalk.dim('Or use your own API keys:\n\n') +
        chalk.cyan('  mint config:set providers.deepseek <key>'),
        { padding: 1, borderColor: 'yellow', borderStyle: 'round' }
      )
    );
    return;
  }

  const email = config.get('email');
  const userId = config.get('userId');
  const gatewayUrl = config.getGatewayUrl();
  const hasGatewayToken = !!config.get('gatewayToken');
  const apiToken = config.get('gatewayToken');

  // Fetch quota data
  let quotaData: QuotaData | null = null;
  try {
    const response = await fetch(`${gatewayUrl}/auth/quota`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });

    if (response.ok) {
      quotaData = await response.json() as QuotaData;
    }
  } catch {
    // Failed to fetch, show what we have
  }

  // Account header
  console.log(
    boxen(
      chalk.bold.cyan('Mint Account\n\n') +
      `${chalk.bold('Email:')} ${chalk.cyan(email ?? 'unknown')}\n` +
      `${chalk.bold('User ID:')} ${chalk.dim(userId ?? 'unknown')}\n` +
      `${chalk.bold('Auth:')} ${hasGatewayToken ? chalk.green('✓ Connected') : chalk.yellow('⚠ Limited')}`,
      { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
    )
  );

  console.log('');

  // Quota section
  if (quotaData) {
    const { requests_used, requests_limit, tokens_used, cost_total, plan_type } = quotaData;
    const requestsRemaining = requests_limit - requests_used;
    const usagePercent = Math.round((requests_used / requests_limit) * 100);

    const planBadge = plan_type === 'free'
      ? chalk.bgYellow.black(' FREE ')
      : plan_type === 'pro'
      ? chalk.bgCyan.black(' PRO ')
      : chalk.bgMagenta.black(' ENTERPRISE ');

    console.log(chalk.bold('Usage & Quota\n'));

    const usageTable = new Table({
      style: { head: [], border: [] },
      colWidths: [20, 30],
    });

    usageTable.push(
      [chalk.dim('Plan'), planBadge],
      [chalk.dim('Requests Used'), `${chalk.cyan(requests_used.toString())} / ${requests_limit}`],
      [chalk.dim('Requests Remaining'), usagePercent >= 90 ? chalk.red(requestsRemaining) : usagePercent >= 70 ? chalk.yellow(requestsRemaining) : chalk.green(requestsRemaining)],
      [chalk.dim('Tokens Used'), chalk.cyan(tokens_used.toLocaleString())],
      [chalk.dim('Total Cost'), chalk.yellow('$' + cost_total.toFixed(4))],
    );

    console.log(usageTable.toString());
  } else {
    console.log(chalk.yellow('Unable to fetch usage data. Check your connection.\n'));
  }

  console.log('');

  // Provider keys section
  const providers = config.get('providers') ?? {};
  const hasOwnKeys = Object.values(providers).some(key => !!key);

  console.log(chalk.bold('API Keys\n'));

  if (hasOwnKeys) {
    const keysTable = new Table({
      style: { head: [], border: [] },
      colWidths: [20, 40],
    });

    for (const [provider, key] of Object.entries(providers)) {
      if (key) {
        const masked = key.slice(0, 8) + '...' + key.slice(-4);
        keysTable.push([chalk.dim(provider), chalk.green(`✓ ${masked}`)]);
      }
    }

    console.log(keysTable.toString());
  } else {
    console.log(chalk.dim('  No custom API keys configured\n'));
    console.log(chalk.dim('  To add your own keys:\n'));
    console.log(chalk.cyan('  mint config:set providers.deepseek <your-key>\n'));
  }

  console.log('');

  // Quick actions
  console.log(chalk.bold('Quick Actions\n'));
  console.log(chalk.cyan('  mint quota') + chalk.dim('        - View detailed quota usage'));
  console.log(chalk.cyan('  mint usage') + chalk.dim('        - See cost breakdown and savings'));
  console.log(chalk.cyan('  mint trace') + chalk.dim('        - Browse recent tasks'));
  console.log(chalk.cyan('  mint config') + chalk.dim('       - View all settings'));

  if (quotaData && quotaData.plan_type === 'free') {
    const usagePercent = Math.round((quotaData.requests_used / quotaData.requests_limit) * 100);
    if (usagePercent >= 70) {
      console.log('');
      console.log(chalk.yellow.bold('  💡 Consider upgrading for unlimited requests'));
      if (quotaData.upgrade_url) {
        console.log(chalk.dim(`     ${quotaData.upgrade_url}`));
      }
    }
  }

  console.log('');
}
