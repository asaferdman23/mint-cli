/**
 * Task classifier — LLM-first with deterministic fallback.
 *
 * Replaces src/context/classifier.ts's hardcoded SIMPLE_KEYWORDS / COMPLEX_KEYWORDS.
 * Produces the structured decision every downstream layer (router, retriever,
 * approvals) depends on.
 *
 * Flow:
 *   1. Deterministic pre-check: obvious questions short-circuit the LLM call.
 *   2. LLM call: cheapest tier returns JSON conforming to the zod schema.
 *   3. Fallback scorer: feature-vector × learned weights; used when the LLM
 *      call times out, errors, or returns malformed JSON.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Complexity, TaskKind } from './events.js';
import type { ClassifierConfig } from './router.js';
import type { ModelId } from '../providers/types.js';
import { complete } from '../providers/index.js';

// ─── Schema & types ────────────────────────────────────────────────────────

export const TASK_KINDS: readonly TaskKind[] = [
  'question',
  'edit_small',
  'edit_multi',
  'refactor',
  'debug',
  'scaffold',
  'review',
  'explain',
] as const;

export const COMPLEXITIES: readonly Complexity[] = ['trivial', 'simple', 'moderate', 'complex'] as const;

export const ClassifyDecisionSchema = z.object({
  kind: z.enum([
    'question',
    'edit_small',
    'edit_multi',
    'refactor',
    'debug',
    'scaffold',
    'review',
    'explain',
  ]),
  complexity: z.enum(['trivial', 'simple', 'moderate', 'complex']),
  estFilesTouched: z.number().int().min(0).max(20),
  needsPlan: z.boolean(),
  needsApproval: z.enum(['none', 'per_diff', 'per_tool']),
  suggestedModelKey: z.string().default('edit_small'),
  reasoning: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type ClassifyDecision = z.infer<typeof ClassifyDecisionSchema>;

export interface ClassifyFeatures {
  task: string;
  /** Total files in the project index, if known. */
  projectFileCount?: number;
  /** Primary language of the project, if known. */
  language?: string;
  /** BM25 top file paths — informs complexity (more matches → broader scope). */
  topFiles?: string[];
  /** Recent user turns (last 2) — gives context for chat follow-ups. */
  recentUserTurns?: string[];
  /** Top past outcomes for near-duplicate tasks. */
  pastOutcomes?: Array<{
    taskPreview: string;
    kind: TaskKind;
    complexity: Complexity;
    success: boolean;
  }>;
}

export interface ClassifyResult extends ClassifyDecision {
  /** Where the decision came from. */
  source: 'precheck' | 'llm' | 'fallback';
}

export interface ClassifyOptions {
  /** Config slice from the routing table (model, timeoutMs, weights). */
  config: ClassifierConfig;
  /** Abort the LLM call when the parent session aborts. */
  signal?: AbortSignal;
  /** When true, skip the LLM call entirely and use the deterministic scorer. Used in tests. */
  skipLlm?: boolean;
}

// ─── Deterministic pre-check ───────────────────────────────────────────────

const QUESTION_PREFIXES = /^(help|what|why|how|where|when|who|tell me|show me)\b/i;
const EDIT_VERBS = /\b(add|change|fix|update|refactor|create|remove|delete|rename|implement|write|make|build|modify|edit|set|apply)\b/i;
// An explicit explain verb anywhere wins over a question prefix, as long as
// there's no edit verb in the task.
const EXPLAIN_VERB = /\b(explain|describe|summari[sz]e|walk me through)\b/i;

/** Cheap pattern match for obvious questions and explain requests. */
export function preclassify(task: string): ClassifyDecision | null {
  const trimmed = task.trim();
  if (!trimmed) return null;

  const isQuestion = QUESTION_PREFIXES.test(trimmed) || trimmed.endsWith('?');
  const isExplain = EXPLAIN_VERB.test(trimmed);
  const hasEditVerb = EDIT_VERBS.test(trimmed);

  if (isExplain && !hasEditVerb) {
    return {
      kind: 'explain',
      complexity: 'simple',
      estFilesTouched: 0,
      needsPlan: false,
      needsApproval: 'none',
      suggestedModelKey: 'explain',
      reasoning: 'leading explain verb',
      confidence: 0.85,
    };
  }

  if (isQuestion && !hasEditVerb) {
    return {
      kind: 'question',
      complexity: 'trivial',
      estFilesTouched: 0,
      needsPlan: false,
      needsApproval: 'none',
      suggestedModelKey: 'question',
      reasoning: 'question pattern with no edit verb',
      confidence: 0.9,
    };
  }

  return null;
}

// ─── Deterministic fallback scorer ─────────────────────────────────────────

const COMPLEX_VERBS = /\b(refactor|migrate|restructure|redesign|rewrite|overhaul|consolidate|split|extract)\b/i;
const MULTI_FILE_HINTS = /\b(across|all|every|throughout|entire|codebase|project|app)\b/i;
const TEST_MENTION = /\b(test|tests|spec|vitest|jest|pytest|coverage)\b/i;
const SCAFFOLD_VERBS = /\b(create|scaffold|bootstrap|new)\b/i;
const DEBUG_VERBS = /\b(debug|broken|failing|error|crash|exception|bug|stack trace|traceback)\b/i;
const REFACTOR_VERBS = /\b(refactor|rename|extract|inline|reorganize|consolidate|migrate|overhaul|redesign|restructure|rewrite|split)\b/i;
const REVIEW_VERBS = /\b(review|audit|check|look at|sanity check)\b/i;

function detectKind(task: string): TaskKind {
  // Refactor verbs are strongly indicative — check before multi-file hints so
  // "refactor across the codebase" stays refactor (not edit_multi).
  if (REFACTOR_VERBS.test(task)) return 'refactor';
  if (DEBUG_VERBS.test(task)) return 'debug';
  if (REVIEW_VERBS.test(task) && !EDIT_VERBS.test(task)) return 'review';
  // Multi-file before scaffold so "add X across the codebase" is edit_multi.
  if (MULTI_FILE_HINTS.test(task) || COMPLEX_VERBS.test(task)) return 'edit_multi';
  // Only scaffold when an explicit scaffold verb leads *and* no edit verb is
  // present. "add test for X" is an edit, not a scaffold.
  if (SCAFFOLD_VERBS.test(task) && !EDIT_VERBS.test(task)) return 'scaffold';
  if (SCAFFOLD_VERBS.test(task) && /^\s*(create|scaffold|bootstrap)\b/i.test(task)) return 'scaffold';
  if (EDIT_VERBS.test(task)) return 'edit_small';
  if (EXPLAIN_VERB.test(task)) return 'explain';
  return 'edit_small';
}

/** Linear feature scorer — outputs a complexity score in [0, 1]. */
function scoreComplexity(features: ClassifyFeatures, weights: Record<string, number>): number {
  const task = features.task.toLowerCase();
  const words = task.split(/\s+/).filter(Boolean).length;
  const fileCount = features.projectFileCount ?? 0;

  const pastSuccessRate = features.pastOutcomes?.length
    ? features.pastOutcomes.filter((o) => o.success).length / features.pastOutcomes.length
    : 0.5;

  const raw =
    (weights.fileCount ?? 0) * Math.min(1, fileCount / 500) +
    (weights.taskLength ?? 0) * Math.min(1, words / 30) +
    (weights.verbComplex ?? 0) * (COMPLEX_VERBS.test(task) ? 1 : 0) +
    (weights.hasMultipleFiles ?? 0) * (MULTI_FILE_HINTS.test(task) ? 1 : 0) +
    (weights.mentionsTest ?? 0) * (TEST_MENTION.test(task) ? 1 : 0) +
    (weights.pastSuccess ?? 0) * pastSuccessRate;

  // Squash to 0..1 via sigmoid so individual weights don't dominate.
  return 1 / (1 + Math.exp(-raw * 4));
}

function bucketComplexity(score: number): Complexity {
  if (score < 0.45) return 'trivial';
  if (score < 0.6) return 'simple';
  if (score < 0.78) return 'moderate';
  return 'complex';
}

function complexityIsHarderThan(a: Complexity, b: Complexity): boolean {
  return COMPLEXITIES.indexOf(a) > COMPLEXITIES.indexOf(b);
}

export function fallbackClassify(features: ClassifyFeatures, config: ClassifierConfig): ClassifyDecision {
  const kind = detectKind(features.task);
  let complexity = bucketComplexity(scoreComplexity(features, config.weights));

  // If a near-identical past task was complex, bump this one up to at least moderate.
  const priorComplex = features.pastOutcomes?.find((o) =>
    complexityIsHarderThan(o.complexity, 'simple'),
  );
  if (priorComplex && !complexityIsHarderThan(complexity, 'simple')) {
    complexity = priorComplex.complexity;
  }

  const estFilesTouched =
    kind === 'question' || kind === 'explain' || kind === 'review'
      ? 0
      : complexity === 'trivial'
      ? 1
      : complexity === 'simple'
      ? 2
      : complexity === 'moderate'
      ? 4
      : 8;

  const needsPlan = kind === 'refactor' || kind === 'scaffold' || complexity === 'complex';
  const needsApproval: ClassifyDecision['needsApproval'] =
    kind === 'question' || kind === 'explain' || kind === 'review' ? 'none' : 'per_diff';

  return {
    kind,
    complexity,
    estFilesTouched,
    needsPlan,
    needsApproval,
    suggestedModelKey: kind,
    reasoning: 'fallback scorer',
    confidence: 0.4,
  };
}

// ─── Prompt loading ────────────────────────────────────────────────────────

const INLINE_PROMPT =
  'You classify coding tasks for the Mint CLI brain agent. Return a single JSON object matching the provided schema. No prose outside the JSON.';

let cachedPrompt: string | null = null;
function loadClassifierPrompt(): string {
  if (cachedPrompt) return cachedPrompt;
  try {
    const here = fileURLToPath(import.meta.url);
    const dir = here.replace(/[\\/][^\\/]+$/, '');
    const path = join(dir, 'prompts', 'classifier.md');
    if (existsSync(path)) {
      cachedPrompt = readFileSync(path, 'utf-8');
      return cachedPrompt;
    }
  } catch {
    /* fall through */
  }
  cachedPrompt = INLINE_PROMPT;
  return cachedPrompt;
}

// ─── LLM call ───────────────────────────────────────────────────────────────

function formatFeatures(features: ClassifyFeatures): string {
  const lines: string[] = [`TASK: ${features.task}`];
  if (features.language) lines.push(`LANGUAGE: ${features.language}`);
  if (features.projectFileCount !== undefined) lines.push(`PROJECT_FILE_COUNT: ${features.projectFileCount}`);
  if (features.topFiles?.length) {
    lines.push(`BM25_TOP_FILES:\n${features.topFiles.slice(0, 5).map((f) => `  - ${f}`).join('\n')}`);
  }
  if (features.recentUserTurns?.length) {
    lines.push(`RECENT_USER_TURNS:\n${features.recentUserTurns.slice(-2).map((t) => `  - ${t.slice(0, 120)}`).join('\n')}`);
  }
  if (features.pastOutcomes?.length) {
    lines.push(
      `PAST_OUTCOMES:\n${features.pastOutcomes
        .slice(0, 3)
        .map(
          (o) => `  - kind=${o.kind} complexity=${o.complexity} success=${o.success} task="${o.taskPreview.slice(0, 80)}"`,
        )
        .join('\n')}`,
    );
  }
  return lines.join('\n');
}

function buildSchemaHint(): string {
  return [
    'Return exactly this JSON shape:',
    '{',
    '  "kind": "question|edit_small|edit_multi|refactor|debug|scaffold|review|explain",',
    '  "complexity": "trivial|simple|moderate|complex",',
    '  "estFilesTouched": 0-20,',
    '  "needsPlan": true|false,',
    '  "needsApproval": "none|per_diff|per_tool",',
    '  "suggestedModelKey": "question|edit_small|edit_multi|refactor|debug|scaffold|review|explain",',
    '  "reasoning": "one sentence",',
    '  "confidence": 0.0-1.0',
    '}',
  ].join('\n');
}

const JSON_BLOCK = /\{[\s\S]*\}/;

function extractJson(text: string): unknown {
  const match = text.match(JSON_BLOCK);
  if (!match) throw new Error('no JSON found');
  return JSON.parse(match[0]);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`classifier timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function llmClassify(
  features: ClassifyFeatures,
  config: ClassifierConfig,
  signal: AbortSignal | undefined,
): Promise<ClassifyDecision> {
  const systemPrompt = `${loadClassifierPrompt()}\n\n${buildSchemaHint()}`;
  const userContent = formatFeatures(features);

  const response = await withTimeout(
    complete({
      model: config.model as ModelId,
      messages: [{ role: 'user', content: userContent }],
      systemPrompt,
      temperature: 0,
      maxTokens: 400,
      signal,
    }),
    config.timeoutMs,
  );

  const parsed = extractJson(response.content);
  return ClassifyDecisionSchema.parse(parsed);
}

// ─── Public entry ───────────────────────────────────────────────────────────

/**
 * Classify a task. Runs the deterministic pre-check first; otherwise calls the
 * LLM, falling back to the feature-vector scorer on any failure.
 */
export async function classify(
  features: ClassifyFeatures,
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  const pre = preclassify(features.task);
  if (pre) return { ...pre, source: 'precheck' };

  if (options.skipLlm) {
    return { ...fallbackClassify(features, options.config), source: 'fallback' };
  }

  try {
    const decision = await llmClassify(features, options.config, options.signal);
    return { ...decision, source: 'llm' };
  } catch {
    return { ...fallbackClassify(features, options.config), source: 'fallback' };
  }
}
