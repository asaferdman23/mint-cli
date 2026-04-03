/**
 * Apply parsed diffs to the filesystem.
 *
 * Shared by both the CLI (non-TUI) and the TUI apply flow.
 * Returns per-file results so the caller can render success/failure.
 */
import { resolve, sep, dirname } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ParsedDiff } from './types.js';

export interface ApplyResult {
  file: string;
  ok: boolean;
  action: 'created' | 'modified' | 'skipped' | 'blocked';
  error?: string;
}

export function applyDiffsToProject(diffs: ParsedDiff[], cwd: string): ApplyResult[] {
  const cwdAbs = resolve(cwd);
  const results: ApplyResult[] = [];

  for (const diff of diffs) {
    const fullPath = resolve(cwdAbs, diff.filePath);
    if (!fullPath.startsWith(cwdAbs + sep) && fullPath !== cwdAbs) {
      results.push({ file: diff.filePath, ok: false, action: 'blocked', error: 'Path outside project' });
      continue;
    }

    try {
      // New file (old was /dev/null or empty)
      if (diff.oldContent === '') {
        mkdirSync(dirname(fullPath), { recursive: true });
        const newContent = diff.hunks
          .flatMap((h) => h.lines.filter((l) => l.type !== 'remove').map((l) => l.content))
          .join('\n');
        writeFileSync(fullPath, newContent + '\n', 'utf-8');
        results.push({ file: diff.filePath, ok: true, action: 'created' });
        continue;
      }

      // Edit existing file — apply hunks
      const current = readFileSync(fullPath, 'utf-8');
      let updated = current;

      for (const hunk of diff.hunks) {
        const removeLines = hunk.lines.filter((l) => l.type === 'remove').map((l) => l.content);
        const addLines = hunk.lines.filter((l) => l.type === 'add').map((l) => l.content);

        if (removeLines.length > 0) {
          const oldBlock = removeLines.join('\n');
          const newBlock = addLines.join('\n');
          if (updated.includes(oldBlock)) {
            updated = updated.replace(oldBlock, newBlock);
          } else {
            // Fallback: try line-by-line (handles minor whitespace diffs)
            let fallbackUpdated = updated;
            let allFound = true;
            for (let i = 0; i < removeLines.length; i++) {
              const removeLine = removeLines[i];
              const addLine = addLines[i] ?? '';
              if (fallbackUpdated.includes(removeLine)) {
                fallbackUpdated = fallbackUpdated.replace(removeLine, addLine);
              } else {
                allFound = false;
                break;
              }
            }
            if (allFound && fallbackUpdated !== updated) {
              updated = fallbackUpdated;
            }
          }
        }
      }

      if (updated !== current) {
        writeFileSync(fullPath, updated, 'utf-8');
        results.push({ file: diff.filePath, ok: true, action: 'modified' });
      } else {
        results.push({ file: diff.filePath, ok: false, action: 'skipped', error: 'Could not match diff text' });
      }
    } catch (err) {
      results.push({
        file: diff.filePath,
        ok: false,
        action: 'skipped',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
