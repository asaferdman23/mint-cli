import chalk from 'chalk';
import boxen from 'boxen';
import { config } from '../../utils/config.js';

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
    const response = await fetch(`${gatewayUrl}/auth/quota`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        console.log(chalk.red('\n  Authentication expired. Please login again:\n'));
        console.log(chalk.cyan('  mint login\n'));
        return;
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as QuotaData;
    displayQuota(data);

  } catch (error) {
    console.log(chalk.red(`\n  Error fetching quota: ${(error as Error).message}\n`));
    console.log(chalk.dim('  Make sure you\'re connected to the internet and try again.\n'));
  }
}

function displayQuota(data: QuotaData): void {
  const { requests_used, requests_limit, tokens_used, cost_total, plan_type, reset_date, upgrade_url } = data;

  const requestsRemaining = requests_limit - requests_used;
  const usagePercent = Math.round((requests_used / requests_limit) * 100);

  // Color based on usage
  let requestsColor = chalk.green;
  if (usagePercent >= 90) requestsColor = chalk.red;
  else if (usagePercent >= 70) requestsColor = chalk.yellow;

  // Build usage bar
  const barWidth = 30;
  const filledWidth = Math.round((requests_used / requests_limit) * barWidth);
  const emptyWidth = barWidth - filledWidth;
  const usageBar = requestsColor('█'.repeat(filledWidth)) + chalk.dim('░'.repeat(emptyWidth));

  // Plan badge
  const planBadge = plan_type === 'free'
    ? chalk.bgYellow.black(' FREE ')
    : plan_type === 'pro'
    ? chalk.bgCyan.black(' PRO ')
    : chalk.bgMagenta.black(' ENTERPRISE ');

  let content = `${planBadge} ${chalk.bold('Usage')}\n\n`;

  // Requests
  content += `${chalk.bold('Requests:')}\n`;
  content += `${usageBar} ${requestsColor(`${requests_used}/${requests_limit}`)}\n`;
  content += chalk.dim(`${requestsRemaining} requests remaining`) + '\n\n';

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

  // Show upgrade CTA if free plan and > 70% used
  if (plan_type === 'free' && usagePercent >= 70) {
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
