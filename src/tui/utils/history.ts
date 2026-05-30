// src/tui/utils/history.ts
// Persistent input history for the TUI prompt (Batch D).
// Stored as newline-delimited entries at ~/.mint/history. Capped at 500 lines;
// oldest entries evict on overflow. All file IO is async and best-effort —
// callers never await persistence on the render path, and any IO failure
// degrades silently (loadHistory returns [], appendHistory swallows).
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const HISTORY_CAP = 500;
export const HISTORY_PATH = path.join(os.homedir(), '.mint', 'history');

/** Load history from disk. Returns [] on missing dir/file/corrupt content. */
export async function loadHistory(filePath: string = HISTORY_PATH): Promise<string[]> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    // Tolerate corruption: only keep printable, non-empty lines.
    const lines = raw.split('\n').filter((l) => l.length > 0 && !/[\x00-\x08\x0e-\x1f]/.test(l));
    if (lines.length <= HISTORY_CAP) return lines;
    return lines.slice(lines.length - HISTORY_CAP);
  } catch {
    return [];
  }
}

/**
 * Append a single line to history, enforcing the cap. Skips empty strings
 * and exact duplicates of the most recent entry. Best-effort: errors are
 * swallowed (e.g. read-only home dir, missing permissions).
 */
export async function appendHistory(
  line: string,
  filePath: string = HISTORY_PATH,
): Promise<void> {
  const trimmed = line.replace(/\r?\n/g, ' ').trim();
  if (!trimmed) return;
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const existing = await loadHistory(filePath);
    if (existing.length > 0 && existing[existing.length - 1] === trimmed) return;
    const next = [...existing, trimmed];
    const capped = next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
    await fs.promises.writeFile(filePath, capped.join('\n') + '\n', 'utf8');
  } catch {
    /* best-effort */
  }
}
