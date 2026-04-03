import { strict as assert } from 'node:assert';
import { ACTIVE_TASK_AUTO_EXPAND_DELAY_MS, shouldCompactSubtasks } from '../components/PipelinePhase.js';
import type { PipelinePhaseData } from '../types.js';

const now = Date.now();

const activeSingleTask: PipelinePhaseData = {
  name: 'BUILDER',
  status: 'active',
  model: 'deepseek-v3',
  subtasks: [
    {
      id: '0',
      description: 'Work on landing/index.html',
      status: 'running',
      startedAt: now - 1000,
      progressSummary: 'reading landing/index.html',
      recentLogs: ['reading landing/index.html'],
    },
  ],
};

assert.equal(
  shouldCompactSubtasks(activeSingleTask, now),
  true,
  'single running task should stay compact during the initial delay',
);

assert.equal(
  shouldCompactSubtasks(activeSingleTask, now + ACTIVE_TASK_AUTO_EXPAND_DELAY_MS + 250),
  false,
  'single running task should auto-expand after the delay',
);

assert.equal(
  shouldCompactSubtasks({
    ...activeSingleTask,
    subtasks: [{ ...activeSingleTask.subtasks![0]!, status: 'waiting_approval' }],
  }, now),
  false,
  'approval states should stay expanded immediately',
);

console.log('Pipeline phase render tests passed.');
