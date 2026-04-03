import type { Tool, ToolContext, ToolResult, ToolDefinition } from './types.js';
import { toToolDefinition } from './types.js';
import { fileReadTool } from './file-read.js';
import { fileWriteTool } from './file-write.js';
import { fileEditTool } from './file-edit.js';
import { bashTool } from './bash.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { listDirTool } from './list-dir.js';
import { searchReplaceTool } from './search-replace.js';
import { runTestsTool } from './run-tests.js';
import { gitDiffTool } from './git-diff.js';
import { webFetchTool } from './web-fetch.js';

export type { Tool, ToolContext, ToolResult, ToolDefinition };
export { toToolDefinition };
export type ToolRole = 'scout' | 'architect' | 'builder' | 'reviewer' | 'general';

// ─── Tool Registry ───────────────────────────────────────────────────────────

const registry = new Map<string, Tool>();

function register(tool: Tool): void {
  registry.set(tool.name, tool);
}

// Register all built-in tools
register(fileReadTool);
register(fileWriteTool);
register(fileEditTool);
register(bashTool);
register(grepTool);
register(globTool);
register(listDirTool);
register(searchReplaceTool);
register(runTestsTool);
register(gitDiffTool);
register(webFetchTool);

/** Get a tool by name. */
export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

/** Get all registered tools. */
export function getAllTools(): Tool[] {
  return Array.from(registry.values());
}

/** Get tool definitions in LLM provider format. */
export function getToolDefinitions(toolNames?: string[]): ToolDefinition[] {
  const tools = toolNames
    ? toolNames.map((name) => registry.get(name)).filter((tool): tool is Tool => Boolean(tool))
    : getAllTools();
  return tools.map(toToolDefinition);
}

/**
 * Execute a tool by name.
 * Returns a ToolResult — callers don't need to know which tool ran.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = registry.get(toolName);
  if (!tool) {
    return { success: false, output: '', error: `Unknown tool: ${toolName}` };
  }

  // Validate input with zod
  const parsed = tool.parameters.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      output: '',
      error: `Invalid input for ${toolName}: ${parsed.error.issues.map(i => i.message).join(', ')}`,
    };
  }

  return tool.execute(parsed.data, ctx);
}

/** Classify a tool as destructive (writes to filesystem or runs commands). */
export function isDestructiveTool(toolName: string): boolean {
  return ['write_file', 'edit_file', 'search_replace', 'bash'].includes(toolName);
}

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'find_files',
  'grep_files',
  'list_dir',
  'git_diff',
  'web_fetch',
]);

const CONCURRENCY_SAFE_TOOLS = new Set([
  'read_file',
  'find_files',
  'grep_files',
  'list_dir',
  'git_diff',
  'web_fetch',
]);

const ROLE_TOOL_ALLOWLIST: Record<ToolRole, string[]> = {
  scout: ['grep_files', 'find_files', 'list_dir', 'read_file'],
  architect: ['read_file', 'grep_files', 'web_fetch'],
  builder: [
    'read_file',
    'grep_files',
    'find_files',
    'list_dir',
    'write_file',
    'edit_file',
    'search_replace',
    'git_diff',
    'run_tests',
    'web_fetch',
    'bash',
  ],
  reviewer: ['read_file', 'grep_files', 'find_files', 'list_dir', 'run_tests', 'git_diff', 'web_fetch', 'bash'],
  general: getAllTools().map((tool) => tool.name),
};

const RISKY_BASH_PATTERN = /\b(rm|mv|del|format|truncate|drop|delete|unlink)\b/i;

export function getAllowedToolNamesForRole(role: ToolRole): string[] {
  return [...ROLE_TOOL_ALLOWLIST[role]];
}

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

export function isConcurrencySafeTool(toolName: string): boolean {
  return CONCURRENCY_SAFE_TOOLS.has(toolName);
}

export function toolRequiresApproval(
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (toolName === 'bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    return RISKY_BASH_PATTERN.test(command);
  }

  return ['write_file', 'edit_file', 'search_replace'].includes(toolName);
}
