/**
 * Parse unified diffs from LLM response text.
 * Ported from the legacy pipeline's diff-parser; used by write-code.
 */

export interface ParsedDiff {
  filePath: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

/** Extract all unified diffs from a model response string. */
export function parseDiffs(response: string): ParsedDiff[] {
  const diffs: ParsedDiff[] = [];
  const fencedRe = /```diff\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fencedRe.exec(response)) !== null) {
    const block = match[1].trim();
    const parsed = parseUnifiedDiff(block);
    if (parsed) diffs.push(parsed);
  }

  if (diffs.length === 0) {
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

function parseUnifiedDiff(block: string): ParsedDiff | null {
  const lines = block.split('\n');
  let filePath = '';
  let oldContent = '';
  let newContent = '';
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      const path = line.slice(4).replace(/^a\//, '').trim();
      if (path !== '/dev/null') filePath = path;
    } else if (line.startsWith('+++ ')) {
      filePath = line.slice(4).replace(/^b\//, '').trim();
    } else if (line.startsWith('@@')) {
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

/** Check if a response contains any diff blocks. */
export function hasDiffs(response: string): boolean {
  return /```diff\s*\n/.test(response);
}
