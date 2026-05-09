/**
 * Approval gate — emits an approval.needed AgentEvent with a resolver closure
 * and awaits the consumer's decision.
 *
 * The TUI handler sees an `approval.needed` event and calls `event.resolve(ok)`.
 * In `mint exec` headless mode, a no-op sink auto-approves everything per the
 * caller's chosen Mode.
 */
import type { Session } from './session.js';
import type { ApprovalReason, Mode } from './events.js';
import { MODE_POLICIES, requiresToolApproval, isWriteTool } from './modes.js';

export interface AskApprovalArgs {
  reason: ApprovalReason;
  payload: Record<string, unknown>;
  /** Consumer-override: if provided, skip emitting and call this directly. */
  fallback?: () => Promise<boolean>;
}

/**
 * Emit an approval request and wait. If the event is not claimed before the
 * next tick (e.g. no one wired a handler), the fallback is used, or — if no
 * fallback is set — approval is DENIED for safety.
 */
export function askApproval(session: Session, args: AskApprovalArgs): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const wrappedResolve = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    session.emit({
      type: 'approval.needed',
      reason: args.reason,
      payload: args.payload,
      resolve: wrappedResolve,
    });

    // If the host hasn't claimed the approval synchronously, defer to the
    // fallback (or default-deny). This keeps headless/no-handler flows sane.
    queueMicrotask(() => {
      if (settled) return;
      if (args.fallback) {
        args.fallback().then(wrappedResolve, () => wrappedResolve(false));
      }
      // Otherwise: leave the promise pending — a real handler has until it
      // calls resolve(). If no one ever does, the session's abort signal will
      // eventually unblock the caller.
    });
  });
}

/** Decide up-front whether a tool call needs approval under this mode. */
export function needsApproval(mode: Mode, toolName: string, input: Record<string, unknown>): boolean {
  return requiresToolApproval(mode, toolName, input);
}

/** Is this tool one where we should generate a diff preview (vs. raw input dump)? */
export function needsDiffPreview(toolName: string): boolean {
  return isWriteTool(toolName) && toolName !== 'git_commit';
}

/** Under this mode, are writes entirely blocked (plan mode)? */
export function writesBlocked(mode: Mode): boolean {
  return !MODE_POLICIES[mode].allowWrites;
}
