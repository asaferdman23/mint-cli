/**
 * Tools host — bridges the unified event stream with the existing tool registry.
 *
 * Responsibilities:
 *   - Batch concurrency-safe tools via Promise.all (reads/greps/globs)
 *   - Run write-sensitive tools sequentially
 *   - Emit tool.call / tool.result / diff.proposed / diff.applied / approval.needed
 *   - Gate calls per ModePolicy (plan blocks writes; diff needs per-hunk approval)
 *   - Track files touched on the Session
 *
 * The underlying tool implementations continue to live in src/tools/*.ts —
 * this host only adds policy + event emission.
 */
import {
  executeTool as executeToolRaw,
  isConcurrencySafeTool,
  isDestructiveTool,
  toolRequiresApproval,
  type ToolContext,
} from '../tools/index.js';
import { countTokens } from './tokens.js';
import { askApproval, needsDiffPreview } from './approvals.js';
import { MODE_POLICIES, isReadOnlyBash, isReadOnlyTool, isWriteTool } from './modes.js';
import type { Session } from './session.js';

export interface BrainToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface BrainToolResult {
  id: string;
  name: string;
  ok: boolean;
  output: string;
  tokens: number;
  durationMs: number;
  rejected?: boolean;
}

export interface RunToolsOptions {
  iteration: number;
  /** Called on the first destructive iteration when mode=diff. If rejected, tools are skipped. */
  requireIterationApproval?: boolean;
}

/**
 * Execute a round of tool calls through the policy gate. Emits events on the
 * session; returns the results for the model to consume.
 */
export async function runToolCalls(
  session: Session,
  calls: BrainToolCall[],
  options: RunToolsOptions,
): Promise<BrainToolResult[]> {
  const policy = MODE_POLICIES[session.mode];

  // ── Iteration approval (diff mode, destructive batch) ────────────────────
  if (options.requireIterationApproval && policy.gateIteration) {
    const destructive = calls.filter((c) => isDestructiveTool(c.name));
    if (destructive.length > 0) {
      const approved = await askApproval(session, {
        reason: 'iteration',
        payload: {
          iteration: options.iteration,
          toolCalls: destructive.map((c) => ({ name: c.name, input: c.input })),
        },
      });
      if (!approved) {
        return calls.map((c) => toRejected(c, 'iteration rejected'));
      }
    }
  }

  const results: BrainToolResult[] = [];

  // ── Split into parallel-safe and sequential segments ─────────────────────
  let i = 0;
  while (i < calls.length) {
    if (session.aborted()) {
      for (; i < calls.length; i++) results.push(toRejected(calls[i], 'aborted'));
      break;
    }

    const call = calls[i];
    if (isConcurrencySafeTool(call.name)) {
      const batch: BrainToolCall[] = [];
      while (i < calls.length && isConcurrencySafeTool(calls[i].name)) {
        batch.push(calls[i]);
        i += 1;
      }
      const batchResults = await Promise.all(batch.map((b) => runSingle(session, b, options)));
      results.push(...batchResults);
    } else {
      results.push(await runSingle(session, call, options));
      i += 1;
    }
  }

  return results;
}

async function runSingle(
  session: Session,
  call: BrainToolCall,
  options: RunToolsOptions,
): Promise<BrainToolResult> {
  const startedAt = Date.now();
  const policy = MODE_POLICIES[session.mode];

  session.emit({
    type: 'tool.call',
    id: call.id,
    name: call.name,
    input: call.input,
    iteration: options.iteration,
  });
  session.recordToolCall();

  // ── Plan-mode blocks writes entirely ─────────────────────────────────────
  if (!policy.allowWrites && isWriteTool(call.name)) {
    return finish(session, call, startedAt, {
      ok: false,
      output: `[PLAN MODE] Would ${call.name}(${truncate(JSON.stringify(call.input))}) — skipped`,
      rejected: true,
    });
  }

  // ── Approval gate ────────────────────────────────────────────────────────
  const mustApprove = shouldAskApproval(session.mode, call);
  if (mustApprove) {
    // For diff-producing writes, emit a diff.proposed first so the TUI can
    // show a real patch preview before approval.
    if (needsDiffPreview(call.name)) {
      await emitDiffPreview(session, call);
    }

    const approved = await askApproval(session, {
      reason: needsDiffPreview(call.name) ? 'diff' : 'tool',
      payload: { name: call.name, input: call.input, iteration: options.iteration },
    });
    if (!approved) {
      return finish(session, call, startedAt, {
        ok: false,
        output: `[rejected] ${call.name} denied by user`,
        rejected: true,
      });
    }
  }

  // ── Execute ──────────────────────────────────────────────────────────────
  const ctx: ToolContext = {
    cwd: session.cwd,
    projectRoot: session.cwd,
    abortSignal: session.signal,
  };

  try {
    const res = await executeToolRaw(call.name, call.input, ctx);
    const ok = res.success;
    const output = ok ? res.output : res.error ?? res.output;

    // Record files the tool touched so the final result has an accurate list.
    if (ok && isWriteTool(call.name)) {
      const path = String(call.input.path ?? call.input.file ?? '');
      if (path) {
        session.recordFile(path);
        session.emit({
          type: 'diff.applied',
          file: path,
          additions: inferAdditions(call),
          deletions: inferDeletions(call),
        });
      }
    }

    return finish(session, call, startedAt, { ok, output });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return finish(session, call, startedAt, { ok: false, output: `[error] ${msg}` });
  }
}

// ─── Policy helpers ─────────────────────────────────────────────────────────

function shouldAskApproval(mode: Session['mode'], call: BrainToolCall): boolean {
  const policy = MODE_POLICIES[mode];
  if (!policy) return true;

  if (isReadOnlyTool(call.name)) return false;

  if (call.name === 'bash' || call.name === 'run_command') {
    if (!policy.gateBash) return false;
    const cmd = String(call.input.command ?? call.input.cmd ?? '');
    if (isReadOnlyBash(cmd)) return false;
    return toolRequiresApproval(call.name, call.input);
  }

  if (isWriteTool(call.name)) {
    return policy.gateDiff;
  }

  return policy.gateDiff;
}

// ─── Diff preview emission ──────────────────────────────────────────────────

async function emitDiffPreview(session: Session, call: BrainToolCall): Promise<void> {
  try {
    const hunks = await buildDiffHunks(session.cwd, call);
    if (hunks.length > 0) {
      const path = String(call.input.path ?? call.input.file ?? '');
      session.emit({ type: 'diff.proposed', file: path, hunks });
    }
  } catch {
    // Preview is best-effort; approval still goes through.
  }
}

async function buildDiffHunks(
  cwd: string,
  call: BrainToolCall,
): Promise<Array<{
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Array<{ type: 'context' | 'add' | 'remove'; content: string }>;
}>> {
  const { createTwoFilesPatch, parsePatch } = await import('diff');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  let oldContent = '';
  let newContent = '';
  const path = String(call.input.path ?? call.input.file ?? '');
  if (!path) return [];

  if (call.name === 'write_file') {
    try {
      oldContent = await readFile(join(cwd, path), 'utf-8');
    } catch {
      /* new file */
    }
    newContent = String(call.input.content ?? '');
  } else if (call.name === 'edit_file') {
    const oldStr = String(call.input.old_text ?? '');
    const newStr = String(call.input.new_text ?? '');
    try {
      const current = await readFile(join(cwd, path), 'utf-8');
      oldContent = current;
      newContent = current.includes(oldStr) ? current.replace(oldStr, newStr) : current;
    } catch {
      oldContent = oldStr;
      newContent = newStr;
    }
  } else {
    return [];
  }

  const patchText = createTwoFilesPatch(path, path, oldContent, newContent, 'old', 'new');
  const [patch] = parsePatch(patchText);
  if (!patch) return [];

  return patch.hunks.map((h: {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines.map((line: string) => {
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === '+') return { type: 'add' as const, content };
      if (prefix === '-') return { type: 'remove' as const, content };
      return { type: 'context' as const, content };
    }),
  }));
}

// ─── Shared finishers ───────────────────────────────────────────────────────

function finish(
  session: Session,
  call: BrainToolCall,
  startedAt: number,
  result: { ok: boolean; output: string; rejected?: boolean },
): BrainToolResult {
  const durationMs = Date.now() - startedAt;
  const tokens = countTokens(result.output);
  session.emit({
    type: 'tool.result',
    id: call.id,
    ok: result.ok,
    output: result.output,
    tokens,
    durationMs,
  });
  return {
    id: call.id,
    name: call.name,
    ok: result.ok,
    output: result.output,
    tokens,
    durationMs,
    rejected: result.rejected,
  };
}

function toRejected(call: BrainToolCall, reason: string): BrainToolResult {
  return {
    id: call.id,
    name: call.name,
    ok: false,
    output: `[rejected] ${reason}`,
    tokens: 0,
    durationMs: 0,
    rejected: true,
  };
}

function truncate(s: string, n = 120): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function inferAdditions(call: BrainToolCall): number {
  if (call.name === 'write_file') {
    const c = String(call.input.content ?? '');
    return c ? c.split('\n').length : 0;
  }
  if (call.name === 'edit_file') {
    const c = String(call.input.new_text ?? '');
    return c ? c.split('\n').length : 0;
  }
  return 0;
}

function inferDeletions(call: BrainToolCall): number {
  if (call.name === 'edit_file') {
    const c = String(call.input.old_text ?? '');
    return c ? c.split('\n').length : 0;
  }
  return 0;
}
