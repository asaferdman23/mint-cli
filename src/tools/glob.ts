import { glob } from 'glob';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ignore from 'ignore';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const MAX_RESULTS = 200;

const parameters = z.object({
  pattern: z.string().describe('Glob pattern (e.g. "**/*.ts", "src/**/*.tsx")'),
  dir: z.string().optional().describe('Directory to search in (default: cwd)'),
});

export const globTool: Tool = {
  name: 'find_files',
  description: 'Find files matching a glob pattern. Respects .gitignore.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const searchDir = resolve(ctx.cwd, params.dir ?? '.');
      const ig = await loadGitignore(searchDir);

      const matches = await glob(params.pattern, {
        cwd: searchDir,
        nodir: true,
        absolute: false,
      });

      const filtered = matches
        .filter(f => !ig.ignores(f))
        .slice(0, MAX_RESULTS);

      if (filtered.length === 0) {
        return { success: true, output: `No files found matching: ${params.pattern}` };
      }

      return { success: true, output: filtered.join('\n') };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

async function loadGitignore(dir: string) {
  const ig = ignore();
  ig.add(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
  try {
    const content = await readFile(join(dir, '.gitignore'), 'utf-8');
    ig.add(content.split('\n').filter(l => l.trim() && !l.startsWith('#')));
  } catch { /* no .gitignore */ }
  return ig;
}
