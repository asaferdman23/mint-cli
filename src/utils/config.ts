import Conf from 'conf';
import { z } from 'zod';

// Config schema
const configSchema = z.object({
  // Auth
  apiKey: z.string().optional(),
  gatewayToken: z.string().optional(),
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
});

export type Config = z.infer<typeof configSchema>;

const conf = new Conf<Config>({
  projectName: 'mint-cli',
  schema: {
    apiKey: { type: 'string' },
    gatewayToken: { type: 'string' },
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
  },
});

export function getConfig(): Partial<Config> {
  return conf.store;
}

export function get<K extends keyof Config>(key: K): Config[K] | undefined {
  return conf.get(key);
}

export function set<K extends keyof Config>(key: K, value: Config[K]): void {
  conf.set(key, value);
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
  return !!conf.get('apiKey');
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
  setAll,
  clear,
  getConfig,
  isAuthenticated,
  getConfigPath,
  getGatewayUrl,
};
