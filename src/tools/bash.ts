import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\/(?!\S)/,    // rm -rf /
  /\bsudo\b/,                   // sudo anything
  /\bmkfs\b/,                   // format filesystem
  /\bdd\s+if=/,                 // raw disk write
  />\s*\/dev\/sd/,              // write to block device
];

const MAX_OUTPUT = 64 * 1024; // 64KB
const DEFAULT_TIMEOUT = 30_000; // 30s

const parameters = z.object({
  command: z.string().describe('Shell command to run'),
  timeout: z.number().optional().describe('Timeout in ms (default 30000)'),
});

export const bashTool: Tool = {
  name: 'bash',
  description: 'Execute a shell command. Returns stdout, stderr, exit code. 30s timeout, 64KB output cap.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    const { command, timeout = DEFAULT_TIMEOUT } = params;

    // Block dangerous commands
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return { success: false, output: '', error: `Blocked dangerous command: ${command}` };
      }
    }

    const result = spawnSync('sh', ['-c', command], {
      cwd: ctx.cwd,
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_OUTPUT,
    });

    if (result.error) {
      const msg = result.error.message ?? 'Unknown error';
      if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
        return { success: false, output: '', error: `Command timed out after ${timeout}ms` };
      }
      return { success: false, output: '', error: msg };
    }

    const stdout = (result.stdout ?? '').slice(0, MAX_OUTPUT);
    const stderr = (result.stderr ?? '').slice(0, 4000);
    const exitCode = result.status ?? 0;

    let output = '';
    if (stdout) output += stdout;
    if (stderr) output += (output ? '\n[stderr] ' : '[stderr] ') + stderr;
    if (!output) output = `[exit ${exitCode}]`;
    else if (exitCode !== 0) output += `\n[exit ${exitCode}]`;

    return { success: exitCode === 0, output };
  },
};
