/**
 * Minimal context extractor — reads only the relevant parts of a file.
 *
 * Instead of sending entire files to the LLM, this module extracts:
 * - Import section
 * - Matched function/class/type bodies (with context lines)
 * - Referenced type definitions
 * Everything else is replaced with "// ... (X lines omitted)"
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SymbolInfo } from './indexer.js';
import { estimateTokens } from './budget.js';

export interface ExtractedContext {
  path: string;
  content: string;
  originalLines: number;
  extractedLines: number;
  tokenEstimate: number;
}

/**
 * Extract minimal context from a file, focusing on symbols relevant to the task.
 */
export async function extractMinimalContext(
  cwd: string,
  filePath: string,
  matchedSymbols: string[],
  allSymbols: SymbolInfo[],
): Promise<ExtractedContext> {
  const fullContent = await readFile(join(cwd, filePath), 'utf-8');
  const lines = fullContent.split('\n');
  const totalLines = lines.length;

  // Small files: include entirely
  if (totalLines <= 50) {
    return {
      path: filePath,
      content: `// ${filePath} (${totalLines} lines)\n\n${fullContent}`,
      originalLines: totalLines,
      extractedLines: totalLines,
      tokenEstimate: estimateTokens(fullContent),
    };
  }

  // Build a set of line ranges to include
  const CONTEXT_LINES = 3;
  const includeRanges: Array<{ start: number; end: number; reason: string }> = [];

  // Always include imports (from start until first non-import line)
  let importEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('import') || (trimmed.startsWith('export') && trimmed.includes('from'))) {
      importEnd = i;
    } else if (importEnd > 0) {
      break;
    }
  }
  if (importEnd > 0) {
    includeRanges.push({ start: 0, end: importEnd, reason: 'imports' });
  }

  // Include matched symbols with their full bodies
  const matchedLower = matchedSymbols.map(s => s.toLowerCase());
  for (const sym of allSymbols) {
    const nameMatch = matchedLower.some(m =>
      sym.name.toLowerCase().includes(m) || m.includes(sym.name.toLowerCase())
    );
    if (nameMatch) {
      const start = Math.max(0, sym.startLine - 1 - CONTEXT_LINES);
      const end = Math.min(totalLines - 1, sym.endLine - 1 + CONTEXT_LINES);
      includeRanges.push({ start, end, reason: `matched: ${sym.name}` });
    }
  }

  // If no symbols matched, include first 30 lines as fallback
  if (includeRanges.length <= 1) {
    includeRanges.push({ start: 0, end: Math.min(30, totalLines - 1), reason: 'fallback top' });
  }

  // Merge overlapping ranges
  const merged = mergeRanges(includeRanges);

  // Build extracted content
  const parts: string[] = [`// ${filePath} (${totalLines} lines, showing relevant sections)`];
  let extractedLineCount = 0;
  let lastEnd = -1;

  for (const range of merged) {
    if (range.start > lastEnd + 1) {
      const omitted = range.start - (lastEnd + 1);
      if (omitted > 0) {
        parts.push(`\n// ... (${omitted} lines omitted)\n`);
      }
    }

    for (let i = range.start; i <= range.end && i < totalLines; i++) {
      parts.push(lines[i]);
      extractedLineCount++;
    }
    lastEnd = range.end;
  }

  // Show omitted lines at end
  if (lastEnd < totalLines - 1) {
    const omitted = totalLines - 1 - lastEnd;
    parts.push(`\n// ... (${omitted} lines omitted)`);
  }

  const content = parts.join('\n');
  return {
    path: filePath,
    content,
    originalLines: totalLines,
    extractedLines: extractedLineCount,
    tokenEstimate: estimateTokens(content),
  };
}

function mergeRanges(
  ranges: Array<{ start: number; end: number; reason: string }>,
): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [{ start: sorted[0].start, end: sorted[0].end }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end + 1) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ start: sorted[i].start, end: sorted[i].end });
    }
  }

  return merged;
}
