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

/** Max time the user has to respond before we auto-deny and unblock the loop. */
const APPROVAL_TIMEOUT_MS = 120_000;

/**
 * Emit an approval request and wait. The promise always settles, even if:
 *   - no handler is wired (fallback runs, or we default-deny)
 *   - the session is aborted (deny, return immediately)
 *   - the user walks away (timeout after APPROVAL_TIMEOUT_MS, deny)
 */
export function askApproval(session: Session, args: AskApprovalArgs): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (abortListener && session.signal) {
        session.signal.removeEventListener('abort', abortListener);
      }
    };

    const wrappedResolve = (ok: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    };

    // If already aborted, deny immediately.
    if (session.signal?.aborted) {
      wrappedResolve(false);
      return;
    }

    // Abort during the wait → deny.
    if (session.signal) {
      abortListener = () => {
        session.emit({ type: 'warn', message: 'Approval cancelled — session aborted' });
        wrappedResolve(false);
      };
      session.signal.addEventListener('abort', abortListener);
    }

    // Hard safety timeout.
    timeoutHandle = setTimeout(() => {
      session.emit({
        type: 'warn',
        message: `Approval timed out after ${APPROVAL_TIMEOUT_MS / 1000}s — denied automatically`,
      });
      wrappedResolve(false);
    }, APPROVAL_TIMEOUT_MS);

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
      // calls resolve(), or the abort/timeout fires above.
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
