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
    ['  openai', providers.openai ? chalk.green('Configured') : chalk.dim('Not set')],
    ['  gemini', providers.gemini ? chalk.green('Configured') : chalk.dim('Not set')],
    ['  grok', providers.grok ? chalk.green('Configured') : chalk.dim('Not set')],
    ['  groq', providers.groq ? chalk.green('Configured') : chalk.dim('Not set')],
    ['  mistral', providers.mistral ? chalk.green('Configured') : chalk.dim('Not set')],
  );

  console.log(table.toString());
}

/** Config keys we recognize. Anything else gets rejected with a suggestion. */
const VALID_TOP_LEVEL_KEYS = new Set([
  'apiKey',
  'gatewayToken',
  'userId',
  'email',
  'orgId',
  'defaultModel',
  'autoContext',
  'maxContextTokens',
  'apiBaseUrl',
]);

const VALID_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'gemini',
  'grok',
  'mistral',
  'groq',
]);

/** Known prefixes for provider keys — we warn but don't block on mismatch. */
const PROVIDER_KEY_PREFIXES: Record<string, string[]> = {
  anthropic: ['sk-ant-'],
  openai: ['sk-'],
  grok: ['xai-'],
  groq: ['gsk_'],
  gemini: ['AIza'],
  mistral: [],
};

/** Levenshtein-ish closest match for "did you mean ___?" hints. */
function closestMatch(input: string, candidates: string[]): string | null {
  const lower = input.toLowerCase();
  // Cheap scoring: rank by shared-prefix length.
  let best: { key: string; score: number } | null = null;
  for (const c of candidates) {
    let shared = 0;
    while (shared < lower.length && shared < c.length && lower[shared] === c.toLowerCase()[shared]) {
      shared++;
    }
    if (shared >= 2 && (!best || shared > best.score)) {
      best = { key: c, score: shared };
    }
  }
  return best?.key ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  // ── Provider keys ────────────────────────────────────────────────────────
  if (key.startsWith('providers.')) {
    const provider = key.split('.')[1];
    if (!provider) {
      console.log(chalk.red('  Missing provider name. Example: ') + chalk.cyan('mint config:set providers.deepseek <key>'));
      return;
    }
    if (!VALID_PROVIDERS.has(provider)) {
      const hint = closestMatch(provider, [...VALID_PROVIDERS]);
      console.log(chalk.red(`  Unknown provider: ${provider}`));
      if (hint) console.log(chalk.dim(`  Did you mean ${chalk.cyan('providers.' + hint)}?`));
      console.log(chalk.dim(`  Supported: ${[...VALID_PROVIDERS].join(', ')}`));
      return;
    }

    // Light sanity check on key format. Warn-only — we don't want to block
    // provider changes if their formats evolve.
    const expectedPrefixes = PROVIDER_KEY_PREFIXES[provider] ?? [];
    if (expectedPrefixes.length > 0 && !expectedPrefixes.some((p) => value.startsWith(p))) {
      console.log(chalk.yellow(`  Warning: ${provider} keys usually start with ${expectedPrefixes.map((p) => chalk.cyan(p)).join(' or ')}. Saving anyway.`));
    }
    if (value.length < 16) {
      console.log(chalk.yellow('  Warning: key looks unusually short. Double-check you pasted the full value.'));
    }

    try {
      const currentProviders = config.get('providers') || {};
      config.set('providers', { ...currentProviders, [provider]: value });
      console.log(chalk.green(`  ✓ Set ${key}`));
    } catch (err) {
      console.log(chalk.red(`  Could not save: ${(err as Error).message}`));
    }
    return;
  }

  // ── Top-level keys ───────────────────────────────────────────────────────
  if (!VALID_TOP_LEVEL_KEYS.has(key)) {
    const hint = closestMatch(key, [...VALID_TOP_LEVEL_KEYS]);
    console.log(chalk.red(`  Unknown setting: ${key}`));
    if (hint) console.log(chalk.dim(`  Did you mean ${chalk.cyan(hint)}?`));
    console.log(chalk.dim('  Run ') + chalk.cyan('mint config') + chalk.dim(' to see all settings.'));
    return;
  }

  // apiBaseUrl — must be a parseable http(s) URL
  if (key === 'apiBaseUrl') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('must use http or https');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`  Invalid URL: ${msg}`));
      console.log(chalk.dim('  Example: ') + chalk.cyan('mint config:set apiBaseUrl https://api.usemint.dev'));
      return;
    }
  }

  // Typed coercion
  let coerced: unknown = value;
  if (value === 'true' || value === 'false') {
    coerced = value === 'true';
  } else if (!isNaN(Number(value)) && value.trim() !== '') {
    coerced = Number(value);
  }

  try {
    config.set(key as Parameters<typeof config.set>[0], coerced as never);
    console.log(chalk.green(`  ✓ Set ${key} = ${value}`));
  } catch (err) {
    console.log(chalk.red(`  Could not save: ${(err as Error).message}`));
  }
}
