import * as os from 'node:os';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAllowedToolNamesForRole } from '../tools/index.js';
import {
  getDependencyStatus,
  selectRunnableTaskIds,
  validateTaskGraph,
  type SchedulerTask,
} from './scheduler.js';
import type {
  PipelineChunk,
  PipelinePhaseName,
  PipelineTaskInfo,
  PipelineTaskStatus,
  SubtaskInfo,
} from '../pipeline/types.js';
import type { AgentRole } from './types.js';

export interface WorkerTaskRunResult<TResult> {
  value: TResult;
  responseText?: string;
  summary?: string;
  model?: string;
  duration?: number;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface WorkerTaskReporter {
  progress: (message: string) => Promise<void>;
  log: (message: string) => Promise<void>;
  setStatus: (
    status: Extract<PipelineTaskStatus, 'running' | 'waiting_approval'>,
    message?: string,
  ) => Promise<void>;
}

export interface WorkerTaskDefinition<TResult> {
  id: string;
  phase: PipelinePhaseName;
  role: AgentRole;
  title: string;
  description: string;
  parentTaskId?: string;
  dependsOn?: string[];
  writeTargets?: string[];
  verificationTargets?: string[];
  attempt?: number;
  isBackground?: boolean;
  requiresApproval?: boolean;
  transcriptName?: string;
  run: (reporter: WorkerTaskReporter) => Promise<WorkerTaskRunResult<TResult>>;
}

export interface WorkerTaskState<TResult> extends Omit<WorkerTaskDefinition<TResult>, 'run'> {
  status: PipelineTaskStatus;
  progressSummary?: string;
  blockedBy?: string[];
  allowedTools: string[];
  startedAt?: number;
  finishedAt?: number;
  duration?: number;
  cost?: number;
  model?: string;
  outputPath?: string;
  transcriptPath?: string;
  result?: WorkerTaskRunResult<TResult>;
  error?: string;
}

export interface PipelineRunMeta {
  runId: string;
  request: string;
  cwd: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  totalCost: number;
  totalDurationMs?: number;
}

interface RunningTask<TResult> {
  state: WorkerTaskState<TResult>;
  promise: Promise<void>;
}

interface TaskExecutionEvent<TResult> {
  type: 'chunk' | 'settled';
  chunk?: PipelineChunk;
  taskId?: string;
  ok?: boolean;
  result?: WorkerTaskRunResult<TResult>;
  error?: string;
}

export interface OrchestrationRuntime {
  runId: string;
  baseDir: string;
  tasksDir: string;
  maxConcurrency: number;
  appendParentEvent: (event: Record<string, unknown>) => Promise<void>;
  appendTaskEvent: <TResult>(task: WorkerTaskState<TResult>, event: Record<string, unknown>) => Promise<void>;
  persistTaskMeta: <TResult>(task: WorkerTaskState<TResult>) => Promise<void>;
  writeTaskOutput: <TResult>(task: WorkerTaskState<TResult>, output: string) => Promise<void>;
  persistRunMeta: (patch: Partial<PipelineRunMeta>) => Promise<void>;
}

export async function createOrchestrationRuntime(
  cwd: string,
  request: string,
): Promise<OrchestrationRuntime> {
  const runId = createRunId();
  const baseDir = join(cwd, '.mint', 'runs', runId);
  const tasksDir = join(baseDir, 'tasks');
  const parentPath = join(baseDir, 'parent.jsonl');
  const metaPath = join(baseDir, 'meta.json');
  const runMeta: PipelineRunMeta = {
    runId,
    request,
    cwd,
    startedAt: new Date().toISOString(),
    status: 'running',
    totalCost: 0,
  };

  await mkdir(tasksDir, { recursive: true });
  await writeFile(metaPath, JSON.stringify(runMeta, null, 2), 'utf8');
  await appendJsonLine(parentPath, {
    type: 'run-start',
    request,
    runId,
    cwd,
    timestamp: new Date().toISOString(),
  });

  return {
    runId,
    baseDir,
    tasksDir,
    maxConcurrency: getDefaultConcurrency(),
    appendParentEvent: async (event) => {
      await appendJsonLine(parentPath, event);
    },
    appendTaskEvent: async (task, event) => {
      const taskJsonlPath = getTaskTranscriptPath(baseDir, task, 'jsonl');
      const legacyTaskPath = join(tasksDir, `${task.id}.jsonl`);
      await Promise.all([
        appendJsonLine(legacyTaskPath, event),
        appendJsonLine(taskJsonlPath, event),
      ]);
    },
    persistTaskMeta: async (task) => {
      const meta = {
        ...task,
        result: task.result
          ? {
              summary: task.result.summary,
              model: task.result.model,
              duration: task.result.duration,
              cost: task.result.cost,
              inputTokens: task.result.inputTokens,
              outputTokens: task.result.outputTokens,
            }
          : undefined,
      };
      const legacyTaskMetaPath = join(tasksDir, `${task.id}.meta.json`);
      const taskMetaPath = getTaskTranscriptPath(baseDir, task, 'meta.json');
      await Promise.all([
        writeFile(legacyTaskMetaPath, JSON.stringify(meta, null, 2), 'utf8'),
        writeFile(taskMetaPath, JSON.stringify(meta, null, 2), 'utf8'),
      ]);
    },
    writeTaskOutput: async (task, output) => {
      const legacyOutputPath = join(tasksDir, `${task.id}.output.md`);
      const outputPath = getTaskTranscriptPath(baseDir, task, 'output.md');
      task.outputPath = outputPath;
      await Promise.all([
        writeFile(legacyOutputPath, output, 'utf8'),
        writeFile(outputPath, output, 'utf8'),
      ]);
    },
    persistRunMeta: async (patch) => {
      Object.assign(runMeta, patch);
      await writeFile(metaPath, JSON.stringify(runMeta, null, 2), 'utf8');
    },
  };
}

export function createInitialSubtasks<TResult>(
  tasks: WorkerTaskDefinition<TResult>[],
): SubtaskInfo[] {
  return tasks.map((task) => {
    const blockedBy = task.dependsOn?.filter(Boolean) ?? [];
    return {
      id: task.id,
      taskId: task.id,
      parentTaskId: task.parentTaskId,
      role: task.role,
      title: task.title,
      description: task.description,
      status: blockedBy.length > 0 ? 'blocked' : 'queued',
      progressSummary: blockedBy.length > 0
        ? `waiting on ${blockedBy.map((id) => `#${id}`).join(', ')}`
        : 'queued',
      blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
      requiresApproval: task.requiresApproval,
      isBackground: task.isBackground,
      attempt: task.attempt ?? 1,
      dependsOn: task.dependsOn,
      writeTargets: task.writeTargets,
      verificationTargets: task.verificationTargets,
      model: undefined,
    };
  });
}

export async function* runTaskGraph<TResult>(
  runtime: OrchestrationRuntime,
  tasks: WorkerTaskDefinition<TResult>[],
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<PipelineChunk, WorkerTaskState<TResult>[]> {
  validateTaskGraph(tasks.map(toSchedulerTask));

  const states = tasks.map((task) => createTaskState(runtime.baseDir, task));
  const statesById = new Map(states.map((task) => [task.id, task]));
  const definitionsById = new Map(tasks.map((task) => [task.id, task]));
  const running = new Map<string, RunningTask<TResult>>();
  const warnedConflictKeys = new Set<string>();
  const executionEvents = createAsyncEventQueue<TaskExecutionEvent<TResult>>();

  for (const state of states) {
    await runtime.persistTaskMeta(state);
    await runtime.appendTaskEvent(state, { type: 'task-created', task: toPipelineTaskInfo(state) });
  }

  while (states.some((task) => !isTerminal(task.status))) {
    if (options.signal?.aborted) {
      throw new Error('Aborted');
    }

    const pendingExecutionEvents = executionEvents.drain();
    if (pendingExecutionEvents.length > 0) {
      for (const event of pendingExecutionEvents) {
        yield* handleTaskExecutionEvent(runtime, running, event);
      }
      continue;
    }

    for (const state of states) {
      if (state.status !== 'blocked') continue;

      const dependencyStatus = getDependencyStatus(toSchedulerTask(state), createSchedulerStateMap(states));
      if (dependencyStatus.failed.length > 0 && !isVerificationOnly(state)) {
        state.status = 'failed';
        state.blockedBy = dependencyStatus.failed;
        state.progressSummary = `blocked by failed dependency ${dependencyStatus.failed.map((dependencyId) => `#${dependencyId}`).join(', ')}`;
        state.error = state.progressSummary;
        await runtime.persistTaskMeta(state);

        const taskInfo = toPipelineTaskInfo(state);
        yield* emitTaskChunk(runtime, { type: 'task-failed', task: taskInfo });
        yield* emitTaskChunk(runtime, { type: 'task-notification', task: taskInfo });
        continue;
      }

      if (dependencyStatus.waitingOn.length === 0) {
        state.status = 'queued';
        state.blockedBy = undefined;
        state.progressSummary = 'queued';
        await runtime.persistTaskMeta(state);
        yield* emitTaskChunk(runtime, { type: 'task-progress', task: toPipelineTaskInfo(state) });
      } else {
        const nextSummary = `waiting on ${dependencyStatus.waitingOn.map((dependencyId) => `#${dependencyId}`).join(', ')}`;
        if (state.progressSummary !== nextSummary) {
          state.blockedBy = dependencyStatus.waitingOn;
          state.progressSummary = nextSummary;
          await runtime.persistTaskMeta(state);
          yield* emitTaskChunk(runtime, { type: 'task-progress', task: toPipelineTaskInfo(state) });
        }
      }
    }

    const availableSlots = runtime.maxConcurrency - running.size;
    if (availableSlots > 0) {
      const decision = selectRunnableTaskIds(
        tasks.map(toSchedulerTask),
        createSchedulerStateMap(states),
        Array.from(running.keys()),
        availableSlots,
      );

      for (const warning of decision.warnings) {
        const conflictKey = `${warning.taskId}:${warning.conflictingWith.slice().sort().join(',')}`;
        if (warnedConflictKeys.has(conflictKey)) continue;
        warnedConflictKeys.add(conflictKey);

        const warningState = statesById.get(warning.taskId);
        if (!warningState) continue;

        warningState.progressSummary = warning.message;
        await runtime.persistTaskMeta(warningState);
        yield* emitTaskChunk(runtime, {
          type: 'task-log',
          task: toPipelineTaskInfo(warningState),
          log: warning.message,
        });
      }

      for (const taskId of decision.runnableTaskIds) {
        const state = statesById.get(taskId);
        if (!state) continue;

        state.status = 'running';
        state.startedAt = Date.now();
        state.progressSummary = state.progressSummary && state.progressSummary !== 'queued'
          ? state.progressSummary
          : 'running';
        await runtime.persistTaskMeta(state);
        yield* emitTaskChunk(runtime, { type: 'task-start', task: toPipelineTaskInfo(state) });

        const taskDef = definitionsById.get(taskId);
        if (!taskDef) {
          throw new Error(`Missing task definition for ${taskId}`);
        }

        const reporter = createTaskReporter(runtime, state, executionEvents);
        const promise = taskDef.run(reporter)
          .then((result) => {
            executionEvents.push({ type: 'settled', taskId: state.id, ok: true, result });
          })
          .catch((error: unknown) => {
            executionEvents.push({
              type: 'settled',
              taskId: state.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });

        running.set(state.id, { state, promise });
      }
    }

    if (running.size === 0) {
      const remaining = states.filter((task) => !isTerminal(task.status));
      if (remaining.length === 0) {
        break;
      }
      const unresolvedIds = remaining.map((task) => task.id);
      const cycleMessage = unresolvedIds.length > 0
        ? `No runnable tasks remain. Unresolved tasks: ${unresolvedIds.map((taskId) => `#${taskId}`).join(', ')}`
        : 'No runnable tasks remain.';
      for (const state of remaining) {
        state.status = 'failed';
        state.error = cycleMessage;
        state.progressSummary = cycleMessage;
        await runtime.persistTaskMeta(state);
        yield* emitTaskChunk(runtime, { type: 'task-failed', task: toPipelineTaskInfo(state) });
      }
      throw new Error(cycleMessage);
    }

    const nextExecutionEvent = await executionEvents.next();
    yield* handleTaskExecutionEvent(runtime, running, nextExecutionEvent);
  }

  return states;
}

function createTaskState<TResult>(
  baseDir: string,
  task: WorkerTaskDefinition<TResult>,
): WorkerTaskState<TResult> {
  const blockedBy = task.dependsOn?.filter(Boolean) ?? [];
  const transcriptPath = getTaskTranscriptPath(baseDir, task, 'jsonl');
  return {
    ...task,
    status: blockedBy.length > 0 ? 'blocked' : 'queued',
    progressSummary: blockedBy.length > 0
      ? `waiting on ${blockedBy.map((id) => `#${id}`).join(', ')}`
      : 'queued',
    blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
    allowedTools: getAllowedToolNamesForRole(task.role),
    attempt: task.attempt ?? 1,
    transcriptPath,
  };
}

function toSchedulerTask(task: Pick<WorkerTaskDefinition<unknown>, 'id' | 'dependsOn' | 'writeTargets'> | WorkerTaskState<unknown>): SchedulerTask {
  return {
    taskId: task.id,
    dependsOn: task.dependsOn,
    writeTargets: task.writeTargets,
  };
}

function createSchedulerStateMap<TResult>(
  tasks: WorkerTaskState<TResult>[],
): Map<string, { taskId: string; status: PipelineTaskStatus }> {
  return new Map(tasks.map((task) => [task.id, { taskId: task.id, status: task.status }]));
}

function toPipelineTaskInfo<TResult>(task: WorkerTaskState<TResult>): PipelineTaskInfo {
  return {
    taskId: task.id,
    subtaskId: task.id,
    parentTaskId: task.parentTaskId,
    phase: task.phase,
    role: task.role,
    title: task.title,
    description: task.description,
    status: task.status,
    progressSummary: task.progressSummary,
    blockedBy: task.blockedBy,
    isBackground: task.isBackground,
    requiresApproval: task.requiresApproval,
    model: task.model,
    duration: task.duration,
    cost: task.cost,
    attempt: task.attempt,
    dependsOn: task.dependsOn,
    writeTargets: task.writeTargets,
    verificationTargets: task.verificationTargets,
    outputPath: task.outputPath,
    transcriptPath: task.transcriptPath,
    transcriptName: task.transcriptName,
    allowedTools: task.allowedTools,
  };
}

export function toSubtaskInfo<TResult>(task: WorkerTaskState<TResult>): SubtaskInfo {
  return {
    id: task.id,
    taskId: task.id,
    parentTaskId: task.parentTaskId,
    role: task.role,
    title: task.title,
    description: task.description,
    status: task.status,
    duration: task.duration,
    cost: task.cost,
    progressSummary: task.progressSummary,
    blockedBy: task.blockedBy,
    requiresApproval: task.requiresApproval,
    isBackground: task.isBackground,
    model: task.model,
    attempt: task.attempt,
    dependsOn: task.dependsOn,
    writeTargets: task.writeTargets,
    verificationTargets: task.verificationTargets,
    transcriptPath: task.transcriptPath,
    transcriptName: task.transcriptName,
  };
}

async function* handleTaskExecutionEvent<TResult>(
  runtime: OrchestrationRuntime,
  running: Map<string, RunningTask<TResult>>,
  event: TaskExecutionEvent<TResult>,
): AsyncGenerator<PipelineChunk> {
  if (event.type === 'chunk' && event.chunk) {
    yield* emitTaskChunk(runtime, event.chunk);
    return;
  }

  if (event.type !== 'settled' || !event.taskId) {
    return;
  }

  const runningState = running.get(event.taskId);
  if (!runningState) return;
  running.delete(event.taskId);

  const state = runningState.state;
  state.finishedAt = Date.now();

  if (event.ok && event.result) {
    state.status = 'done';
    state.result = event.result;
    state.duration = event.result.duration ?? durationFromState(state);
    state.cost = event.result.cost;
    state.model = event.result.model;
    state.progressSummary = event.result.summary ?? 'completed';
    if (event.result.responseText) {
      await runtime.writeTaskOutput(state, event.result.responseText);
    }
    await runtime.persistTaskMeta(state);
    yield* emitTaskChunk(runtime, { type: 'task-done', task: toPipelineTaskInfo(state) });
    yield* emitTaskChunk(runtime, { type: 'task-notification', task: toPipelineTaskInfo(state) });
    return;
  }

  state.status = 'failed';
  state.error = event.error ?? 'Task failed';
  state.progressSummary = state.error;
  state.duration = durationFromState(state);
  await runtime.persistTaskMeta(state);
  yield* emitTaskChunk(runtime, { type: 'task-failed', task: toPipelineTaskInfo(state) });
  yield* emitTaskChunk(runtime, { type: 'task-notification', task: toPipelineTaskInfo(state) });
}

function createTaskReporter<TResult>(
  runtime: OrchestrationRuntime,
  task: WorkerTaskState<TResult>,
  executionEvents: AsyncEventQueue<TaskExecutionEvent<TResult>>,
): WorkerTaskReporter {
  return {
    progress: async (message) => {
      task.progressSummary = message;
      await runtime.persistTaskMeta(task);
      executionEvents.push({
        type: 'chunk',
        chunk: { type: 'task-progress', task: toPipelineTaskInfo(task) },
      });
    },
    log: async (message) => {
      await runtime.persistTaskMeta(task);
      executionEvents.push({
        type: 'chunk',
        chunk: { type: 'task-log', task: toPipelineTaskInfo(task), log: message },
      });
    },
    setStatus: async (status, message) => {
      task.status = status;
      if (message) {
        task.progressSummary = message;
      }
      await runtime.persistTaskMeta(task);
      executionEvents.push({
        type: 'chunk',
        chunk: { type: 'task-progress', task: toPipelineTaskInfo(task) },
      });
    },
  };
}

async function* emitTaskChunk(
  runtime: OrchestrationRuntime,
  chunk: PipelineChunk,
): AsyncGenerator<PipelineChunk> {
  await runtime.appendParentEvent(chunkToLogRecord(chunk));
  if (chunk.task) {
    await runtime.appendTaskEvent(
      {
        id: chunk.task.taskId,
        phase: chunk.task.phase,
        role: chunk.task.role,
        title: chunk.task.title,
        description: chunk.task.description,
        parentTaskId: chunk.task.parentTaskId,
        dependsOn: chunk.task.dependsOn,
        writeTargets: chunk.task.writeTargets,
        verificationTargets: chunk.task.verificationTargets,
        attempt: chunk.task.attempt,
        isBackground: chunk.task.isBackground,
        requiresApproval: chunk.task.requiresApproval,
        transcriptName: taskTranscriptNameFromChunk(chunk.task),
        status: chunk.task.status,
        progressSummary: chunk.task.progressSummary,
        blockedBy: chunk.task.blockedBy,
        allowedTools: chunk.task.allowedTools ?? [],
        duration: chunk.task.duration,
        cost: chunk.task.cost,
        model: chunk.task.model,
        outputPath: chunk.task.outputPath,
        transcriptPath: chunk.task.transcriptPath,
      },
      chunkToLogRecord(chunk),
    );
  }
  yield chunk;
}

function chunkToLogRecord(chunk: PipelineChunk): Record<string, unknown> {
  return {
    ...chunk,
    timestamp: new Date().toISOString(),
  };
}

function durationFromState<TResult>(task: WorkerTaskState<TResult>): number | undefined {
  return task.startedAt != null && task.finishedAt != null
    ? task.finishedAt - task.startedAt
    : undefined;
}

function isTerminal(status: PipelineTaskStatus): boolean {
  return status === 'done' || status === 'failed';
}

function isVerificationOnly<TResult>(task: WorkerTaskState<TResult>): boolean {
  return Boolean(task.verificationTargets && task.verificationTargets.length > 0);
}

function getDefaultConcurrency(): number {
  const cpuCount = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.max(1, Math.min(6, Math.min(4, cpuCount)));
}

function createRunId(): string {
  const iso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const safeIso = iso.replace(/:/g, '-').replace(/\.\d+/, '');
  return `${safeIso}-${randomUUID().slice(0, 6)}`;
}

function getTaskTranscriptPath(
  baseDir: string,
  task: Pick<WorkerTaskDefinition<unknown>, 'id' | 'role' | 'transcriptName'>,
  suffix: 'jsonl' | 'meta.json' | 'output.md',
): string {
  const stem = getTaskStem(task);
  return join(baseDir, `${stem}.${suffix}`);
}

function getTaskStem(
  task: Pick<WorkerTaskDefinition<unknown>, 'id' | 'role' | 'transcriptName'>,
): string {
  const preferred = task.transcriptName?.trim();
  if (preferred) return preferred;
  return `${task.role}-${task.id}`;
}

function taskTranscriptNameFromChunk(task: PipelineTaskInfo): string | undefined {
  return task.transcriptName;
}

async function appendJsonLine(path: string, value: Record<string, unknown>): Promise<void> {
  await appendFile(path, JSON.stringify(value) + '\n', 'utf8');
}

interface AsyncEventQueue<T> {
  push: (value: T) => void;
  next: () => Promise<T>;
  drain: () => T[];
}

function createAsyncEventQueue<T>(): AsyncEventQueue<T> {
  const values: T[] = [];
  const waiters: Array<(value: T) => void> = [];

  return {
    push(value) {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(value);
        return;
      }
      values.push(value);
    },
    next() {
      const value = values.shift();
      if (value !== undefined) {
        return Promise.resolve(value);
      }
      return new Promise<T>((resolve) => {
        waiters.push(resolve);
      });
    },
    drain() {
      if (values.length === 0) return [];
      return values.splice(0, values.length);
    },
  };
}
