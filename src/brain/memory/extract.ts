/**
 * Fire-and-forget typed-memory extractor (PR4).
 *
 * Reuses the same call site shape as `summarize-turn.ts`:
 *   - cheap model (mistral-small)
 *   - only paths + small strings reach the model — never file bodies
 *   - failure / malformed JSON / empty output → returns `[]`, never throws
 *
 * Output is the typed Memory union from `store.ts`. Any memory whose text
 * fields trip the secret denylist is dropped here in addition to the second
 * line of defence inside `MemoryStore.write`.
 */
import { complete } from '../../providers/index.js';
import type { ModelId } from '../../providers/types.js';
import type { TurnInputs } from './summarize-turn.js';
import { containsSecret } from './redact.js';
import type { Memory } from './store.js';

const DEFAULT_MODEL: ModelId = 'mistral-small';
const MAX_MEMORIES_PER_TURN = 5;
/** Max characters per memory text-bearing field. Anything longer is almost
 *  certainly a pasted snippet, library code, or an error blob — exactly the
 *  poisoning vector we want to drop. */
const MAX_MEMORY_TEXT_LEN = 200;
/** Hard timeout for the extractor LLM call. Past this we fall back to a
 *  regex-only episode summary so the turn never feels gated on extraction. */
const EXTRACT_TIMEOUT_MS = 3000;

const SYSTEM_PROMPT =
  'Extract 0-5 typed memories from this turn. Return JSON only, no prose. Skip if nothing memorable.\n\n' +
  'Rules for memory extraction:\n' +
  '  1. ONLY save memories about the user, the user\'s preferences, or this project\'s code conventions.\n' +
  '  2. NEVER save memories about third-party content from files we read (library code, generated output, error message contents).\n' +
  '  3. NEVER save memories that contain literal user prompts, API responses, or pasted snippets.\n' +
  '  4. Hard cap: 5 memories per turn. If you have more candidates, return only the most useful 5.\n\n' +
  'Schema (each entry must match exactly one shape):\n' +
  '  {"kind":"preference","text":"...","confidence":0.0-1.0}\n' +
  '  {"kind":"fact","subject":"...","predicate":"...","object":"...","confidence":0.0-1.0}\n' +
  '  {"kind":"decision","turn":N,"rationale":"...","files":["..."]}\n' +
  '  {"kind":"episode","turn":N,"userTask":"...","outcome":"success"|"partial"|"reverted","filesTouched":["..."]}\n' +
  '  {"kind":"open_question","text":"..."}\n\n' +
  'Return: {"memories": [...]} — JSON object only, no markdown fences.';

function buildUserPayload(inputs: TurnInputs): string {
  const truncatedTask =
    inputs.userTask.length > 600 ? `${inputs.userTask.slice(0, 600)}…` : inputs.userTask;
  const truncatedAssistant =
    inputs.finalAssistant.length > 1200
      ? `${inputs.finalAssistant.slice(0, 1200)}…`
      : inputs.finalAssistant;
  const filesLine =
    inputs.filesTouched.length === 0 ? '(no files touched)' : inputs.filesTouched.join(', ');
  return [
    `User task: ${truncatedTask}`,
    `Files touched: ${filesLine}`,
    `Tool calls: ${inputs.toolCalls}`,
    `Outcome: ${inputs.outcome}`,
    `Model: ${inputs.model}`,
    `Final assistant message: ${truncatedAssistant}`,
  ].join('\n');
}

function tryParseMemories(raw: string): unknown[] {
  if (!raw || !raw.trim()) return [];
  // Strip code fences if the model returned them despite instructions.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const memories = (parsed as Record<string, unknown>).memories;
      if (Array.isArray(memories)) return memories;
    }
    return [];
  } catch {
    return [];
  }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string');
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Validate one parsed object against the Memory union. Returns null if invalid. */
function validate(raw: unknown): Memory | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;

  switch (kind) {
    case 'preference': {
      const text = asString(o.text);
      if (!text) return null;
      const confidence = asNumber(o.confidence) ?? 0.5;
      return { kind: 'preference', text, confidence };
    }
    case 'fact': {
      const subject = asString(o.subject);
      const predicate = asString(o.predicate);
      const object = asString(o.object);
      if (!subject || !predicate || !object) return null;
      const confidence = asNumber(o.confidence) ?? 0.5;
      return { kind: 'fact', subject, predicate, object, confidence };
    }
    case 'decision': {
      const turn = asNumber(o.turn) ?? 0;
      const rationale = asString(o.rationale);
      if (!rationale) return null;
      return { kind: 'decision', turn, rationale, files: asStringArray(o.files) };
    }
    case 'episode': {
      const turn = asNumber(o.turn) ?? 0;
      const userTask = asString(o.userTask);
      const outcomeStr = asString(o.outcome);
      if (!userTask || !outcomeStr) return null;
      if (outcomeStr !== 'success' && outcomeStr !== 'partial' && outcomeStr !== 'reverted') {
        return null;
      }
      return {
        kind: 'episode',
        turn,
        userTask,
        outcome: outcomeStr,
        filesTouched: asStringArray(o.filesTouched),
      };
    }
    case 'open_question': {
      const text = asString(o.text);
      if (!text) return null;
      return { kind: 'open_question', text };
    }
    default:
      return null;
  }
}

function memoryTouchesSecret(m: Memory): boolean {
  switch (m.kind) {
    case 'preference':
    case 'open_question':
      return containsSecret(m.text);
    case 'fact':
      return (
        containsSecret(m.subject) ||
        containsSecret(m.predicate) ||
        containsSecret(m.object)
      );
    case 'decision':
      return containsSecret(m.rationale);
    case 'episode':
      return containsSecret(m.userTask);
  }
}

/** Length-based poisoning filter: drop memories whose text fields exceed the
 *  cap. Long text is almost always a pasted snippet, never a useful memory. */
function memoryTooLong(m: Memory): boolean {
  switch (m.kind) {
    case 'preference':
    case 'open_question':
      return m.text.length > MAX_MEMORY_TEXT_LEN;
    case 'fact':
      return (
        m.subject.length > MAX_MEMORY_TEXT_LEN ||
        m.predicate.length > MAX_MEMORY_TEXT_LEN ||
        m.object.length > MAX_MEMORY_TEXT_LEN
      );
    case 'decision':
      return m.rationale.length > MAX_MEMORY_TEXT_LEN;
    case 'episode':
      return m.userTask.length > MAX_MEMORY_TEXT_LEN;
  }
}

/** Cheap normalized key for in-session dedupe of repeated poisoning attempts.
 *  Matches the spirit of the store's `normalized_key` (lowercase+trim of the
 *  identifying text) without re-importing the SQL layer. */
function normalizedKey(m: Memory): string {
  const lower = (s: string): string => s.toLowerCase().trim();
  switch (m.kind) {
    case 'preference':
    case 'open_question':
      return `${m.kind}:${lower(m.text)}`;
    case 'fact':
      return `fact:${lower(m.subject)}|${lower(m.predicate)}|${lower(m.object)}`;
    case 'decision':
      return `decision:${lower(m.rationale)}`;
    case 'episode':
      return `episode:${lower(m.userTask)}`;
  }
}

/** Session-scoped rejection set. Subsequent identical poisoning attempts
 *  within the same CLI process are silently dropped (cheap, no SQLite hop). */
const sessionRejectedKeys = new Set<string>();

/** Regex-only fallback when the extractor LLM call times out. Emits a single
 *  episode-kind memory built from inputs we already have — no LLM, no risk
 *  of malformed JSON, deterministic latency. */
function regexFallback(inputs: TurnInputs): Memory[] {
  const outcome: 'success' | 'partial' | 'reverted' =
    inputs.outcome === 'success'
      ? 'success'
      : inputs.outcome === 'aborted'
        ? 'reverted'
        : 'partial';
  const userTask =
    inputs.userTask.length > MAX_MEMORY_TEXT_LEN
      ? inputs.userTask.slice(0, MAX_MEMORY_TEXT_LEN)
      : inputs.userTask;
  return [
    {
      kind: 'episode',
      turn: 0,
      userTask,
      outcome,
      filesTouched: inputs.filesTouched,
    },
  ];
}

export type ExtractKind = Memory['kind'];

export interface ExtractMemoriesOptions {
  signal?: AbortSignal;
  model?: ModelId;
  /** Whitelist of memory kinds to emit. When provided, the extractor system
   *  prompt is constrained AND the parsed response is filtered to this set. */
  kinds?: ExtractKind[];
  /** Override the 3s timeout (tests). */
  timeoutMs?: number;
  /** Trace hook fired on fallback. Best-effort, never throws. */
  onFallback?: (reason: 'timeout') => void;
}

export async function extractMemories(
  inputs: TurnInputs,
  options?: ExtractMemoriesOptions,
): Promise<Memory[]> {
  const model = options?.model ?? DEFAULT_MODEL;
  const kindsFilter = options?.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
  const timeoutMs = options?.timeoutMs ?? EXTRACT_TIMEOUT_MS;

  // Augment the system prompt with the kinds whitelist (if any). The model
  // already filters server-side most of the time; we also drop offenders in
  // the parse loop below for defense-in-depth.
  const systemPrompt = kindsFilter
    ? `${SYSTEM_PROMPT}\n\nExtract ONLY these kinds: ${[...kindsFilter].join(', ')}. Skip all other kinds.`
    : SYSTEM_PROMPT;

  const llmCall = (async (): Promise<Memory[] | null> => {
    try {
      const response = await complete({
        model,
        systemPrompt,
        messages: [{ role: 'user', content: buildUserPayload(inputs) }],
        maxTokens: 512,
        temperature: 0,
        signal: options?.signal,
      });
      const parsed = tryParseMemories(response.content);
      const out: Memory[] = [];
      for (const raw of parsed) {
        const validated = validate(raw);
        if (!validated) continue;
        if (kindsFilter && !kindsFilter.has(validated.kind)) continue;
        if (memoryTouchesSecret(validated)) continue;
        if (memoryTooLong(validated)) {
          sessionRejectedKeys.add(normalizedKey(validated));
          continue;
        }
        const key = normalizedKey(validated);
        if (sessionRejectedKeys.has(key)) continue;
        out.push(validated);
        // Hard 5-entry cap, enforced AFTER all validation/dedupe filters so
        // we don't waste a slot on something we'll drop.
        if (out.length >= MAX_MEMORIES_PER_TURN) break;
      }
      return out;
    } catch {
      return [];
    }
  })();

  // Promise.race: whichever completes first wins. The timeout branch resolves
  // with the symbol so we can disambiguate it from a real `null` return.
  const TIMEOUT_SENTINEL = Symbol('timeout');
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutId = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });

  const winner = await Promise.race([llmCall, timeoutPromise]);
  if (timeoutId) clearTimeout(timeoutId);

  if (winner === TIMEOUT_SENTINEL) {
    try {
      options?.onFallback?.('timeout');
    } catch {
      /* trace is best-effort */
    }
    return regexFallback(inputs);
  }
  return winner ?? [];
}

export const __testing = {
  buildUserPayload,
  SYSTEM_PROMPT,
  MAX_MEMORIES_PER_TURN,
  MAX_MEMORY_TEXT_LEN,
  EXTRACT_TIMEOUT_MS,
  sessionRejectedKeys,
  regexFallback,
};
