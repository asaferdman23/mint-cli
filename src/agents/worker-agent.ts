import { runAgentSession, type RunAgentOptions } from '../agent/index.js';
import { getAllowedToolNamesForRole } from '../tools/index.js';
import { compressContext } from '../context/compress.js';
import { estimateTokens } from '../context/budget.js';
import { getTier } from '../providers/tiers.js';
import { loadIndex, indexProject, searchRelevantFiles, extractKeywords } from '../context/index.js';
import { loadProjectRules, formatProjectRulesForPrompt } from '../context/project-rules.js';
import { loadSkills, getSkillsForSpecialist } from '../context/skills.js';
import { getSpecialist } from './specialists/index.js';
import { SCOUT_PROMPT } from './prompts/scout.js';
import { ARCHITECT_PROMPT } from './prompts/architect.js';
import { BUILDER_PROMPT } from './prompts/builder.js';
import { REVIEWER_PROMPT } from './prompts/reviewer.js';
import { parseArchitectResponse } from './architect.js';
import { classifyTaskHeuristically, parseScoutResponse } from './scout.js';
import { parseReviewerResponseFull } from './reviewer.js';
import { selectAgentModel } from './model-selector.js';
import type { AgentInput, ArchitectOutput, ReviewerOutput, ScoutOutput, TaskComplexity } from './types.js';
import type { SearchResult } from '../context/search.js';
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
    await reporter?.log(`[scout] heuristic complexity=${heuristicComplexity}`);
  } else {
    const systemPrompt = await buildScoutWorkerSystemPrompt(cwd);
    const scoutPrompt = buildScoutTaskPrompt(input.task);

    const session = await runAgentSession(scoutPrompt, {
      cwd,
      model,
      signal,
      mode: args.mode,
      toolNames: getAllowedToolNamesForRole('scout'),
      systemPrompt,
      maxIterations: 6,
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
        await reporter?.log('[scout] indexing project');
        index = await indexProject(cwd);
      }
      if (index && index.totalFiles > 0) {
        const maxFiles = getScoutMaxFiles(decision.complexity);
        const searchQuery = buildScoutSearchQuery(input.task, decision.relevantKeywords);
        relevantFiles = await searchRelevantFiles(cwd, searchQuery, index, {
          maxFiles,
          alwaysInclude: decision.candidateFiles,
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

  const fileSummary = relevantFiles.length > 0
    ? `${relevantFiles.length} files: ${relevantFiles.map((file) => file.path).join(', ')}`
    : 'no files found';

  return {
    result: responseText || `complexity=${decision.complexity}, ${fileSummary}`,
    complexity: decision.complexity,
    relevantFiles,
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
} & SharedWorkerOptions): Promise<ArchitectOutput> {
  const { input, complexity, searchResults, cwd, signal, reporter } = args;
  const model = selectAgentModel('architect', complexity);
  const systemPrompt = await buildArchitectWorkerSystemPrompt(cwd);
  const taskPrompt = buildArchitectTaskPrompt(input.task, searchResults, model);

  await reporter?.progress('planning implementation');

  const session = await runAgentSession(taskPrompt, {
    cwd,
    model,
    signal,
    mode: args.mode,
    toolNames: getAllowedToolNamesForRole('architect'),
    systemPrompt,
    maxIterations: 8,
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
} & SharedWorkerOptions): Promise<BuilderWorkerResult> {
  const { input, complexity, plan, searchResults, specialist, cwd, signal, reporter } = args;
  const model = selectAgentModel('builder', complexity);
  const systemPrompt = await buildBuilderWorkerSystemPrompt({
    cwd,
    searchResults,
    specialist,
    model,
  });

  const taskPrompt = buildBuilderTaskPrompt(input.task, plan, searchResults);
  const session = await runAgentSession(taskPrompt, {
    cwd,
    model,
    signal,
    mode: args.mode,
    toolNames: getAllowedToolNamesForRole('builder'),
    systemPrompt,
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
} & SharedWorkerOptions): Promise<ReviewerOutput> {
  const { input, complexity, allDiffs, subtaskIds = [], cwd, signal, reporter } = args;
  const model = selectAgentModel('reviewer', complexity);
  const systemPrompt = await buildReviewerWorkerSystemPrompt(cwd);
  const reviewTask = buildReviewerTaskPrompt(input.task, allDiffs, subtaskIds);

  const session = await runAgentSession(reviewTask, {
    cwd,
    model,
    signal,
    mode: args.mode,
    toolNames: getAllowedToolNamesForRole('reviewer'),
    systemPrompt,
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
}): Promise<string> {
  const parts: string[] = [
    'You are a scoped Mint BUILDER worker running inside the multi-agent pipeline.',
    'Use tools to inspect and edit the assigned files.',
    'Stay within the assigned scope unless you discover a hard dependency.',
    'Always finish with a brief explanation followed by unified diff blocks.',
    BUILDER_PROMPT,
  ];

  try {
    const rules = await loadProjectRules(args.cwd);
    if (rules) {
      parts.push(formatProjectRulesForPrompt(rules));
    }
  } catch {
    // Ignore missing rules.
  }

  if (args.specialist) {
    parts.push(getSpecialist(args.specialist).systemPrompt);
    try {
      const skills = loadSkills(args.cwd);
      const matching = getSkillsForSpecialist(skills, args.specialist);
      if (matching.length > 0) {
        parts.push(
          `<skills>\n${matching.map((skill) => `<skill name="${skill.name}">\n${skill.content}\n</skill>`).join('\n\n')}\n</skills>`,
        );
      }
    } catch {
      // Ignore skill loading errors.
    }
  }

  const compressed = compressContext(
    args.searchResults.map((file) => ({
      path: file.path,
      content: file.content,
      language: file.language,
    })),
    getTier(args.model),
  ).files;
  const fileBlocks: string[] = [];
  let budget = 5000;
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

async function buildScoutWorkerSystemPrompt(cwd: string): Promise<string> {
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

  return parts.join('\n\n');
}

async function buildArchitectWorkerSystemPrompt(cwd: string): Promise<string> {
  const parts: string[] = [
    'You are a scoped Mint ARCHITECT worker.',
    'Plan the implementation, split into subtasks when domains differ, and return JSON only.',
    'Use read/search/web tools if the provided context is insufficient.',
    ARCHITECT_PROMPT,
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

function buildBuilderTaskPrompt(
  task: string,
  plan: string | undefined,
  searchResults: SearchResult[],
): string {
  const files = searchResults.map((file) => file.path);
  return [
    `Task: ${task}`,
    plan ? `Implementation plan:\n${plan}` : undefined,
    files.length > 0 ? `Assigned files:\n${files.join('\n')}` : undefined,
    'Use your tools to inspect and edit the project. Return the final proposed changes as unified diffs.',
  ].filter(Boolean).join('\n\n');
}

function buildScoutTaskPrompt(task: string): string {
  return [
    `Task: ${task}`,
    'Inspect the repository only as needed and return JSON with complexity, reasoning, candidateFiles, and relevantKeywords.',
  ].join('\n\n');
}

function buildArchitectTaskPrompt(
  task: string,
  searchResults: SearchResult[],
  model: ModelId,
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
  let tokenBudget = 4000;
  for (const file of compressed) {
    const block = `<file path="${file.path}">\n${file.content}\n</file>\n`;
    const tokens = estimateTokens(block);
    if (tokens > tokenBudget) break;
    fileContext += block;
    tokenBudget -= tokens;
  }

  return fileContext
    ? `Task: ${task}\n\nRelevant files:\n${fileContext}\nReturn JSON only.`
    : `Task: ${task}\n\nReturn JSON only.`;
}

function buildReviewerTaskPrompt(
  task: string,
  allDiffs: string,
  subtaskIds: string[],
): string {
  const diffsSlice = allDiffs.slice(0, 12000);
  return [
    `Original task: ${task}`,
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
      await reporter.progress(`using ${chunk.toolName}`);
      await reporter.log(`[tool] ${chunk.toolName}${formatPreview(chunk.toolInput)}`);
      return;
    case 'tool_result':
      if (chunk.results) {
        for (const result of chunk.results) {
          const preview = result.content.replace(/\s+/g, ' ').slice(0, 180);
          await reporter.log(`[result] ${result.toolName}: ${preview}`);
        }
      }
      return;
    case 'text': {
      const summary = summarizeText(chunk.text);
      if (summary) {
        await reporter.progress(summary);
      }
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

function summarizeText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  return trimmed.slice(0, 120);
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

function buildScoutSearchQuery(task: string, relevantKeywords: string[]): string {
  if (relevantKeywords.length === 0) {
    return task;
  }
  return `${task}\n\nKeywords: ${relevantKeywords.join(' ')}`;
}

function getScoutMaxFiles(complexity: TaskComplexity): number {
  if (complexity === 'complex') return 12;
  if (complexity === 'moderate') return 8;
  return 5;
}
