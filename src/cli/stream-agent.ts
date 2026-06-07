/**
 * NDJSON streaming agent bridge — drives runBrain() for the Go BubbleTea TUI.
 *
 * Protocol (newline-delimited JSON, both directions):
 *
 *   stdin  (commands from the Go UI):
 *     {"type":"prompt","task":"...","mode":"diff","model":"claude-sonnet-4"}
 *     {"type":"approval","ok":true}
 *     {"type":"cancel"}
 *
 *   stdout (events to the Go UI): each AgentEvent serialized as one JSON line,
 *     verbatim from the brain's event stream, plus a final {"type":"done",...}.
 *
 * One prompt runs at a time. Approval gates park until an approval command
 * arrives on stdin. The process stays alive across prompts until stdin closes.
 */
import { createInterface } from 'node:readline';
import { runBrain, type AgentEvent, type Mode } from '../brain/index.js';
import type { ModelId } from '../providers/types.js';

interface PromptCommand {
  type: 'prompt';
  task: string;
  mode?: Mode;
  model?: string;
}
interface ApprovalCommand {
  type: 'approval';
  ok: boolean;
}
interface CancelCommand {
  type: 'cancel';
}
type Command = PromptCommand | ApprovalCommand | CancelCommand;

/** Write a single event as one NDJSON line. */
function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

export async function runStreamAgent(): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });

  // Pending approval resolver — set while a gate is open.
  let pendingApproval: ((ok: boolean) => void) | null = null;
  let abortController: AbortController | null = null;
  let running = false;

  // Queue of prompts received while one is already running (we process serially).
  const promptQueue: PromptCommand[] = [];

  const handleCommand = (cmd: Command): void => {
    switch (cmd.type) {
      case 'approval':
        if (pendingApproval) {
          const resolve = pendingApproval;
          pendingApproval = null;
          resolve(cmd.ok);
        }
        break;
      case 'cancel':
        abortController?.abort();
        break;
      case 'prompt':
        promptQueue.push(cmd);
        void drainQueue();
        break;
    }
  };

  const drainQueue = async (): Promise<void> => {
    if (running) return;
    const next = promptQueue.shift();
    if (!next) return;
    running = true;
    await runOnePrompt(next);
    running = false;
    void drainQueue();
  };

  const runOnePrompt = async (cmd: PromptCommand): Promise<void> => {
    abortController = new AbortController();
    const overrideModel =
      cmd.model && cmd.model !== 'auto' ? (cmd.model as ModelId) : undefined;

    try {
      for await (const event of runBrain({
        task: cmd.task,
        cwd: process.cwd(),
        mode: cmd.mode ?? 'diff',
        signal: abortController.signal,
        model: overrideModel,
      })) {
        // Approval gates can't be JSON-serialized (they carry a resolve fn).
        // Emit a serializable notice, then park until the UI answers.
        if (event.type === 'approval.needed') {
          emit({ type: 'approval.needed', reason: event.reason, payload: event.payload, ts: event.ts });
          const ok = await new Promise<boolean>((resolve) => {
            pendingApproval = resolve;
          });
          event.resolve(ok);
          continue;
        }
        emit(serializeEvent(event));
      }
    } catch (err) {
      emit({ type: 'error', error: err instanceof Error ? err.message : String(err), ts: Date.now() });
    } finally {
      abortController = null;
    }
  };

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const cmd = JSON.parse(trimmed) as Command;
      handleCommand(cmd);
    } catch {
      // Ignore malformed lines.
    }
  });

  // Resolve when stdin closes — the UI exited.
  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      abortController?.abort();
      resolve();
    });
  });
}

/** Strip non-serializable fields (functions) from an AgentEvent. */
function serializeEvent(event: AgentEvent): Record<string, unknown> {
  // The brain's events are plain data except approval.needed (handled above),
  // so a shallow JSON round-trip is safe and drops any stray functions.
  return JSON.parse(JSON.stringify(event));
}
