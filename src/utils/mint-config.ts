/**
 * Project-local Mint configuration (.mint/config.json).
 *
 * Loaded per-project, separate from the global user config (Conf store).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface MintProjectConfig {
  model: {
    default: string;
    thinking: string;
    provider: string;
    baseURL: string;
  };
  context: {
    maxTokensPerTask: number;
    maxFilesPerSearch: number;
    maxToolCalls: number;
  };
  display: {
    autoApplyDiffs: boolean;
    showCostAfterEachTask: boolean;
    showClaudeCodeComparison: boolean;
  };
  ignore: string[];
}

const DEFAULT_CONFIG: MintProjectConfig = {
  model: {
    default: 'deepseek-chat',
    thinking: 'deepseek-reasoner',
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com',
  },
  context: {
    maxTokensPerTask: 15000,
    maxFilesPerSearch: 8,
    maxToolCalls: 5,
  },
  display: {
    autoApplyDiffs: false,
    showCostAfterEachTask: true,
    showClaudeCodeComparison: true,
  },
  ignore: ['node_modules', 'dist', '.git', '*.lock', '*.min.js'],
};

export async function loadMintConfig(cwd: string): Promise<MintProjectConfig> {
  try {
    const content = await readFile(join(cwd, '.mint', 'config.json'), 'utf-8');
    const parsed = JSON.parse(content);
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveMintConfig(cwd: string, config: MintProjectConfig): Promise<void> {
  const mintDir = join(cwd, '.mint');
  await mkdir(mintDir, { recursive: true });
  await writeFile(join(mintDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
}

export async function initMintConfig(cwd: string): Promise<MintProjectConfig> {
  const existing = await loadMintConfig(cwd);
  // Only save if it doesn't exist yet
  try {
    await readFile(join(cwd, '.mint', 'config.json'), 'utf-8');
    return existing;
  } catch {
    await saveMintConfig(cwd, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

function deepMerge(base: MintProjectConfig, override: Record<string, unknown>): MintProjectConfig {
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(override)) {
    const val = override[key];
    const baseVal = result[key];
    if (val && typeof val === 'object' && !Array.isArray(val) && baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
      result[key] = { ...(baseVal as Record<string, unknown>), ...(val as Record<string, unknown>) };
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result as unknown as MintProjectConfig;
}

export { DEFAULT_CONFIG };
