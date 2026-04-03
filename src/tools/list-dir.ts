import { readdirSync, statSync } from 'node:fs';
import { resolve, sep, join, relative } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv']);
const MAX_ENTRIES = 200;

const parameters = z.object({
  path: z.string().optional().describe('Directory path (default: cwd)'),
  depth: z.number().optional().describe('Max depth to traverse (default: 3)'),
});

export const listDirTool: Tool = {
  name: 'list_dir',
  description: 'List directory structure with files and subdirectories. Respects common ignore patterns.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const cwdAbs = resolve(ctx.cwd);
      const targetDir = resolve(ctx.cwd, params.path ?? '.');
      if (!targetDir.startsWith(cwdAbs + sep) && targetDir !== cwdAbs) {
        return { success: false, output: '', error: `Path outside working directory: ${params.path}` };
      }
      const maxDepth = params.depth ?? 3;
      const entries: string[] = [];

      walk(targetDir, targetDir, 0, maxDepth, entries);

      if (entries.length === 0) {
        return { success: true, output: '(empty directory)' };
      }

      return { success: true, output: entries.join('\n') };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

function walk(dir: string, root: string, depth: number, maxDepth: number, entries: string[]): void {
  if (depth > maxDepth || entries.length >= MAX_ENTRIES) return;

  let items: string[];
  try {
    items = readdirSync(dir);
  } catch {
    return;
  }

  // Sort: directories first, then files
  const sorted = items
    .filter(name => !name.startsWith('.') || name === '.env.example')
    .sort((a, b) => {
      const aIsDir = isDir(join(dir, a));
      const bIsDir = isDir(join(dir, b));
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

  for (const name of sorted) {
    if (entries.length >= MAX_ENTRIES) break;
    if (IGNORE_DIRS.has(name)) continue;

    const fullPath = join(dir, name);
    const relPath = relative(root, fullPath);
    const indent = '  '.repeat(depth);

    if (isDir(fullPath)) {
      entries.push(`${indent}${name}/`);
      walk(fullPath, root, depth + 1, maxDepth, entries);
    } else {
      entries.push(`${indent}${name}`);
    }
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
