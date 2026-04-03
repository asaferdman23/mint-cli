import { runAgentSession, type RunAgentSessionResult } from '../agent/index.js';
import { getAllowedToolNamesForRole } from '../tools/index.js';
import { selectAgentModel, getModelOptions } from './model-selector.js';
import { getSpecialist, detectSpecialistFromTask } from './specialists/index.js';
import { loadSkills, getSkillsForSpecialist } from '../context/skills.js';
import { loadProjectRules, formatProjectRulesForPrompt } from '../context/project-rules.js';
import { EXPLORE_PROMPT } from './prompts/explore.js';
import { PLAN_PHASE_PROMPT } from './prompts/plan-phase.js';
import { BUILDER_PROMPT } from './prompts/builder.js';
import { VERIFY_PROMPT } from './prompts/verify.js';
import type { TaskComplexity } from './types.js';
import type { SpecialistType } from './specialists/types.js';
import type { WorkerTaskReporter } from './runtime.js';
import type { AgentMode } from '../agent/tools.js';

export interface DeepLoopInput {
  task: string;
  cwd: string;
  complexity: TaskComplexity;
  specialist?: SpecialistType;
  signal?: AbortSignal;
  reporter?: WorkerTaskReporter;
  mode?: AgentMode;
  /** Conversation history — so follow-up prompts have context about what was built before. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface DeepLoopResult {
  response: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
  phases: {
    explore: { duration: number; cost: number };
    plan: { duration: number; cost: number };
    implement: { duration: number; cost: number; attempts: number };
    verify: { duration: number; cost: number; passed: boolean };
  };
}

interface ExploreBriefing {
  stack: string;
  buildCommand: string;
  projectRoot?: string;
  structure: string;
  existingPatterns: string;
  relevantFiles: Array<{ path: string; snippet: string; why: string }>;
  dependencies: string[];
  concerns: string;
}

interface PlanOutput {
  steps: Array<{ file: string; action: string; description: string; details: string }>;
  verificationSteps: string[];
}

interface VerifyOutput {
  passed: boolean;
  buildPassed: boolean;
  filesChecked: string[];
  planCompliance: Array<{ step: string; done: boolean; issues: string[] }>;
  completenessIssues: string[];
  qualityIssues: string[];
  summary: string;
}

const MAX_VERIFY_RETRIES = 1;

const IMPLEMENT_ITERATIONS: Record<TaskComplexity, number> = {
  trivial: 10,
  simple: 20,
  moderate: 35,
  complex: 50,
};

const STATIC_STACKS = /\b(static\s*html|vanilla\s*html|plain\s*html|no\s*framework)\b/i;
const STATIC_BUILD_NONE = /\bnone\b/i;

function isStaticProject(briefing: ExploreBriefing): boolean {
  if (STATIC_BUILD_NONE.test(briefing.buildCommand)) return true;
  if (STATIC_STACKS.test(briefing.stack)) return true;
  // No framework deps and only HTML/CSS/JS files → static
  const frameworkDeps = ['react', 'vue', 'svelte', 'next', 'nuxt', 'angular', 'vite', 'webpack', 'parcel', 'typescript'];
  const hasFramework = briefing.dependencies.some((d) => frameworkDeps.some((f) => d.toLowerCase().includes(f)));
  if (!hasFramework && briefing.relevantFiles.every((f) => /\.(html?|css|js)$/.test(f.path))) return true;
  return false;
}

export async function runDeepLoop(input: DeepLoopInput): Promise<DeepLoopResult> {
  const { task, cwd, complexity, signal, reporter, mode, history } = input;
  // Resolve specialist — never stay on 'general' if the task clearly implies a domain
  const specialist = input.specialist && input.specialist !== 'general'
    ? input.specialist
    : detectSpecialistFromTask(task);
  const startTime = Date.now();

  // Build conversation context so follow-up prompts have memory of what was discussed
  const conversationContext = buildConversationContext(history);
  const totals = { inputTokens: 0, outputTokens: 0, cost: 0 };
  const phaseTimes: DeepLoopResult['phases'] = {
    explore: { duration: 0, cost: 0 },
    plan: { duration: 0, cost: 0 },
    implement: { duration: 0, cost: 0, attempts: 0 },
    verify: { duration: 0, cost: 0, passed: false },
  };

  // ── PHASE 1: EXPLORE ────────────────────────────────────────────────────
  await reporter?.progress('reading codebase');
  await reporter?.log(`${specialist} specialist · reading files and detecting project stack`);

  const exploreModel = selectAgentModel('explore', complexity);
  const exploreStart = Date.now();

  const exploreSession = await runAgentSession(
    [
      `Task: ${task}`,
      conversationContext,
      'Explore the codebase and produce a JSON briefing. Do NOT write code.',
    ].filter(Boolean).join('\n\n'),
    {
      cwd,
      model: exploreModel,
      signal,
      mode: mode ?? 'auto',
      toolNames: ['read_file', 'grep_files', 'find_files', 'list_dir'],
      systemPrompt: EXPLORE_PROMPT,
      maxIterations: 15,
      maxTokens: 8192,
      providerOptions: getModelOptions('explore', complexity),
    },
  );

  phaseTimes.explore = { duration: Date.now() - exploreStart, cost: exploreSession.cost };
  totals.inputTokens += exploreSession.inputTokens;
  totals.outputTokens += exploreSession.outputTokens;
  totals.cost += exploreSession.cost;

  const briefing = parseJSON<ExploreBriefing>(exploreSession.output) ?? {
    stack: 'unknown',
    buildCommand: 'npm run build',
    structure: '',
    existingPatterns: '',
    relevantFiles: [],
    dependencies: [],
    concerns: exploreSession.output.slice(0, 500),
  };

  // ── Smart build detection: skip build for static HTML projects ──────────
  if (isStaticProject(briefing)) {
    briefing.buildCommand = 'none';
  }

  await reporter?.log(`found: ${briefing.stack} · ${briefing.relevantFiles.length} files${briefing.buildCommand === 'none' ? ' · static (no build)' : ''}`);

  // ── PHASE 2: PLAN ───────────────────────────────────────────────────────
  await reporter?.progress('thinking about approach');
  await reporter?.log('planning what to build and in what order');

  const planModel = selectAgentModel('plan', complexity);
  const planStart = Date.now();

  const briefingText = JSON.stringify(briefing, null, 2);
  const planSession = await runAgentSession(
    [
      `Task: ${task}`,
      conversationContext,
      `Explore briefing:\n${briefingText}`,
      'Create an implementation plan. Output JSON only.',
    ].filter(Boolean).join('\n\n'),
    {
      cwd,
      model: planModel,
      signal,
      mode: mode ?? 'auto',
      toolNames: [],
      systemPrompt: PLAN_PHASE_PROMPT,
      maxIterations: 1,
      maxTokens: complexity === 'complex' ? 8192 : 6144,
      providerOptions: getModelOptions('plan', complexity),
    },
  );

  phaseTimes.plan = { duration: Date.now() - planStart, cost: planSession.cost };
  totals.inputTokens += planSession.inputTokens;
  totals.outputTokens += planSession.outputTokens;
  totals.cost += planSession.cost;

  const plan = parseJSON<PlanOutput>(planSession.output) ?? {
    steps: [{ file: 'unknown', action: 'create', description: task, details: planSession.output.slice(0, 500) }],
    verificationSteps: ['Build passes'],
  };

  const planPreview = plan.steps.map((s) => `  ${s.action}: ${s.file}`).join('\n');
  await reporter?.log(`plan: ${plan.steps.length} files\n${planPreview}`);
  await reporter?.log(`will check: ${plan.verificationSteps.join(' · ')}`);

  // ── Build system prompt for implement phase ─────────────────────────────
  const implementSystemParts: string[] = [
    'You are a BUILDER. Follow the implementation plan step by step.',
    'The plan was created by a senior architect who analyzed the codebase. Trust it.',
  ];

  if (specialist) {
    implementSystemParts.push(getSpecialist(specialist).systemPrompt);
    try {
      const skills = loadSkills(cwd);
      const matched = getSkillsForSpecialist(skills, specialist);
      if (matched.length > 0) {
        implementSystemParts.push(
          `<skills>\n${matched.map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`).join('\n\n')}\n</skills>`,
        );
      }
    } catch { /* ignore */ }
  }

  implementSystemParts.push(BUILDER_PROMPT);
  implementSystemParts.push(`Repository root: ${cwd}`);

  try {
    const rules = await loadProjectRules(cwd);
    if (rules) implementSystemParts.push(formatProjectRulesForPrompt(rules));
  } catch { /* ignore */ }

  const implementSystemPrompt = implementSystemParts.join('\n\n');

  // ── Build implement task with plan + briefing context ───────────────────
  const briefingContext = briefing.relevantFiles
    .map((f) => `<file path="${f.path}" why="${f.why}">\n${f.snippet}\n</file>`)
    .join('\n\n');

  const planText = plan.steps
    .map((s, i) => `${i + 1}. [${s.action}] ${s.file}: ${s.description}\n   ${s.details}`)
    .join('\n\n');

  const buildImplementTask = (retryIssues?: string) => {
    const parts = [
      `Task: ${task}`,
      conversationContext,
      `Stack: ${briefing.stack}`,
      briefing.buildCommand !== 'none'
        ? `Build command: ${briefing.buildCommand}`
        : 'Build: none needed (static project — no build step, verify by reading files only)',
      briefingContext ? `Reference files:\n${briefingContext}` : null,
      `Implementation plan:\n${planText}`,
      retryIssues ? `RETRY — the verifier found these issues. Fix ONLY these:\n${retryIssues}` : null,
      briefing.buildCommand !== 'none'
        ? 'Follow the plan step by step. Implement every step completely. Run the build when done.'
        : 'Follow the plan step by step. Implement every step completely. No build step needed — re-read your files to verify correctness.',
    ];
    return parts.filter(Boolean).join('\n\n');
  };

  // ── PHASE 3 + 4: IMPLEMENT → VERIFY loop ──────────────────────────────
  let lastImplementOutput = '';
  let verifyResult: VerifyOutput | null = null;

  for (let attempt = 0; attempt <= MAX_VERIFY_RETRIES; attempt++) {
    // ── IMPLEMENT ──
    const isRetry = attempt > 0;
    const retryIssues = verifyResult
      ? [...verifyResult.completenessIssues, ...verifyResult.qualityIssues].join('\n')
      : undefined;

    await reporter?.progress(isRetry ? `fixing issues (attempt ${attempt + 1})` : 'writing code');
    await reporter?.log(isRetry ? `fixing: ${retryIssues?.split('\n')[0]}` : 'writing code per plan');

    const implModel = selectAgentModel('builder', complexity);
    const implStart = Date.now();

    const implSession = await runAgentSession(
      buildImplementTask(retryIssues),
      {
        cwd,
        model: implModel,
        signal,
        mode: mode ?? 'auto',
        toolNames: getAllowedToolNamesForRole('builder'),
        systemPrompt: implementSystemPrompt,
        maxIterations: IMPLEMENT_ITERATIONS[complexity] ?? 35,
        maxTokens: 16384,
        providerOptions: getModelOptions('builder', complexity),
      },
    );

    const implDuration = Date.now() - implStart;
    phaseTimes.implement.duration += implDuration;
    phaseTimes.implement.cost += implSession.cost;
    phaseTimes.implement.attempts = attempt + 1;
    totals.inputTokens += implSession.inputTokens;
    totals.outputTokens += implSession.outputTokens;
    totals.cost += implSession.cost;
    lastImplementOutput = implSession.output;

    await reporter?.log(`code written (${(implDuration / 1000).toFixed(1)}s)`);

    // ── VERIFY ──
    await reporter?.progress('checking quality');
    await reporter?.log('verifying: reading files, running build, checking completeness');

    const verifyModel = selectAgentModel('verify', complexity);
    const verifyStart = Date.now();

    const noBuild = briefing.buildCommand === 'none';
    const verifyTask = [
      `Original task: ${task}`,
      noBuild
        ? 'Build: none needed (static project). Skip the build check — set buildPassed to true. Verify by reading files only.'
        : `Build command: ${briefing.buildCommand}`,
      `Implementation plan:\n${planText}`,
      `Verification criteria:\n${plan.verificationSteps.filter((v) => noBuild ? !/build/i.test(v) : true).map((v, i) => `${i + 1}. ${v}`).join('\n')}`,
      `Files the builder claims to have changed:\n${plan.steps.map((s) => `  ${s.action}: ${s.file}`).join('\n')}`,
      noBuild
        ? 'Read every file listed above. Check completeness against the plan. Output JSON only.'
        : 'Read every file listed above. Run the build. Check completeness against the plan. Output JSON only.',
    ].join('\n\n');

    const verifySession = await runAgentSession(verifyTask, {
      cwd,
      model: verifyModel,
      signal,
      mode: mode ?? 'auto',
      toolNames: ['read_file', 'grep_files', 'find_files', 'list_dir', 'bash', 'run_tests'],
      systemPrompt: VERIFY_PROMPT,
      maxIterations: 15,
      maxTokens: 8192,
      providerOptions: getModelOptions('verify', complexity),
    });

    const verifyDuration = Date.now() - verifyStart;
    phaseTimes.verify.duration += verifyDuration;
    phaseTimes.verify.cost += verifySession.cost;
    totals.inputTokens += verifySession.inputTokens;
    totals.outputTokens += verifySession.outputTokens;
    totals.cost += verifySession.cost;

    verifyResult = parseJSON<VerifyOutput>(verifySession.output) ?? {
      passed: false,
      buildPassed: false,
      filesChecked: [],
      planCompliance: [],
      completenessIssues: ['Could not parse verify output'],
      qualityIssues: [],
      summary: verifySession.output.slice(0, 300),
    };

    phaseTimes.verify.passed = verifyResult.passed;

    if (verifyResult.passed) {
      await reporter?.log(`quality check passed: ${verifyResult.summary}`);
      break;
    }

    const issueCount = verifyResult.completenessIssues.length + verifyResult.qualityIssues.length;
    await reporter?.log(
      `${issueCount} issues found: ${verifyResult.summary}`,
    );

    if (attempt >= MAX_VERIFY_RETRIES) {
      await reporter?.log('max retries — moving to final review');
    }
  }

  return {
    response: lastImplementOutput,
    model: selectAgentModel('builder', complexity),
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cost: totals.cost,
    duration: Date.now() - startTime,
    phases: phaseTimes,
  };
}

function parseJSON<T>(text: string): T | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
  } catch { /* ignore */ }
  return null;
}

/**
 * Build conversation context from history.
 * User messages: full (they're short — requests + feedback).
 * Assistant messages: truncated (they contain huge code dumps — keep first 500 chars as summary).
 * Last 4 messages (2 turns) — enough to know what was built and what feedback was given.
 */
function buildConversationContext(
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
): string | null {
  if (!history || history.length === 0) return null;

  const recent = history.slice(-4);
  const lines = recent.map((m) => {
    if (m.role === 'user') {
      return `User: ${m.content}`;
    }
    // Assistant messages may contain full code output — summarize
    const summary = m.content.length > 500
      ? m.content.slice(0, 500) + '\n[... truncated — read actual files on disk to see current state]'
      : m.content;
    return `Assistant: ${summary}`;
  });

  return `<conversation_history>\n${lines.join('\n\n')}\n</conversation_history>`;
}
