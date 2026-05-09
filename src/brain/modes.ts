/**
 * Approval-mode policy table.
 *
 * plan → no writes at all, show intent only.
 * diff → every file change requires approval; per-hunk review available.
 * auto → safe tools auto-approve; writes prompt.
 * yolo → nothing is gated.
 */
import type { Mode } from './events.js';

export interface ModePolicy {
  /** Whether write tools (edit_file, write_file, apply_diff, git_commit) are allowed at all. */
  allowWrites: boolean;
  /** Whether bash-like commands are gated on a per-call basis. */
  gateBash: boolean;
  /** Whether each diff requires user approval before applying. */
  gateDiff: boolean;
  /** Whether each iteration that proposes destructive actions requires approval. */
  gateIteration: boolean;
}

export const MODE_POLICIES: Record<Mode, ModePolicy> = {
  plan: {
    allowWrites: false,
    gateBash: true,
    gateDiff: false,
    gateIteration: false,
  },
  diff: {
    allowWrites: true,
    gateBash: true,
    gateDiff: true,
    gateIteration: true,
  },
  auto: {
    allowWrites: true,
    gateBash: true,
    gateDiff: false,
    gateIteration: false,
  },
  yolo: {
    allowWrites: true,
    gateBash: false,
    gateDiff: false,
    gateIteration: false,
  },
};

const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'edit_file',
  'write_file',
  'apply_diff',
  'git_commit',
  'search_replace',
]);

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'grep_file',
  'grep_files',
  'search_files',
  'find_files',
  'list_files',
  'list_dir',
  'git_diff',
  'glob',
  'web_fetch',
]);

const READ_ONLY_BASH_PREFIXES: readonly string[] = [
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'ls',
  'ls ',
  'pwd',
  'cat ',
  'head ',
  'tail ',
  'wc ',
  'which ',
  'node -e',
  'echo ',
  'npm run build',
  'npm test',
  'npx tsc',
];

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

export function isReadOnlyBash(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  return READ_ONLY_BASH_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Decide whether a proposed tool call needs user approval under the given mode. */
export function requiresToolApproval(
  mode: Mode,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  const policy = MODE_POLICIES[mode];
  if (!policy) return true;

  if (isReadOnlyTool(toolName)) return false;

  if (toolName === 'bash' || toolName === 'run_command') {
    if (!policy.gateBash) return false;
    const cmd = String(input.command ?? input.cmd ?? '');
    return !isReadOnlyBash(cmd);
  }

  if (isWriteTool(toolName)) {
    if (!policy.allowWrites) return true;
    return policy.gateDiff;
  }

  return policy.gateDiff;
}

export function writesBlocked(mode: Mode): boolean {
  return !MODE_POLICIES[mode].allowWrites;
}
