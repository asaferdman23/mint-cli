// src/tui/components/PipelinePhase.tsx
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { PipelinePhaseData, SubtaskData } from '../types.js';

interface PipelinePhaseProps {
  phase: PipelinePhaseData;
}

type TextColor = React.ComponentProps<typeof Text>['color'];

interface InlineSegment {
  text: string;
  color?: TextColor;
  dimColor?: boolean;
  bold?: boolean;
}

interface PhaseRenderLine {
  key: string;
  spinnerColor?: TextColor;
  segments: InlineSegment[];
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `${(cost * 100).toFixed(3)}¢`;
  return `$${cost.toFixed(4)}`;
}

function pushWrappedTextLines(
  lines: PhaseRenderLine[],
  keyPrefix: string,
  text: string,
  maxWidth: number,
  firstPrefix: InlineSegment,
  continuationPrefix: InlineSegment,
  contentSegment: Omit<InlineSegment, 'text'>,
): void {
  const wrapWithPrefix = (value: string, initialWidth: number, continuationWidth: number): string[] => {
    if (value.length === 0) return [''];

    const wrapped: string[] = [];
    let remaining = value;
    let isFirst = true;

    while (remaining.length > 0) {
      const width = Math.max(1, isFirst ? initialWidth : continuationWidth);
      if (remaining.length <= width) {
        wrapped.push(remaining);
        break;
      }

      const breakAt = remaining.lastIndexOf(' ', width);
      const splitAt = breakAt > 0 ? breakAt : width;
      wrapped.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
      if (breakAt > 0) {
        remaining = remaining.replace(/^ /, '');
      }
      isFirst = false;
    }

    return wrapped;
  };

  const sourceLines = text.split('\n');
  const firstWidth = Math.max(1, maxWidth - firstPrefix.text.length);
  const continuationWidth = Math.max(1, maxWidth - continuationPrefix.text.length);

  sourceLines.forEach((sourceLine, sourceIndex) => {
    const wrapped = wrapWithPrefix(sourceLine, firstWidth, continuationWidth);

    wrapped.forEach((part, wrapIndex) => {
      const prefix = wrapIndex === 0 ? firstPrefix : continuationPrefix;
      lines.push({
        key: `${keyPrefix}-${sourceIndex}-${wrapIndex}`,
        segments: [
          prefix,
          { text: part || ' ', ...contentSegment },
        ],
      });
    });
  });
}

function buildSubtaskLines(
  subtask: SubtaskData,
  isLast: boolean,
  maxWidth: number,
  keyPrefix: string,
  active: boolean,
): PhaseRenderLine[] {
  const lines: PhaseRenderLine[] = [];
  const branch = isLast ? '└─ ' : '├─ ';
  const outerPrefix = active ? '│   ' : '  ';
  const firstPrefixText = `${outerPrefix}${branch}`;
  const continuationPrefixText = `${outerPrefix}   `;
  const suffix = [
    subtask.model ?? null,
    subtask.duration != null ? formatDuration(subtask.duration) : null,
    subtask.cost != null ? formatCost(subtask.cost) : null,
  ].filter(Boolean).join(' · ');

  let statusText = `#${subtask.id} ${subtask.description}`;
  let contentStyle: Omit<InlineSegment, 'text'> = { dimColor: true };
  let spinnerColor: TextColor | undefined;

  switch (subtask.status) {
    case 'running':
      contentStyle = { color: 'cyan' };
      spinnerColor = 'cyan';
      break;
    case 'retry':
      statusText = `#${subtask.id} retry ${subtask.description}`;
      contentStyle = { color: 'yellow' };
      spinnerColor = 'yellow';
      break;
    case 'blocked':
      contentStyle = { color: 'yellow' };
      statusText = `… #${subtask.id} ${subtask.description}`;
      break;
    case 'waiting_approval':
      contentStyle = { color: 'magenta', bold: true };
      statusText = `! #${subtask.id} ${subtask.description}`;
      break;
    case 'failed':
      contentStyle = { color: 'red' };
      statusText = `✗ #${subtask.id} ${subtask.description}`;
      break;
    case 'done':
      statusText = `✓ #${subtask.id} ${subtask.description}${suffix ? ` · ${suffix}` : ''}`;
      contentStyle = { dimColor: true };
      break;
    case 'queued':
      statusText = `○ #${subtask.id} ${subtask.description}`;
      contentStyle = { dimColor: true };
      break;
    case 'pending':
    default:
      statusText = `○ #${subtask.id} ${subtask.description}`;
      contentStyle = { dimColor: true };
      break;
  }

  pushWrappedTextLines(
    lines,
    keyPrefix,
    statusText,
    maxWidth,
    { text: firstPrefixText, dimColor: true },
    { text: continuationPrefixText, dimColor: true },
    contentStyle,
  );

  if (lines[0] && spinnerColor) {
    lines[0]!.spinnerColor = spinnerColor;
    lines[0]!.segments.unshift({ text: '' });
  }

  const detailPrefix = `${outerPrefix}   `;
  const details: string[] = [];
  if (subtask.progressSummary) details.push(subtask.progressSummary);
  if (subtask.blockedBy && subtask.blockedBy.length > 0 && subtask.status === 'blocked') {
    details.push(`blocked by ${subtask.blockedBy.map((id) => `#${id}`).join(', ')}`);
  }
  if (subtask.requiresApproval) details.push('approval required');

  if (details.length > 0) {
    pushWrappedTextLines(
      lines,
      `${keyPrefix}-detail`,
      details.join(' · '),
      maxWidth,
      { text: detailPrefix, dimColor: true },
      { text: detailPrefix, dimColor: true },
      subtask.status === 'failed'
        ? { color: 'red', dimColor: false }
        : { dimColor: true },
    );
  }

  return lines;
}

function buildPhaseRenderLines(
  phase: PipelinePhaseData,
  maxWidth: number,
  keyPrefix: string,
): PhaseRenderLine[] {
  const lines: PhaseRenderLine[] = [];
  const hasSubtasks = phase.subtasks && phase.subtasks.length > 0;

  switch (phase.status) {
    case 'done':
      lines.push({
        key: `${keyPrefix}-header`,
        segments: [
          { text: '✓', color: 'green' },
          { text: ` ${phase.name}`, dimColor: true },
          ...(phase.model ? [{ text: ` · ${phase.model}`, dimColor: true }] : []),
          ...(phase.duration != null ? [{ text: ` · ${formatDuration(phase.duration)}`, dimColor: true }] : []),
          ...(phase.cost != null ? [{ text: ` · ${formatCost(phase.cost)}`, dimColor: true }] : []),
        ],
      });
      if (phase.summary) {
        pushWrappedTextLines(
          lines,
          `${keyPrefix}-summary`,
          phase.summary,
          maxWidth,
          { text: '  ', dimColor: true },
          { text: '  ', dimColor: true },
          { dimColor: true },
        );
      }
      if (hasSubtasks) {
        phase.subtasks!.forEach((subtask, index) => {
          lines.push(...buildSubtaskLines(subtask, index === phase.subtasks!.length - 1, maxWidth, `${keyPrefix}-subtask-${subtask.id}`, false));
        });
      }
      return lines;

    case 'active':
      lines.push({
        key: `${keyPrefix}-header`,
        spinnerColor: 'cyan',
        segments: [
          { text: ' ' },
          { text: phase.name, color: 'cyan', bold: true },
          ...(phase.model ? [{ text: ` · ${phase.model}`, dimColor: true }] : []),
        ],
      });
      if (hasSubtasks) {
        phase.subtasks!.forEach((subtask, index) => {
          lines.push(...buildSubtaskLines(subtask, index === phase.subtasks!.length - 1, maxWidth, `${keyPrefix}-subtask-${subtask.id}`, true));
        });
      }
      if (phase.streamingContent && !hasSubtasks) {
        pushWrappedTextLines(
          lines,
          `${keyPrefix}-stream`,
          phase.streamingContent,
          maxWidth,
          { text: '│ ', color: 'cyan' },
          { text: '│ ', color: 'cyan' },
          {},
        );
        lines.push({
          key: `${keyPrefix}-cursor`,
          segments: [
            { text: '│ ', color: 'cyan' },
            { text: '▋', color: 'cyan' },
          ],
        });
      }
      return lines;

    case 'pending':
      lines.push({
        key: `${keyPrefix}-pending`,
        segments: [
          { text: '○', dimColor: true },
          { text: ` ${phase.name} · waiting`, dimColor: true },
        ],
      });
      return lines;

    case 'skipped':
      lines.push({
        key: `${keyPrefix}-skipped`,
        segments: [
          { text: '–', dimColor: true },
          { text: ` ${phase.name} · skipped`, dimColor: true },
        ],
      });
      return lines;
  }
}

function renderPhaseLine(line: PhaseRenderLine, keyPrefix: string): React.ReactElement {
  return (
    <Box key={`${keyPrefix}-${line.key}`} gap={0}>
      {line.spinnerColor ? (
        <Text color={line.spinnerColor}>
          <Spinner type="dots" />
        </Text>
      ) : null}
      {line.segments.map((segment, index) => (
        <Text
          key={`${keyPrefix}-${line.key}-segment-${index}`}
          color={segment.color}
          dimColor={segment.dimColor}
          bold={segment.bold}
        >
          {segment.text || ' '}
        </Text>
      ))}
    </Box>
  );
}

export function countPhaseRenderLines(phases: PipelinePhaseData[] | undefined, maxWidth: number): number {
  if (!phases || phases.length === 0) return 0;

  return phases.reduce(
    (total, phase, index) => total + buildPhaseRenderLines(phase, Math.max(20, maxWidth), `phase-${index}`).length,
    0,
  );
}

export function renderPipelinePhaseLines(
  phase: PipelinePhaseData,
  maxWidth: number,
  keyPrefix = 'phase',
): React.ReactElement[] {
  return buildPhaseRenderLines(phase, Math.max(20, maxWidth), keyPrefix).map((line) =>
    renderPhaseLine(line, keyPrefix),
  );
}

export function PipelinePhase({ phase }: PipelinePhaseProps): React.ReactElement {
  const maxWidth = Math.max(20, (process.stdout.columns ?? 80) - 4);

  return (
    <Box flexDirection="column" marginBottom={0}>
      {renderPipelinePhaseLines(phase, maxWidth, `${phase.name.toLowerCase()}-${phase.status}`)}
    </Box>
  );
}
