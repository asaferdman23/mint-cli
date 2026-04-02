/**
 * Multi-agent pipeline orchestrator.
 *
 * Scout → [Architect] → Builder task graph → [Reviewer with retry]
 *
 * Trivial tasks:         Scout → Builder (skip architect + reviewer)
 * Simple tasks:          Scout → Builder → Reviewer
 * Moderate/Complex:      Scout → Architect → Builder task graph → Reviewer (with retry, max 2)
 *
 * Yields PipelineChunks for progressive TUI rendering.
 */
import { parseDiffs } from '../pipeline/diff-parser.js';
import { calculateOpusCost } from '../usage/tracker.js';
import { detectSpecialist } from './specialists/index.js';
import { selectAgentModel } from './model-selector.js';
import {
  runArchitectWorkerAgent,
  runBuilderWorkerAgent,
  runReviewerWorkerAgent,
  runScoutWorkerAgent,
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
  ScoutOutput,
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
  const runtime = await createOrchestrationRuntime(cwd, task);
  const totals = {
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  const agentInput: AgentInput = { task, cwd, signal, history };
  const workerExecutionOptions = {
    mode: options.agentMode,
    onApprovalNeeded: options.onApprovalNeeded,
    onDiffProposed: options.onDiffProposed,
    onIterationApprovalNeeded: options.onIterationApprovalNeeded,
  };

  const emit = async (chunk: PipelineChunk): Promise<PipelineChunk> => {
    await runtime.appendParentEvent({
      ...chunk,
      timestamp: new Date().toISOString(),
    });
    return chunk;
  };

  // ── SCOUT ─────────────────────────────────────────────────────────────────
  const scoutTask = createScoutTask({
    agentInput,
    workerOptions: workerExecutionOptions,
  });

  yield await emit({
    type: 'phase-start',
    phase: 'SCOUT',
    phaseModel: selectAgentModel('scout', 'simple'),
    subtasks: createInitialSubtasks([scoutTask]),
  });

  const scoutStates = yield* runTaskGraph(runtime, [scoutTask], { signal });
  throwOnFailedTasks(scoutStates, 'scout');

  const scoutState = scoutStates[0];
  if (!scoutState?.result) {
    throw new Error('Missing scout result');
  }

  const scoutResult = scoutState.result.value;
  totals.cost += scoutState.result.cost ?? 0;
  totals.inputTokens += scoutState.result.inputTokens ?? 0;
  totals.outputTokens += scoutState.result.outputTokens ?? 0;

  yield await emit({
    type: 'phase-done',
    phase: 'SCOUT',
    phaseDuration: scoutState.duration,
    phaseCost: scoutState.cost,
    phaseSummary: scoutState.progressSummary ?? `${scoutResult.complexity} · ${scoutResult.relevantFiles.length} files`,
    subtasks: scoutStates.map((state) => toSubtaskInfo(state)),
  });
  yield await emit({ type: 'search', filesFound: scoutResult.relevantFiles.map((file) => file.path) });

  const complexity: TaskComplexity = scoutResult.complexity;
  const searchResults = scoutResult.relevantFiles;

  // ── ARCHITECT (moderate/complex only) ─────────────────────────────────────
  let architectResult: ArchitectOutput | undefined;

  if (complexity === 'moderate' || complexity === 'complex') {
    const architectTask = createArchitectTask({
      agentInput: { ...agentInput, searchResults },
      complexity,
      searchResults,
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
    const singleBuilderTask = createBuilderTask({
      agentInput: { ...agentInput, searchResults, history },
      complexity,
      subtask: {
        id: '0',
        description: task.slice(0, 80),
        relevantFiles: searchResults.map((file) => file.path),
        plan: architectResult?.plan ?? '',
        specialist: detectSpecialist(searchResults.map((file) => file.path)),
        writeTargets: searchResults.map((file) => file.path),
      },
      searchResults,
      attempt: 1,
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
  }

  // ── REVIEWER with retry loop (not trivial) ─────────────────────────────────
  const MAX_RETRIES = 2;
  let retryCount = 0;
  let currentResults = builderResults;

  if (complexity !== 'trivial') {
    while (retryCount <= MAX_RETRIES) {
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

      const reviewerStates = yield* runTaskGraph(runtime, reviewerTasks, { signal });
      throwOnFailedTasks(reviewerStates, 'reviewer');

      const reviewerState = reviewerStates[0];
      if (!reviewerState?.result) {
        yield await emit({ type: 'phase-done', phase: 'REVIEWER', phaseSummary: 'skipped (error)' });
        break;
      }

      const reviewerResult = reviewerState.result.value;
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

      const toRetry = currentResults.filter((result) =>
        reviewerResult.subtaskFeedback?.[result.subtaskId]
      );

      if (toRetry.length === 0) break;

      const retryTasks = toRetry.map((previous) => {
        const subtask = architectResult?.subtasks?.find((entry) => entry.id === previous.subtaskId);
        const retryTask = subtask
          ? `${subtask.description}\n\nReviewer feedback: ${reviewerResult.subtaskFeedback![previous.subtaskId]}`
          : `${task}\n\nReviewer feedback: ${reviewerResult.feedback}`;

        const retrySubtask: Subtask = subtask
          ? {
              ...subtask,
              plan: retryTask,
            }
          : {
              id: previous.subtaskId,
              description: task.slice(0, 60),
              relevantFiles: searchResults.map((file) => file.path),
              plan: retryTask,
              specialist: detectSpecialist(searchResults.map((file) => file.path)),
              writeTargets: searchResults.map((file) => file.path),
            };

        return createBuilderTask({
          agentInput: { ...agentInput, task: retryTask },
          complexity,
          subtask: retrySubtask,
          searchResults,
          attempt: retryCount + 2,
          phaseSummaryPrefix: 'retry',
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

  yield await emit({ type: 'done', result });
}

function createScoutTask(args: {
  agentInput: AgentInput;
  workerOptions: Pick<
    PipelineOptions,
    'agentMode' | 'onApprovalNeeded' | 'onDiffProposed' | 'onIterationApprovalNeeded'
  >;
}): WorkerTaskDefinition<ScoutOutput> {
  const { agentInput, workerOptions } = args;

  return {
    id: 'scout',
    phase: 'SCOUT',
    role: 'scout',
    transcriptName: 'scout',
    title: 'Scout repository',
    description: 'Classify task complexity and find the most relevant files.',
    run: async (reporter) => {
      const scoutResult = await runScoutWorkerAgent({
        input: agentInput,
        cwd: agentInput.cwd,
        signal: agentInput.signal,
        reporter,
        mode: workerOptions.agentMode,
        onApprovalNeeded: workerOptions.onApprovalNeeded,
        onDiffProposed: workerOptions.onDiffProposed,
        onIterationApprovalNeeded: workerOptions.onIterationApprovalNeeded,
      });

      return {
        value: scoutResult,
        responseText: scoutResult.result,
        summary: `${scoutResult.complexity} · ${scoutResult.relevantFiles.length} files`,
        model: scoutResult.model,
        duration: scoutResult.duration,
        cost: scoutResult.cost,
        inputTokens: scoutResult.inputTokens,
        outputTokens: scoutResult.outputTokens,
      };
    },
  };
}

function createArchitectTask(args: {
  agentInput: AgentInput;
  complexity: TaskComplexity;
  searchResults: NonNullable<AgentInput['searchResults']>;
  workerOptions: Pick<
    PipelineOptions,
    'agentMode' | 'onApprovalNeeded' | 'onDiffProposed' | 'onIterationApprovalNeeded'
  >;
}): WorkerTaskDefinition<ArchitectOutput> {
  const { agentInput, complexity, searchResults, workerOptions } = args;

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
  workerOptions: Pick<
    PipelineOptions,
    'agentMode' | 'onApprovalNeeded' | 'onDiffProposed' | 'onIterationApprovalNeeded'
  >;
}): WorkerTaskDefinition<SubtaskBuilderResult> {
  const { agentInput, complexity, subtask, searchResults, attempt, phaseSummaryPrefix, workerOptions } = args;

  return {
    id: subtask.id,
    phase: 'BUILDER',
    role: 'builder',
    transcriptName: buildBuilderTranscriptName(subtask.id, phaseSummaryPrefix),
    title: phaseSummaryPrefix ? `${phaseSummaryPrefix} #${subtask.id}` : `Build #${subtask.id}`,
    description: subtask.description,
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
    .map((task) => `#${task.id}: ${task.error ?? task.progressSummary ?? 'failed'}`)
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
