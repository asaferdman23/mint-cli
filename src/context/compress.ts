// src/context/compress.ts
import type { ContextTier } from '../providers/tiers.js';
import { truncateToTokens, estimateTokens } from './budget.js';

export interface FileEntry {
  path: string;
  content: string;
  language?: string;
}

export interface CompressedContext {
  files: FileEntry[];
  tokenEstimate: number;
  compressionApplied: string[];   // human-readable log of what was compressed
}

/**
 * Apply tier-appropriate compression to a set of files.
 * APEX: no changes. SMART: truncate large outputs. FAST: heavy. ULTRA: skeleton only.
 */
export function compressContext(files: FileEntry[], tier: ContextTier): CompressedContext {
  const log: string[] = [];

  switch (tier) {
    case 'apex':
      return { files, tokenEstimate: sumTokens(files), compressionApplied: ['none'] };

    case 'smart': {
      const compressed = files.map(f => {
        if (estimateTokens(f.content) > 2000) {
          log.push(`truncated ${f.path} (>${2000} tokens)`);
          return { ...f, content: truncateToTokens(f.content, 2000) };
        }
        return f;
      });
      return { files: compressed, tokenEstimate: sumTokens(compressed), compressionApplied: log.length ? log : ['none'] };
    }

    case 'fast': {
      const compressed = files.map(f => {
        // Strip single-line comments from code
        let content = stripComments(f.content, f.language ?? '');
        // Truncate each file to 500 tokens
        if (estimateTokens(content) > 500) {
          log.push(`truncated ${f.path} to 500 tokens`);
          content = truncateToTokens(content, 500);
        }
        return { ...f, content };
      });
      log.push('stripped comments');
      return { files: compressed, tokenEstimate: sumTokens(compressed), compressionApplied: log };
    }

    case 'ultra': {
      // Skeleton only: extract function/class signatures, no bodies
      const compressed = files.map(f => ({
        ...f,
        content: extractSkeleton(f.content, f.language ?? ''),
      }));
      log.push('skeleton-only (signatures extracted)', 'bodies removed');
      return { files: compressed, tokenEstimate: sumTokens(compressed), compressionApplied: log };
    }
  }
}

/**
 * Compress tool output (bash results, file reads) per tier.
 * Used in agent loop to trim tool results before re-injecting into context.
 */
export function compressToolOutput(output: string, tier: ContextTier): string {
  const limits: Record<ContextTier, number> = {
    apex:  100_000,
    smart:  2_000,
    fast:     500,
    ultra:    200,
  };
  return truncateToTokens(output, limits[tier]);
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function sumTokens(files: FileEntry[]): number {
  return files.reduce((sum, f) => sum + estimateTokens(f.content), 0);
}

function stripComments(code: string, language: string): string {
  const lineComment = /\/\/.*/g;
  const blockComment = /\/\*[\s\S]*?\*\//g;
  const hashComment = /#.*/g;

  if (['typescript', 'javascript', 'go', 'java', 'rust', 'csharp', 'cpp', 'c'].includes(language)) {
    return code.replace(blockComment, '').replace(lineComment, '');
  }
  if (['python', 'ruby', 'bash', 'yaml'].includes(language)) {
    return code.replace(hashComment, '');
  }
  return code;
}

/**
 * Extract function/class/type signatures without bodies.
 * Handles TypeScript/JavaScript. Falls back to first-line-of-each-block heuristic.
 */
function extractSkeleton(code: string, language: string): string {
  if (!['typescript', 'javascript'].includes(language)) {
    // Generic: return first 10 lines only
    return code.split('\n').slice(0, 10).join('\n') + '\n... [body omitted]';
  }

  const lines = code.split('\n');
  const skeleton: string[] = [];
  let depth = 0;
  let inSignature = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Always include imports, exports, type/interface/class/function declarations
    const isDecl = /^(import|export|type |interface |class |function |const |let |var |async function|export default)/.test(trimmed);

    if (isDecl && depth === 0) {
      skeleton.push(line);
      inSignature = true;
    } else if (inSignature && depth === 0 && trimmed === '{') {
      skeleton.push(line);
      depth++;
    } else if (depth > 0) {
      if (trimmed.includes('{')) depth++;
      if (trimmed.includes('}')) depth--;
      if (depth === 0) {
        skeleton.push('  // ... body omitted');
        skeleton.push('}');
        inSignature = false;
      }
    }
  }

  return skeleton.join('\n');
}
