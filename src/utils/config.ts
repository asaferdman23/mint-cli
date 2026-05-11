import Conf from 'conf';
import { z } from 'zod';

// Config schema
const configSchema = z.object({
  // Auth
  apiKey: z.string().optional(),
  gatewayToken: z.string().optional(),
  /** Records whether gatewayToken/apiKey is a long-lived API token or a
   *  short-lived JWT. Drives UX (re-login prompts, "mint account" warnings). */
  gatewayTokenKind: z.enum(['api', 'jwt']).optional(),
  userId: z.string().optional(),
  email: z.string().optional(),
  orgId: z.string().optional(),
  
  // Preferences
  defaultModel: z.enum(['auto', 'deepseek', 'sonnet', 'opus', 'gemini']).default('auto'),
  autoContext: z.boolean().default(true),
  maxContextTokens: z.number().default(100000),
  
  // Provider keys (for BYOK mode)
  providers: z.object({
    anthropic: z.string().optional(),
    deepseek: z.string().optional(),
    openrouter: z.string().optional(),
    gemini: z.string().optional(),
  }).default({}),
  
  // Backend
  apiBaseUrl: z.string().default('https://api.usemint.dev'),

  // Brain runtime knobs
  brain: z
    .object({
      /** Per-session cost budget (USD). When the running cost exceeds this,
       *  the TUI shows a warning. 0 disables the warning. */
      sessionBudgetUsd: z.number().default(0.5),
    })
    .default({ sessionBudgetUsd: 0.5 }),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Build the Conf instance, recovering from corruption. If the config file is
 * unparseable JSON (disk full mid-write, partial update, etc.) Conf throws on
 * instantiation — we catch, move the bad file aside so the user can inspect
 * it, and start fresh.
 */
function createConf(): Conf<Config> {
  const opts = {
    projectName: 'mint-cli',
    schema: {
      apiKey: { type: 'string' },
      gatewayToken: { type: 'string' },
      gatewayTokenKind: { type: 'string', enum: ['api', 'jwt'] },
      userId: { type: 'string' },
      email: { type: 'string' },
      orgId: { type: 'string' },
    defaultModel: { 
      type: 'string', 
      enum: ['auto', 'deepseek', 'sonnet', 'opus', 'gemini'],
      default: 'auto' 
    },
    autoContext: { type: 'boolean', default: true },
    maxContextTokens: { type: 'number', default: 100000 },
    providers: { 
      type: 'object',
      default: {},
      properties: {
        anthropic: { type: 'string' },
        deepseek: { type: 'string' },
        openrouter: { type: 'string' },
        gemini: { type: 'string' },
      }
    },
      apiBaseUrl: { type: 'string', default: 'https://api.usemint.dev' },
      brain: {
        type: 'object',
        default: { sessionBudgetUsd: 0.5 },
        properties: {
          sessionBudgetUsd: { type: 'number', default: 0.5 },
        },
      },
    },
  } as const;

  try {
    return new Conf<Config>(opts);
  } catch (err) {
    // Corrupted config JSON. Move it aside and retry with a fresh file so the
    // rest of the CLI can keep working. We emit a warning so the user knows
    // their credentials need to be re-entered.
    try {
      const tmpConf = new Conf<Config>({ ...opts, projectName: 'mint-cli-probe' });
      const realPath = tmpConf.path.replace('mint-cli-probe', 'mint-cli');
      const fs = require('node:fs');
      if (fs.existsSync(realPath)) {
        const backupPath = `${realPath}.corrupted-${Date.now()}`;
        fs.renameSync(realPath, backupPath);
        process.stderr.write(
          `[mint] Config file was corrupted and has been moved to:\n` +
          `       ${backupPath}\n` +
          `       Re-run \`mint login\` (or \`mint signup\`) to re-authenticate.\n`
        );
      }
    } catch {
      process.stderr.write(`[mint] Config corrupted: ${(err as Error).message}\n`);
    }
    return new Conf<Config>(opts);
  }
}

const conf = createConf();

export function getConfig(): Partial<Config> {
  return conf.store;
}

export function get<K extends keyof Config>(key: K): Config[K] | undefined {
  return conf.get(key);
}

export function set<K extends keyof Config>(key: K, value: Config[K]): void {
  conf.set(key, value);
}

export function del<K extends keyof Config>(key: K): void {
  conf.delete(key);
}

export function setAll(values: Partial<Config>): void {
  for (const [key, value] of Object.entries(values)) {
    conf.set(key as keyof Config, value);
  }
}

export function clear(): void {
  conf.clear();
}

export function isAuthenticated(): boolean {
  return !!(conf.get('apiKey') || conf.get('gatewayToken'));
}

export function getConfigPath(): string {
  return conf.path;
}

export function getGatewayUrl(): string {
  return conf.get('apiBaseUrl') ?? 'https://api.usemint.dev';
}

export const config = {
  get,
  set,
  del,
  setAll,
  clear,
  getConfig,
  isAuthenticated,
  getConfigPath,
  getGatewayUrl,
};
