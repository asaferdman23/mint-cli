import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const parameters = z.object({
  path: z.string().describe('Path to file'),
  old_text: z.string().describe('Exact text to replace'),
  new_text: z.string().describe('Replacement text'),
});

export const fileEditTool: Tool = {
  name: 'edit_file',
  description: 'Replace exact text in a file. Fails if old_text not found or matches multiple times.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const abs = resolveSafe(params.path, ctx.cwd);
      if (!existsSync(abs)) {
        return { success: false, output: '', error: `File not found: ${params.path}` };
      }

      const current = readFileSync(abs, 'utf8');
      const idx = current.indexOf(params.old_text);
      if (idx === -1) {
        return { success: false, output: '', error: `old_text not found in ${params.path}. Make sure it matches exactly.` };
      }

      // Check for ambiguous matches
      const secondIdx = current.indexOf(params.old_text, idx + 1);
      if (secondIdx !== -1) {
        return { success: false, output: '', error: `old_text matches multiple locations in ${params.path}. Provide more surrounding context to make it unique.` };
      }

      const updated = current.slice(0, idx) + params.new_text + current.slice(idx + params.old_text.length);
      writeFileSync(abs, updated, 'utf8');
      return { success: true, output: `Replaced text in ${params.path}` };
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
