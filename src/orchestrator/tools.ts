/**
 * Orchestrator tools — the toolkit available to the Grok orchestrator.
 *
 * All tools except write_code are pure code ($0 cost).
 * write_code dispatches to DeepSeek for the actual code generation.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { loadIndex, indexProject, searchRelevantFiles } from '../context/index.js';
import { parseDiffs } from '../pipeline/diff-parser.js';
import { applyDiffsToProject } from '../pipeline/diff-apply.js';
import { writeCode } from './write-code.js';
import { getRelevantExample } from '../context/examples.js';
import type { ToolDefinition } from '../tools/types.js';

export interface OrchestratorToolContext {
  cwd: string;
  onLog?: (message: string) => void;
  onApprovalNeeded?: (description: string) => Promise<boolean>;
}

// Cost tracking for the session
let sessionWriteCodeCost = 0;

// Undo backup — stores the last version of each edited file
const undoBackups = new Map<string, string>();
export function getWriteCodeCost(): number { return sessionWriteCodeCost; }
export function resetWriteCodeCost(): void { sessionWriteCodeCost = 0; }

// Tools that are safe to auto-approve (read-only)
const SAFE_TOOLS = new Set([
  'search_files', 'read_file', 'grep_file', 'list_files',
  'git_diff', 'run_tests', 'write_code',
]);

export function isToolSafe(toolName: string, input: Record<string, unknown>): boolean {
  if (SAFE_TOOLS.has(toolName)) return true;
  // run_command is safe only for read-only commands
  if (toolName === 'run_command') {
    const cmd = String(input.command ?? '').trim().toLowerCase();
    const readOnlyPrefixes = ['git status', 'git log', 'git diff', 'ls', 'cat ', 'head ', 'tail ', 'npm run build', 'npm test', 'npx tsc', 'curl ', 'echo ', 'pwd', 'which ', 'node -e', 'wc '];
    return readOnlyPrefixes.some((prefix) => cmd.startsWith(prefix));
  }
  return false;
}

// ─── Tool Definitions (for LLM function calling) ──────────────────────────

export const ORCHESTRATOR_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_files',
    description: 'Search for files relevant to a task using keywords. Returns file paths with relevance scores.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search for (e.g. "mobile menu toggle", "auth login")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content as text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory. Returns file and directory names.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to project root (default: ".")' },
      },
      required: [],
    },
  },
  {
    name: 'write_code',
    description: 'Send a coding task to a fast coding model. Provide a precise description of what to change and the relevant file contents as a JSON object mapping file paths to their contents. Returns a unified diff.',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Precise description of what code to write or change' },
        files: { type: 'object', description: 'Map of filepath -> file contents to include as context' },
      },
      required: ['task', 'files'],
    },
  },
  {
    name: 'apply_diff',
    description: 'Apply a unified diff to modify or create files. Pass the raw diff text.',
    input_schema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Unified diff text to apply' },
      },
      required: ['diff'],
    },
  },
  {
    name: 'grep_file',
    description: 'Search for a pattern inside a file. Returns matching lines with line numbers. Use this to find the exact text before using edit_file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        pattern: { type: 'string', description: 'Text or regex pattern to search for' },
      },
      required: ['path', 'pattern'],
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing exact text. The old_text must match exactly (including whitespace). Use this for precise edits instead of diffs.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        old_text: { type: 'string', description: 'The exact text to find and replace (must match exactly)' },
        new_text: { type: 'string', description: 'The replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content. Use for new files or full rewrites.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command (e.g. npm test, npm run build, git status). Returns stdout and stderr.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'git_diff',
    description: 'Show what changed since the last commit. Returns unified diff of all modified files.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and commit with a message.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['message'],
    },
  },
  {
    name: 'run_tests',
    description: 'Detect and run the project test suite. Tries npm test, then looks for common test runners.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'undo',
    description: 'Revert the last file change made by edit_file or write_file. Restores the file to its previous state.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to revert' },
      },
      required: ['path'],
    },
  },
];

// ─── Tool Executors ────────────────────────────────────────────────────────

const DANGEROUS_COMMANDS = /\b(rm\s+-rf|sudo|chmod\s+777|mkfs|dd\s+if|shutdown|reboot|kill\s+-9|pkill)\b/;
const MAX_OUTPUT = 4000;

export async function executeOrchestratorTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: OrchestratorToolContext,
): Promise<string> {
  switch (toolName) {
    case 'search_files':
      return await toolSearchFiles(String(input.query ?? ''), ctx);
    case 'read_file':
      return toolReadFile(String(input.path ?? ''), ctx);
    case 'list_files':
      return toolListFiles(String(input.path ?? '.'), ctx);
    case 'write_code':
      return await toolWriteCode(
        String(input.task ?? ''),
        (input.files ?? {}) as Record<string, string>,
        ctx,
      );
    case 'apply_diff':
      return toolApplyDiff(String(input.diff ?? ''), ctx);
    case 'grep_file':
      return toolGrepFile(String(input.path ?? ''), String(input.pattern ?? ''), ctx);
    case 'edit_file':
      return toolEditFile(
        String(input.path ?? ''),
        String(input.old_text ?? ''),
        String(input.new_text ?? ''),
        ctx,
      );
    case 'write_file':
      return toolWriteFile(String(input.path ?? ''), String(input.content ?? ''), ctx);
    case 'run_command':
      return toolRunCommand(String(input.command ?? ''), ctx);
    case 'git_diff':
      return toolGitDiff(ctx);
    case 'git_commit':
      return toolGitCommit(String(input.message ?? ''), ctx);
    case 'run_tests':
      return toolRunTests(ctx);
    case 'undo':
      return toolUndo(String(input.path ?? ''), ctx);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ─── Individual tool implementations ───────────────────────────────────────

async function toolSearchFiles(query: string, ctx: OrchestratorToolContext): Promise<string> {
  ctx.onLog?.('searching files...');
  try {
    let index = await loadIndex(ctx.cwd);
    if (!index || index.totalFiles === 0) {
      index = await indexProject(ctx.cwd);
    }
    if (!index || index.totalFiles === 0) {
      return 'No files indexed. The project may be empty. Use list_files to check.';
    }
    const results = await searchRelevantFiles(ctx.cwd, query, index, { maxFiles: 10 });
    if (results.length === 0) {
      return 'No matching files found. Try different keywords or use list_files to browse.';
    }
    return results
      .map((r) => `${r.path} (score: ${r.score}, reason: ${r.reason})`)
      .join('\n');
  } catch (err) {
    return `Search error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function toolReadFile(filePath: string, ctx: OrchestratorToolContext): string {
  ctx.onLog?.(`reading ${filePath}`);
  const fullPath = join(ctx.cwd, filePath);
  if (!fullPath.startsWith(ctx.cwd)) return 'Error: path outside project directory';
  try {
    const content = readFileSync(fullPath, 'utf-8');
    if (content.length > 32000) {
      // For large files, show structure: first 200 lines + line count + hint to use grep_file
      const lines = content.split('\n');
      const preview = lines.slice(0, 200).map((l, i) => `${i + 1}: ${l}`).join('\n');
      return `${preview}\n\n... (${lines.length} total lines, file truncated at line 200. Use grep_file to search for specific content.)`;
    }
    return content;
  } catch {
    return `Error: file not found: ${filePath}`;
  }
}

function toolGrepFile(filePath: string, pattern: string, ctx: OrchestratorToolContext): string {
  ctx.onLog?.(`grep ${filePath}: ${pattern}`);
  const fullPath = join(ctx.cwd, filePath);
  if (!fullPath.startsWith(ctx.cwd)) return 'Error: path outside project directory';
  try {
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const matches: string[] = [];
    const patternLower = pattern.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(patternLower)) {
        // Show 2 lines before and after for context
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 3);
        matches.push(
          lines.slice(start, end)
            .map((l, idx) => `${start + idx + 1}${start + idx === i ? '>' : ' '}: ${l}`)
            .join('\n')
        );
        matches.push('---');
      }
    }

    if (matches.length === 0) return `No matches for "${pattern}" in ${filePath}`;
    return matches.slice(0, 30).join('\n'); // Cap at ~30 match blocks
  } catch {
    return `Error: file not found: ${filePath}`;
  }
}

function toolListFiles(dirPath: string, ctx: OrchestratorToolContext): string {
  ctx.onLog?.(`listing ${dirPath}`);
  const fullPath = join(ctx.cwd, dirPath);
  if (!fullPath.startsWith(ctx.cwd) && fullPath !== ctx.cwd) return 'Error: path outside project directory';
  try {
    const entries = readdirSync(fullPath, { withFileTypes: true });
    const lines = entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.isDirectory() ? `${e.name}/` : e.name)
      .sort();
    return lines.length > 0 ? lines.join('\n') : '(empty directory)';
  } catch {
    return `Error: cannot list directory: ${dirPath}`;
  }
}

async function toolWriteCode(
  task: string,
  files: Record<string, string>,
  ctx: OrchestratorToolContext,
): Promise<string> {
  ctx.onLog?.('writing code (deepseek)...');

  // If files map has paths but no content, read the files
  const resolvedFiles: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (content && content.length > 0) {
      resolvedFiles[path] = content;
    } else {
      try {
        resolvedFiles[path] = readFileSync(join(ctx.cwd, path), 'utf-8');
      } catch {
        resolvedFiles[path] = '(file does not exist — create it)';
      }
    }
  }

  // Inject relevant project example into the task prompt
  const filePaths = Object.keys(resolvedFiles);
  const example = getRelevantExample(task, filePaths, ctx.cwd);
  const enrichedTask = example
    ? `${task}\n\n${example}`
    : task;

  try {
    const result = await writeCode(enrichedTask, resolvedFiles);
    sessionWriteCodeCost += result.cost;
    ctx.onLog?.(`code written ($${result.cost.toFixed(4)})`);
    // Return raw response — the orchestrator reviews it and decides to apply or retry
    return result.rawResponse;
  } catch (err) {
    return `write_code error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function toolEditFile(filePath: string, oldText: string, newText: string, ctx: OrchestratorToolContext): Promise<string> {
  ctx.onLog?.(`editing ${filePath}`);
  if (ctx.onApprovalNeeded) {
    const preview = `Edit ${filePath}:\n  - ${oldText.slice(0, 80).replace(/\n/g, '\\n')}...\n  + ${newText.slice(0, 80).replace(/\n/g, '\\n')}...`;
    const approved = await ctx.onApprovalNeeded(preview);
    if (!approved) return 'User rejected this edit.';
  }
  const fullPath = join(ctx.cwd, filePath);
  if (!fullPath.startsWith(ctx.cwd)) return 'Error: path outside project directory';
  try {
    const content = readFileSync(fullPath, 'utf-8');

    // Try exact match first
    if (content.includes(oldText)) {
      const count = content.split(oldText).length - 1;
      if (count > 1) {
        return `Error: old_text matches ${count} locations in ${filePath}. Make it more specific by including more surrounding context.`;
      }
      undoBackups.set(filePath, content);
      const updated = content.replace(oldText, newText);
      writeFileSync(fullPath, updated, 'utf-8');
      return `Edited ${filePath}: replaced ${oldText.length} chars with ${newText.length} chars.`;
    }

    // Try whitespace-normalized match (collapse all whitespace to single space)
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    const normalizedOld = normalize(oldText);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Try single line match
      if (normalize(lines[i]).includes(normalizedOld)) {
        const updated = content.replace(lines[i], lines[i].replace(
          // Find the part that matches when normalized
          new RegExp(escapeRegex(normalizedOld).replace(/ /g, '\\s+'), 's'),
          newText,
        ));
        if (updated !== content) {
          writeFileSync(fullPath, updated, 'utf-8');
          return `Edited ${filePath} (fuzzy match on line ${i + 1}): replaced text.`;
        }
      }
      // Try multi-line window
      for (let windowSize = 2; windowSize <= 5 && i + windowSize <= lines.length; windowSize++) {
        const window = lines.slice(i, i + windowSize).join('\n');
        if (normalize(window).includes(normalizedOld)) {
          const replacement = lines.slice(0, i).join('\n') +
            '\n' + newText + '\n' +
            lines.slice(i + windowSize).join('\n');
          writeFileSync(fullPath, replacement, 'utf-8');
          return `Edited ${filePath} (fuzzy match lines ${i + 1}-${i + windowSize}): replaced text.`;
        }
      }
    }

    // Show nearby content to help the LLM
    const preview = lines.slice(0, 5).map((l, i) => `  ${i + 1}: ${l}`).join('\n');
    return `Error: could not find the text to replace in ${filePath}. The file starts with:\n${preview}\n\nTip: use read_file to see the exact content, then copy-paste the exact text you want to replace.`;
  } catch (err) {
    return `Error editing ${filePath}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── Git + Test + Undo tools ───────────────────────────────────────────────

function toolGitDiff(ctx: OrchestratorToolContext): string {
  ctx.onLog?.('git diff');
  try {
    const diff = execSync('git diff', { cwd: ctx.cwd, encoding: 'utf-8', timeout: 10_000 });
    const staged = execSync('git diff --cached', { cwd: ctx.cwd, encoding: 'utf-8', timeout: 10_000 });
    const status = execSync('git status --short', { cwd: ctx.cwd, encoding: 'utf-8', timeout: 10_000 });
    const parts = [
      status.trim() ? `Status:\n${status.trim()}` : 'No changes.',
      diff.trim() ? `\nUnstaged changes:\n${diff.trim().slice(0, MAX_OUTPUT)}` : '',
      staged.trim() ? `\nStaged changes:\n${staged.trim().slice(0, MAX_OUTPUT)}` : '',
    ].filter(Boolean);
    return parts.join('\n') || 'Working tree clean.';
  } catch (err) {
    return `Git error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function toolGitCommit(message: string, ctx: OrchestratorToolContext): string {
  ctx.onLog?.(`git commit: ${message.slice(0, 40)}`);
  try {
    execFileSync('git', ['add', '-A'], { cwd: ctx.cwd, timeout: 10_000 });
    const result = execFileSync('git', ['commit', '-m', message], {
      cwd: ctx.cwd,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return result.trim() || 'Committed.';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('nothing to commit')) return 'Nothing to commit — working tree clean.';
    return `Git commit error: ${msg}`;
  }
}

function toolRunTests(ctx: OrchestratorToolContext): string {
  ctx.onLog?.('running tests');
  try {
    // Detect test command from package.json
    const pkgPath = join(ctx.cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const testScript = pkg.scripts?.test;
      if (testScript && testScript !== 'echo "Error: no test specified" && exit 1') {
        const output = execSync('npm test', { cwd: ctx.cwd, encoding: 'utf-8', timeout: 60_000, maxBuffer: 1024 * 1024 });
        return output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + '\n... (truncated)' : output;
      }
    }
    return 'No test script found in package.json.';
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const out = [execErr.stdout, execErr.stderr].filter(Boolean).join('\n');
    return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + '\n... (truncated)' : out || 'Tests failed.';
  }
}

function toolUndo(filePath: string, ctx: OrchestratorToolContext): string {
  ctx.onLog?.(`undo ${filePath}`);
  const backup = undoBackups.get(filePath);
  if (!backup) return `No undo history for ${filePath}. Only the most recent edit can be undone.`;
  const fullPath = join(ctx.cwd, filePath);
  try {
    writeFileSync(fullPath, backup, 'utf-8');
    undoBackups.delete(filePath);
    return `Reverted ${filePath} to previous state.`;
  } catch (err) {
    return `Undo error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Resolve a path safely — prevents traversal and symlink escapes */
function safePath(filePath: string, cwd: string): string | null {
  const fullPath = join(cwd, filePath);
  if (!fullPath.startsWith(cwd + '/') && fullPath !== cwd) return null;
  // Check symlinks if file exists
  try {
    const real = realpathSync(fullPath);
    const realCwd = realpathSync(cwd);
    if (!real.startsWith(realCwd + '/') && real !== realCwd) return null;
  } catch {
    // File doesn't exist yet (creating new file) — logical path check is enough
  }
  return fullPath;
}

async function toolWriteFile(filePath: string, content: string, ctx: OrchestratorToolContext): Promise<string> {
  ctx.onLog?.(`writing ${filePath}`);
  if (ctx.onApprovalNeeded) {
    const preview = `Create ${filePath} (${content.length} chars):\n  ${content.slice(0, 120).replace(/\n/g, '\\n')}...`;
    const approved = await ctx.onApprovalNeeded(preview);
    if (!approved) return 'User rejected this file creation.';
  }
  const fullPath = join(ctx.cwd, filePath);
  if (!fullPath.startsWith(ctx.cwd)) return 'Error: path outside project directory';
  try {
    mkdirSync(dirname(fullPath), { recursive: true });
    // Backup existing file for undo
    try { undoBackups.set(filePath, readFileSync(fullPath, 'utf-8')); } catch { /* new file */ }
    writeFileSync(fullPath, content, 'utf-8');
    return `Created ${filePath} (${content.length} chars).`;
  } catch (err) {
    return `Error writing ${filePath}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function toolApplyDiff(diffText: string, ctx: OrchestratorToolContext): string {
  ctx.onLog?.('applying diff...');
  try {
    // Try multiple parsing strategies
    let diffs = parseDiffs(diffText);
    if (diffs.length === 0) {
      diffs = parseDiffs('```diff\n' + diffText + '\n```');
    }
    if (diffs.length === 0) {
      // Try wrapping each --- block
      const blocks = diffText.split(/(?=^---\s)/m).filter((b) => b.trim());
      for (const block of blocks) {
        const parsed = parseDiffs('```diff\n' + block.trim() + '\n```');
        diffs.push(...parsed);
      }
    }
    if (diffs.length === 0) {
      return 'Error: could not parse diff. The diff text was:\n' + diffText.slice(0, 500);
    }
    const results = applyDiffsToProject(diffs, ctx.cwd);
    return formatApplyResults(results);
  } catch (err) {
    return `apply_diff error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatApplyResults(results: Array<{ file: string; ok: boolean; action: string; error?: string }>): string {
  return results
    .map((r) => r.ok ? `Applied: ${r.action} ${r.file}` : `Failed: ${r.file} — ${r.error}`)
    .join('\n');
}

function toolRunCommand(command: string, ctx: OrchestratorToolContext): string {
  if (DANGEROUS_COMMANDS.test(command)) {
    return `Blocked: "${command}" is a potentially dangerous command.`;
  }
  ctx.onLog?.(`running: ${command.slice(0, 60)}...`);
  try {
    const output = execSync(command, {
      cwd: ctx.cwd,
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return output.length > MAX_OUTPUT
      ? output.slice(0, MAX_OUTPUT) + '\n... (truncated)'
      : output || '(no output)';
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const out = [execErr.stdout, execErr.stderr, execErr.message].filter(Boolean).join('\n');
    return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + '\n... (truncated)' : out || 'Command failed';
  }
}
