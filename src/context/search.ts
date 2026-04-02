/**
 * File relevance search — finds the most relevant files for a given task.
 *
 * Uses the project index (from indexer.ts) + dependency graph to:
 * 1. Extract keywords from the task
 * 2. Score files by keyword match against paths, exports, summaries
 * 3. Expand top hits via the dependency graph (1 level)
 * 4. Return ranked files with content
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectIndex } from './indexer.js';
import { DependencyGraph } from './graph.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  path: string;
  content: string;
  language: string;
  score: number;
  reason: string;  // why this file was included
}

export interface SearchOptions {
  /** Maximum files to return (default: 8) */
  maxFiles?: number;
  /** Depth to expand via dependency graph (default: 1) */
  graphDepth?: number;
  /** Extra file paths to always include */
  alwaysInclude?: string[];
}

// ─── Stop words ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  'them', 'what', 'which', 'who', 'whom', 'make', 'like', 'use', 'get',
  'new', 'file', 'code', 'change', 'update', 'need', 'want', 'please',
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Search the project index for files relevant to a task description.
 */
export async function searchRelevantFiles(
  cwd: string,
  task: string,
  index: ProjectIndex,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { maxFiles = 8, graphDepth = 1, alwaysInclude = [] } = options;

  const keywords = extractKeywords(task);
  if (keywords.length === 0) return [];

  // Score every indexed file
  const scored: Array<{ path: string; score: number; reasons: string[] }> = [];

  for (const [filePath, fileInfo] of Object.entries(index.files)) {
    const { score, reasons } = scoreFile(filePath, fileInfo, keywords);
    if (score > 0) {
      scored.push({ path: filePath, score, reasons });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Take top candidates (before graph expansion)
  const topPaths = scored.slice(0, Math.max(4, maxFiles)).map(s => s.path);

  // Expand via dependency graph
  const graph = DependencyGraph.fromJSON(index.graph);
  const expanded = graph.expand(topPaths, graphDepth);

  // Merge: scored files + graph-expanded files + always-include
  const allPaths = new Set<string>([...topPaths, ...alwaysInclude]);
  for (const p of expanded) {
    if (allPaths.size >= maxFiles * 2) break; // cap expansion
    allPaths.add(p);
  }

  // Build final scored list
  const scoreMap = new Map(scored.map(s => [s.path, s]));
  const finalScored: Array<{ path: string; score: number; reason: string }> = [];

  for (const p of allPaths) {
    const entry = scoreMap.get(p);
    if (entry) {
      finalScored.push({ path: p, score: entry.score, reason: entry.reasons.join(', ') });
    } else if (alwaysInclude.includes(p)) {
      finalScored.push({ path: p, score: 100, reason: 'always-include' });
    } else {
      // Graph-expanded file
      finalScored.push({ path: p, score: 0.5, reason: 'dependency of matched file' });
    }
  }

  // Sort and take top N
  finalScored.sort((a, b) => b.score - a.score);
  const topN = finalScored.slice(0, maxFiles);

  // Read file contents
  const results: SearchResult[] = [];
  for (const { path, score, reason } of topN) {
    try {
      const content = await readFile(join(cwd, path), 'utf-8');
      const language = index.files[path]?.language ?? 'text';
      results.push({ path, content, language, score, reason });
    } catch {
      // File may have been deleted since indexing
    }
  }

  return results;
}

/**
 * Lightweight search without a full index — falls back to keyword grep
 * on file paths and content. Used when no index exists.
 */
export function extractKeywords(task: string): string[] {
  return task
    .toLowerCase()
    .replace(/[^a-z0-9_\-\.\/]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    // Deduplicate
    .filter((w, i, arr) => arr.indexOf(w) === i);
}

// ─── Scoring ────────────────────────────────────────────────────────────────

interface FileInfo {
  imports: string[];
  exports: string[];
  summary: string;
  loc: number;
  language: string;
}

function scoreFile(
  filePath: string,
  fileInfo: FileInfo,
  keywords: string[],
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const pathLower = filePath.toLowerCase();

  for (const kw of keywords) {
    // Path match (highest signal — user mentioned a specific file/dir)
    if (pathLower.includes(kw)) {
      score += 3;
      reasons.push(`path contains "${kw}"`);
    }

    // Export name match (strong signal — user mentioned a function/class)
    const exportMatch = fileInfo.exports.some(e => e.toLowerCase().includes(kw));
    if (exportMatch) {
      score += 2;
      reasons.push(`exports match "${kw}"`);
    }

    // Summary match
    if (fileInfo.summary.toLowerCase().includes(kw)) {
      score += 1;
      reasons.push(`summary contains "${kw}"`);
    }
  }

  // Boost entry points and central files
  if (filePath.endsWith('index.ts') || filePath.endsWith('index.js')) {
    score *= 1.1;
  }

  // Slight boost for smaller files (more focused)
  if (fileInfo.loc < 100) {
    score *= 1.05;
  }

  return { score, reasons: [...new Set(reasons)] };
}
