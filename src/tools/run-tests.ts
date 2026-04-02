import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const DEFAULT_TIMEOUT = 60_000;
const MAX_OUTPUT = 128 * 1024;
const MAX_LINES = 50;
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\/(?!\S)/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/sd/,
];

const parameters = z.object({
  command: z.string().optional().describe('Optional test command override'),
  timeout: z.number().optional().describe('Timeout in ms (default 60000)'),
});

export const runTestsTool: Tool = {
  name: 'run_tests',
  description: 'Run the project test suite or a specific test command. Returns pass/fail counts and the last 50 lines of output.',
  parameters,

  async execute(params: z.infer<typeof parameters>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const command = params.command?.trim() || detectTestCommand(ctx.cwd);
      const timeout = params.timeout ?? DEFAULT_TIMEOUT;

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
          return { success: false, output: '', error: `Test command timed out after ${timeout}ms` };
        }
        return { success: false, output: '', error: msg };
      }

      const combinedOutput = [result.stdout ?? '', result.stderr ?? '']
        .filter(Boolean)
        .join('\n')
        .trim();
      const summary = summarizeTestOutput(combinedOutput);
      const tail = lastLines(combinedOutput, MAX_LINES);
      const passed = summary.passed ?? 0;
      const failed = summary.failed ?? 0;
      const status = (result.status ?? 0) === 0 ? 'PASS' : 'FAIL';

      return {
        success: (result.status ?? 0) === 0,
        output: [
          `Status: ${status}`,
          `Command: ${command}`,
          `Passed: ${passed}`,
          `Failed: ${failed}`,
          '',
          'Last 50 lines:',
          tail || '(no output)',
        ].join('\n'),
      };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

function detectTestCommand(cwd: string): string {
  const packageJsonPath = join(cwd, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      if (packageJson.scripts?.test) {
        return 'npm test';
      }
    } catch {
      // Ignore invalid package.json and continue probing other runners.
    }
  }

  if (existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'pyproject.toml'))) {
    return 'pytest';
  }

  if (existsSync(join(cwd, 'go.mod'))) {
    return 'go test ./...';
  }

  if (existsSync(join(cwd, 'Cargo.toml'))) {
    return 'cargo test';
  }

  throw new Error('Could not detect a test runner. Pass an explicit command.');
}

function summarizeTestOutput(output: string): { passed?: number; failed?: number } {
  const lines = output.split(/\r?\n/);

  for (const line of [...lines].reverse()) {
    const testsLine = line.match(/Tests?:\s*(.*)/i);
    if (testsLine) {
      return {
        passed: pickCount(testsLine[1], /(\d+)\s+passed/i),
        failed: pickCount(testsLine[1], /(\d+)\s+failed/i),
      };
    }

    const cargoLine = line.match(/test result:\s+\w+\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;/i);
    if (cargoLine) {
      return {
        passed: Number(cargoLine[1]),
        failed: Number(cargoLine[2]),
      };
    }

    const pytestLine = line.match(/=+\s*(.*?)\s+in\s+[0-9.]+s\s*=+/i);
    if (pytestLine) {
      return {
        passed: pickCount(pytestLine[1], /(\d+)\s+passed/i),
        failed: pickCount(pytestLine[1], /(\d+)\s+failed/i),
      };
    }
  }

  const goPassed = lines.filter((line) => line.startsWith('--- PASS:')).length;
  const goFailed = lines.filter((line) => line.startsWith('--- FAIL:')).length;
  if (goPassed > 0 || goFailed > 0) {
    return { passed: goPassed, failed: goFailed };
  }

  return {
    passed: lastNumericMatch(output, /(\d+)\s+passed/gi),
    failed: lastNumericMatch(output, /(\d+)\s+failed/gi),
  };
}

function lastNumericMatch(text: string, pattern: RegExp): number | undefined {
  let match: RegExpExecArray | null;
  let value: number | undefined;

  while ((match = pattern.exec(text)) !== null) {
    value = Number(match[1]);
  }

  return value;
}

function pickCount(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  return match ? Number(match[1]) : undefined;
}

function lastLines(text: string, count: number): string {
  return text
    .split(/\r?\n/)
    .slice(-count)
    .join('\n')
    .trim();
}
