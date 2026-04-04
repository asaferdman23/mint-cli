import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runAgentSession, type RunAgentOptions } from '../agent/index.js';
import { getAllowedToolNamesForRole } from '../tools/index.js';
import { compressContext } from '../context/compress.js';
import { estimateTokens } from '../context/budget.js';
import { getTier } from '../providers/tiers.js';
import { loadIndex, indexProject, searchRelevantFiles, extractKeywords } from '../context/index.js';
import { loadProjectRules, formatProjectRulesForPrompt } from '../context/project-rules.js';
import {
  formatSessionMemoryForPrompt,
  formatSessionMemorySummary,
  getSessionMemoryCandidateFiles,
  isReferentialTask,
  loadSessionMemory,
  loadSessionMemorySnapshot,
} from '../context/session-memory.js';
import { loadSkills, getSkillsForSpecialist } from '../context/skills.js';
import { getSpecialist } from './specialists/index.js';
import { SCOUT_PROMPT } from './prompts/scout.js';
import { ARCHITECT_PROMPT } from './prompts/architect.js';
import { BUILDER_PROMPT } from './prompts/builder.js';
import { REVIEWER_PROMPT } from './prompts/reviewer.js';
import { parseArchitectResponse } from './architect.js';
import { classifyTaskHeuristically, parseScoutResponse } from './scout.js';
import { parseReviewerResponseFull } from './reviewer.js';
import { selectAgentModel, getModelOptions } from './model-selector.js';
import { inferBuilderTaskIntent, type BuilderTaskIntent } from './task-intent.js';
import { runDeepLoop } from './deep-loop.js';
import type { AgentInput, ArchitectOutput, ReviewerOutput, ScoutOutput, TaskComplexity } from './types.js';
import type { Hotspot, SearchResult } from '../context/search.js';
import type { SpecialistType } from './specialists/types.js';
import type { AgentLoopChunk } from '../agent/loop.js';
import type { AgentMode } from '../agent/tools.js';
import type { ModelId } from '../providers/types.js';
import type { WorkerTaskReporter } from './runtime.js';

interface SharedWorkerOptions {
  cwd: string;
  signal?: AbortSignal;
  reporter?: WorkerTaskReporter;
  mode?: AgentMode;
  onApprovalNeeded?: RunAgentOptions['onApprovalNeeded'];
  onDiffProposed?: RunAgentOptions['onDiffProposed'];
  onIterationApprovalNeeded?: RunAgentOptions['onIterationApprovalNeeded'];
}

export interface BuilderWorkerResult {
  response: string;
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
}

interface ScoutWorkerDecision {
  complexity: TaskComplexity;
  relevantKeywords: string[];
  candidateFiles: string[];
  reasoning?: string;
}

export async function runScoutWorkerAgent(args: {
  input: AgentInput;
} & SharedWorkerOptions): Promise<ScoutOutput> {
  const { input, cwd, signal, reporter } = args;
  const model = selectAgentModel('scout', 'simple');
  const startTime = Date.now();
  const sessionMemory = await loadSessionMemory(cwd).catch(() => null);
  const sessionSnapshot = sessionMemory?.snapshot ?? await loadSessionMemorySnapshot(cwd).catch(() => null);

  await reporter?.progress('classifying task');

  let decision: ScoutWorkerDecision;
  let responseText = '';
  let metrics = {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    duration: 0,
  };

  const heuristicComplexity = classifyTaskHeuristically(input.task);
  if (heuristicComplexity) {
    const relevantKeywords = extractKeywords(input.task);
    decision = {
      complexity: heuristicComplexity,
      relevantKeywords,
      candidateFiles: [],
      reasoning: 'heuristic classification',
    };
    responseText = JSON.stringify(decision, null, 2);
    // Internal: don't surface mechanism details to user
  } else {
    const systemPrompt = await buildScoutWorkerSystemPrompt(cwd, sessionMemory);
    const scoutPrompt = buildScoutTaskPrompt(input.task, input.history);

    const session = await runAgentSession(scoutPrompt, {
      cwd,
      model,
      signal,
      mode: args.mode,
      toolNames: getAllowedToolNamesForRole('scout'),
      systemPrompt,
      maxIterations: 12,
      providerOptions: getModelOptions('scout', 'simple'),
      onApprovalNeeded: wrapApprovalCallback('scout', reporter, args.onApprovalNeeded),
      onDiffProposed: wrapDiffApprovalCallback('scout', reporter, args.onDiffProposed),
      onIterationApprovalNeeded: wrapIterationApprovalCallback('scout', reporter, args.onIterationApprovalNeeded),
      onChunk: (chunk) => handleWorkerChunk(chunk, reporter),
    });

    if (session.stoppedReason === 'error') {
      throw new Error(session.error ?? 'Scout agent failed');
    }

    responseText = session.output;
    decision = parseScoutWorkerResponse(session.output, input.task);
    metrics = {
      model: session.model,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      cost: session.cost,
      duration: session.duration,
    };
  }

  await reporter?.progress('searching relevant files');

  let relevantFiles: SearchResult[] = [];
  if (decision.complexity !== 'trivial') {
    try {
      let index = await loadIndex(cwd);
      if (!index || index.totalFiles === 0) {
        await reporter?.log('indexing project');
        index = await indexProject(cwd);
      }
      if (index && index.totalFiles > 0) {
        const maxFiles = getScoutMaxFiles(decision.complexity);
        const useMemory = isReferentialTask(input.task);
        const searchQuery = buildScoutSearchQuery(
          input.task,
          decision.relevantKeywords,
          input.history,
          useMemory && sessionSnapshot ? formatSessionMemorySummary(sessionSnapshot) : undefined,
        );
        relevantFiles = await searchRelevantFiles(cwd, searchQuery, index, {
          maxFiles,
          alwaysInclude: useMemory
            ? uniqueStrings([...decision.candidateFiles, ...getSessionMemoryCandidateFiles(sessionSnapshot)])
            : decision.candidateFiles,
        });
      }
    } catch {
      // Ignore index/search failures and fall back below.
    }

    if (relevantFiles.length === 0) {
      try {
        const { gatherRelevantFilesFallback } = await import('../pipeline/fallback-search.js');
        relevantFiles = await gatherRelevantFilesFallback(cwd, input.task);
      } catch {
        // Proceed without files.
      }
    }
  }

  const { extractHotspots } = await import('../context/search.js');
  const scoutHotspots = extractHotspots(relevantFiles, input.task);
  const fileSummary = relevantFiles.length > 0
    ? `${relevantFiles.length} files: ${relevantFiles.map((file) => file.path).join(', ')}`
    : 'no files found';

  return {
    result: responseText || `complexity=${decision.complexity}, ${fileSummary}`,
    complexity: decision.complexity,
    relevantFiles,
    hotspots: scoutHotspots,
    fileSummary,
    model: metrics.model,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    cost: metrics.cost,
    duration: metrics.duration || (Date.now() - startTime),
  };
}

export async function runArchitectWorkerAgent(args: {
  input: AgentInput;
  complexity: TaskComplexity;
  searchResults: SearchResult[];
  hotspots?: Hotspot[];
} & SharedWorkerOptions): Promise<ArchitectOutput> {
  const { input, complexity, searchResults, hotspots = [], cwd, signal, reporter } = args;
  const model = selectAgentModel('architect', complexity);
  const sessionMemory = await loadSessionMemory(cwd).catch(() => null);
  const systemPrompt = await buildArchitectWorkerSystemPrompt(cwd, sessionMemory);
  const taskPrompt = buildArchitectTaskPrompt(input.task, searchResults, model, input.history, hotspots);

  await reporter?.progress('planning implementation');

  const session = await runAgentSession(taskPrompt, {
    cwd,
    model,
    signal,
    mode: args.mode,
    toolNames: getAllowedToolNamesForRole('architect'),
    systemPrompt,
    maxIterations: 20,
    maxTokens: 16384,
    providerOptions: getModelOptions('architect', complexity),
    onApprovalNeeded: wrapApprovalCallback('architect', reporter, args.onApprovalNeeded),
    onDiffProposed: wrapDiffApprovalCallback('architect', reporter, args.onDiffProposed),
    onIterationApprovalNeeded: wrapIterationApprovalCallback('architect', reporter, args.onIterationApprovalNeeded),
    onChunk: (chunk) => handleWorkerChunk(chunk, reporter),
  });

  if (session.stoppedReason === 'error') {
    throw new Error(session.error ?? 'Architect agent failed');
  }

  const parsed = parseArchitectResponse(session.output);

  return {
    result: session.output,
    type: parsed.type,
    plan: parsed.plan,
    subtasks: parsed.subtasks,
    model: session.model,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cost: session.cost,
    duration: session.duration,
  };
}

export async function runBuilderWorkerAgent(args: {
  input: AgentInput;
  complexity: TaskComplexity;
  plan?: string;
  searchResults: SearchResult[];
  specialist?: SpecialistType;
  scopeDirectory?: string;
  entryFiles?: string[];
  researchSummary?: string;
  builderBrief?: string;
  writeTargets?: string[];
  gateMode?: string;
} & SharedWorkerOptions): Promise<BuilderWorkerResult> {
  const {
    input,
    complexity,
    plan,
    searchResults,
    specialist,
    scopeDirectory,
    entryFiles,
    researchSummary,
    builderBrief,
    writeTargets,
    gateMode,
    cwd,
    signal,
    reporter,
  } = args;
  const model = selectAgentModel('builder', complexity, gateMode);

  // Deep loop only for moderate+ tasks WITHOUT an architect plan.
  // Simple tasks with a plan → just execute it directly, no extra explore/plan cycle.
  const hasPlan = !!(args.plan || args.researchSummary);
  const useDeepLoop = complexity !== 'trivial' && complexity !== 'simple' && !hasPlan;

  if (useDeepLoop) {
    await reporter?.log('analyzing code');
    const result = await runDeepLoop({
      task: input.task,
      cwd,
      complexity,
      specialist,
      signal,
      reporter,
      mode: args.mode,
      history: input.history,
    });

    await reporter?.log(
      `done · ${result.phases.implement.attempts} attempt${result.phases.implement.attempts > 1 ? 's' : ''} · ` +
      `${result.phases.verify.passed ? 'verified' : 'needs review'} · ` +
      `${(result.duration / 1000).toFixed(1)}s · $${result.cost.toFixed(4)}`,
    );

    return {
      response: result.response,
      model: result.model as import('../providers/types.js').ModelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cost: result.cost,
      duration: result.duration,
    };
  }

  const intent = inferBuilderTaskIntent(input.task);

  // ── Surface specialist + skills selection to TUI ──
    // Internal: don't surface mechanism details to user
  if (specialist) {
    try {
      const skills = loadSkills(cwd);
      const matched = getSkillsForSpecialist(skills, specialist);
      if (matched.length > 0) {
        // Internal: skills loaded, don't surface to user
      } else {
        // Internal: no skills found, don't surface to user
      }
    } catch {
      // Skills discovery is best-effort.
    }
  }

  const sessionMemory = await loadSessionMemory(cwd).catch(() => null);
  const systemPrompt = await buildBuilderWorkerSystemPrompt({
    cwd,
    searchResults,
    specialist,
    model,
    intent,
    scopeDirectory,
    entryFiles,
    researchSummary,
    builderBrief,
    sessionMemoryBlock: sessionMemory ? formatSessionMemoryForPrompt(sessionMemory) : undefined,
  });

  const taskPrompt = buildBuilderTaskPrompt({
    task: input.task,
    plan,
    searchResults,
    intent,
    cwd,
    history: input.history,
    scopeDirectory,
    entryFiles,
    researchSummary,
    builderBrief,
    writeTargets,
  });
  const session = await runAgentSession(taskPrompt, {
    cwd,
    model,
    signal,
    mode: args.mode,
    toolNames: getBuilderToolNames(intent),
    systemPrompt,
    maxIterations: 50,
    maxTokens: 16384,
    providerOptions: getModelOptions('builder', complexity),
    onApprovalNeeded: wrapApprovalCallback('builder', reporter, args.onApprovalNeeded),
    onDiffProposed: wrapDiffApprovalCallback('builder', reporter, args.onDiffProposed),
    onIterationApprovalNeeded: wrapIterationApprovalCallback('builder', reporter, args.onIterationApprovalNeeded),
    onChunk: (chunk) => handleWorkerChunk(chunk, reporter),
  });

  if (session.stoppedReason === 'error') {
    throw new Error(session.error ?? 'Builder agent failed');
  }

  return {
    response: session.output,
    model: session.model,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cost: session.cost,
    duration: session.duration,
  };
}

export async function runReviewerWorkerAgent(args: {
  input: AgentInput;
  complexity: TaskComplexity;
  allDiffs: string;
  subtaskIds?: string[];
  writeTargets?: string[];
} & SharedWorkerOptions): Promise<ReviewerOutput> {
  const { input, complexity, allDiffs, subtaskIds = [], writeTargets = [], cwd, signal, reporter } = args;
  const model = selectAgentModel('reviewer', complexity);
  const systemPrompt = await buildReviewerWorkerSystemPrompt(cwd);
  const reviewTask = buildReviewerTaskPrompt(input.task, allDiffs, subtaskIds, writeTargets);

  const session = await runAgentSession(reviewTask, {
    cwd,
    model,
    signal,
    mode: args.mode,
    toolNames: getAllowedToolNamesForRole('reviewer'),
    systemPrompt,
    maxIterations: 25,
    maxTokens: 16384,
    providerOptions: getModelOptions('reviewer', complexity),
    onApprovalNeeded: wrapApprovalCallback('reviewer', reporter, args.onApprovalNeeded),
    onDiffProposed: wrapDiffApprovalCallback('reviewer', reporter, args.onDiffProposed),
    onIterationApprovalNeeded: wrapIterationApprovalCallback('reviewer', reporter, args.onIterationApprovalNeeded),
    onChunk: (chunk) => handleWorkerChunk(chunk, reporter),
  });

  if (session.stoppedReason === 'error') {
    throw new Error(session.error ?? 'Reviewer agent failed');
  }

  const parsed = parseReviewerResponseFull(session.output);
  const inputTokens = Math.ceil(reviewTask.length / 4);
  const outputTokens = Math.ceil(session.output.length / 4);

  return {
    result: session.output,
    approved: parsed.approved,
    feedback: parsed.feedback,
    subtaskFeedback: parsed.subtaskFeedback,
    model: session.model,
    inputTokens: session.inputTokens || inputTokens,
    outputTokens: session.outputTokens || outputTokens,
    cost: session.cost,
    duration: session.duration,
  };
}

async function buildBuilderWorkerSystemPrompt(args: {
  cwd: string;
  searchResults: SearchResult[];
  specialist?: SpecialistType;
  model: ModelId;
  intent: BuilderTaskIntent;
  scopeDirectory?: string;
  entryFiles?: string[];
  researchSummary?: string;
  builderBrief?: string;
  sessionMemoryBlock?: string;
}): Promise<string> {
  const scopeDirectories = deriveScopeDirectories(args.searchResults);
  const isAnalysis = args.intent === 'analysis';

  // ── 1. Identity: WHO I AM ──────────────────────────────────────────────────
  const parts: string[] = [
    isAnalysis
      ? 'You are a scoped Mint ANALYSIS worker running inside the multi-agent pipeline.'
      : 'You are a scoped Mint BUILDER worker running inside the multi-agent pipeline.',
  ];

  // ── 2. Specialist persona (FIRST — establishes domain expertise) ───────────
  if (args.specialist) {
    parts.push(getSpecialist(args.specialist).systemPrompt);
  }

  // ── 3. Project skills/conventions (SECOND — defines how to apply expertise) ─
  if (args.specialist) {
    try {
      const skills = loadSkills(args.cwd);
      const matching = getSkillsForSpecialist(skills, args.specialist);
      if (matching.length > 0) {
        parts.push(
          `<skills>\n${matching.map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`).join('\n\n')}\n</skills>`,
        );
      }
    } catch {
      // Ignore skill loading errors.
    }
  }

  // ── 4. Output format + behavioral instructions ────────────────────────────
  parts.push(BUILDER_PROMPT);
  parts.push(
    'IMPORTANT: Before writing ANY code, use read_file to read the target files first. Understand what exists before changing it.',
    isAnalysis
      ? 'Use read/search tools to inspect the assigned scope and nearby dependencies. Do not modify files.'
      : 'Use tools to inspect the assigned scope, discover nearby dependencies, and edit only when required.',
    'Start by checking the most relevant directory or file cluster before broad exploration.',
    'Stay within the assigned scope unless you discover a hard dependency.',
    isAnalysis
      ? 'Finish with concise findings, concrete improvement suggestions, and the files you inspected. Do not output diffs.'
      : 'Always finish with a brief explanation followed by unified diff blocks.',
    'Treat the architect handoff as the authoritative starting point. Do not spend time rediscovering the whole repository unless the handoff is clearly incomplete.',
    `Repository root: ${args.cwd}`,
  );

  // ── 5. Architect handoff (WHERE to start + WHAT to do) ────────────────────
  if (args.scopeDirectory || (args.entryFiles && args.entryFiles.length > 0) || args.researchSummary || args.builderBrief) {
    parts.push([
      '<architect_handoff>',
      args.scopeDirectory ? `Start directory: ${args.scopeDirectory}` : undefined,
      args.entryFiles && args.entryFiles.length > 0 ? `Read first:\n${args.entryFiles.join('\n')}` : undefined,
      args.researchSummary ? `Research summary:\n${args.researchSummary}` : undefined,
      args.builderBrief ? `Tutorial:\n${args.builderBrief}` : undefined,
      '</architect_handoff>',
    ].filter(Boolean).join('\n'));
  }

  if (args.sessionMemoryBlock) {
    parts.push(`${args.sessionMemoryBlock}\nUse this only to resolve continuation, rollback, or referential requests.`);
  }

  // ── 6. Scope hints ────────────────────────────────────────────────────────
  if (scopeDirectories.length > 0) {
    parts.push(`<scope_hints>\nPrimary directories:\n${scopeDirectories.join('\n')}\n</scope_hints>`);
  }

  // ── 7. Project tree (WHERE everything lives) ──────────────────────────────
  try {
    const tree = await buildProjectTree(args.cwd);
    parts.push(`<project_tree>\n${tree}\n</project_tree>`);
  } catch {
    // Ignore tree failures.
  }

  // ── 8. Project rules (MINT.md conventions) ────────────────────────────────
  try {
    const rules = await loadProjectRules(args.cwd);
    if (rules) {
      parts.push(formatProjectRulesForPrompt(rules));
    }
  } catch {
    // Ignore missing rules.
  }

  // ── 9. Assigned file context (WHAT files to work with) ────────────────────
  const compressed = compressContext(
    args.searchResults.map((file) => ({
      path: file.path,
      content: file.content,
      language: file.language,
    })),
    getTier(args.model),
  ).files;
  const fileBlocks: string[] = [];
  let budget = 8000;
  for (const file of compressed) {
    const block = `<file path="${file.path}">\n${file.content}\n</file>`;
    const tokens = estimateTokens(block);
    if (tokens > budget) break;
    budget -= tokens;
    fileBlocks.push(block);
  }
  if (fileBlocks.length > 0) {
    parts.push(`<assigned_context files="${fileBlocks.length}">\n${fileBlocks.join('\n\n')}\n</assigned_context>`);
  }

  return parts.join('\n\n');
}

async function buildScoutWorkerSystemPrompt(
  cwd: string,
  sessionMemory?: Awaited<ReturnType<typeof loadSessionMemory>> | null,
): Promise<string> {
  const parts: string[] = [
    'You are a scoped Mint SCOUT worker.',
    'Your job is to classify task complexity and identify likely relevant files.',
    'Use only read/search tools when needed. Return JSON only.',
    `${SCOUT_PROMPT}

Additional output fields:
- include "candidateFiles": an array of repo-relative file paths that are likely relevant
- include "relevantKeywords": an array of useful search keywords
- keep candidateFiles to at most 8 entries`,
  ];

  try {
    const rules = await loadProjectRules(cwd);
    if (rules) {
      parts.push(formatProjectRulesForPrompt(rules));
    }
  } catch {
    // Ignore missing rules.
  }

  if (sessionMemory) {
    parts.push(`${formatSessionMemoryForPrompt(sessionMemory)}\nUse this only to resolve references to earlier work.`);
  }

  return parts.join('\n\n');
}

async function buildArchitectWorkerSystemPrompt(
  cwd: string,
  sessionMemory?: Awaited<ReturnType<typeof loadSessionMemory>> | null,
): Promise<string> {
  const parts: string[] = [
    'You are a scoped Mint ARCHITECT worker.',
    'Plan the implementation, split into subtasks when domains differ, and return JSON only.',
    'Use read/search/web tools if the provided context is insufficient.',
    `Repository root: ${cwd}`,
    ARCHITECT_PROMPT,
  ];

  try {
    const tree = await buildProjectTree(cwd);
    parts.push(`<project_tree>\n${tree}\n</project_tree>`);
  } catch {
    // Ignore tree failures.
  }

  try {
    const rules = await loadProjectRules(cwd);
    if (rules) {
      parts.push(formatProjectRulesForPrompt(rules));
    }
  } catch {
    // Ignore missing rules.
  }

  // Inject ALL project skills so architect knows conventions when planning
  try {
    const skills = loadSkills(cwd);
    if (skills.length > 0) {
      parts.push(
        `<skills>\n${skills.slice(0, 6).map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`).join('\n\n')}\n</skills>`,
      );
    }
  } catch {
    // Ignore skill loading errors.
  }

  if (sessionMemory) {
    parts.push(`${formatSessionMemoryForPrompt(sessionMemory)}\nUse this only to resolve continuation, revert, or pronoun-based follow-ups.`);
  }

  return parts.join('\n\n');
}

async function buildReviewerWorkerSystemPrompt(cwd: string): Promise<string> {
  const parts: string[] = [
    'You are a scoped Mint REVIEWER worker.',
    'Use the available tools to inspect diffs, read files, and run focused verification.',
    'Never modify files. Report only JSON matching the REVIEWER contract.',
    REVIEWER_PROMPT,
  ];

  try {
    const rules = await loadProjectRules(cwd);
    if (rules) {
      parts.push(formatProjectRulesForPrompt(rules));
    }
  } catch {
    // Ignore missing rules.
  }

  return parts.join('\n\n');
}

function buildBuilderTaskPrompt(args: {
  task: string;
  plan: string | undefined;
  searchResults: SearchResult[];
  intent: BuilderTaskIntent;
  cwd: string;
  history?: AgentInput['history'];
  scopeDirectory?: string;
  entryFiles?: string[];
  researchSummary?: string;
  builderBrief?: string;
  writeTargets?: string[];
}): string {
  const files = args.searchResults.map((file) => file.path);
  return [
    `Task: ${args.task}`,
    `Repository root: ${args.cwd}`,
    formatRecentHistoryBlock(args.history),
    args.scopeDirectory ? `Assigned start directory: ${args.scopeDirectory}` : undefined,
    args.entryFiles && args.entryFiles.length > 0 ? `Read these files first:\n${args.entryFiles.join('\n')}` : undefined,
    args.researchSummary ? `Architect research:\n${args.researchSummary}` : undefined,
    args.builderBrief ? `Architect tutorial:\n${args.builderBrief}` : undefined,
    args.plan ? `Implementation plan:\n${args.plan}` : undefined,
    files.length > 0 ? `Context files (read-only reference):\n${files.join('\n')}` : undefined,
    args.writeTargets && args.writeTargets.length > 0
      ? `Files to create or modify (authoritative — includes new files):\n${args.writeTargets.join('\n')}`
      : undefined,
    args.intent === 'analysis'
      ? 'Inspect the assigned scope and nearby files if needed. Do not modify the project. Return findings, improvement ideas, and the specific files/directories you inspected.'
      : 'Begin in the assigned start directory and entry files. Treat the architect tutorial as your starting map before broad exploration. Use your tools to inspect and edit the project. Return the final proposed changes as unified diffs.',
  ].filter(Boolean).join('\n\n');
}

function buildScoutTaskPrompt(task: string, history?: AgentInput['history']): string {
  return [
    `Task: ${task}`,
    formatRecentHistoryBlock(history),
    'Inspect the repository only as needed and return JSON with complexity, reasoning, candidateFiles, and relevantKeywords.',
  ].join('\n\n');
}

function buildArchitectTaskPrompt(
  task: string,
  searchResults: SearchResult[],
  model: ModelId,
  history?: AgentInput['history'],
  hotspots: Hotspot[] = [],
): string {
  const compressed = compressContext(
    searchResults.map((file) => ({
      path: file.path,
      content: file.content,
      language: file.language,
    })),
    getTier(model),
  ).files;

  let fileContext = '';
  let tokenBudget = 7000;
  for (const file of compressed) {
    const block = `<file path="${file.path}">\n${file.content}\n</file>\n`;
    const tokens = estimateTokens(block);
    if (tokens > tokenBudget) break;
    fileContext += block;
    tokenBudget -= tokens;
  }

  const hotspotsBlock = hotspots.length > 0
    ? `Hotspots (most relevant lines — reference these line numbers in your plan):\n${hotspots.map((h) => `  ${h.file}:${h.line} — ${h.content.trim()}`).join('\n')}`
    : undefined;

  return [
    `Task: ${task}`,
    formatRecentHistoryBlock(history),
    fileContext ? `Relevant files:\n${fileContext}` : undefined,
    hotspotsBlock,
    'Return JSON only.',
  ].filter(Boolean).join('\n\n');
}

function buildReviewerTaskPrompt(
  task: string,
  allDiffs: string,
  subtaskIds: string[],
  writeTargets: string[],
): string {
  const diffsSlice = allDiffs.slice(0, 12000);
  return [
    `Original task: ${task}`,
    writeTargets.length > 0
      ? `Files written/modified by the builder:\n${writeTargets.map((f) => `  - ${f}`).join('\n')}\nIMPORTANT: Use these exact paths when reading files. Do NOT guess file locations.`
      : undefined,
    `Current proposed changes:\n${diffsSlice}`,
    subtaskIds.length > 0 ? `Subtask IDs: ${subtaskIds.join(', ')}` : undefined,
    'Inspect the changes with your tools if needed, then return JSON only.',
  ].filter(Boolean).join('\n\n');
}

async function handleWorkerChunk(
  chunk: AgentLoopChunk,
  reporter?: WorkerTaskReporter,
): Promise<void> {
  if (!reporter) return;

  switch (chunk.type) {
    case 'tool_call':
      await reporter.progress(describeToolActivity(chunk.toolName ?? 'tool', chunk.toolInput));
      await reporter.log(describeToolLog(chunk.toolName ?? 'tool', chunk.toolInput));
      return;
    case 'tool_result':
      if (chunk.results) {
        for (const result of chunk.results) {
          await reporter.log(summarizeToolResult(result.toolName, result.content));
        }
      }
      return;
    case 'text': {
      return;
    }
    case 'error':
      await reporter.log(`[error] ${chunk.error ?? 'unknown error'}`);
      return;
    default:
      return;
  }
}

function wrapApprovalCallback(
  role: 'scout' | 'architect' | 'builder' | 'reviewer',
  reporter: WorkerTaskReporter | undefined,
  callback: RunAgentOptions['onApprovalNeeded'],
): RunAgentOptions['onApprovalNeeded'] | undefined {
  if (!callback) return undefined;
  return async (toolName, toolInput) => {
    await reporter?.setStatus('waiting_approval', `${role} waiting for approval on ${toolName}`);
    const approved = await callback(toolName, toolInput);
    await reporter?.setStatus('running', approved ? `${toolName} approved` : `${toolName} rejected`);
    return approved;
  };
}

function wrapDiffApprovalCallback(
  role: 'scout' | 'architect' | 'builder' | 'reviewer',
  reporter: WorkerTaskReporter | undefined,
  callback: RunAgentOptions['onDiffProposed'],
): RunAgentOptions['onDiffProposed'] | undefined {
  if (!callback) return undefined;
  return async (path, diff) => {
    await reporter?.setStatus('waiting_approval', `${role} waiting for diff approval on ${path}`);
    const approved = await callback(path, diff);
    await reporter?.setStatus('running', approved ? `${path} approved` : `${path} rejected`);
    return approved;
  };
}

function wrapIterationApprovalCallback(
  role: 'scout' | 'architect' | 'builder' | 'reviewer',
  reporter: WorkerTaskReporter | undefined,
  callback: RunAgentOptions['onIterationApprovalNeeded'],
): RunAgentOptions['onIterationApprovalNeeded'] | undefined {
  if (!callback) return undefined;
  return async (iteration, toolCalls) => {
    await reporter?.setStatus('waiting_approval', `${role} waiting for approval on iteration ${iteration}`);
    const approved = await callback(iteration, toolCalls);
    await reporter?.setStatus('running', approved ? `iteration ${iteration} approved` : `iteration ${iteration} rejected`);
    return approved;
  };
}

function formatPreview(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const json = JSON.stringify(input);
  return json.length > 0 ? ` ${json.slice(0, 140)}` : '';
}

function describeToolActivity(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
  const path = typeof input?.path === 'string' ? input.path : undefined;
  const file = typeof input?.file === 'string' ? input.file : undefined;
  const directory = typeof input?.directory === 'string' ? input.directory : undefined;
  const query = typeof input?.query === 'string' ? input.query : undefined;
  const pattern = typeof input?.pattern === 'string' ? input.pattern : undefined;
  const url = typeof input?.url === 'string' ? input.url : undefined;
  const command = typeof input?.command === 'string' ? input.command : undefined;

  switch (toolName) {
    case 'read_file':
      return `reading ${path ?? 'file'}`;
    case 'write_file':
      return `writing ${path ?? 'file'}`;
    case 'edit_file':
      return `editing ${path ?? 'file'}`;
    case 'search_replace':
      return `patching ${path ?? 'file'}`;
    case 'grep_files':
      return `searching ${query ?? pattern ?? 'codebase'}${path ? ` in ${path}` : ''}`;
    case 'find_files':
      return `finding files${pattern ? ` matching ${pattern}` : ''}${path ? ` in ${path}` : ''}`;
    case 'list_dir':
      return `listing ${path ?? directory ?? 'directory'}`;
    case 'git_diff':
      return file ? `checking diff for ${file}` : 'checking git diff';
    case 'run_tests':
      return command ? `running ${summarizeCommand(command)}` : 'running tests';
    case 'web_fetch':
      return `fetching ${summarizeUrl(url)}`;
    case 'bash':
      return `running ${summarizeCommand(command)}`;
    default:
      return `using ${toolName}`;
  }
}

function describeToolLog(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
  const activity = describeToolActivity(toolName, input);
  const preview = formatPreview(input);
  return preview ? `${activity}${preview}` : activity;
}

function summarizeToolResult(toolName: string, content: string): string {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return `${toolName} completed`;
  }

  const preview = cleaned.slice(0, 180);
  switch (toolName) {
    case 'grep_files':
      return `search results: ${preview}`;
    case 'find_files':
    case 'list_dir':
      return `found: ${preview}`;
    case 'read_file':
      return `read: ${preview}`;
    case 'git_diff':
      return `diff: ${preview}`;
    case 'run_tests':
      return `tests: ${preview}`;
    case 'bash':
      return `command output: ${preview}`;
    default:
      return `${toolName}: ${preview}`;
  }
}

function summarizeCommand(command: string | undefined): string {
  if (!command || command.trim().length === 0) return 'command';
  const normalized = command.replace(/\s+/g, ' ').trim();
  const truncated = normalized.slice(0, 72);
  return truncated.length < normalized.length ? `${truncated}...` : truncated;
}

function summarizeUrl(url: string | undefined): string {
  if (!url) return 'URL';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

function getBuilderToolNames(intent: BuilderTaskIntent): string[] {
  if (intent === 'analysis') {
    return ['read_file', 'grep_files', 'find_files', 'list_dir', 'git_diff', 'web_fetch'];
  }

  return getAllowedToolNamesForRole('builder');
}

const TREE_IGNORE = new Set([
  '.git', 'node_modules', 'dist', 'coverage', '.next', '__pycache__', '.DS_Store', '.turbo',
]);

async function buildProjectTree(cwd: string, maxDepth = 3, maxLines = 80): Promise<string> {
  const lines: string[] = ['./'];

  async function walk(dir: string, depth: number, prefix: string): Promise<void> {
    if (lines.length >= maxLines || depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const filtered = entries
      .filter((e) => !TREE_IGNORE.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    for (let i = 0; i < filtered.length; i++) {
      if (lines.length >= maxLines) {
        lines.push(`${prefix}...`);
        return;
      }
      const entry = filtered[i];
      const isLast = i === filtered.length - 1;
      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), depth + 1, prefix + (isLast ? '    ' : '│   '));
      }
    }
  }

  await walk(cwd, 1, '');
  return lines.join('\n');
}

function deriveScopeDirectories(searchResults: SearchResult[]): string[] {
  const seen = new Set<string>();
  const directories: string[] = [];

  for (const result of searchResults) {
    const parts = result.path.split('/');
    if (parts.length <= 1) continue;
    const directory = parts.slice(0, -1).join('/');
    if (seen.has(directory)) continue;
    seen.add(directory);
    directories.push(directory);
    if (directories.length >= 4) break;
  }

  return directories;
}

function parseScoutWorkerResponse(text: string, task: string): ScoutWorkerDecision {
  const fallback = parseScoutResponse(text);
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const relevantKeywords = Array.isArray(parsed.relevantKeywords)
        ? parsed.relevantKeywords.map(String).filter(Boolean)
        : Array.isArray(parsed.relevant_keywords)
          ? parsed.relevant_keywords.map(String).filter(Boolean)
          : extractKeywords(task);
      const candidateFiles = Array.isArray(parsed.candidateFiles)
        ? parsed.candidateFiles.map(String).filter(Boolean)
        : Array.isArray(parsed.candidate_files)
          ? parsed.candidate_files.map(String).filter(Boolean)
          : [];
      return {
        complexity: fallback.complexity,
        relevantKeywords,
        candidateFiles,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
      };
    }
  } catch {
    // Fall through to keyword fallback.
  }

  return {
    complexity: fallback.complexity,
    relevantKeywords: extractKeywords(task),
    candidateFiles: [],
  };
}

function buildScoutSearchQuery(
  task: string,
  relevantKeywords: string[],
  history?: AgentInput['history'],
  memorySummary?: string,
): string {
  const parts: string[] = [task];
  const historySummary = summarizeRecentHistory(history);
  if (historySummary) {
    parts.push(`Recent conversation:\n${historySummary}`);
  }
  if (memorySummary) {
    parts.push(`Session memory:\n${memorySummary}`);
  }
  if (relevantKeywords.length > 0) {
    parts.push(`Keywords: ${relevantKeywords.join(' ')}`);
  }
  return parts.join('\n\n');
}

function formatRecentHistoryBlock(history?: AgentInput['history']): string | undefined {
  const summary = summarizeRecentHistory(history);
  return summary ? `Recent conversation context:\n${summary}` : undefined;
}

function summarizeRecentHistory(history?: AgentInput['history']): string | undefined {
  if (!history || history.length === 0) return undefined;

  const recent = history
    .slice(-4)
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content.trim()}`)
    .filter((line) => line.length > 0);

  return recent.length > 0 ? recent.join('\n') : undefined;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function getScoutMaxFiles(complexity: TaskComplexity): number {
  if (complexity === 'complex') return 20;
  if (complexity === 'moderate') return 14;
  return 8;
}
