import { spawnSync } from 'node:child_process';
import { resolve, relative, sep } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const MAX_OUTPUT = 64 * 1024;
const MAX_BUFFER = 10 * 1024 * 1024;

const parameters = z.object({
  staged: z.boolean().optional().describe('Show staged changes instead of unstaged changes'),
  file: z.string().optional().describe('Optional file path filter'),
});

export const gitDiffTool: Tool = {
  name: 'git_diff',
  description: 'Show git status summary plus the current diff. Supports staged diffs and per-file filtering.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const output = buildGitDiffOutput(params, ctx.cwd);
      return { success: true, output };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export function buildGitDiffOutput(
  params: z.infer<typeof parameters>,
  cwd: string,
): string {
  const fileArg = params.file ? normalizeGitPath(params.file, cwd) : undefined;
  const status = runGit(['status', '--short', ...(fileArg ? ['--', fileArg] : [])], cwd);
  const diffArgs = ['diff', ...(params.staged ? ['--staged'] : []), ...(fileArg ? ['--', fileArg] : [])];
  const diff = runGit(diffArgs, cwd);

  const combined = [
    'Status:',
    status.trim() || '(clean)',
    '',
    'Diff:',
    diff.trim() || '(no diff)',
  ].join('\n');

  if (combined.length <= MAX_OUTPUT) {
    return combined;
  }

  return combined.slice(0, MAX_OUTPUT) + '\n... [truncated at 64KB]';
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: MAX_BUFFER,
  });

  if (result.error) {
    throw new Error(result.error.message ?? 'Unknown git error');
  }

  if ((result.status ?? 0) !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(output || `git ${args.join(' ')} failed`);
  }

  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

function normalizeGitPath(filePath: string, cwd: string): string {
  const abs = resolve(cwd, filePath);
  const cwdAbs = resolve(cwd);
  if (!abs.startsWith(cwdAbs + sep) && abs !== cwdAbs) {
    throw new Error(`Path outside working directory: ${filePath}`);
  }

  const rel = relative(cwdAbs, abs);
  return rel === '' ? '.' : rel;
}
