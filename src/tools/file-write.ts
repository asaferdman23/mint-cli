import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, sep, dirname } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const parameters = z.object({
  path: z.string().describe('Path to file'),
  content: z.string().describe('Content to write'),
});

export const fileWriteTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file (creates or overwrites). Creates parent directories if needed.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const abs = resolveSafe(params.path, ctx.cwd);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, params.content, 'utf8');
      return { success: true, output: `Written ${params.content.length} chars to ${params.path}` };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
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
