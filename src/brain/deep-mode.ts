/**
 * Deep mode — staged planner → execute → review loop for complex tasks.
 *
 * Auto-triggered by the main loop when the classifier reports
 *   complexity === 'complex' && estFilesTouched >= 4
 *
 * This is a slimmed replacement for the legacy Scout→Architect→Builder→Reviewer
 * pipeline. Instead of 600 LOC of DAG scheduling, we run three phases:
 *
 *   1. PLAN   — ask a reasoning model for an ordered subtask list.
 *   2. BUILD  — run each subtask as a focused mini-session (classifier re-runs,
 *               tool loop executes, results stream as phase events).
 *   3. REVIEW — ask the model for a final verification pass.
 *
 * Every phase emits `phase` events. The outer loop stays otherwise unchanged.
 */
import { complete } from '../providers/index.js';
import type { Message, ModelId } from '../providers/types.js';
import type { Session } from './session.js';
import type { ClassifyResult } from './classifier.js';
import type { RouteEntry } from './router.js';
import type { PlanStep, PhaseName } from './events.js';
import { countTokens, approxCostUsd } from './tokens.js';
import { z } from 'zod';

const PLAN_SCHEMA = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      filesHint: z.array(z.string()).default([]),
    }),
  ),
});

const PLAN_PROMPT = `You are a senior engineer planning a complex change. Decompose the task into 2-6 ordered, atomic subtasks. Each subtask should touch 1-3 files and be independently verifiable. Output ONLY JSON matching this schema:
{
  "steps": [
    { "id": "1", "description": "<what to do>", "filesHint": ["<path>", "..."] }
  ]
}`;

const REVIEW_PROMPT = `You are reviewing a completed multi-step change. Given the original task and the subtask descriptions, list in plain text: (1) what was accomplished, (2) any obvious gaps, (3) suggested follow-ups. Keep it under 200 words.`;

export interface DeepModeInput {
  session: Session;
  task: string;
  decision: ClassifyResult;
  route: RouteEntry;
  contextFiles: Array<{ path: string; summary?: string }>;
}

export interface DeepModeResult {
  planSteps: PlanStep[];
  reviewSummary: string;
  phaseCount: number;
  planCostUsd: number;
  reviewCostUsd: number;
}

/**
 * Should the loop fall into deep mode for this classification?
 * Matches the plan's trigger: complex + >=4 files expected.
 */
export function shouldUseDeepMode(decision: ClassifyResult): boolean {
  return decision.complexity === 'complex' && decision.estFilesTouched >= 4;
}

/**
 * Run the planner + review phases around a provided executor. The executor
 * is the outer loop's per-subtask runner — deep-mode doesn't own the tool
 * loop, just the phase structure.
 */
export async function runDeepMode(
  input: DeepModeInput,
  executeSubtask: (step: PlanStep) => Promise<void>,
): Promise<DeepModeResult> {
  const { session, task, route, contextFiles } = input;

  // ── Phase: plan ────────────────────────────────────────────────────────
  const planStart = Date.now();
  session.emit({ type: 'phase', name: 'plan', status: 'start' });
  const planResult = await runPlanner(task, route.model, contextFiles, session.signal).catch(
    (err) => {
      session.emit({ type: 'warn', message: `planner failed: ${err.message ?? err}` });
      return { steps: [], costUsd: 0 } as { steps: PlanStep[]; costUsd: number };
    },
  );
  session.emit({
    type: 'phase',
    name: 'plan',
    status: 'end',
    durationMs: Date.now() - planStart,
  });

  const steps = planResult.steps;
  if (steps.length === 0) {
    // No plan — fall back to single-pass. Outer loop continues normally.
    return {
      planSteps: [],
      reviewSummary: '',
      phaseCount: 0,
      planCostUsd: planResult.costUsd,
      reviewCostUsd: 0,
    };
  }

  session.emit({ type: 'plan.draft', steps });

  // ── Phase: build (per subtask) ─────────────────────────────────────────
  for (const step of steps) {
    if (session.aborted()) break;
    const buildStart = Date.now();
    session.emit({ type: 'phase', name: 'build', status: 'start' });
    try {
      await executeSubtask(step);
    } catch (err) {
      session.emit({
        type: 'warn',
        message: `subtask ${step.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    session.emit({
      type: 'phase',
      name: 'build',
      status: 'end',
      durationMs: Date.now() - buildStart,
    });
  }

  // ── Phase: review ──────────────────────────────────────────────────────
  const reviewStart = Date.now();
  session.emit({ type: 'phase', name: 'review', status: 'start' });
  const reviewResult = await runReviewer(task, steps, route.model, session.signal).catch((err) => {
    session.emit({ type: 'warn', message: `reviewer failed: ${err.message ?? err}` });
    return { summary: '', costUsd: 0 };
  });
  session.emit({
    type: 'phase',
    name: 'review',
    status: 'end',
    durationMs: Date.now() - reviewStart,
  });

  return {
    planSteps: steps,
    reviewSummary: reviewResult.summary,
    phaseCount: steps.length,
    planCostUsd: planResult.costUsd,
    reviewCostUsd: reviewResult.costUsd,
  };
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function runPlanner(
  task: string,
  model: ModelId,
  contextFiles: Array<{ path: string; summary?: string }>,
  signal: AbortSignal | undefined,
): Promise<{ steps: PlanStep[]; costUsd: number }> {
  const contextBlock = contextFiles
    .slice(0, 8)
    .map((f) => `- ${f.path}${f.summary ? ` — ${f.summary}` : ''}`)
    .join('\n');

  const userPrompt = `Task:\n${task}\n\nRelevant files:\n${contextBlock || '(none)'}`;

  const response = await complete({
    model,
    systemPrompt: PLAN_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 1024,
    temperature: 0,
    signal,
  });

  const raw = response.content.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) return { steps: [], costUsd: 0 };

  try {
    const parsed = PLAN_SCHEMA.parse(JSON.parse(raw));
    const steps: PlanStep[] = parsed.steps.map((s, i) => ({
      id: s.id || `${i + 1}`,
      description: s.description,
      filesHint: s.filesHint,
    }));
    const inputTokens = response.usage?.inputTokens ?? countTokens(userPrompt);
    const outputTokens = response.usage?.outputTokens ?? countTokens(response.content);
    return {
      steps,
      costUsd: response.cost?.total ?? approxCostUsd(model, inputTokens, outputTokens),
    };
  } catch {
    return { steps: [], costUsd: 0 };
  }
}

async function runReviewer(
  task: string,
  steps: PlanStep[],
  model: ModelId,
  signal: AbortSignal | undefined,
): Promise<{ summary: string; costUsd: number }> {
  const stepList = steps.map((s) => `- ${s.id}: ${s.description}`).join('\n');
  const userPrompt = `Original task:\n${task}\n\nSubtasks executed:\n${stepList}`;

  const response = await complete({
    model,
    systemPrompt: REVIEW_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 512,
    temperature: 0,
    signal,
  });

  const inputTokens = response.usage?.inputTokens ?? countTokens(userPrompt);
  const outputTokens = response.usage?.outputTokens ?? countTokens(response.content);
  return {
    summary: response.content.trim(),
    costUsd: response.cost?.total ?? approxCostUsd(model, inputTokens, outputTokens),
  };
}

/** Exported for tests. Produces a prompt-free stand-in when offline. */
export function synthesizePlanFromHeuristic(task: string): PlanStep[] {
  const sentences = task
    .split(/[.\n;]|,\s*(?:then|and|also)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length < 2) return [];
  return sentences.slice(0, 6).map((desc, i) => ({
    id: `${i + 1}`,
    description: desc,
    filesHint: [],
  }));
}

export type { PlanStep, PhaseName };
