import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

import {
  formatSessionMemorySummary,
  getSessionMemoryCandidateFiles,
  isReferentialTask,
  loadSessionMemory,
  loadSessionMemorySnapshot,
  persistSessionMemory,
  type SessionMemorySnapshot,
} from '../session-memory.js';

const cwd = mkdtempSync(join(tmpdir(), 'mint-memory-'));

const snapshot: SessionMemorySnapshot = {
  updatedAt: '2026-04-02T10:00:00.000Z',
  runId: 'run-123',
  cwd,
  task: 'Review the landing page hero and revert the headline change',
  complexity: 'simple',
  filesSearched: ['landing/index.html', 'landing/src/App.tsx'],
  scopeDirectories: ['landing', 'landing/src'],
  entryFiles: ['landing/index.html'],
  writeTargets: ['landing/index.html'],
  architectPlan: 'Read landing/index.html first, then revert the headline block.',
  architectResearch: ['The hero headline is rendered directly in landing/index.html.'],
  builderBriefs: ['Start in landing/index.html and restore the previous headline markup.'],
  finalResponseSummary: 'Reverted the landing page headline to the previous copy.',
  reviewerFeedback: undefined,
};

await persistSessionMemory(cwd, snapshot);

assert.ok(existsSync(join(cwd, '.mint', 'MEMORY.md')), 'writes .mint/MEMORY.md');
assert.ok(existsSync(join(cwd, '.mint', 'memory.json')), 'writes .mint/memory.json');

const markdown = readFileSync(join(cwd, '.mint', 'MEMORY.md'), 'utf8');
assert.ok(markdown.includes('landing/index.html'), 'markdown contains entry file');
assert.ok(markdown.includes('Review the landing page hero'), 'markdown contains task');

const loadedSnapshot = await loadSessionMemorySnapshot(cwd);
assert.equal(loadedSnapshot?.task, snapshot.task, 'loads snapshot json');

writeFileSync(join(cwd, 'MEMORY.md'), '# Manual Memory\n\nRemember the landing page lives under landing/.', 'utf8');
const loadedMemory = await loadSessionMemory(cwd);
assert.ok(loadedMemory?.raw.includes('Manual Memory'), 'loads manual root MEMORY.md');
assert.ok(loadedMemory?.raw.includes('Session Memory'), 'loads auto memory too');

const summary = formatSessionMemorySummary(snapshot);
assert.ok(summary.includes('Scope: landing'), 'summary includes scope');
assert.deepEqual(
  getSessionMemoryCandidateFiles(snapshot),
  ['landing/index.html', 'landing/src/App.tsx'],
  'candidate files are deduped and ordered',
);

assert.equal(isReferentialTask('change it back to what was there before'), true, 'detects referential tasks');
assert.equal(isReferentialTask('review the landing page hero'), false, 'does not mark direct tasks as referential');

rmSync(cwd, { recursive: true, force: true });

console.log('Session memory tests passed.');
