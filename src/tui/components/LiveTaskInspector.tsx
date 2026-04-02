import React from 'react';
import { Box, Text } from 'ink';
import type { PipelinePhaseData, SubtaskData } from '../types.js';

interface LiveTaskInspectorProps {
  phases: PipelinePhaseData[];
  selectedTaskId?: string | null;
  maxHeight: number;
}

export function LiveTaskInspector({
  phases,
  selectedTaskId,
  maxHeight,
}: LiveTaskInspectorProps): React.ReactElement | null {
  const tasks = flattenTasks(phases);
  if (tasks.length === 0 || maxHeight <= 0) {
    return null;
  }

  const selectedTask = tasks.find((task) => (task.taskId ?? task.id) === selectedTaskId) ?? tasks[0];
  const logs = selectedTask.recentLogs ?? [];
  const headerSuffix = [
    selectedTask.model ?? null,
    selectedTask.transcriptName ?? null,
  ].filter(Boolean).join(' · ');

  const lines: Array<{ text: string; color?: 'cyan' | 'yellow' | 'green' | 'red' | 'magenta'; dim?: boolean; bold?: boolean }> = [
    {
      text: `Task ${selectedTask.role ? `${selectedTask.role.toUpperCase()} ` : ''}#${selectedTask.id} · ${selectedTask.status}${headerSuffix ? ` · ${headerSuffix}` : ''}`,
      color: colorForStatus(selectedTask.status),
      bold: true,
    },
    { text: selectedTask.description, dim: true },
  ];

  if (selectedTask.progressSummary) {
    lines.push({ text: `progress: ${selectedTask.progressSummary}`, dim: true });
  }
  if (selectedTask.dependsOn && selectedTask.dependsOn.length > 0) {
    lines.push({ text: `depends on: ${selectedTask.dependsOn.map((id) => `#${id}`).join(', ')}`, dim: true });
  }
  if (selectedTask.writeTargets && selectedTask.writeTargets.length > 0) {
    lines.push({ text: `writes: ${selectedTask.writeTargets.join(', ')}`, dim: true });
  }
  if (selectedTask.transcriptPath) {
    lines.push({ text: `transcript: ${selectedTask.transcriptPath}`, dim: true });
  }
  if (logs.length > 0) {
    lines.push({ text: 'recent activity:', color: 'cyan', bold: true });
    for (const log of logs.slice(-Math.max(1, maxHeight - lines.length - 3))) {
      lines.push({ text: `- ${log}`, dim: true });
    }
  }

  const visibleLines = lines.slice(0, Math.max(1, maxHeight - 3));

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} height={maxHeight} overflow="hidden">
      <Box justifyContent="space-between">
        <Text color="cyan" bold>Live Inspector</Text>
        <Text dimColor>Tab toggle · ←/→ task</Text>
      </Box>
      {visibleLines.map((line, index) => (
        <Text
          key={`${selectedTask.taskId ?? selectedTask.id}-${index}`}
          color={line.color}
          dimColor={line.dim}
          bold={line.bold}
        >
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

function flattenTasks(phases: PipelinePhaseData[]): SubtaskData[] {
  const tasks = phases.flatMap((phase) => phase.subtasks ?? []);
  return [...tasks].sort((left, right) => rankTask(right) - rankTask(left));
}

function rankTask(task: SubtaskData): number {
  const statusRank = (() => {
    switch (task.status) {
      case 'waiting_approval': return 5;
      case 'running': return 4;
      case 'retry': return 3;
      case 'blocked': return 2;
      case 'queued': return 1;
      default: return 0;
    }
  })();
  return statusRank * 1000 + (task.recentLogs?.length ?? 0);
}

function colorForStatus(status: SubtaskData['status']): 'cyan' | 'yellow' | 'green' | 'red' | 'magenta' {
  switch (status) {
    case 'waiting_approval':
      return 'magenta';
    case 'running':
    case 'retry':
      return 'cyan';
    case 'blocked':
      return 'yellow';
    case 'failed':
      return 'red';
    default:
      return 'green';
  }
}
