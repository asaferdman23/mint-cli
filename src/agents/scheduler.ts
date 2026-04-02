export type SchedulerTaskStatus =
  | 'pending'
  | 'queued'
  | 'blocked'
  | 'running'
  | 'waiting_approval'
  | 'done'
  | 'retry'
  | 'failed';

export interface SchedulerTask {
  taskId: string;
  dependsOn?: string[];
  writeTargets?: string[];
}

export interface SchedulerTaskState {
  taskId: string;
  status: SchedulerTaskStatus;
}

export interface DependencyStatus {
  waitingOn: string[];
  failed: string[];
}

export interface SchedulerWarning {
  type: 'write-conflict';
  taskId: string;
  conflictingWith: string[];
  message: string;
}

export interface ScheduleDecision {
  runnableTaskIds: string[];
  warnings: SchedulerWarning[];
}

export function validateTaskGraph(tasks: SchedulerTask[]): void {
  const byId = new Map<string, SchedulerTask>();

  for (const task of tasks) {
    if (byId.has(task.taskId)) {
      throw new Error(`Duplicate task id: ${task.taskId}`);
    }
    byId.set(task.taskId, task);
  }

  for (const task of tasks) {
    for (const dependencyId of task.dependsOn ?? []) {
      if (!byId.has(dependencyId)) {
        throw new Error(`Task ${task.taskId} depends on missing task ${dependencyId}`);
      }
    }
  }

  const cycle = detectDependencyCycle(tasks);
  if (cycle) {
    throw new Error(`Task dependency cycle detected: ${cycle.join(' -> ')}`);
  }
}

export function detectDependencyCycle(tasks: SchedulerTask[]): string[] | null {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (taskId: string): string[] | null => {
    if (visiting.has(taskId)) {
      const cycleStart = stack.indexOf(taskId);
      return [...stack.slice(cycleStart), taskId];
    }
    if (visited.has(taskId)) return null;

    visiting.add(taskId);
    stack.push(taskId);

    const task = byId.get(taskId);
    for (const dependencyId of task?.dependsOn ?? []) {
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }

    stack.pop();
    visiting.delete(taskId);
    visited.add(taskId);
    return null;
  };

  for (const task of tasks) {
    const cycle = visit(task.taskId);
    if (cycle) return cycle;
  }

  return null;
}

export function getDependencyStatus(
  task: SchedulerTask,
  stateById: Map<string, SchedulerTaskState>,
): DependencyStatus {
  const waitingOn: string[] = [];
  const failed: string[] = [];

  for (const dependencyId of task.dependsOn ?? []) {
    const dependencyState = stateById.get(dependencyId);
    if (!dependencyState || dependencyState.status === 'done') {
      continue;
    }
    if (dependencyState.status === 'failed') {
      failed.push(dependencyId);
    } else {
      waitingOn.push(dependencyId);
    }
  }

  return { waitingOn, failed };
}

export function selectRunnableTaskIds(
  tasks: SchedulerTask[],
  stateById: Map<string, SchedulerTaskState>,
  runningTaskIds: string[],
  limit: number,
): ScheduleDecision {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const queued = tasks.filter((task) => {
    const status = stateById.get(task.taskId)?.status;
    return status === 'queued' || status === 'retry';
  });
  const selected: string[] = [];
  const warnings: SchedulerWarning[] = [];

  for (const task of queued) {
    if (selected.length >= limit) break;

    const conflicting = findConflictingTaskIds(task, [...runningTaskIds, ...selected], byId);
    if (conflicting.length === 0) {
      selected.push(task.taskId);
      continue;
    }

    const independentConflicts = conflicting.filter((otherTaskId) =>
      !hasDependencyRelationship(task.taskId, otherTaskId, byId)
    );

    if (independentConflicts.length > 0) {
      warnings.push({
        type: 'write-conflict',
        taskId: task.taskId,
        conflictingWith: independentConflicts,
        message: `Serialized #${task.taskId} because it overlaps writes with ${independentConflicts.map((id) => `#${id}`).join(', ')}`,
      });
    }
  }

  return {
    runnableTaskIds: selected,
    warnings,
  };
}

function findConflictingTaskIds(
  task: SchedulerTask,
  candidateIds: string[],
  byId: Map<string, SchedulerTask>,
): string[] {
  if (!task.writeTargets || task.writeTargets.length === 0) return [];

  const taskTargets = new Set(task.writeTargets);
  const conflicting: string[] = [];

  for (const candidateId of candidateIds) {
    const candidate = byId.get(candidateId);
    if (!candidate?.writeTargets || candidate.writeTargets.length === 0) continue;
    if (candidate.writeTargets.some((target) => taskTargets.has(target))) {
      conflicting.push(candidateId);
    }
  }

  return conflicting;
}

function hasDependencyRelationship(
  leftTaskId: string,
  rightTaskId: string,
  byId: Map<string, SchedulerTask>,
): boolean {
  return dependsOn(leftTaskId, rightTaskId, byId, new Set()) || dependsOn(rightTaskId, leftTaskId, byId, new Set());
}

function dependsOn(
  sourceTaskId: string,
  targetTaskId: string,
  byId: Map<string, SchedulerTask>,
  seen: Set<string>,
): boolean {
  if (sourceTaskId === targetTaskId) return true;
  if (seen.has(sourceTaskId)) return false;
  seen.add(sourceTaskId);

  const source = byId.get(sourceTaskId);
  for (const dependencyId of source?.dependsOn ?? []) {
    if (dependencyId === targetTaskId) return true;
    if (dependsOn(dependencyId, targetTaskId, byId, seen)) return true;
  }

  return false;
}
