/**
 * Agent tool layer — wraps src/tools/ registry with agent-specific concerns:
 * approval modes, diff preview, plan-mode blocking.
 *
 * The actual tool implementations live in src/tools/*.ts.
 */
import {
  getToolDefinitions,
  executeTool as executeToolRaw,
  isDestructiveTool,
  toolRequiresApproval,
  type ToolContext,
  type ToolDefinition,
} from '../tools/index.js';

// Re-export the tool definitions for the agent loop / providers
export const TOOLS: ToolDefinition[] = getToolDefinitions();
export function getAgentToolDefinitions(toolNames?: string[]): ToolDefinition[] {
  return getToolDefinitions(toolNames);
}

// ─── Agent-level types ──────────────────────────────────────────────────────

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export type AgentMode = 'yolo' | 'plan' | 'diff' | 'auto';

export interface AgentOptions {
  cwd: string;
  model?: string;
  signal?: AbortSignal;
  verbose?: boolean;
  mode?: AgentMode;
  toolNames?: string[];
  onApprovalNeeded?: (toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>;
  onDiffProposed?: (path: string, diff: string) => Promise<boolean>;
  onIterationApprovalNeeded?: (
    iteration: number,
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
  ) => Promise<boolean>;
}

// ─── Agent tool executor ────────────────────────────────────────────────────

/**
 * Execute a tool call with agent-mode policy (plan/diff/auto/yolo).
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  toolCallId: string,
  options: AgentOptions,
): Promise<ToolResult> {
  const mode = options.mode ?? 'auto';
  const destructive = isDestructiveTool(toolName);
  const diffApprovalTools = new Set(['write_file', 'edit_file', 'search_replace']);

  // --plan mode: block all writes
  if (mode === 'plan' && destructive) {
    return {
      toolCallId,
      toolName,
      content: `[PLAN MODE] Would execute: ${toolName}(${JSON.stringify(input).slice(0, 200)}) — skipped (--plan mode)`,
      isError: false,
    };
  }

  // --diff mode: for write_file/edit_file, show diff and ask
  if (mode === 'diff' && diffApprovalTools.has(toolName)) {
    const diffPreview = await generateDiffPreview(toolName, input, options.cwd);
    if (options.onDiffProposed) {
      const target = String(input.path ?? input.file ?? '(working tree)');
      const approved = await options.onDiffProposed(target, diffPreview);
      if (!approved) {
        return {
          toolCallId,
          toolName,
          content: `[DIFF MODE] Change rejected by user for ${target}`,
          isError: false,
        };
      }
    }
  }

  if (
    mode !== 'yolo' &&
    !diffApprovalTools.has(toolName) &&
    toolRequiresApproval(toolName, input) &&
    options.onApprovalNeeded
  ) {
    const approved = await options.onApprovalNeeded(toolName, input);
    if (!approved) {
      return {
        toolCallId,
        toolName,
        content: `[${mode.toUpperCase()} MODE] Action rejected by user for ${toolName}`,
        isError: false,
      };
    }
  }

  // Execute through the tools registry
  const ctx: ToolContext = {
    cwd: options.cwd,
    projectRoot: options.cwd,
    abortSignal: options.signal,
  };

  const result = await executeToolRaw(toolName, input, ctx);

  return {
    toolCallId,
    toolName,
    content: result.success ? result.output : `[ERROR] ${result.error ?? result.output}`,
    isError: !result.success,
  };
}

// ─── Diff preview ───────────────────────────────────────────────────────────

async function generateDiffPreview(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  const { createTwoFilesPatch } = await import('diff');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  if (toolName === 'write_file') {
    const path = String(input.path ?? '');
    const newContent = String(input.content ?? '');
    let oldContent = '';
    try {
      oldContent = await readFile(join(cwd, path), 'utf-8');
    } catch { /* new file */ }
    return createTwoFilesPatch(path, path, oldContent, newContent, 'old', 'new');
  }

  if (toolName === 'edit_file') {
    const path = String(input.path ?? '');
    const oldStr = String(input.old_text ?? '');
    const newStr = String(input.new_text ?? '');
    try {
      const current = await readFile(join(cwd, path), 'utf-8');
      const firstMatch = current.indexOf(oldStr);
      const secondMatch = firstMatch === -1 ? -1 : current.indexOf(oldStr, firstMatch + oldStr.length);

      if (firstMatch !== -1 && secondMatch === -1) {
        const updated = current.slice(0, firstMatch) + newStr + current.slice(firstMatch + oldStr.length);
        return createTwoFilesPatch(path, path, current, updated, 'old', 'new');
      }
    } catch {
      // Fall back to the local snippet preview below if the file cannot be read.
    }

    return createTwoFilesPatch(path, path, oldStr, newStr, 'old', 'new');
  }

  if (toolName === 'search_replace') {
    const path = String(input.path ?? '');
    const current = await readFile(join(cwd, path), 'utf-8');
    const { buildSearchReplacePlan, buildSearchReplacePreview } = await import('../tools/search-replace.js');
    const plan = buildSearchReplacePlan(current, {
      path,
      search: String(input.search ?? ''),
      replace: String(input.replace ?? ''),
      regex: Boolean(input.regex),
      all: Boolean(input.all),
    });
    return buildSearchReplacePreview(path, current, plan.updated);
  }

  if (toolName === 'git_diff') {
    const { buildGitDiffOutput } = await import('../tools/git-diff.js');
    return buildGitDiffOutput({
      staged: Boolean(input.staged),
      file: typeof input.file === 'string' ? input.file : undefined,
    }, cwd);
  }

  return '';
}
