import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const parameters = z.object({
  path: z.string().describe('Absolute or relative path to file'),
  start_line: z.number().optional().describe('First line to read (1-based)'),
  end_line: z.number().optional().describe('Last line to read (1-based, inclusive)'),
});

export const fileReadTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Optionally specify a line range.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const abs = resolveSafe(params.path, ctx.cwd);
      if (!existsSync(abs)) {
        return { success: false, output: '', error: `File not found: ${params.path}` };
      }

      let content = readFileSync(abs, 'utf8');

      // Apply line range
      if (params.start_line !== undefined || params.end_line !== undefined) {
        const lines = content.split('\n');
        const start = Math.max(0, (params.start_line ?? 1) - 1);
        const end = params.end_line ?? lines.length;
        content = lines.slice(start, end)
          .map((line, i) => `${start + i + 1}\t${line}`)
          .join('\n');
      } else if (content.length > 64000) {
        content = content.slice(0, 64000) + '\n... [truncated at 64KB]';
      }

      return { success: true, output: content };
    } catch (err) {
      return { success: false, output: '', error: errMsg(err) };
    }
  },
};

function resolveSafe(filePath: string, cwd: string): string {
  const abs = resolve(cwd, filePath);
  const cwdAbs = resolve(cwd);
  if (!abs.startsWith(cwdAbs + sep) && abs !== cwdAbs) {
    throw new Error(`Path outside working directory: ${filePath}`);
  }
  return abs;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
