// src/tui/hooks/useAgentEvents.ts
import { useState, useCallback } from 'react';
import type { PipelinePhaseData, PhaseName } from '../types.js';

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

  const onPhaseStart = useCallback((name: PhaseName, model?: string) => {
    setPipelinePhases(prev => [
      ...prev.map(p => p.status === 'active' ? { ...p, status: 'done' as const } : p),
      { name, status: 'active' as const, model },
    ]);
  }, []);

  const onPhaseDone = useCallback((name: PhaseName, result: { duration?: number; cost?: number; summary?: string }) => {
    setPipelinePhases(prev =>
      prev.map(p => p.name === name
        ? { ...p, status: 'done' as const, duration: result.duration, cost: result.cost, summary: result.summary }
        : p
      )
    );
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

  return { panelState, pipelinePhases, onToolCall, onCostUpdate, onPhaseStart, onPhaseDone, resetPhases, reset };
}

function inferFileStatus(toolName: string): FileStatus | null {
  switch (toolName) {
    case 'read_file':  return 'READ';
    case 'write_file': return 'NEW';
    case 'edit_file':  return 'EDIT';
    default:           return null;
  }
}
