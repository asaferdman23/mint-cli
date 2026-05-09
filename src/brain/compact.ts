/**
 * Token-based message compaction.
 *
 * Replaces src/orchestrator/loop.ts's char-based compaction. When the running
 * TokenBudget crosses its compactAt threshold, we:
 *   1. Keep the first user turn (the original task) verbatim
 *   2. Keep the last N turns verbatim (default 4)
 *   3. Summarize everything in the middle via the cheapest model
 *
 * Emits a 'compact' AgentEvent so the TUI can surface what was dropped.
 */
import type { Message, ModelId } from '../providers/types.js';
import { complete } from '../providers/index.js';
import type { Session } from './session.js';
import { TokenBudget, countTokens, countTokensMany } from './tokens.js';

export interface CompactOptions {
  /** Model to use for the summary call. Default: mistral-small. */
  summarizerModel?: ModelId;
  /** Keep last N messages verbatim. Default: 4. */
  keepRecent?: number;
  /** Signal for abort propagation. */
  signal?: AbortSignal;
}

export interface CompactResult {
  messages: Message[];
  beforeTokens: number;
  afterTokens: number;
  compacted: boolean;
}

const DEFAULT_SUMMARIZER: ModelId = 'mistral-small';

/**
 * If the budget exceeds its threshold, produce a compacted message list.
 * Otherwise returns the input unchanged with `compacted: false`.
 */
export async function maybeCompact(
  messages: Message[],
  budget: TokenBudget,
  session: Session,
  options: CompactOptions = {},
): Promise<CompactResult> {
  const beforeTokens = countTokensMany(messages);

  // Only compact if the budget flagged us AND there's enough middle to trim.
  if (beforeTokens < budget.compactAt || messages.length <= 6) {
    return { messages, beforeTokens, afterTokens: beforeTokens, compacted: false };
  }

  const keepRecent = options.keepRecent ?? 4;
  const first = messages[0];
  const recent = messages.slice(-keepRecent);
  const middle = messages.slice(1, messages.length - keepRecent);

  if (middle.length === 0) {
    return { messages, beforeTokens, afterTokens: beforeTokens, compacted: false };
  }

  const summaryText = await summarizeMiddle(middle, options).catch((err) => {
    session.emit({ type: 'warn', message: `compaction summary failed: ${err.message ?? err}` });
    return buildFallbackSummary(middle);
  });

  const summary: Message = { role: 'assistant', content: summaryText };
  const nextMessages: Message[] = [first, summary, ...recent];
  const afterTokens = countTokensMany(nextMessages);

  session.emit({
    type: 'compact',
    reason: 'tokens',
    beforeTokens,
    afterTokens,
  });

  budget.reset(afterTokens);

  return { messages: nextMessages, beforeTokens, afterTokens, compacted: true };
}

async function summarizeMiddle(middle: Message[], options: CompactOptions): Promise<string> {
  const model = options.summarizerModel ?? DEFAULT_SUMMARIZER;

  const transcript = middle
    .map((m) => `${m.role.toUpperCase()}: ${truncate(m.content ?? '', 400)}`)
    .join('\n');

  const response = await complete({
    model,
    systemPrompt:
      'You compact a coding agent transcript. Preserve: user requests, files read/edited, key decisions, errors encountered, test/build outcomes. Drop: greetings, filler, redundant reasoning. Output a concise bulleted summary under 400 tokens.',
    messages: [{ role: 'user', content: transcript }],
    maxTokens: 512,
    temperature: 0,
    signal: options.signal,
  });

  const out = response.content.trim();
  if (!out) throw new Error('empty summary');
  return `[Compacted earlier turns]\n${out}`;
}

function buildFallbackSummary(middle: Message[]): string {
  const filesEdited = new Set<string>();
  const filesRead = new Set<string>();
  const userAsks: string[] = [];

  for (const m of middle) {
    const content = typeof m.content === 'string' ? m.content : '';
    if (m.role === 'user' && content) userAsks.push(truncate(content, 120));
    // Heuristic: paths mentioned in tool-result style content
    const pathMatches = content.match(/[a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json)/g);
    if (pathMatches) {
      for (const p of pathMatches) filesRead.add(p);
    }
    const writeMatches = content.match(/(?:Edited|Created|Modified)\s+([a-zA-Z0-9_./-]+)/g);
    if (writeMatches) {
      for (const w of writeMatches) {
        const file = w.split(/\s+/)[1];
        if (file) filesEdited.add(file);
      }
    }
  }

  const parts = [
    '[Compacted earlier turns — fallback summary]',
    userAsks.length ? `User asked: ${userAsks.join(' | ')}` : '',
    filesRead.size ? `Files examined: ${[...filesRead].slice(0, 10).join(', ')}` : '',
    filesEdited.size ? `Files modified: ${[...filesEdited].slice(0, 10).join(', ')}` : '',
  ].filter(Boolean);

  return parts.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** Utility: compute token count of a single message (for callers that want it). */
export function messageTokens(m: Message): number {
  return countTokens(typeof m.content === 'string' ? m.content : '');
}
