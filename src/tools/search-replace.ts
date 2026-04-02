import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const MAX_PREVIEW = 64 * 1024;

const parameters = z.object({
  path: z.string().min(1).describe('Path to file'),
  search: z.string().min(1).describe('Text or regex pattern to search for'),
  replace: z.string().describe('Replacement text'),
  regex: z.boolean().optional().describe('Treat search as a regex pattern'),
  all: z.boolean().optional().describe('Replace all matches instead of just the first one'),
});

export interface SearchReplacePlan {
  updated: string;
  replacementCount: number;
}

export const searchReplaceTool: Tool = {
  name: 'search_replace',
  description: 'Search and replace text in a file. Supports regex and multi-replace previews with 3 lines of context.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const abs = resolveSafe(params.path, ctx.cwd);
      if (!existsSync(abs)) {
        return { success: false, output: '', error: `File not found: ${params.path}` };
      }

      const current = readFileSync(abs, 'utf8');
      const plan = buildSearchReplacePlan(current, params);

      if (plan.updated !== current) {
        writeFileSync(abs, plan.updated, 'utf8');
      }

      const preview = buildSearchReplacePreview(params.path, current, plan.updated);
      const summary = `Replaced ${plan.replacementCount} occurrence(s) in ${params.path}.`;
      const output = preview
        ? `${summary}\n\n${preview}`
        : `${summary}\n\nMatched content, but the replacement produced no file changes.`;

      return { success: true, output };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export function buildSearchReplacePlan(
  current: string,
  params: z.infer<typeof parameters>,
): SearchReplacePlan {
  if (params.regex) {
    return buildRegexPlan(current, params.search, params.replace, params.all ?? false);
  }

  return buildLiteralPlan(current, params.search, params.replace, params.all ?? false);
}

export function buildSearchReplacePreview(path: string, before: string, after: string): string {
  if (before === after) {
    return '';
  }

  const patch = createTwoFilesPatch(path, path, before, after, 'before', 'after', { context: 3 });
  if (patch.length <= MAX_PREVIEW) {
    return patch;
  }

  return patch.slice(0, MAX_PREVIEW) + '\n... [truncated at 64KB]';
}

function buildLiteralPlan(current: string, search: string, replace: string, replaceAll: boolean): SearchReplacePlan {
  let replacementCount = 0;

  if (replaceAll) {
    let index = current.indexOf(search);
    while (index !== -1) {
      replacementCount++;
      index = current.indexOf(search, index + search.length);
    }
  } else if (current.includes(search)) {
    replacementCount = 1;
  }

  if (replacementCount === 0) {
    throw new Error('No matches found.');
  }

  if (!replaceAll) {
    const index = current.indexOf(search);
    return {
      updated: current.slice(0, index) + replace + current.slice(index + search.length),
      replacementCount,
    };
  }

  return {
    updated: current.split(search).join(replace),
    replacementCount,
  };
}

function buildRegexPlan(current: string, search: string, replace: string, replaceAll: boolean): SearchReplacePlan {
  const flags = replaceAll ? 'g' : '';
  const regex = compileRegex(search, flags);
  const counter = compileRegex(search, replaceAll ? 'g' : '');

  let replacementCount = 0;
  let match: RegExpExecArray | null;
  while ((match = counter.exec(current)) !== null) {
    if (match[0].length === 0) {
      throw new Error('Regex search must not match empty strings.');
    }
    replacementCount++;
    if (!replaceAll) {
      break;
    }
    if (counter.lastIndex === match.index) {
      counter.lastIndex++;
    }
  }

  if (replacementCount === 0) {
    throw new Error('No matches found.');
  }

  return {
    updated: current.replace(regex, replace),
    replacementCount,
  };
}

function compileRegex(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new Error(`Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function resolveSafe(filePath: string, cwd: string): string {
  const abs = resolve(cwd, filePath);
  const cwdAbs = resolve(cwd);
  if (!abs.startsWith(cwdAbs + sep) && abs !== cwdAbs) {
    throw new Error(`Path outside working directory: ${filePath}`);
  }
  return abs;
}
