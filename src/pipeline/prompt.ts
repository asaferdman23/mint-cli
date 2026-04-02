/**
 * Build focused prompts with context from search results.
 */
import type { SearchResult } from '../context/search.js';
import { compressContext, type FileEntry } from '../context/compress.js';
import { estimateTokens } from '../context/budget.js';
import { loadProjectRules, formatProjectRulesForPrompt } from '../context/project-rules.js';
import { loadAgentMd, formatAgentMdForPrompt } from '../context/agentmd.js';
import { getTier } from '../providers/tiers.js';
import type { ModelId } from '../providers/types.js';
import { MODELS } from '../providers/types.js';

const BASE_SYSTEM = `You are Mint, an expert AI coding assistant.

<rules>
1. When modifying code, output changes as unified diffs in fenced code blocks:
   \`\`\`diff
   --- a/path/to/file.ts
   +++ b/path/to/file.ts
   @@ ... @@
   -old line
   +new line
   \`\`\`
2. Be precise. Only change what's needed for the task.
3. If creating a new file, use a diff with /dev/null as the old file.
4. Explain your reasoning briefly before showing diffs.
5. If you need to see more files, say which ones and why.
</rules>`;

export interface BuiltPrompt {
  systemPrompt: string;
  contextTokens: number;
  filesIncluded: string[];
}

/**
 * Build a system prompt with focused context for a task.
 *
 * Respects model context window — reserves space for user message + output.
 */
export async function buildFocusedPrompt(
  cwd: string,
  searchResults: SearchResult[],
  modelId: ModelId,
): Promise<BuiltPrompt> {
  const parts: string[] = [];
  const tier = getTier(modelId);
  const modelInfo = MODELS[modelId];

  // Hard cap: use 50% of model context for system prompt, leave room for
  // user message, conversation history, and output tokens.
  // For small-context or rate-limited models (Groq free tier), this prevents 413s.
  const hardCap = modelInfo
    ? Math.min(Math.floor(modelInfo.contextWindow * 0.5), 8_000)
    : 6_000;

  // 1. Project rules (MINT.md) — highest priority
  const rules = await loadProjectRules(cwd);
  if (rules) {
    parts.push(formatProjectRulesForPrompt(rules));
  }

  // 2. AGENT.md — legacy support
  const agentMd = await loadAgentMd(cwd);
  if (agentMd) {
    parts.push(formatAgentMdForPrompt(agentMd));
  }

  // 3. Base system prompt
  parts.push(BASE_SYSTEM);

  // 4. Relevant files — compressed per model tier, within budget
  const overhead = estimateTokens(parts.join('\n'));
  const fileBudget = Math.max(0, hardCap - overhead);

  if (searchResults.length > 0 && fileBudget > 500) {
    const fileEntries: FileEntry[] = searchResults.map(r => ({
      path: r.path,
      content: r.content,
      language: r.language,
    }));

    const { files: compressed } = compressContext(fileEntries, tier);

    const filesIncluded: string[] = [];
    let usedTokens = 0;
    const fileBlocks: string[] = [];

    for (const f of compressed) {
      const tokens = estimateTokens(f.content);
      if (usedTokens + tokens > fileBudget) break;
      fileBlocks.push(`<file path="${f.path}">\n${f.content}\n</file>`);
      filesIncluded.push(f.path);
      usedTokens += tokens;
    }

    if (fileBlocks.length > 0) {
      parts.push(`\n<context files="${filesIncluded.length}">\n` + fileBlocks.join('\n\n') + '\n</context>');

      const systemPrompt = parts.join('\n');
      return {
        systemPrompt,
        contextTokens: estimateTokens(systemPrompt),
        filesIncluded,
      };
    }
  }

  // No files included
  const systemPrompt = parts.join('\n');
  return {
    systemPrompt,
    contextTokens: estimateTokens(systemPrompt),
    filesIncluded: [],
  };
}
