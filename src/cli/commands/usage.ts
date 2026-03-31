import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { config } from '../../utils/config.js';

interface UsageOptions {
  days: string;
}

export async function showUsage(options: UsageOptions): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(chalk.yellow('Not authenticated. Usage tracking requires login.'));
    console.log(chalk.dim('Run `axon login` to authenticate'));
    return;
  }

  const days = parseInt(options.days, 10) || 7;
  const apiBaseUrl = config.get('apiBaseUrl') || 'https://api.axon.dev';
  const apiKey = config.get('apiKey');

  console.log(chalk.dim(`Fetching usage for last ${days} days...\n`));

  try {
    const response = await fetch(`${apiBaseUrl}/usage?days=${days}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as UsageData;
    displayUsage(data, days);

  } catch (error) {
    // Show placeholder data for now
    console.log(chalk.dim('(Showing sample data - API not connected)\n'));
    
    displayUsage({
      totalTokens: 1_250_000,
      totalCost: 12.50,
      totalSaved: 45.30,
      byModel: [
        { model: 'deepseek-v3', tokens: 800000, cost: 0.22, requests: 45 },
        { model: 'claude-sonnet-4', tokens: 350000, cost: 8.75, requests: 12 },
        { model: 'claude-opus-4', tokens: 100000, cost: 3.50, requests: 3 },
      ],
      byDay: [
        { date: '2026-03-21', tokens: 150000, cost: 1.50 },
        { date: '2026-03-22', tokens: 200000, cost: 2.00 },
        { date: '2026-03-23', tokens: 180000, cost: 1.80 },
        { date: '2026-03-24', tokens: 220000, cost: 2.20 },
        { date: '2026-03-25', tokens: 190000, cost: 1.90 },
        { date: '2026-03-26', tokens: 160000, cost: 1.60 },
        { date: '2026-03-27', tokens: 150000, cost: 1.50 },
      ],
    }, days);
  }
}

interface UsageData {
  totalTokens: number;
  totalCost: number;
  totalSaved: number;
  byModel: Array<{
    model: string;
    tokens: number;
    cost: number;
    requests: number;
  }>;
  byDay: Array<{
    date: string;
    tokens: number;
    cost: number;
  }>;
}

function displayUsage(data: UsageData, days: number): void {
  // Summary box
  console.log(boxen(
    `${chalk.bold('Usage Summary')} (Last ${days} days)\n\n` +
    `Total Tokens: ${chalk.cyan(data.totalTokens.toLocaleString())}\n` +
    `Total Cost: ${chalk.yellow('$' + data.totalCost.toFixed(2))}\n` +
    `Total Saved: ${chalk.green('$' + data.totalSaved.toFixed(2))} vs Opus baseline`,
    { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
  ));

  // By model table
  console.log(chalk.bold('\nUsage by Model'));
  
  const modelTable = new Table({
    head: [
      chalk.cyan('Model'),
      chalk.cyan('Requests'),
      chalk.cyan('Tokens'),
      chalk.cyan('Cost'),
    ],
    style: { head: [], border: [] },
  });

  for (const row of data.byModel) {
    modelTable.push([
      row.model,
      row.requests.toString(),
      row.tokens.toLocaleString(),
      '$' + row.cost.toFixed(2),
    ]);
  }

  console.log(modelTable.toString());

  // Daily chart (simple ASCII)
  console.log(chalk.bold('\nDaily Usage'));
  
  const maxTokens = Math.max(...data.byDay.map(d => d.tokens));
  const chartWidth = 30;

  for (const day of data.byDay) {
    const barLength = Math.round((day.tokens / maxTokens) * chartWidth);
    const bar = '█'.repeat(barLength);
    const date = day.date.slice(5); // MM-DD
    console.log(
      chalk.dim(date) + ' ' +
      chalk.cyan(bar) + ' ' +
      chalk.dim((day.tokens / 1000).toFixed(0) + 'K')
    );
  }

  // Savings insight
  if (data.totalSaved > 0) {
    const savingsPercent = Math.round((data.totalSaved / (data.totalCost + data.totalSaved)) * 100);
    console.log(chalk.green(`\n💰 Smart routing saved you ${savingsPercent}% ($${data.totalSaved.toFixed(2)})`));
  }
}
