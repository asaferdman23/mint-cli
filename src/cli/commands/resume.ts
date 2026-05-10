/**
 * `mint resume <sessionId>` — open a fresh TUI seeded with the original task
 * and a brief summary of what the previous session did.
 *
 * This is a pragmatic v1: we don't reconstruct the full message history (that
 * would require replaying tool results inline). Instead we reload the trace,
 * surface the original task and final outcome to the user, and let them
 * continue the conversation. Future work: full message-state restore.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import type { AgentEvent } from '../../brain/index.js';

interface ResumeData {
  sessionId: string;
  task: string;
  mode: 'plan' | 'diff' | 'auto' | 'yolo';
  finalOutput: string;
  filesTouched: string[];
}

function traceDir(): string {
  return join(homedir(), '.mint', 'traces');
}

function findSession(prefix: string): string | null {
  const dir = traceDir();
  if (!existsSync(dir)) return null;
  const match = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith('.jsonl'));
  return match ? join(dir, match) : null;
}

function loadResumeData(path: string): ResumeData | null {
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return null;
  }

  let sessionId = '';
  let task = '';
  let mode: ResumeData['mode'] = 'diff';
  let finalOutput = '';
  let filesTouched: string[] = [];

  for (const line of lines) {
    let event: AgentEvent;
    try {
      event = JSON.parse(line) as AgentEvent;
    } catch {
      continue;
    }
    if (event.type === 'session.start') {
      sessionId = event.sessionId;
      task = event.task;
      mode = event.mode;
    } else if (event.type === 'done') {
      finalOutput = event.result.output;
      filesTouched = event.result.filesTouched;
    }
  }

  if (!task) return null;
  return { sessionId, task, mode, finalOutput, filesTouched };
}

export async function runResume(sessionIdPrefix: string): Promise<void> {
  const path = findSession(sessionIdPrefix);
  if (!path) {
    console.error(chalk.red(`  No trace found for '${sessionIdPrefix}'`));
    console.error(chalk.dim(`  Try: mint trace`));
    process.exit(1);
  }

  const data = loadResumeData(path);
  if (!data) {
    console.error(chalk.red(`  Trace exists but has no session.start event — can't resume.`));
    process.exit(1);
  }

  // Print the session preamble before opening the TUI so the user has context.
  console.log('');
  console.log(chalk.cyan(`  Resuming session ${chalk.bold(data.sessionId)}`));
  console.log(chalk.dim(`  Original task: `) + data.task);
  if (data.filesTouched.length > 0) {
    console.log(
      chalk.dim(`  Files touched: ${data.filesTouched.slice(0, 5).join(', ')}${
        data.filesTouched.length > 5 ? `, +${data.filesTouched.length - 5} more` : ''
      }`),
    );
  }
  if (data.finalOutput) {
    const preview = data.finalOutput.length > 200
      ? `${data.finalOutput.slice(0, 200)}…`
      : data.finalOutput;
    console.log(chalk.dim(`  Last output:   `) + preview.replace(/\n/g, ' '));
  }
  console.log('');

  // Open the TUI. Seed the input box with a prompt so the user can edit
  // before sending — we don't auto-resubmit because that would re-spend.
  const { render } = await import('ink');
  const React = await import('react');
  const { BrainApp } = await import('../../tui/BrainApp.js');
  const seedPrompt = `Continuing previous session.\nOriginal task: ${data.task}\n\n`;

  const app = render(
    React.default.createElement(BrainApp, {
      modelPreference: 'auto',
      agentMode: data.mode,
      // We pass it as initialPrompt only as a textual seed comment in messages —
      // BrainApp's auto-submit behaviour treats this as a real task. To avoid
      // re-spending, we instead leave it empty and let the user type.
      initialPrompt: undefined,
    }),
  );
  // Print the seed prompt to stderr so the user sees it as a hint.
  process.stderr.write(chalk.dim(`Hint: ${seedPrompt.split('\n')[0]}\n`));
  await app.waitUntilExit();
}
