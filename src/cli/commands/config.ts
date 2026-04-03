import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { config } from '../../utils/config.js';

export async function showConfig(): Promise<void> {
  const currentConfig = config.getConfig();
  const configPath = config.getConfigPath();

  console.log(boxen(
    chalk.bold('Mint Configuration') + '\n\n' +
    chalk.dim(`Path: ${configPath}`),
    { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
  ));

  const table = new Table({
    head: [chalk.cyan('Key'), chalk.cyan('Value')],
    style: { head: [], border: [] },
  });

  // Auth
  table.push(
    [chalk.bold('Authentication'), ''],
    ['  apiKey', currentConfig.apiKey ? chalk.green('[configured]') : chalk.dim('Not set')],
    ['  gatewayToken', currentConfig.gatewayToken ? chalk.green('[configured]') : chalk.dim('Not set')],
    ['  email', currentConfig.email || chalk.dim('Not set')],
    ['  orgId', currentConfig.orgId || chalk.dim('Personal')],
  );

  // Preferences
  table.push(
    ['', ''],
    [chalk.bold('Preferences'), ''],
    ['  defaultModel', currentConfig.defaultModel || 'auto'],
    ['  autoContext', String(currentConfig.autoContext ?? true)],
    ['  maxContextTokens', String(currentConfig.maxContextTokens || 100000)],
  );

  table.push(
    ['', ''],
    [chalk.bold('Gateway'), ''],
    ['  apiBaseUrl', currentConfig.apiBaseUrl || 'https://api.usemint.dev'],
  );

  // Providers
  const providers = currentConfig.providers || {};
  table.push(
    ['', ''],
    [chalk.bold('Provider Keys (BYOK)'), ''],
    ['  anthropic', providers.anthropic ? chalk.green('Configured') : chalk.dim('Not set')],
    ['  deepseek', providers.deepseek ? chalk.green('Configured') : chalk.dim('Not set')],
    ['  openrouter', providers.openrouter ? chalk.green('Configured') : chalk.dim('Not set')],
    ['  gemini', providers.gemini ? chalk.green('Configured') : chalk.dim('Not set')],
  );

  console.log(table.toString());
}

export async function setConfig(key: string, value: string): Promise<void> {
  // Handle nested keys like providers.anthropic
  if (key.startsWith('providers.')) {
    const provider = key.split('.')[1];
    const currentProviders = config.get('providers') || {};
    config.set('providers', {
      ...currentProviders,
      [provider]: value,
    });
    console.log(chalk.green(`✓ Set ${key}`));
    return;
  }

  // Handle boolean values
  if (value === 'true' || value === 'false') {
    config.set(key as any, value === 'true');
    console.log(chalk.green(`✓ Set ${key} = ${value}`));
    return;
  }

  // Handle numeric values
  if (!isNaN(Number(value))) {
    config.set(key as any, Number(value));
    console.log(chalk.green(`✓ Set ${key} = ${value}`));
    return;
  }

  // String value
  config.set(key as any, value);
  console.log(chalk.green(`✓ Set ${key} = ${value}`));
}
