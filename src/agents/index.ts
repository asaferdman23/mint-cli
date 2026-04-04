/**
 * Multi-agent pipeline orchestrator.
 *
 * Scout → Architect → Builder task graph → [Reviewer with retry]
 *
 * Trivial tasks:         Scout → Builder (skip architect + reviewer)
 * Simple/Moderate/Complex:
 *                        Scout → Architect → Builder task graph → Reviewer (with retry, max 2)
 *
 * Yields PipelineChunks for progressive TUI rendering.
 */
import { parseDiffs } from '../pipeline/diff-parser.js';
import { calculateOpusCost } from '../usage/tracker.js';
import { complete } from '../providers/index.js';
import { persistSessionMemory, type SessionMemorySnapshot } from '../context/session-memory.js';
import { detectSpecialist, detectSpecialistFromTask } from './specialists/index.js';
import { selectAgentModel } from './model-selector.js';
import { resolveAdaptiveGate, type AdaptiveGateDecision } from './adaptive-gate.js';
import { generateClarifyingQuestions } from './clarifier.js';
import {
  runArchitectWorkerAgent,
  runBuilderWorkerAgent,
  runReviewerWorkerAgent,
} from './worker-agent.js';
import {
  createInitialSubtasks,
  createOrchestrationRuntime,
  runTaskGraph,
  toSubtaskInfo,
  type WorkerTaskDefinition,
  type WorkerTaskState,
} from './runtime.js';
import type {
  AgentInput,
  ArchitectOutput,
  MultiAgentResult,
  ReviewerOutput,
  Subtask,
  SubtaskBuilderResult,
  TaskComplexity,
} from './types.js';
import type { PipelineChunk, PipelineOptions, PipelineResult, SubtaskInfo } from '../pipeline/types.js';

export type { MultiAgentResult };

/**
 * Run the full multi-agent pipeline as a streaming generator.
 */
export async function* runAgentPipeline(
  task: string,
  options: PipelineOptions,
): AsyncGenerator<PipelineChunk> {
  const { cwd, signal, history = [] } = options;
  const startTime = Date.now();

  let agentInput: AgentInput = { task, cwd, signal, history };
  const workerExecutionOptions = {
    mode: options.agentMode,
    onApprovalNeeded: options.onApprovalNeeded,
    onDiffProposed: options.onDiffProposed,
    onIterationApprovalNeeded: options.onIterationApprovalNeeded,
  };

  let gateDecision: AdaptiveGateDecision;
  let clarificationAttempts = 0;

  while (true) {
    gateDecision = await resolveAdaptiveGate({ input: agentInput });

    if (gateDecision.mode === 'chat') {
      const result = buildImmediateResult(
        gateDecision.response ?? 'Ready when you are.',
        [],
        startTime,
        options.model ?? selectAgentModel('scout', 'trivial'),
      );
      yield { type: 'text', text: result.response };
      yield { type: 'done', result };
      return;
    }

    if (gateDecision.mode === 'question') {
      const files = gateDecision.searchResults;
      const fileContext = files.length > 0
        ? files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n')
        : 'No relevant files found in this project.';
      const model = options.model ?? selectAgentModel('scout', 'simple');
      const llmResponse = await complete({
        model,
        messages: [
          {
            role: 'system',
            content: [
              'You are an assistant that answers questions about a codebase.',
              'Answer the user\'s question based on the file contents below.',
              'Be concise and direct. If the files don\'t contain the answer, say so.',
              '',
              fileContext,
            ].join('\n'),
          },
          { role: 'user', content: task },
        ],
        maxTokens: 1024,
        temperature: 0,
        signal,
      });
      const result: PipelineResult = {
        response: llmResponse.content,
        diffs: [],
        filesSearched: files.map((f) => f.path),
        model,
        cost: llmResponse.cost.total,
        inputTokens: llmResponse.usage.inputTokens,
        outputTokens: llmResponse.usage.outputTokens,
        duration: Date.now() - startTime,
        opusCost: 0,
      };
      yield { type: 'text', text: result.response };
      yield { type: 'done', result };
      return;
    }

    if (gateDecision.mode === 'spec_required') {
      const result = buildImmediateResult(
        gateDecision.response ?? 'Please provide a more concrete spec.',
        gateDecision.searchResults.map((file) => file.path),
        startTime,
        options.model ?? selectAgentModel('scout', 'simple'),
      );
      yield { type: 'text', text: result.response };
      yield { type: 'done', result };
      return;
    }

    if (gateDecision.mode === 'clarify') {
      const projectContext = gateDecision.searchResults.length > 0
        ? `Existing files: ${gateDecision.searchResults.map((f) => f.path).join(', ')}`
        : 'Empty project — no existing files.';
      const questions = await generateClarifyingQuestions(agentInput.task, signal, projectContext);

      // If clarifier says no questions needed → just proceed, don't show fallback questions
      if (questions.length === 0) {
        break;
      }

      if (options.onClarificationNeeded && clarificationAttempts < 2) {
        yield { type: 'clarification', questions };
        const answer = await options.onClarificationNeeded(questions);
        clarificationAttempts += 1;

        // User dismissed clarification — proceed with what we have
        if (!answer.trim() || isDismissal(answer)) {
          break;
        }

        agentInput = {
          ...agentInput,
          task: `${agentInput.task}\n\nUser clarifications:\n${answer.trim()}`,
        };
        continue;
      }

      // Clarification attempts exhausted — proceed anyway instead of stopping
      break;
    }

    break;
  }

  const runtime = await createOrchestrationRuntime(cwd, agentInput.task);
  const totals = {
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  const emit = async (chunk: PipelineChunk): Promise<PipelineChunk> => {
    await runtime.appendParentEvent({
      ...chunk,
      timestamp: new Date().toISOString(),
    });
    return chunk;
  };

  const complexity: TaskComplexity = gateDecision.complexity;
  const searchResults = gateDecision.searchResults;
  const hotspots = gateDecision.hotspots;

  yield await emit({
    type: 'phase-start',
    phase: 'SCOUT',
    phaseModel: gateDecision.scoutModelLabel,
  });
  yield await emit({
    type: 'phase-done',
    phase: 'SCOUT',
    phaseSummary: `${complexity} · ${gateDecision.scoutSummary || `${searchResults.length} files`}`,
  });
  yield await emit({ type: 'search', filesFound: searchResults.map((file) => file.path) });

  // ── ARCHITECT (always plan for non-trivial tasks — cheap models need precise instructions) ──
  let architectResult: ArchitectOutput | undefined;

  if (complexity !== 'trivial') {
    const architectTask = createArchitectTask({
      agentInput: { ...agentInput, searchResults },
      complexity,
      searchResults,
      hotspots,
      workerOptions: workerExecutionOptions,
    });

    yield await emit({
      type: 'phase-start',
      phase: 'ARCHITECT',
      phaseModel: selectAgentModel('architect', complexity),
      subtasks: createInitialSubtasks([architectTask]),
    });

    try {
      const architectStates = yield* runTaskGraph(runtime, [architectTask], { signal });
      throwOnFailedTasks(architectStates, 'architect');

      const architectState = architectStates[0];
      if (!architectState?.result) {
        throw new Error('Missing architect result');
      }

      architectResult = architectState.result.value;
      totals.cost += architectState.result.cost ?? 0;
      totals.inputTokens += architectState.result.inputTokens ?? 0;
      totals.outputTokens += architectState.result.outputTokens ?? 0;

      yield await emit({
        type: 'phase-done',
        phase: 'ARCHITECT',
        phaseDuration: architectState.duration,
        phaseCost: architectState.cost,
        phaseSummary: architectState.progressSummary ?? (architectResult.type === 'split'
          ? `split into ${architectResult.subtasks?.length ?? 0} tasks`
          : `plan ready (${architectResult.outputTokens} tokens)`),
        subtasks: architectStates.map((state) => toSubtaskInfo(state)),
      });
    } catch {
      yield await emit({ type: 'phase-done', phase: 'ARCHITECT', phaseSummary: 'skipped (error)' });
    }
  }

  // ── BUILDER(S) — single or task graph ─────────────────────────────────────
  let builderResults: SubtaskBuilderResult[];
  let allWriteTargets: string[] = [];

  if (
    architectResult?.type === 'split' &&
    architectResult.subtasks &&
    architectResult.subtasks.length > 1
  ) {
    const builderTasks = architectResult.subtasks.map((subtask) => createBuilderTask({
      agentInput,
      complexity,
      subtask,
      searchResults,
      attempt: 1,
      gateMode: gateDecision.mode,
      workerOptions: workerExecutionOptions,
    }));

    yield await emit({
      type: 'phase-start',
      phase: 'BUILDER',
      phaseModel: `${builderTasks.length} worker DAG`,
      subtasks: createInitialSubtasks(builderTasks),
    });

    const builderStates = yield* runTaskGraph(runtime, builderTasks, { signal });
    throwOnFailedTasks(builderStates, 'builder');

    builderResults = architectResult.subtasks.map((subtask) => {
      const state = builderStates.find((entry) => entry.id === subtask.id);
      if (!state?.result) {
        throw new Error(`Missing builder result for subtask ${subtask.id}`);
      }
      totals.cost += state.result.cost ?? 0;
      totals.inputTokens += state.result.inputTokens ?? 0;
      totals.outputTokens += state.result.outputTokens ?? 0;
      return state.result.value;
    });
    allWriteTargets = architectResult.subtasks.flatMap((s) => [
      ...(s.writeTargets ?? []),
      ...s.relevantFiles,
    ]);

    const combinedText = builderResults
      .map((result) => `**Subtask ${result.subtaskId}:**\n${result.response}`)
      .join('\n\n');
    yield await emit({ type: 'text', text: combinedText });

    yield await emit({
      type: 'phase-done',
      phase: 'BUILDER',
      phaseCost: sumTaskCost(builderStates),
      phaseSummary: `${builderResults.length} worker(s) complete`,
      subtasks: builderStates.map((task) => toSubtaskInfo(task)),
    });
  } else {
    const directBuilderSubtask = gateDecision.directSubtask ?? {
      id: '0',
      description: describeBuilderScope(
        searchResults.map((file) => file.path),
        'Work on the requested change',
      ),
      relevantFiles: searchResults.map((file) => file.path),
      plan: architectResult?.plan ?? '',
      specialist: resolveSpecialist(searchResults.map((file) => file.path), agentInput.task),
      scopeDirectory: deriveBuilderScopeDirectory(searchResults.map((file) => file.path)),
      entryFiles: deriveBuilderEntryFiles(searchResults.map((file) => file.path)),
      researchSummary: buildBuilderResearchSummary(
        searchResults.map((file) => file.path),
        describeBuilderScope(searchResults.map((file) => file.path), 'Work on the requested change'),
        architectResult?.plan ?? '',
      ),
      builderBrief: buildBuilderBrief(
        deriveBuilderScopeDirectory(searchResults.map((file) => file.path)),
        deriveBuilderEntryFiles(searchResults.map((file) => file.path)),
        architectResult?.plan ?? '',
      ),
      writeTargets: searchResults.map((file) => file.path),
    };

    const singleBuilderTask = createBuilderTask({
      agentInput: { ...agentInput, searchResults, history },
      complexity,
      subtask: directBuilderSubtask,
      searchResults,
      attempt: 1,
      gateMode: gateDecision.mode,
      workerOptions: workerExecutionOptions,
    });

    yield await emit({
      type: 'phase-start',
      phase: 'BUILDER',
      phaseModel: selectAgentModel('builder', complexity),
      subtasks: createInitialSubtasks([singleBuilderTask]),
    });

    const builderStates = yield* runTaskGraph(runtime, [singleBuilderTask], { signal });
    throwOnFailedTasks(builderStates, 'builder');

    const state = builderStates[0];
    if (!state?.result) {
      throw new Error('Missing builder result for task #0');
    }

    totals.cost += state.result.cost ?? 0;
    totals.inputTokens += state.result.inputTokens ?? 0;
    totals.outputTokens += state.result.outputTokens ?? 0;

    yield await emit({ type: 'text', text: state.result.value.response });
    yield await emit({
      type: 'phase-done',
      phase: 'BUILDER',
      phaseDuration: state.duration,
      phaseCost: state.cost,
      phaseSummary: state.progressSummary ?? `${state.model} complete`,
      subtasks: builderStates.map((taskState) => toSubtaskInfo(taskState)),
    });

    builderResults = [state.result.value];
    allWriteTargets = [
      ...(directBuilderSubtask.writeTargets ?? []),
      ...directBuilderSubtask.relevantFiles,
    ];
  }

  // ── REVIEWER with retry loop (not trivial) ─────────────────────────────────
  const MAX_RETRIES = 2; // invest in planning upfront, not retrying after
  let retryCount = 0;
  let currentResults = builderResults;
  let finalReviewerResult: ReviewerOutput | undefined;

  const COST_CAP = 2.0; // stop iterating if total cost exceeds $2 (safety net)
  if (complexity !== 'trivial') {
    while (retryCount <= MAX_RETRIES && totals.cost < COST_CAP) {
      const reviewTaskId = `review-${retryCount + 1}`;
      const reviewerTasks: WorkerTaskDefinition<ReviewerOutput>[] = [
        {
          id: reviewTaskId,
          phase: 'REVIEWER',
          role: 'reviewer',
          transcriptName: retryCount === 0 ? 'reviewer' : `reviewer-${retryCount + 1}`,
          title: retryCount === 0 ? 'Review builder changes' : `Review retry ${retryCount}`,
          description: 'Validate the current builder output and provide per-subtask feedback.',
          verificationTargets: currentResults.map((result) => result.subtaskId),
          run: async (reporter) => {
            const allDiffs = currentResults.map((result) => result.response).join('\n\n---\n\n');
            const subtaskIds = currentResults.map((result) => result.subtaskId);
            const reviewerResult = await runReviewerWorkerAgent({
              input: agentInput,
              complexity,
              allDiffs,
              subtaskIds,
              writeTargets: [...new Set(allWriteTargets)],
              cwd,
              signal,
              reporter,
              ...workerExecutionOptions,
            });
            return {
              value: reviewerResult,
              responseText: reviewerResult.result,
              summary: reviewerResult.approved
                ? 'approved'
                : `issues: ${reviewerResult.feedback.slice(0, 80)}`,
              model: reviewerResult.model,
              duration: reviewerResult.duration,
              cost: reviewerResult.cost,
              inputTokens: reviewerResult.inputTokens,
              outputTokens: reviewerResult.outputTokens,
            };
          },
        },
      ];

      yield await emit({
        type: 'phase-start',
        phase: 'REVIEWER',
        phaseModel: 'review task',
        subtasks: createInitialSubtasks(reviewerTasks),
      });

      let reviewerStates: WorkerTaskState<ReviewerOutput>[];
      try {
        reviewerStates = yield* runTaskGraph(runtime, reviewerTasks, { signal });
      } catch {
        // Reviewer crashed — don't kill the pipeline, just skip review
        yield await emit({ type: 'phase-done', phase: 'REVIEWER', phaseSummary: 'skipped (error)' });
        break;
      }

      const reviewerState = reviewerStates[0];
      if (!reviewerState?.result || reviewerState.status === 'failed') {
        yield await emit({ type: 'phase-done', phase: 'REVIEWER', phaseSummary: 'skipped (error)' });
        break;
      }

      const reviewerResult = reviewerState.result.value;
      finalReviewerResult = reviewerResult;
      totals.cost += reviewerState.result.cost ?? 0;
      totals.inputTokens += reviewerState.result.inputTokens ?? 0;
      totals.outputTokens += reviewerState.result.outputTokens ?? 0;

      yield await emit({
        type: 'phase-done',
        phase: 'REVIEWER',
        phaseDuration: reviewerState.duration,
        phaseCost: reviewerState.cost,
        phaseSummary: reviewerState.progressSummary ?? 'review complete',
        subtasks: reviewerStates.map((state) => toSubtaskInfo(state)),
      });

      if (reviewerResult.approved || retryCount >= MAX_RETRIES) break;

      // Find subtasks with specific feedback; if none, retry ALL with general feedback
      let toRetry = currentResults.filter((result) =>
        reviewerResult.subtaskFeedback?.[result.subtaskId]
      );
      if (toRetry.length === 0 && reviewerResult.feedback) {
        // Reviewer gave general feedback but no per-subtask keys — retry all
        toRetry = currentResults;
      }

      if (toRetry.length === 0) break;

      const retryTasks = toRetry.map((previous) => {
        const subtask = architectResult?.subtasks?.find((entry) => entry.id === previous.subtaskId);
        const feedback = reviewerResult.subtaskFeedback?.[previous.subtaskId] ?? reviewerResult.feedback;
        // Keep the original spec and append feedback — don't replace
        const originalPlan = subtask?.plan ?? task;
        const retryTask = `${originalPlan}\n\n---\nREVIEWER FEEDBACK (fix these issues, do not re-investigate):\n${feedback}`;

        const retrySubtask: Subtask = subtask
          ? {
              ...subtask,
              plan: retryTask,
            }
          : {
              id: previous.subtaskId,
              description: describeBuilderScope(
                searchResults.map((file) => file.path),
                'Apply reviewer-requested changes',
              ),
              relevantFiles: searchResults.map((file) => file.path),
              plan: retryTask,
              specialist: resolveSpecialist(searchResults.map((file) => file.path), agentInput.task),
              scopeDirectory: deriveBuilderScopeDirectory(searchResults.map((file) => file.path)),
              entryFiles: deriveBuilderEntryFiles(searchResults.map((file) => file.path)),
              researchSummary: buildBuilderResearchSummary(
                searchResults.map((file) => file.path),
                describeBuilderScope(searchResults.map((file) => file.path), 'Apply reviewer-requested changes'),
                retryTask,
              ),
              builderBrief: buildBuilderBrief(
                deriveBuilderScopeDirectory(searchResults.map((file) => file.path)),
                deriveBuilderEntryFiles(searchResults.map((file) => file.path)),
                retryTask,
              ),
              writeTargets: searchResults.map((file) => file.path),
            };

        return createBuilderTask({
          agentInput: { ...agentInput, task: retryTask },
          complexity,
          subtask: retrySubtask,
          searchResults,
          attempt: retryCount + 2,
          phaseSummaryPrefix: 'retry',
          gateMode: gateDecision.mode,
          workerOptions: workerExecutionOptions,
        });
      });

      yield await emit({
        type: 'phase-start',
        phase: 'BUILDER',
        phaseModel: `retry ${retryCount + 1}`,
        subtasks: createRetrySubtasks(retryTasks),
      });

      const retryStates = yield* runTaskGraph(runtime, retryTasks, { signal });
      throwOnFailedTasks(retryStates, 'builder retry');

      const retried = retryStates.map((state) => {
        if (!state.result) {
          throw new Error(`Missing retry result for task ${state.id}`);
        }
        totals.cost += state.result.cost ?? 0;
        totals.inputTokens += state.result.inputTokens ?? 0;
        totals.outputTokens += state.result.outputTokens ?? 0;
        return state.result.value;
      });

      const retryText = retried
        .map((result) => `**Subtask ${result.subtaskId} (retry):**\n${result.response}`)
        .join('\n\n');
      yield await emit({ type: 'text', text: '\n\n---\n**Revised after review:**\n\n' + retryText });

      yield await emit({
        type: 'phase-done',
        phase: 'BUILDER',
        phaseCost: sumTaskCost(retryStates),
        phaseSummary: `retry ${retried.length} builder(s)`,
        subtasks: retryStates.map((state) => toSubtaskInfo(state)),
      });

      currentResults = currentResults.map((result) =>
        retried.find((retryResult) => retryResult.subtaskId === result.subtaskId) ?? result
      );

      retryCount++;
    }
  }

  // ── DONE — aggregate costs, parse diffs, emit result ──────────────────────
  const totalDuration = Date.now() - startTime;
  const finalResponse = currentResults.map((result) => result.response).join('\n\n');
  const diffs = parseDiffs(finalResponse);
  const primary = currentResults[0];
  const result: PipelineResult = {
    response: finalResponse,
    diffs,
    filesSearched: searchResults.map((file) => file.path),
    model: primary.model,
    cost: totals.cost,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    duration: totalDuration,
    opusCost: calculateOpusCost(totals.inputTokens, totals.outputTokens),
  };

  await runtime.appendParentEvent({
    type: 'run-done',
    timestamp: new Date().toISOString(),
    result: {
      cost: result.cost,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      duration: result.duration,
      filesSearched: result.filesSearched,
    },
  });
  await runtime.persistRunMeta({
    status: 'completed',
    completedAt: new Date().toISOString(),
    totalCost: result.cost,
    totalDurationMs: result.duration,
  });
  if (complexity !== 'trivial' && (searchResults.length > 0 || diffs.length > 0 || architectResult)) {
    await persistSessionMemory(
      cwd,
      buildSessionMemorySnapshot({
        cwd,
        runId: runtime.runId,
        task: agentInput.task,
        complexity,
        filesSearched: searchResults.map((file) => file.path),
        architectResult,
        directBuilderSubtask: architectResult ? undefined : gateDecision.directSubtask,
        finalResponse,
        diffs,
        reviewerResult: finalReviewerResult,
      }),
    );
  }

  yield await emit({ type: 'done', result });
}

function createArchitectTask(args: {
  agentInput: AgentInput;
  complexity: TaskComplexity;
  searchResults: NonNullable<AgentInput['searchResults']>;
  hotspots: import('../context/search.js').Hotspot[];
  workerOptions: Pick<
    PipelineOptions,
    'agentMode' | 'onApprovalNeeded' | 'onDiffProposed' | 'onIterationApprovalNeeded'
  >;
}): WorkerTaskDefinition<ArchitectOutput> {
  const { agentInput, complexity, searchResults, hotspots, workerOptions } = args;

  return {
    id: 'architect',
    phase: 'ARCHITECT',
    role: 'architect',
    transcriptName: 'architect',
    title: 'Plan implementation',
    description: 'Create a structured implementation plan for the task.',
    run: async (reporter) => {
      const architectResult = await runArchitectWorkerAgent({
        input: agentInput,
        complexity,
        searchResults,
        hotspots,
        cwd: agentInput.cwd,
        signal: agentInput.signal,
        reporter,
        mode: workerOptions.agentMode,
        onApprovalNeeded: workerOptions.onApprovalNeeded,
        onDiffProposed: workerOptions.onDiffProposed,
        onIterationApprovalNeeded: workerOptions.onIterationApprovalNeeded,
      });

      return {
        value: architectResult,
        responseText: architectResult.result,
        summary: architectResult.type === 'split'
          ? `split into ${architectResult.subtasks?.length ?? 0} tasks`
          : `plan ready (${architectResult.outputTokens} tokens)`,
        model: architectResult.model,
        duration: architectResult.duration,
        cost: architectResult.cost,
        inputTokens: architectResult.inputTokens,
        outputTokens: architectResult.outputTokens,
      };
    },
  };
}

function createBuilderTask(args: {
  agentInput: AgentInput;
  complexity: TaskComplexity;
  subtask: Subtask;
  searchResults: NonNullable<AgentInput['searchResults']>;
  attempt: number;
  phaseSummaryPrefix?: string;
  gateMode?: string;
  workerOptions: Pick<
    PipelineOptions,
    'agentMode' | 'onApprovalNeeded' | 'onDiffProposed' | 'onIterationApprovalNeeded'
  >;
}): WorkerTaskDefinition<SubtaskBuilderResult> {
  const { agentInput, complexity, subtask, searchResults, attempt, phaseSummaryPrefix, gateMode, workerOptions } = args;

  return {
    id: subtask.id,
    phase: 'BUILDER',
    role: 'builder',
    transcriptName: buildBuilderTranscriptName(subtask.id, phaseSummaryPrefix),
    title: phaseSummaryPrefix
      ? `${phaseSummaryPrefix} #${subtask.id}`
      : `Build #${subtask.id} [${subtask.specialist}]`,
    description: `[${subtask.specialist} specialist] ${subtask.description}`,
    dependsOn: subtask.dependsOn,
    writeTargets: subtask.writeTargets ?? subtask.relevantFiles,
    verificationTargets: subtask.verificationTargets,
    attempt,
    run: async (reporter) => {
      const subtaskFiles = searchResults.filter((file) =>
        subtask.relevantFiles.includes(file.path)
      );
      const builderResult = await runBuilderWorkerAgent({
        input: { ...agentInput, searchResults: subtaskFiles },
        complexity,
        plan: subtask.plan,
        searchResults: subtaskFiles,
        specialist: subtask.specialist,
        scopeDirectory: subtask.scopeDirectory,
        entryFiles: subtask.entryFiles,
        researchSummary: subtask.researchSummary,
        builderBrief: subtask.builderBrief,
        writeTargets: subtask.writeTargets,
        gateMode,
        cwd: agentInput.cwd,
        signal: agentInput.signal,
        reporter,
        mode: workerOptions.agentMode,
        onApprovalNeeded: workerOptions.onApprovalNeeded,
        onDiffProposed: workerOptions.onDiffProposed,
        onIterationApprovalNeeded: workerOptions.onIterationApprovalNeeded,
      });

      const value: SubtaskBuilderResult = {
        subtaskId: subtask.id,
        response: builderResult.response,
        model: builderResult.model,
        inputTokens: builderResult.inputTokens,
        outputTokens: builderResult.outputTokens,
        cost: builderResult.cost,
        duration: builderResult.duration,
      };

      return {
        value,
        responseText: builderResult.response,
        summary: `${builderResult.model} · ${builderResult.outputTokens} tokens`,
        model: builderResult.model,
        duration: builderResult.duration,
        cost: builderResult.cost,
        inputTokens: builderResult.inputTokens,
        outputTokens: builderResult.outputTokens,
      };
    },
  };
}

function resolveSpecialist(files: string[], task: string): import('./specialists/types.js').SpecialistType {
  const fromFiles = detectSpecialist(files);
  if (fromFiles !== 'general') return fromFiles;
  return detectSpecialistFromTask(task);
}

function describeBuilderScope(files: string[], fallback: string): string {
  if (files.length === 0) {
    return fallback;
  }

  if (files.length === 1) {
    return `Work on ${files[0]}`;
  }

  const preview = files.slice(0, 2).join(', ');
  const remaining = files.length - 2;
  return remaining > 0
    ? `Work on ${preview}, +${remaining} more`
    : `Work on ${preview}`;
}

function deriveBuilderScopeDirectory(files: string[]): string | undefined {
  const first = files.find((file) => file.includes('/'));
  if (!first) return undefined;
  const segments = first.split('/');
  return segments.length > 1 ? segments.slice(0, -1).join('/') : undefined;
}

function deriveBuilderEntryFiles(files: string[]): string[] | undefined {
  const ordered = files.filter(Boolean).slice(0, 3);
  return ordered.length > 0 ? ordered : undefined;
}

function buildBuilderResearchSummary(files: string[], description: string, plan: string): string | undefined {
  if (files.length === 0 && !description && !plan) return undefined;
  const fileLine = files.length > 0 ? `Relevant files: ${files.join(', ')}.` : undefined;
  const descriptionLine = description ? `Task scope: ${description}.` : undefined;
  const planLine = plan ? `Planned work: ${plan}` : undefined;
  return [fileLine, descriptionLine, planLine].filter(Boolean).join(' ');
}

function buildBuilderBrief(
  scopeDirectory: string | undefined,
  entryFiles: string[] | undefined,
  plan: string,
): string | undefined {
  const startLine = scopeDirectory
    ? `Start in ${scopeDirectory}.`
    : 'Start in the assigned files.';
  const filesLine = entryFiles && entryFiles.length > 0
    ? `Read ${entryFiles.join(', ')} first.`
    : undefined;
  const planLine = plan ? `Then execute: ${plan}` : undefined;
  return [startLine, filesLine, planLine].filter(Boolean).join(' ');
}

function createRetrySubtasks(
  tasks: WorkerTaskDefinition<SubtaskBuilderResult>[],
): SubtaskInfo[] {
  return createInitialSubtasks(tasks).map((task) => ({
    ...task,
    status: task.status === 'queued' ? 'retry' : task.status,
    progressSummary: task.status === 'queued' ? 'retry queued' : task.progressSummary,
  }));
}

function throwOnFailedTasks<TResult>(
  tasks: WorkerTaskState<TResult>[],
  label: string,
): void {
  const failures = tasks.filter((task) => task.status === 'failed');
  if (failures.length === 0) return;

  const message = failures
    .map((task) => {
      const err = task.error ?? task.progressSummary ?? 'failed';
      return `#${task.id}: ${typeof err === 'string' ? err : JSON.stringify(err)}`;
    })
    .join('; ');
  throw new Error(`${label} task(s) failed: ${message}`);
}

function sumTaskCost<TResult>(tasks: WorkerTaskState<TResult>[]): number {
  return tasks.reduce((total, task) => total + (task.cost ?? task.result?.cost ?? 0), 0);
}

function buildBuilderTranscriptName(subtaskId: string, phaseSummaryPrefix?: string): string {
  const safeId = subtaskId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return phaseSummaryPrefix ? `builder-${phaseSummaryPrefix}-${safeId}` : `builder-${safeId}`;
}

function buildSessionMemorySnapshot(args: {
  cwd: string;
  runId: string;
  task: string;
  complexity: TaskComplexity;
  filesSearched: string[];
  architectResult?: ArchitectOutput;
  directBuilderSubtask?: Subtask;
  finalResponse: string;
  diffs: PipelineResult['diffs'];
  reviewerResult?: ReviewerOutput;
}): SessionMemorySnapshot {
  const architectSubtasks = args.architectResult?.subtasks ?? [];
  const directSubtasks = args.directBuilderSubtask ? [args.directBuilderSubtask] : [];
  const memorySubtasks = architectSubtasks.length > 0 ? architectSubtasks : directSubtasks;
  const scopeDirectories = uniqueStrings([
    ...memorySubtasks.map((subtask) => subtask.scopeDirectory ?? ''),
    deriveBuilderScopeDirectory(args.filesSearched) ?? '',
  ]);
  const entryFiles = uniqueStrings([
    ...memorySubtasks.flatMap((subtask) => subtask.entryFiles ?? []),
    ...(deriveBuilderEntryFiles(args.filesSearched) ?? []),
  ]);
  const writeTargets = uniqueStrings([
    ...memorySubtasks.flatMap((subtask) => subtask.writeTargets ?? []),
    ...args.diffs.map((diff) => diff.filePath),
  ]);
  const architectResearch = uniqueStrings(
    memorySubtasks.flatMap((subtask) => subtask.researchSummary ? [subtask.researchSummary] : []),
  );
  const builderBriefs = uniqueStrings(
    memorySubtasks.flatMap((subtask) => subtask.builderBrief ? [subtask.builderBrief] : []),
  );
  const architectPlan = args.architectResult?.type === 'single'
    ? args.architectResult.plan
    : architectSubtasks.length > 0
      ? architectSubtasks.map((subtask) => `#${subtask.id} ${subtask.description}: ${subtask.plan}`).join('\n')
      : args.directBuilderSubtask
        ? args.directBuilderSubtask.plan
      : undefined;

  return {
    updatedAt: new Date().toISOString(),
    runId: args.runId,
    cwd: args.cwd,
    task: args.task,
    complexity: args.complexity,
    filesSearched: uniqueStrings(args.filesSearched),
    scopeDirectories,
    entryFiles,
    writeTargets,
    architectPlan,
    architectResearch,
    builderBriefs,
    finalResponseSummary: summarizeSessionOutcome(args.finalResponse),
    reviewerFeedback: args.reviewerResult && !args.reviewerResult.approved
      ? args.reviewerResult.feedback
      : undefined,
  };
}

function buildImmediateResult(
  response: string,
  filesSearched: string[],
  startTime: number,
  model = selectAgentModel('scout', 'simple'),
): PipelineResult {
  return {
    response,
    diffs: [],
    filesSearched,
    model,
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    duration: Date.now() - startTime,
    opusCost: 0,
  };
}

function summarizeSessionOutcome(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 320);
}

// Detect answers that contain no actionable information — short, no technical
// terms, no file paths, no error descriptions. These are dismissals.
const TECHNICAL_CONTENT =
  /\b(file|error|bug|crash|broken|missing|wrong|css|html|js|tsx?|component|route|api|button|form|header|footer|nav|style|color|font|layout|margin|padding|import|function|class|div|section|page|image|link|url|database|server|port|env|config|deploy)\b|[/.#{}()<>]|\d{3,}/i;

function isDismissal(answer: string): boolean {
  const normalized = answer.trim();
  if (!normalized) return true;
  // Short answer with no technical content = dismissal
  if (normalized.length < 40 && !TECHNICAL_CONTENT.test(normalized)) return true;
  return false;
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
