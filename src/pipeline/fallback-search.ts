/**
 * Fallback file search — works without a project index.
 * Uses keyword matching on file paths + quick content scan.
 */
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { glob } from 'glob';
import ignore from 'ignore';
import type { SearchResult } from '../context/search.js';
import { extractKeywords } from '../context/search.js';

const SOURCE_PATTERNS = '**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,md,json}';
const MAX_FILES_TO_SCAN = 100;
const MAX_RESULTS = 8;

export async function gatherRelevantFilesFallback(
  cwd: string,
  task: string,
): Promise<SearchResult[]> {
  const keywords = extractKeywords(task);
  if (keywords.length === 0) return [];

  // Load gitignore
  const ig = ignore();
  ig.add(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.mint', '.claude']);
  try {
    const content = await readFile(join(cwd, '.gitignore'), 'utf-8');
    ig.add(content.split('\n').filter(l => l.trim() && !l.startsWith('#')));
  } catch { /* no .gitignore */ }

  // Find source files
  const allFiles = await glob(SOURCE_PATTERNS, { cwd, nodir: true, absolute: false });
  const validFiles = allFiles
    .filter(f => !ig.ignores(f))
    .slice(0, MAX_FILES_TO_SCAN);

  // Score by keyword overlap
  const scored: Array<{ path: string; score: number; content: string; language: string }> = [];

  for (const filePath of validFiles) {
    try {
      const content = await readFile(join(cwd, filePath), 'utf-8');
      const lower = (filePath + ' ' + content).toLowerCase();
      let score = 0;
      const reasons: string[] = [];

      for (const kw of keywords) {
        if (filePath.toLowerCase().includes(kw)) {
          score += 3;
          reasons.push(`path: ${kw}`);
        }
        if (lower.includes(kw)) {
          score += 1;
        }
      }

      if (score > 0) {
        const ext = extname(filePath).slice(1);
        const langMap: Record<string, string> = {
          ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
          py: 'python', go: 'go', rs: 'rust', java: 'java', rb: 'ruby',
          md: 'markdown', json: 'json',
        };
        scored.push({
          path: filePath,
          score,
          content,
          language: langMap[ext] ?? 'text',
        });
      }
    } catch { /* skip */ }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_RESULTS).map(s => ({
    path: s.path,
    content: s.content,
    language: s.language,
    score: s.score,
    reason: 'keyword match (fallback)',
  }));
}
