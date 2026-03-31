import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { glob } from 'glob';
import type { ToolDefinition } from '../providers/types.js';

function assertInCwd(filePath: string, cwd: string): string {
  const abs = resolve(cwd, filePath);
  const cwdAbs = resolve(cwd);
  if (!abs.startsWith(cwdAbs + sep) && abs !== cwdAbs) {
    throw new Error(`Path outside working directory: ${filePath}`);
  }
  return abs;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  {
    name: 'bash',
    description: 'Execute a shell command. Returns stdout, stderr, exit code.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file (creates or overwrites).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace exact text in a file. Fails if old_text not found.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to file' },
        old_text: { type: 'string', description: 'Exact text to replace' },
        new_text: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'find_files',
    description: 'Find files matching a glob pattern.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts")' },
        dir: { type: 'string', description: 'Directory to search in (default: cwd)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_files',
    description: 'Search file contents for a regex pattern. Returns matching lines with file:line format.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        dir: { type: 'string', description: 'Directory to search in (default: cwd)' },
        glob: { type: 'string', description: 'File glob filter (e.g. "*.ts")' },
      },
      required: ['pattern'],
    },
  },
];

// ─── Tool Executors ────────────────────────────────────────────────────────────

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
  onApprovalNeeded?: (toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>;
  onDiffProposed?: (path: string, diff: string) => Promise<boolean>;
}

/**
 * Execute a bash command with safety constraints.
 * - spawnSync with 30s timeout
 * - 64KB output cap
 * - cwd enforced
 */
function executeBash(command: string, cwd: string, timeout = 30000): string {
  const result = spawnSync('sh', ['-c', command], {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024, // 64KB cap
  });

  const stdout = (result.stdout ?? '').slice(0, 64000);
  const stderr = (result.stderr ?? '').slice(0, 4000);
  const exitCode = result.status ?? 0;

  if (result.error) {
    const errMsg = result.error.message ?? 'Unknown error';
    if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timeout')) {
      return `[ERROR] Command timed out after ${timeout}ms`;
    }
    return `[ERROR] ${errMsg}`;
  }

  let output = '';
  if (stdout) output += stdout;
  if (stderr) output += (output ? '\n[stderr] ' : '[stderr] ') + stderr;
  if (!output) output = `[exit ${exitCode}]`;
  else if (exitCode !== 0) output += `\n[exit ${exitCode}]`;

  return output;
}

function executeReadFile(filePath: string, cwd: string): string {
  try {
    const abs = assertInCwd(filePath, cwd);
    if (!existsSync(abs)) {
      return `[ERROR] File not found: ${filePath}`;
    }
    const content = readFileSync(abs, 'utf8');
    if (content.length > 64000) {
      return content.slice(0, 64000) + '\n... [truncated at 64KB]';
    }
    return content;
  } catch (err) {
    return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
  }
}

function executeWriteFile(filePath: string, content: string, cwd: string): string {
  try {
    const abs = assertInCwd(filePath, cwd);
    writeFileSync(abs, content, 'utf8');
    return `[OK] Written ${content.length} chars to ${filePath}`;
  } catch (err) {
    return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
  }
}

function executeEditFile(filePath: string, oldText: string, newText: string, cwd: string): string {
  try {
    const abs = assertInCwd(filePath, cwd);
    if (!existsSync(abs)) {
      return `[ERROR] File not found: ${filePath}`;
    }
    const current = readFileSync(abs, 'utf8');
    if (!current.includes(oldText)) {
      return `[ERROR] old_text not found in ${filePath}. Make sure the text matches exactly.`;
    }
    const updated = current.replace(oldText, newText);
    writeFileSync(abs, updated, 'utf8');
    return `[OK] Replaced text in ${filePath}`;
  } catch (err) {
    return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function executeFindFiles(pattern: string, dir?: string, cwd = '.'): Promise<string> {
  try {
    const searchDir = dir ?? cwd;
    const matches = await glob(pattern, { cwd: searchDir, nodir: false });
    if (matches.length === 0) {
      return `[OK] No files found matching: ${pattern}`;
    }
    return matches.join('\n');
  } catch (err) {
    return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
  }
}

function executeGrepFiles(pattern: string, dir?: string, fileGlob?: string, cwd = '.'): string {
  try {
    const searchDir = resolve(cwd, dir ?? '.');
    const args = ['-rn', '-E', pattern];
    if (fileGlob) args.push(`--include=${fileGlob}`);
    args.push(searchDir);
    const result = execFileSync('grep', args, { encoding: 'utf8', timeout: 15000 });
    const lines = result.split('\n').slice(0, 100);
    return lines.join('\n') || '[OK] No matches found';
  } catch (err: unknown) {
    // grep exits 1 when no matches — not an error
    const spawnErr = err as { status?: number; stdout?: string };
    if (spawnErr.status === 1) return '[OK] No matches found';
    return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Execute a tool call by name with input arguments.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  toolCallId: string,
  options: AgentOptions
): Promise<ToolResult> {
  const cwd = options.cwd;
  const isDestructive = ['write_file', 'edit_file', 'bash'].includes(toolName);
  const mode = options.mode ?? 'auto';

  // --plan mode: block all writes
  if (mode === 'plan' && isDestructive) {
    return {
      toolCallId,
      toolName,
      content: `[PLAN MODE] Would execute: ${toolName}(${JSON.stringify(input).slice(0, 200)}) — skipped (--plan mode)`,
      isError: false,
    };
  }

  // --diff mode: for write_file/edit_file, show diff and ask
  if (mode === 'diff' && (toolName === 'write_file' || toolName === 'edit_file')) {
    const diffPreview = await generateDiffPreview(toolName, input, cwd);
    if (options.onDiffProposed) {
      const approved = await options.onDiffProposed(String(input.path ?? ''), diffPreview);
      if (!approved) {
        return {
          toolCallId,
          toolName,
          content: `[DIFF MODE] Change rejected by user for ${input.path}`,
          isError: false,
        };
      }
    }
  }

  // --auto mode (default): prompt for risky bash commands
  if (mode === 'auto' && toolName === 'bash') {
    const cmd = String(input.command ?? '');
    const isRisky = /\b(rm|mv|del|format|truncate|drop|delete|unlink)\b/.test(cmd);
    if (isRisky && options.onApprovalNeeded) {
      const approved = await options.onApprovalNeeded(toolName, input);
      if (!approved) {
        return {
          toolCallId,
          toolName,
          content: `[AUTO MODE] Command rejected by user: ${cmd}`,
          isError: false,
        };
      }
    }
  }

  try {
    let content: string;

    switch (toolName) {
      case 'bash': {
        const command = input.command as string;
        const timeout = (input.timeout as number | undefined) ?? 30000;
        content = executeBash(command, cwd, timeout);
        break;
      }
      case 'read_file': {
        const filePath = input.path as string;
        content = executeReadFile(filePath, cwd);
        break;
      }
      case 'write_file': {
        const filePath = input.path as string;
        const fileContent = input.content as string;
        content = executeWriteFile(filePath, fileContent, cwd);
        break;
      }
      case 'edit_file': {
        const filePath = input.path as string;
        const oldText = input.old_text as string;
        const newText = input.new_text as string;
        content = executeEditFile(filePath, oldText, newText, cwd);
        break;
      }
      case 'find_files': {
        const pattern = input.pattern as string;
        const dir = input.dir as string | undefined;
        content = await executeFindFiles(pattern, dir, cwd);
        break;
      }
      case 'grep_files': {
        const pattern = input.pattern as string;
        const dir = input.dir as string | undefined;
        const fileGlob = input.glob as string | undefined;
        content = executeGrepFiles(pattern, dir, fileGlob, cwd);
        break;
      }
      default:
        content = `[ERROR] Unknown tool: ${toolName}`;
    }

    return { toolCallId, toolName, content, isError: content.startsWith('[ERROR]') };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { toolCallId, toolName, content: `[ERROR] ${errMsg}`, isError: true };
  }
}

async function generateDiffPreview(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string
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
    return createTwoFilesPatch(path, path, oldStr, newStr, 'old', 'new');
  }

  return '';
}
