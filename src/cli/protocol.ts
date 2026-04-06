/**
 * Stdin/stdout pipe protocol for agent integration.
 *
 * Reads JSON from stdin, executes task, outputs JSON to stdout.
 * Usage: echo '{"task": "fix auth bug", "apply": true}' | mint exec --pipe
 */
import { runExec, type ExecOptions } from './exec.js';

export interface PipeInput {
  task: string;
  apply?: boolean;
  think?: boolean;
  fast?: boolean;
  workdir?: string;
}

export async function runPipeMode(): Promise<void> {
  const input = await readStdin();

  let parsed: PipeInput;
  try {
    parsed = JSON.parse(input);
  } catch {
    const result = { success: false, error: 'Invalid JSON input. Expected: {"task": "..."}' };
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(1);
    return;
  }

  if (!parsed.task) {
    const result = { success: false, error: 'Missing "task" field in input JSON' };
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(1);
    return;
  }

  const options: ExecOptions = {
    task: parsed.task,
    apply: parsed.apply,
    think: parsed.think,
    fast: parsed.fast,
    workdir: parsed.workdir,
  };

  const result = await runExec(options);
  process.stdout.write(JSON.stringify(result) + '\n');

  // Exit codes: 0 = success, 1 = error, 2 = model asked a question
  if (!result.success) {
    process.exit(1);
  } else if (!result.diffs?.length && result.message) {
    process.exit(2);
  } else {
    process.exit(0);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve('');
      }
    }, 5000);

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(data.trim());
      }
    });
  });
}
