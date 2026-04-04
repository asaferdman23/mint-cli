/**
 * CLI wrapper for the v2 orchestrator.
 * Shows real-time progress as the orchestrator works.
 */
import chalk from 'chalk';
import { runOrchestrator } from '../../orchestrator/loop.js';

export async function runOrchestratorCLI(task: string): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.dim(`\n  Task: ${task}\n`));

  try {
  const result = await runOrchestrator(task, cwd, {
    onLog: (msg) => {
      process.stdout.write(chalk.dim(`  ${msg}\n`));
    },
    onText: (text) => {
      process.stdout.write(text);
    },
    onToolCall: (name, input) => {
      const preview = name === 'write_code'
        ? `task: "${String(input.task ?? '').slice(0, 60)}..."`
        : name === 'read_file'
          ? String(input.path ?? '')
          : name === 'search_files'
            ? String(input.query ?? '')
            : name === 'run_command'
              ? String(input.command ?? '').slice(0, 60)
              : name === 'apply_diff'
                ? '(applying...)'
                : JSON.stringify(input).slice(0, 60);
      console.log(chalk.cyan(`  > ${name}`) + chalk.dim(` ${preview}`));
    },
    onToolResult: (name, result) => {
      if (name === 'search_files' || name === 'list_files') {
        console.log(chalk.dim(`    ${result.split('\n').length} results`));
      } else if (name === 'apply_diff') {
        console.log(chalk.green(`    ${result.slice(0, 100)}`));
      }
    },
  });

  // Summary
  const duration = (result.duration / 1000).toFixed(1);
  const opusCost = result.totalCost * 50; // rough Opus equivalent
  console.log('');
  console.log(chalk.dim(`  ${result.iterations} steps · ${duration}s · $${result.totalCost.toFixed(4)} (orchestrator: $${result.orchestratorCost.toFixed(4)} + code: $${result.writeCodeCost.toFixed(4)})`));
  if (opusCost > result.totalCost * 2) {
    console.log(chalk.dim(`  Opus equivalent: $${opusCost.toFixed(2)} — saved ${Math.round((1 - result.totalCost / opusCost) * 100)}%`));
  }
  console.log('');
  } catch (err) {
    console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
    if (err instanceof Error && err.stack) {
      console.error(chalk.dim(err.stack.split('\n').slice(1, 5).join('\n')));
    }
  }
}
