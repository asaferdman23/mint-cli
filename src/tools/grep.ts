import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const MAX_MATCHES = 100;

const parameters = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  dir: z.string().optional().describe('Directory to search in (default: cwd)'),
  glob: z.string().optional().describe('File glob filter (e.g. "*.ts")'),
});

export const grepTool: Tool = {
  name: 'grep_files',
  description: 'Search file contents for a regex pattern. Returns matching lines with file:line format. Respects .gitignore.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const searchDir = resolve(ctx.cwd, params.dir ?? '.');
      const args = ['-rn', '-E', params.pattern];

      // Respect common ignore patterns
      args.push('--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '--exclude-dir=build');

      if (params.glob) args.push(`--include=${params.glob}`);
      args.push(searchDir);

      const output = execFileSync('grep', args, {
        encoding: 'utf8',
        timeout: 15_000,
      });

      const lines = output.split('\n').filter(Boolean).slice(0, MAX_MATCHES);
      const result = lines.join('\n');
      return {
        success: true,
        output: result || 'No matches found',
      };
    } catch (err: unknown) {
      // grep exits 1 when no matches — not an error
      const spawnErr = err as { status?: number };
      if (spawnErr.status === 1) {
        return { success: true, output: 'No matches found' };
      }
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};
