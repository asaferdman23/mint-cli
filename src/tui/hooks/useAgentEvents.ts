// src/tui/hooks/useAgentEvents.ts
import { useState, useCallback } from 'react';
import type { PipelinePhaseData, PhaseName, SubtaskData } from '../types.js';
import type { PipelineTaskInfo } from '../../pipeline/types.js';

export type FileStatus = 'READ' | 'EDIT' | 'NEW' | 'BASH';

export interface TrackedFile {
  path: string;
  status: FileStatus;
  timestamp: number;
}

export interface ToolCall {
  name: string;
  count: number;
}

export interface PanelState {
  files: TrackedFile[];
  toolCalls: ToolCall[];
  totalCost: number;
  totalTokens: number;
  iterationCount: number;
}

export function useAgentEvents() {
  const [panelState, setPanelState] = useState<PanelState>({
    files: [],
    toolCalls: [],
    totalCost: 0,
    totalTokens: 0,
    iterationCount: 0,
  });

  const [pipelinePhases, setPipelinePhases] = useState<PipelinePhaseData[]>([]);

  const onToolCall = useCallback((toolName: string, toolInput: Record<string, unknown>) => {
    setPanelState(prev => {
      const newFiles = [...prev.files];
      const fileStatus = inferFileStatus(toolName);
      if (fileStatus && toolInput.path) {
        const path = String(toolInput.path);
        const existing = newFiles.findIndex(f => f.path === path);
        if (existing >= 0) {
          newFiles[existing] = { path, status: fileStatus, timestamp: Date.now() };
        } else {
          newFiles.push({ path, status: fileStatus, timestamp: Date.now() });
        }
      }

      const newToolCalls = [...prev.toolCalls];
      const existingTool = newToolCalls.find(t => t.name === toolName);
      if (existingTool) {
        existingTool.count++;
      } else {
        newToolCalls.push({ name: toolName, count: 1 });
      }

      return {
        ...prev,
        files: newFiles,
        toolCalls: newToolCalls,
        iterationCount: prev.iterationCount + 1,
      };
    });
  }, []);

  const onCostUpdate = useCallback((cost: number, tokens: number) => {
    setPanelState(prev => ({
      ...prev,
      totalCost: prev.totalCost + cost,
      totalTokens: prev.totalTokens + tokens,
    }));
  }, []);

  const onPhaseStart = useCallback((name: PhaseName, model?: string, subtasks?: SubtaskData[]) => {
    setPipelinePhases(prev => [
      ...prev.map(p => p.status === 'active' ? { ...p, status: 'done' as const } : p),
      { name, status: 'active' as const, model, subtasks },
    ]);
  }, []);

  const onPhaseDone = useCallback((name: PhaseName, result: { duration?: number; cost?: number; summary?: string; subtasks?: SubtaskData[] }) => {
    setPipelinePhases(prev => {
      // Find the LAST phase with this name (handles multiple BUILDER phases)
      const idx = findLastMatchingPhaseIndex(prev, (phase) => phase.name === name && phase.status === 'active');
      if (idx === -1) {
        // fallback: update first matching
        return prev.map(p => p.name === name && p.status !== 'done'
          ? { ...p, status: 'done' as const, duration: result.duration, cost: result.cost, summary: result.summary, subtasks: result.subtasks ?? p.subtasks }
          : p
        );
      }
      return prev.map((p, i) => i === idx
        ? { ...p, status: 'done' as const, duration: result.duration, cost: result.cost, summary: result.summary, subtasks: result.subtasks ?? p.subtasks }
        : p
      );
    });
  }, []);

  const onTaskEvent = useCallback((task: PipelineTaskInfo, log?: string) => {
    setPipelinePhases((prev) => {
      const phaseIndex = findLastMatchingPhaseIndex(prev, (phase) => phase.name === task.phase && phase.status === 'active');
      if (phaseIndex === -1) {
        return prev;
      }

      return prev.map((phase, index) => {
        if (index !== phaseIndex) return phase;

        const subtasks = [...(phase.subtasks ?? [])];
        const subtaskIndex = subtasks.findIndex((subtask) => (subtask.taskId ?? subtask.id) === task.taskId);
        const existingSubtask = subtaskIndex >= 0 ? subtasks[subtaskIndex] : undefined;
        const recentLogs = log
          ? [...(existingSubtask?.recentLogs ?? []).slice(-11), log]
          : existingSubtask?.recentLogs;
        const nextSubtask: SubtaskData = {
          id: task.subtaskId ?? task.taskId,
          taskId: task.taskId,
          parentTaskId: task.parentTaskId,
          role: task.role,
          title: task.title,
          description: task.description,
          status: task.status,
          startedAt: task.startedAt,
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
          recentLogs,
        };

        if (subtaskIndex >= 0) {
          subtasks[subtaskIndex] = {
            ...subtasks[subtaskIndex],
            ...nextSubtask,
          };
        } else {
          subtasks.push(nextSubtask);
        }

        return { ...phase, subtasks };
      });
    });
  }, []);

  const resetPhases = useCallback(() => {
    setPipelinePhases([]);
  }, []);

  const reset = useCallback(() => {
    setPanelState({
      files: [],
      toolCalls: [],
      totalCost: 0,
      totalTokens: 0,
      iterationCount: 0,
    });
    setPipelinePhases([]);
  }, []);

  return {
    panelState,
    pipelinePhases,
    onToolCall,
    onCostUpdate,
    onPhaseStart,
    onPhaseDone,
    onTaskEvent,
    resetPhases,
    reset,
  };
}

function findLastMatchingPhaseIndex(
  phases: PipelinePhaseData[],
  predicate: (phase: PipelinePhaseData) => boolean,
): number {
  for (let index = phases.length - 1; index >= 0; index--) {
    if (predicate(phases[index]!)) {
      return index;
    }
  }

  return -1;
}

function inferFileStatus(toolName: string): FileStatus | null {
  switch (toolName) {
    case 'read_file':  return 'READ';
    case 'write_file': return 'NEW';
    case 'edit_file':  return 'EDIT';
    default:           return null;
  }
}
