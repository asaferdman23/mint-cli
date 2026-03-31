import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { getUsageDb } from './tracker.js';
import type { UsageSummary, SessionSummary } from './db.js';

function formatCost(cost: number): string {
  if (cost < 0.001) return `${(cost * 100_000).toFixed(3)}mc`;
  if (cost < 0.01) return `${(cost * 100).toFixed(4)}c`;
  return `$${cost.toFixed(4)}`;
}

interface DashboardProps {
  summary: UsageSummary;
  sessions: SessionSummary[];
  totalSaved: number;
}

function Dashboard({ summary, sessions, totalSaved }: DashboardProps): React.ReactElement {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q' || key.ctrl && input === 'c') {
      exit();
    }
  });

  const avgCost = summary.totalRequests > 0
    ? summary.totalCost / summary.totalRequests
    : 0;

  const opusWouldCost = summary.totalOpusCost;

  // Model breakdown
  const modelEntries = Object.entries(summary.byModel)
    .sort((a, b) => b[1].requests - a[1].requests);

  const totalReq = summary.totalRequests || 1;
  const topModels = modelEntries.slice(0, 3);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={2} marginBottom={1}>
        <Text bold color="cyan">AXON -- Usage Dashboard</Text>
      </Box>

      {/* Total Saved */}
      <Text bold color="yellow">TOTAL SAVED vs Claude Opus</Text>
      <Box borderStyle="double" borderColor="green" paddingX={2} paddingY={0} marginBottom={1}>
        <Box flexDirection="column">
          <Text bold color="green">{`$${totalSaved.toFixed(2)} saved`}</Text>
          {opusWouldCost > 0 && (
            <Text dimColor>{`(would have cost $${opusWouldCost.toFixed(2)} with Opus)`}</Text>
          )}
        </Box>
      </Box>

      {/* This period summary */}
      <Text bold color="yellow">ALL TIME</Text>
      <Box marginBottom={1} flexDirection="column">
        <Text>{`Requests:   ${summary.totalRequests.toString().padEnd(10)} Avg cost:  ${formatCost(avgCost)}`}</Text>
        <Text>{`Total cost: ${formatCost(summary.totalCost).padEnd(10)} Saved:     ${formatCost(totalSaved)}`}</Text>
        {topModels.length > 0 && (
          <Text>
            {`Models:     `}
            {topModels.map(([m, s]) => `${m} (${Math.round((s.requests / totalReq) * 100)}%)`).join('  ')}
          </Text>
        )}
      </Box>

      {/* Top sessions */}
      {sessions.length > 0 && (
        <>
          <Text bold color="yellow">TOP SESSIONS (recent)</Text>
          <Box flexDirection="column" marginBottom={1}>
            {sessions.slice(0, 5).map((s, i) => (
              <Text key={i}>
                {`${s.taskPreview.slice(0, 40).padEnd(40)} ${formatCost(s.cost).padStart(8)}  saved ${formatCost(s.savedAmount)}`}
              </Text>
            ))}
          </Box>
        </>
      )}

      {/* Model breakdown */}
      {modelEntries.length > 0 && (
        <>
          <Text bold color="yellow">MODEL BREAKDOWN</Text>
          <Box flexDirection="column" marginBottom={1}>
            {modelEntries.slice(0, 6).map(([model, stats], i) => {
              const avg = stats.requests > 0 ? stats.cost / stats.requests : 0;
              return (
                <Text key={i}>
                  {`${model.padEnd(22)} ${stats.requests.toString().padStart(4)} req  ${formatCost(stats.cost).padStart(9)}  avg ${formatCost(avg)}`}
                </Text>
              );
            })}
          </Box>
        </>
      )}

      {/* Footer */}
      <Text dimColor>[q] quit</Text>
    </Box>
  );
}

export async function renderDashboard(): Promise<void> {
  const { render } = await import('ink');

  const db = getUsageDb();
  const summary = db.getSummary();
  const sessions = db.getRecentSessions(10);
  const totalSaved = db.getTotalSaved();

  const app = render(
    React.createElement(Dashboard, { summary, sessions, totalSaved })
  );
  await app.waitUntilExit();
}
