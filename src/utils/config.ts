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
  defaultModel: z.enum(['auto', 'sonnet', 'opus', 'gemini']).default('auto'),
  autoContext: z.boolean().default(true),
  maxContextTokens: z.number().default(100000),
  
  // Provider keys (for BYOK mode)
  providers: z.object({
    anthropic: z.string().optional(),
    openai: z.string().optional(),
    gemini: z.string().optional(),
    grok: z.string().optional(),
    groq: z.string().optional(),
    mistral: z.string().optional(),
  }).default({}),
  
  // Backend
  apiBaseUrl: z.string().default('https://api.usemint.dev'),

  /** Opt-in: upload each usage row to the gateway's /v1/usage/ingest for
   *  org-wide cache/cost visibility. Defaults to false (BYOK-friendly). */
  usageGatewaySync: z.boolean().optional(),

  // Brain runtime knobs
  brain: z
    .object({
      /** Per-session cost budget (USD). When the running cost exceeds this,
       *  the TUI shows a warning. 0 disables the warning. */
      sessionBudgetUsd: z.number().default(0.5),
      /** Hard per-session spend ceiling (USD). When the running cost reaches
       *  this, the loop halts and asks for explicit approval before continuing.
       *  Unlike sessionBudgetUsd (a passive warning), this enforces. 0 = off.
       *  Defaults to $2 — far above a normal task (<$0.01) but a real ceiling
       *  against runaway loops, so Mint can never silently surprise you. */
      spendCap: z.number().default(2),
      /** When true, the loop halts if it detects the model repeating the same
       *  tool call with identical input — a runaway-loop guard. */
      runawayLoopDetection: z.boolean().default(true),
      /** Number of identical consecutive tool calls that trips the runaway
       *  loop detector. */
      loopDetectionThreshold: z.number().default(3),
      /** Old-model scaffolding — best-effort harness fixes for weak-model
       *  failure modes. Milestone 1 ships format normalization only
       *  (capitalized keys etc.); future milestones add CoT hints, tool-call
       *  validation+retry, and per-(model,kind) prompt patches. */
      scaffolding: z
        .object({
          /** Normalize known weak-model tool-call malformations before
           *  dispatch (e.g. `Path` → `path`). Every fix emits a `warn` +
           *  `scaffolding.applied` event so the intervention is visible
           *  in `mint trace` / `mint audit`. */
          normalize: z.boolean().default(true),
        })
        .default({ normalize: true }),
    })
    .default({
      sessionBudgetUsd: 0.5,
      spendCap: 2,
      runawayLoopDetection: true,
      loopDetectionThreshold: 3,
      scaffolding: { normalize: true },
    }),

  /** Anthropic-specific opt-ins. */
  anthropic: z
    .object({
      /** Opt into the `extended-cache-ttl-2025-04-11` beta — sets a 1-hour
       *  TTL on every emitted `cache_control` block instead of the default
       *  5-minute. Pricing: 1h writes are ~2× the 5-min write cost, reads
       *  remain ~10% of fresh tokens. Worth it when sessions pause for
       *  >5 min and the user resumes (e.g. lunch break, context switch).
       *  Verify current pricing at
       *  https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching.
       *  Env override: MINT_ANTHROPIC_CACHE_1H=1. */
      cache1h: z.boolean().default(false),
    })
    .default({ cache1h: false }),

  /** Memory subsystem knobs (PR8). All values have sane defaults so users
   *  who never touch config keep the behavior shipped in PR4–PR7. */
  memory: z
    .object({
      extract: z
        .object({
          /** Master kill switch for the per-turn extractor LLM call.
           *  When false, zero extractor calls fire and zero SQLite writes
           *  result from automatic extraction (manual /remember still works). */
          enabled: z.boolean().default(true),
          /** Whitelist of memory kinds the extractor is allowed to emit.
           *  Decisions and open_questions are opt-in (noisier, lower hit rate). */
          kinds: z
            .array(z.enum(['preference', 'fact', 'decision', 'episode', 'open_question']))
            .default(['preference', 'fact', 'episode']),
        })
        .default({ enabled: true, kinds: ['preference', 'fact', 'episode'] }),
      retrieval: z
        .object({
          /** Top-K memories injected into the dynamic prompt tier per turn. */
          k: z.number().default(10),
          /** Recency-decay half-life for the hybrid scorer. */
          halfLifeDays: z.number().default(14),
        })
        .default({ k: 10, halfLifeDays: 14 }),
    })
    .default({
      extract: { enabled: true, kinds: ['preference', 'fact', 'episode'] },
      retrieval: { k: 10, halfLifeDays: 14 },
    }),
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
      enum: ['auto', 'sonnet', 'opus', 'gemini'],
      default: 'auto' 
    },
    autoContext: { type: 'boolean', default: true },
    maxContextTokens: { type: 'number', default: 100000 },
    providers: { 
      type: 'object',
      default: {},
      properties: {
        anthropic: { type: 'string' },
        openai: { type: 'string' },
        gemini: { type: 'string' },
        grok: { type: 'string' },
        groq: { type: 'string' },
        mistral: { type: 'string' },
      }
    },
      apiBaseUrl: { type: 'string', default: 'https://api.usemint.dev' },
      usageGatewaySync: { type: 'boolean' },
      brain: {
        type: 'object',
        default: { sessionBudgetUsd: 0.5 },
        properties: {
          sessionBudgetUsd: { type: 'number', default: 0.5 },
        },
      },
      anthropic: {
        type: 'object',
        default: { cache1h: false },
        properties: {
          cache1h: { type: 'boolean', default: false },
        },
      },
      memory: {
        type: 'object',
        default: {
          extract: { enabled: true, kinds: ['preference', 'fact', 'episode'] },
          retrieval: { k: 10, halfLifeDays: 14 },
        },
        properties: {
          extract: {
            type: 'object',
            default: { enabled: true, kinds: ['preference', 'fact', 'episode'] },
            properties: {
              enabled: { type: 'boolean', default: true },
              kinds: { type: 'array', default: ['preference', 'fact', 'episode'] },
            },
          },
          retrieval: {
            type: 'object',
            default: { k: 10, halfLifeDays: 14 },
            properties: {
              k: { type: 'number', default: 10 },
              halfLifeDays: { type: 'number', default: 14 },
            },
          },
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

/** Dot-path getter for nested keys (e.g. `memory.extract.enabled`).
 *  Conf's underlying dot-prop honors the path; we widen the return type because
 *  the top-level `Config` schema isn't statically indexable by string-path. */
export function getPath<T = unknown>(path: string): T | undefined {
  // `conf.get` accepts dot-paths despite the typed signature.
  return (conf as unknown as { get: (k: string) => T | undefined }).get(path);
}

/** Dot-path setter for nested keys. */
export function setPath(path: string, value: unknown): void {
  (conf as unknown as { set: (k: string, v: unknown) => void }).set(path, value);
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
  getPath,
  setPath,
};
