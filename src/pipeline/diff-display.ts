/**
 * Colored diff display for the terminal.
 */
import chalk from 'chalk';
import type { ParsedDiff } from './types.js';

/**
 * Render a list of diffs as a colored string for terminal output.
 */
export function formatDiffs(diffs: ParsedDiff[]): string {
  if (diffs.length === 0) return '';

  const parts: string[] = [];

  for (const diff of diffs) {
    parts.push('');
    parts.push(chalk.bold.white(`  ${diff.filePath}`));
    parts.push(chalk.dim('  ' + '─'.repeat(Math.min(60, diff.filePath.length + 4))));

    for (const hunk of diff.hunks) {
      parts.push(chalk.cyan(`  ${hunk.header}`));
      for (const line of hunk.lines) {
        switch (line.type) {
          case 'add':
            parts.push(chalk.green(`  + ${line.content}`));
            break;
          case 'remove':
            parts.push(chalk.red(`  - ${line.content}`));
            break;
          case 'context':
            parts.push(chalk.dim(`    ${line.content}`));
            break;
        }
      }
    }
  }

  parts.push('');
  return parts.join('\n');
}

/**
 * Render a raw unified diff text block with colors.
 */
export function formatRawUnifiedDiff(diffText: string): string {
  return diffText
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++ ') || line.startsWith('--- ')) {
        return chalk.bold.cyan(line);
      }
      if (line.startsWith('@@')) {
        return chalk.cyan(line);
      }
      if (line.startsWith('+')) {
        return chalk.green(line);
      }
      if (line.startsWith('-')) {
        return chalk.red(line);
      }
      if (line.startsWith('diff --git') || line.startsWith('index ')) {
        return chalk.dim(line);
      }
      return chalk.dim(line);
    })
    .join('\n');
}

/**
 * Render a cost summary line.
 */
export function formatCostSummary(
  cost: number,
  opusCost: number,
  duration: number,
  filesModified: string[],
): string {
  const parts: string[] = [];

  const durationStr = duration < 1000
    ? `${duration}ms`
    : `${(duration / 1000).toFixed(1)}s`;

  parts.push(chalk.green(`  Done in ${durationStr}`));

  if (filesModified.length > 0) {
    parts.push(chalk.dim(`  Modified: ${filesModified.join(', ')}`));
  }

  const formatCost = (c: number): string => {
    if (c < 0.0001) return `${(c * 100).toFixed(4)}¢`;
    if (c < 0.10) return `${(c * 100).toFixed(2)}¢`;
    return `$${c.toFixed(3)}`;
  };

  const costStr = formatCost(cost);
  const opusCostStr = formatCost(opusCost);

  const savedPct = opusCost > 0
    ? Math.round((1 - cost / opusCost) * 100)
    : 0;

  parts.push(
    chalk.dim(`  Cost: `) + chalk.yellow(costStr) +
    (savedPct > 0
      ? chalk.dim(` (Opus: ${opusCostStr} — saved ${chalk.green(`${savedPct}%`)})`)
      : '')
  );

  return parts.join('\n');
}
