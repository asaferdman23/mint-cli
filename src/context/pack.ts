// src/context/pack.ts
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { glob } from 'glob';
import ignore from 'ignore';
import type { ModelId } from '../providers/types.js';
import { getTier } from '../providers/tiers.js';
import { estimateTokens, getBudget } from './budget.js';
import { compressContext, type FileEntry } from './compress.js';
import { loadAgentMd, formatAgentMdForPrompt } from './agentmd.js';

const execAsync = promisify(exec);

export interface ContextPack {
  /** Ready-to-inject system context string */
  systemContext: string;
  /** Estimated token count of systemContext */
  tokenEstimate: number;
  /** Paths of files included */
  filesIncluded: string[];
  /** Was AGENT.md found and injected? */
  agentMdFound: boolean;
  /** Compression tier applied */
  tier: string;
}

/**
 * Build a complete context pack for an agent task.
 *
 * @param cwd     - Project working directory
 * @param modelId - The model that will receive this context (determines tier)
 * @param task    - The task description (used for semantic relevance ranking)
 */
export async function buildContextPack(cwd: string, modelId: ModelId, task: string): Promise<ContextPack> {
  const tier = getTier(modelId);
  const budget = getBudget(modelId);

  const parts: string[] = [];
  let agentMdFound = false;

  // 1. AGENT.md — highest priority, always first
  const agentMd = await loadAgentMd(cwd);
  if (agentMd) {
    parts.push(formatAgentMdForPrompt(agentMd));
    agentMdFound = true;
  }

  // 2. Git context (cheap, high-signal)
  const gitContext = await getGitContext(cwd);
  if (gitContext) {
    parts.push(`<git_context>\n${gitContext}\n</git_context>\n`);
  }

  // 3. File tree (up to 3 levels deep, .gitignore filtered)
  const fileTree = await getFileTree(cwd);
  parts.push(`<file_tree>\n${fileTree}\n</file_tree>\n`);

  // 4. Relevant source files
  const tokenBudgetForFiles = budget.maxContextTokens - estimateTokens(parts.join(''));
  const files = await gatherRelevantFiles(cwd, task, tokenBudgetForFiles);
  const { files: compressedFiles } = compressContext(files, tier);

  const filesIncluded: string[] = [];
  for (const f of compressedFiles) {
    const snippet = `<file path="${f.path}">\n${f.content}\n</file>`;
    parts.push(snippet);
    filesIncluded.push(f.path);
  }

  const systemContext = parts.join('\n');

  return {
    systemContext,
    tokenEstimate: estimateTokens(systemContext),
    filesIncluded,
    agentMdFound,
    tier,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getGitContext(cwd: string): Promise<string | null> {
  try {
    const [status, diffStat] = await Promise.all([
      execAsync('git status --short', { cwd }),
      execAsync('git diff --stat HEAD~1 2>/dev/null || echo "(no prior commit)"', { cwd }),
    ]);
    return `$ git status --short\n${status.stdout}\n$ git diff --stat HEAD~1\n${diffStat.stdout}`;
  } catch {
    return null;
  }
}

async function getFileTree(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      'find . -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -maxdepth 3 -print | sort | head -80',
      { cwd }
    );
    return stdout.trim();
  } catch {
    return '(could not generate file tree)';
  }
}

async function getGitignoreFilter(cwd: string) {
  const ig = ignore();
  ig.add(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '*.lock', '.env*']);
  try {
    const content = await readFile(join(cwd, '.gitignore'), 'utf-8');
    ig.add(content.split('\n').filter(l => l.trim() && !l.startsWith('#')));
  } catch { /* no .gitignore */ }
  return ig;
}

/**
 * Find the top N files most likely relevant to `task`.
 * Strategy: keyword grep for task words → score by match count → top 10.
 */
async function gatherRelevantFiles(cwd: string, task: string, tokenBudget: number): Promise<FileEntry[]> {
  const ig = await getGitignoreFilter(cwd);

  const allFiles = (await glob('**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,md}', {
    cwd,
    nodir: true,
    absolute: false,
  })).filter(f => !ig.ignores(f));

  // Score files by keyword overlap with task
  const keywords = task.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  const scored: Array<{ path: string; score: number }> = await Promise.all(
    allFiles.map(async (filePath) => {
      try {
        const content = await readFile(join(cwd, filePath), 'utf-8');
        const lower = content.toLowerCase();
        const score = keywords.reduce((n, kw) => n + (lower.includes(kw) ? 1 : 0), 0);
        return { path: filePath, score };
      } catch {
        return { path: filePath, score: 0 };
      }
    })
  );

  scored.sort((a, b) => b.score - a.score);

  // Take top 10 by relevance, then fill budget
  const topFiles = scored.slice(0, 10);
  const result: FileEntry[] = [];
  let used = 0;

  for (const { path: filePath } of topFiles) {
    try {
      const content = await readFile(join(cwd, filePath), 'utf-8');
      const tokens = estimateTokens(content);
      if (used + tokens > tokenBudget) break;
      result.push({ path: filePath, content, language: detectLanguage(filePath) });
      used += tokens;
    } catch { /* skip */ }
  }

  return result;
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', go: 'go', rs: 'rust', java: 'java', rb: 'ruby',
    md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
  };
  return map[ext] ?? 'text';
}
