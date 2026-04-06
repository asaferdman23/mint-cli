/**
 * Prompt builder — assembles the final prompt from all context pieces.
 *
 * Produces a system prompt + user message optimized for minimal token usage.
 * Target: <8K tokens for simple tasks, <15K for complex.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectIndex } from './indexer.js';
import type { ExtractedContext } from './extractor.js';
import { estimateTokens } from './budget.js';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userMessage: string;
  estimatedTokens: number;
}

/**
 * Build the final prompt for a task.
 */
export async function buildPrompt(
  task: string,
  fileContexts: ExtractedContext[],
  conversationHistory: Message[],
  index: ProjectIndex,
  cwd: string,
): Promise<BuiltPrompt> {
  // Load MINT.md project rules if they exist
  let projectRules = '';
  try {
    projectRules = await readFile(join(cwd, 'MINT.md'), 'utf-8');
  } catch { /* no MINT.md */ }

  // Build compact symbol index (name:kind:file)
  const symbolLines: string[] = [];
  for (const [path, file] of Object.entries(index.files)) {
    if (file.symbols && file.symbols.length > 0) {
      for (const sym of file.symbols) {
        symbolLines.push(`${sym.name}:${sym.kind}:${path}`);
      }
    }
  }
  // Cap symbol index to ~500 tokens
  const symbolIndex = symbolLines.slice(0, 200).join('\n');

  // Determine key files (most-imported)
  const importCounts = new Map<string, number>();
  for (const file of Object.values(index.files)) {
    for (const imp of file.imports) {
      importCounts.set(imp, (importCounts.get(imp) ?? 0) + 1);
    }
  }
  const keyFiles = [...importCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path]) => path)
    .join(', ');

  // Languages
  const langSet = new Set<string>();
  for (const file of Object.values(index.files)) {
    if (file.language) langSet.add(file.language);
  }

  // System prompt
  const systemPrompt = `You are Mint, an expert coding assistant. You make precise, minimal changes to fix bugs and implement features.

RULES:
- Output ONLY unified diffs for file changes. No explanations unless asked.
- If you need to run a command first, output: {"tool": "bash", "command": "..."}
- If you need to read more files, output: {"tool": "read", "files": ["path1", "path2"]}
- After making changes, suggest a verification command if appropriate.
- Be precise. Change only what's needed. Don't refactor unrelated code.

PROJECT CONTEXT:
- Root: ${cwd}
- Languages: ${[...langSet].join(', ')}
- Files: ${index.totalFiles} (${index.totalLOC.toLocaleString()} LOC)
- Key files: ${keyFiles}
${projectRules ? `\nPROJECT RULES (from MINT.md):\n${projectRules}\n` : ''}
AVAILABLE SYMBOLS (for reference):
${symbolIndex}`;

  // User message
  const fileContextStr = fileContexts
    .map(fc => fc.content)
    .join('\n\n---\n\n');

  // Include conversation history summary if follow-up
  let historyStr = '';
  if (conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-4);
    historyStr = '\nPREVIOUS CONTEXT:\n' + recentHistory
      .map(m => `[${m.role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`)
      .join('\n');
  }

  const userMessage = `TASK: ${task}

RELEVANT CODE:
${fileContextStr}
${historyStr}`;

  const totalTokens = estimateTokens(systemPrompt) + estimateTokens(userMessage);

  return { systemPrompt, userMessage, estimatedTokens: totalTokens };
}
