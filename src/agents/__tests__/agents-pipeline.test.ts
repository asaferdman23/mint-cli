/**
 * TDD tests for the real multi-agent pipeline.
 *
 * Tests the new types, JSON-parsing logic, builder isolated mode,
 * reviewer subtaskFeedback parsing, and orchestrator structure.
 *
 * These tests do NOT make real LLM calls — they test the parsing
 * and orchestration logic in isolation.
 */

import { strict as assert } from 'node:assert';

// ── 1. Types shape test ───────────────────────────────────────────────────────
// Import the types to verify they compile and have the right shapes.
import type {
  Subtask,
  ArchitectOutput,
  SubtaskBuilderResult,
  ReviewerOutput,
} from '../types.js';

// If these compile without error, the types are correct.
const _subtask: Subtask = {
  id: '1',
  description: 'Fix auth token expiry',
  relevantFiles: ['src/auth.ts'],
  plan: '1. In src/auth.ts add expiresIn option',
  specialist: 'backend',
};

const _architectOutputSingle: ArchitectOutput = {
  result: 'plan',
  type: 'single',
  plan: '1. change X',
  model: 'deepseek-v3',
  inputTokens: 100,
  outputTokens: 50,
  cost: 0.001,
  duration: 1000,
};

const _architectOutputSplit: ArchitectOutput = {
  result: 'split',
  type: 'split',
  subtasks: [_subtask],
  model: 'deepseek-v3',
  inputTokens: 100,
  outputTokens: 50,
  cost: 0.001,
  duration: 1000,
};

const _subtaskBuilderResult: SubtaskBuilderResult = {
  subtaskId: '1',
  response: 'diff output',
  model: 'deepseek-v3',
  inputTokens: 100,
  outputTokens: 200,
  cost: 0.005,
  duration: 2000,
};

const _reviewerOutput: ReviewerOutput = {
  result: '{"approved":true,"feedback":"ok"}',
  approved: true,
  feedback: 'ok',
  subtaskFeedback: { '1': 'missing null check' },
  model: 'groq-llama-70b',
  inputTokens: 50,
  outputTokens: 20,
  cost: 0.0001,
  duration: 500,
};

console.log('Types shape check passed.');

// ── 2. Architect JSON parsing ─────────────────────────────────────────────────
// Test parseArchitectResponse (we'll export it from architect.ts)
import { parseArchitectResponse } from '../architect.js';

// Single plan
{
  const json = JSON.stringify({ type: 'single', plan: '1. Change X in file.ts' });
  const result = parseArchitectResponse(json);
  assert.strictEqual(result.type, 'single', 'architect: type should be single');
  assert.strictEqual(result.plan, '1. Change X in file.ts', 'architect: plan should be set');
  assert.ok(!result.subtasks, 'architect: no subtasks for single');
}

// Split plan
{
  const json = JSON.stringify({
    type: 'split',
    reason: 'Independent changes',
    subtasks: [
      {
        id: '1',
        description: 'Auth fix',
        relevantFiles: ['src/auth.ts'],
        plan: '1. Add expiry',
        writeTargets: ['src/auth.ts'],
      },
      {
        id: '2',
        description: 'UI update',
        relevantFiles: ['src/ui.tsx'],
        plan: '1. Update button',
        dependsOn: ['1'],
        writeTargets: ['src/ui.tsx'],
        verificationTargets: ['src/ui.test.tsx'],
      },
    ],
  });
  const result = parseArchitectResponse(json);
  assert.strictEqual(result.type, 'split', 'architect: type should be split');
  assert.ok(Array.isArray(result.subtasks), 'architect: subtasks should be array');
  assert.strictEqual(result.subtasks!.length, 2, 'architect: should have 2 subtasks');
  assert.strictEqual(result.subtasks![0].id, '1', 'architect: first subtask id');
  assert.deepEqual(result.subtasks![0].relevantFiles, ['src/auth.ts'], 'architect: relevantFiles');
  assert.deepEqual(result.subtasks![0].writeTargets, ['src/auth.ts'], 'architect: writeTargets');
  assert.deepEqual(result.subtasks![1].dependsOn, ['1'], 'architect: dependsOn');
  assert.deepEqual(result.subtasks![1].verificationTargets, ['src/ui.test.tsx'], 'architect: verificationTargets');
}

// Invalid JSON → fallback to single plan
{
  const raw = 'Just some text with no JSON';
  const result = parseArchitectResponse(raw);
  assert.strictEqual(result.type, 'single', 'architect: fallback should be single');
  assert.strictEqual(result.plan, raw, 'architect: fallback plan is raw text');
}

// JSON with unknown type → fallback to single
{
  const json = JSON.stringify({ type: 'unknown', data: 'foo' });
  const result = parseArchitectResponse(json);
  assert.strictEqual(result.type, 'single', 'architect: unknown type falls back to single');
}

console.log('Architect JSON parsing tests passed.');

// ── 3. Reviewer subtaskFeedback parsing ───────────────────────────────────────
import { parseReviewerResponseFull } from '../reviewer.js';

// Approved with no subtask feedback
{
  const json = JSON.stringify({ approved: true, feedback: 'Looks good.', subtaskFeedback: {} });
  const result = parseReviewerResponseFull(json);
  assert.strictEqual(result.approved, true, 'reviewer: approved=true');
  assert.strictEqual(result.feedback, 'Looks good.', 'reviewer: feedback');
  assert.deepEqual(result.subtaskFeedback, {}, 'reviewer: empty subtaskFeedback');
}

// Rejected with per-subtask feedback
{
  const json = JSON.stringify({
    approved: false,
    feedback: 'Overall issue',
    subtaskFeedback: { '1': 'Missing null check', '2': 'Wrong import' },
  });
  const result = parseReviewerResponseFull(json);
  assert.strictEqual(result.approved, false, 'reviewer: approved=false');
  assert.strictEqual(result.subtaskFeedback?.['1'], 'Missing null check', 'reviewer: subtask 1 feedback');
  assert.strictEqual(result.subtaskFeedback?.['2'], 'Wrong import', 'reviewer: subtask 2 feedback');
}

// Fallback for malformed JSON
{
  const raw = '"approved": true, some malformed text';
  const result = parseReviewerResponseFull(raw);
  assert.ok(typeof result.approved === 'boolean', 'reviewer: fallback approved is boolean');
  assert.ok(result.subtaskFeedback !== undefined, 'reviewer: fallback subtaskFeedback exists');
}

console.log('Reviewer subtaskFeedback parsing tests passed.');

// ── 4. Builder options (isolated flag) ────────────────────────────────────────
// Test that the BuilderOptions type includes isolated flag.
import type { BuilderOptions } from '../builder.js';

const _builderOpts: BuilderOptions = {
  isolated: true,
  onText: (t: string) => { void t; },
};

const _builderOptsEmpty: BuilderOptions = {};

console.log('Builder options type check passed.');

// ── 5. Orchestrator exports ───────────────────────────────────────────────────
// Verify runAgentPipeline is exported from index.ts
import { runAgentPipeline } from '../index.js';

assert.strictEqual(typeof runAgentPipeline, 'function', 'index: runAgentPipeline must be a function');

// Verify it's an async generator
const gen = runAgentPipeline('test task', {
  cwd: '/tmp',
  signal: new AbortController().signal,
});
assert.ok(
  gen && typeof gen[Symbol.asyncIterator] === 'function',
  'index: runAgentPipeline must return an async iterable',
);

// Abort it immediately
gen.return?.('done');

console.log('Orchestrator export test passed.');

console.log('\nAll agent pipeline tests passed!');
