/**
 * Parse unified diffs from LLM response text.
 *
 * LLMs typically output diffs inside ```diff fenced blocks.
 * This parser extracts them and structures them for display/apply.
 */
import type { ParsedDiff, DiffHunk, DiffLine } from './types.js';

/**
 * Extract all unified diffs from a model response string.
 */
export function parseDiffs(response: string): ParsedDiff[] {
  const diffs: ParsedDiff[] = [];

  // Match ```diff ... ``` blocks
  const fencedRe = /```diff\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fencedRe.exec(response)) !== null) {
    const block = match[1].trim();
    const parsed = parseUnifiedDiff(block);
    if (parsed) {
      diffs.push(parsed);
    }
  }

  // Fallback: if no fenced blocks found, try to parse unfenced diffs (--- a/... lines)
  if (diffs.length === 0) {
    const unfencedRe = /^--- a\/[\s\S]*?(?=^--- a\/|\Z)/gm;
    const blocks = response.match(/--- a\/[^\n]*\n\+\+\+ b\/[^\n]*\n@@[\s\S]*?(?=\n--- a\/|\n*$)/g);
    if (blocks) {
      for (const block of blocks) {
        const parsed = parseUnifiedDiff(block.trim());
        if (parsed) diffs.push(parsed);
      }
    }
  }

  return diffs;
}

/**
 * Parse a single unified diff block into structured data.
 */
function parseUnifiedDiff(block: string): ParsedDiff | null {
  const lines = block.split('\n');

  // Extract file path from --- a/path and +++ b/path headers
  let filePath = '';
  let oldContent = '';
  let newContent = '';
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      // Old file path: --- a/path/to/file or --- /dev/null
      const path = line.slice(4).replace(/^a\//, '').trim();
      if (path !== '/dev/null') {
        filePath = path;
      }
    } else if (line.startsWith('+++ ')) {
      // New file path: +++ b/path/to/file
      const path = line.slice(4).replace(/^b\//, '').trim();
      filePath = path;
    } else if (line.startsWith('@@')) {
      // Hunk header: @@ -start,count +start,count @@
      currentHunk = { header: line, lines: [] };
      hunks.push(currentHunk);
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', content: line.slice(1) });
        newContent += line.slice(1) + '\n';
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'remove', content: line.slice(1) });
        oldContent += line.slice(1) + '\n';
      } else {
        // Context line (starts with space or is empty)
        const content = line.startsWith(' ') ? line.slice(1) : line;
        currentHunk.lines.push({ type: 'context', content });
        oldContent += content + '\n';
        newContent += content + '\n';
      }
    }
  }

  if (!filePath || hunks.length === 0) return null;

  return { filePath, oldContent, newContent, hunks };
}

/**
 * Check if a response contains any diff blocks.
 */
export function hasDiffs(response: string): boolean {
  return /```diff\s*\n/.test(response);
}
