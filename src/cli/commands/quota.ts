import chalk from 'chalk';
import boxen from 'boxen';
import { config } from '../../utils/config.js';
import { gatewayFetch, describeGatewayFailure, GatewayError } from '../../utils/gateway-fetch.js';

export interface QuotaData {
  requests_used: number;
  requests_limit: number;
  tokens_used: number;
  cost_total: number;
  plan_type: 'free' | 'pro' | 'enterprise';
  reset_date?: string;
  upgrade_url?: string;
}

export async function showQuota(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(
      boxen(
        chalk.yellow('Not authenticated\n\n') +
        chalk.dim('Sign up for a free account to get 50 free requests:\n\n') +
        chalk.cyan('  mint signup\n\n') +
        chalk.dim('Or bring your own API keys:\n\n') +
        chalk.cyan('  mint config:set providers.deepseek <your-key>'),
        { padding: 1, borderColor: 'yellow', borderStyle: 'round' }
      )
    );
    return;
  }

  const gatewayUrl = config.getGatewayUrl();
  const apiToken = config.get('gatewayToken');

  try {
    const response = await gatewayFetch(`${gatewayUrl}/auth/quota`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });

    if (!response.ok) {
      const err = await describeGatewayFailure(response);
      if (err.status === 401) {
        console.log(chalk.yellow('\n  ' + err.message));
        console.log(chalk.cyan('  mint login\n'));
        return;
      }
      throw err;
    }

    const data = await response.json() as QuotaData;
    displayQuota(data);

  } catch (error) {
    if (error instanceof GatewayError) {
      console.log(chalk.red('\n  ' + error.message + '\n'));
    } else {
      console.log(chalk.red(`\n  Error fetching quota: ${(error as Error).message}\n`));
    }
  }
}

function displayQuota(data: QuotaData): void {
  // Defend against unexpected gateway responses: clamp to valid ranges and
  // pick sensible defaults so we never render NaN or negative numbers.
  const rawLimit = Number.isFinite(data.requests_limit) ? Math.max(0, Math.floor(data.requests_limit)) : 0;
  const rawUsed = Number.isFinite(data.requests_used) ? Math.max(0, Math.floor(data.requests_used)) : 0;
  const requests_limit = rawLimit;
  const requests_used = rawLimit > 0 ? Math.min(rawUsed, rawLimit) : rawUsed;
  const tokens_used = Number.isFinite(data.tokens_used) ? Math.max(0, data.tokens_used) : 0;
  const cost_total = Number.isFinite(data.cost_total) ? Math.max(0, data.cost_total) : 0;
  const { plan_type, reset_date, upgrade_url } = data;
  const isUnlimited = requests_limit === 0 || requests_limit >= 999_999;

  const requestsRemaining = isUnlimited ? Infinity : requests_limit - requests_used;
  const usagePercent = isUnlimited ? 0 : Math.round((requests_used / requests_limit) * 100);

  // Color based on usage
  let requestsColor = chalk.green;
  if (usagePercent >= 90) requestsColor = chalk.red;
  else if (usagePercent >= 70) requestsColor = chalk.yellow;

  // Build usage bar (skipped for unlimited plans).
  const barWidth = 30;
  const filledWidth = isUnlimited ? 0 : Math.round((requests_used / requests_limit) * barWidth);
  const emptyWidth = barWidth - filledWidth;
  const usageBar = requestsColor('█'.repeat(filledWidth)) + chalk.dim('░'.repeat(emptyWidth));

  // Plan badge — unknown plan types get a neutral gray badge rather than crashing.
  const planBadge = plan_type === 'free'
    ? chalk.bgYellow.black(' FREE ')
    : plan_type === 'pro'
    ? chalk.bgCyan.black(' PRO ')
    : plan_type === 'enterprise'
    ? chalk.bgMagenta.black(' ENTERPRISE ')
    : chalk.bgGray.white(` ${String(plan_type ?? 'UNKNOWN').toUpperCase()} `);

  let content = `${planBadge} ${chalk.bold('Usage')}\n\n`;

  // Requests
  content += `${chalk.bold('Requests:')}\n`;
  if (isUnlimited) {
    content += chalk.green('  ∞ unlimited requests\n\n');
  } else {
    content += `${usageBar} ${requestsColor(`${requests_used}/${requests_limit}`)}\n`;
    content += chalk.dim(`${requestsRemaining} requests remaining`) + '\n\n';
  }

  // Tokens & Cost
  content += `${chalk.bold('Tokens:')} ${chalk.cyan(tokens_used.toLocaleString())}\n`;
  content += `${chalk.bold('Total Cost:')} ${chalk.yellow('$' + cost_total.toFixed(4))}\n`;

  if (reset_date) {
    content += `\n${chalk.dim('Resets: ' + reset_date)}`;
  }

  console.log(boxen(content, {
    padding: 1,
    borderColor: usagePercent >= 90 ? 'red' : usagePercent >= 70 ? 'yellow' : 'cyan',
    borderStyle: 'round'
  }));

  // Show upgrade CTA if free plan and > 70% used (not applicable to unlimited)
  if (plan_type === 'free' && !isUnlimited && usagePercent >= 70) {
    console.log();
    if (requestsRemaining === 0) {
      console.log(chalk.red.bold('  ⚠️  You\'ve used all your free requests!\n'));
      console.log(chalk.dim('  To continue using Mint:\n'));
      console.log(chalk.cyan('  1. Upgrade to Pro for unlimited requests'));
      if (upgrade_url) {
        console.log(chalk.dim(`     ${upgrade_url}\n`));
      }
      console.log(chalk.cyan('  2. Add your own API keys (free forever)'));
      console.log(chalk.dim('     mint config:set providers.deepseek <your-key>\n'));
    } else {
      console.log(chalk.yellow('  💡 Running low on free requests?\n'));
      console.log(chalk.dim('  Options:\n'));
      console.log(chalk.cyan('  • Upgrade to Pro for unlimited requests'));
      if (upgrade_url) {
        console.log(chalk.dim(`    ${upgrade_url}\n`));
      }
      console.log(chalk.cyan('  • Add your own API keys (always free)'));
      console.log(chalk.dim('    mint config:set providers.deepseek <your-key>\n'));
    }
  }

  // Helpful tips for first-timers
  if (requests_used < 5) {
    console.log();
    console.log(chalk.dim('  💡 Tip: Run ') + chalk.cyan('mint usage') + chalk.dim(' to see detailed cost breakdown'));
    console.log(chalk.dim('  💡 Tip: Run ') + chalk.cyan('mint trace') + chalk.dim(' to see your recent tasks\n'));
  }
}
