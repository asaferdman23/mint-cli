/**
 * TDD tests for the specialist builder system and skills system.
 *
 * Tests:
 * 1. Specialist configs have correct shape
 * 2. detectSpecialist classifies files correctly
 * 3. getSpecialist returns valid configs
 * 4. Skills loading and filtering
 * 5. Subtask type includes specialist field
 * 6. Architect response parsing includes specialist
 * 7. BuilderOptions includes specialist field
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// ── 1. Specialist types compile ──────────────────────────────────────────────
import type { SpecialistType, SpecialistConfig } from '../specialists/types.js';

const _specialistType: SpecialistType = 'frontend';
const _config: SpecialistConfig = {
  type: 'frontend',
  systemPrompt: 'test',
  allowedTools: ['read_file'],
  extraContextGlobs: ['**/*.tsx'],
};

console.log('1. Specialist types compile: PASSED');

// ── 2. All specialist configs exist and have correct shape ───────────────────
import { getSpecialist, detectSpecialist } from '../specialists/index.js';

const specialistTypes: SpecialistType[] = [
  'frontend', 'backend', 'database', 'testing', 'devops', 'docs', 'general',
];

for (const type of specialistTypes) {
  const config = getSpecialist(type);
  assert.strictEqual(config.type, type, `getSpecialist('${type}') should have type='${type}'`);
  assert.ok(config.systemPrompt.length > 10, `'${type}' should have a non-empty systemPrompt`);
  assert.ok(Array.isArray(config.allowedTools), `'${type}' should have allowedTools array`);
  assert.ok(config.allowedTools.length > 0, `'${type}' should have at least one allowed tool`);
  assert.ok(Array.isArray(config.extraContextGlobs), `'${type}' should have extraContextGlobs array`);
}

console.log('2. All specialist configs exist: PASSED');

// ── 3. detectSpecialist classifies files correctly ───────────────────────────
// Frontend
assert.strictEqual(detectSpecialist(['src/App.tsx']), 'frontend');
assert.strictEqual(detectSpecialist(['components/Button.jsx']), 'frontend');
assert.strictEqual(detectSpecialist(['src/styles/main.css']), 'frontend');
assert.strictEqual(detectSpecialist(['src/components/Header.vue']), 'frontend');
assert.strictEqual(detectSpecialist(['src/Widget.svelte']), 'frontend');

// Backend
assert.strictEqual(detectSpecialist(['src/routes/api.ts']), 'backend');
assert.strictEqual(detectSpecialist(['src/controllers/user.ts']), 'backend');
assert.strictEqual(detectSpecialist(['src/middleware/auth.ts']), 'backend');
assert.strictEqual(detectSpecialist(['server.ts']), 'backend');

// Database
assert.strictEqual(detectSpecialist(['prisma/schema.prisma']), 'database');
assert.strictEqual(detectSpecialist(['migrations/001_init.sql']), 'database');
assert.strictEqual(detectSpecialist(['drizzle/schema.ts']), 'database');

// Testing
assert.strictEqual(detectSpecialist(['src/utils.test.ts']), 'testing');
assert.strictEqual(detectSpecialist(['src/__tests__/app.test.ts']), 'testing');
assert.strictEqual(detectSpecialist(['tests/integration.spec.ts']), 'testing');

// DevOps
assert.strictEqual(detectSpecialist(['Dockerfile']), 'devops');
assert.strictEqual(detectSpecialist(['.github/workflows/ci.yml']), 'devops');
assert.strictEqual(detectSpecialist(['docker-compose.yml']), 'devops');

// Docs
assert.strictEqual(detectSpecialist(['README.md']), 'docs');
assert.strictEqual(detectSpecialist(['CHANGELOG.md']), 'docs');
assert.strictEqual(detectSpecialist(['docs/api.md']), 'docs');

// General (fallback)
assert.strictEqual(detectSpecialist(['src/utils.ts']), 'general');
assert.strictEqual(detectSpecialist([]), 'general');

console.log('3. detectSpecialist classifications: PASSED');

// ── 4. Skills loading and filtering ──────────────────────────────────────────
import { loadSkills, getSkillsForSpecialist } from '../../context/skills.js';

// Create a temp skills directory
const tempDir = join('/tmp', `mint-skills-test-${Date.now()}`);
const skillsDir = join(tempDir, '.mint', 'skills');
mkdirSync(skillsDir, { recursive: true });

// Create test skills
writeFileSync(join(skillsDir, 'react-patterns.md'), `---
applies_to: [frontend]
---
# React Patterns
- Use functional components
- Prefer hooks over HOCs
`);

writeFileSync(join(skillsDir, 'api-patterns.md'), `---
applies_to: [backend, database]
---
# API Patterns
- Validate all inputs
- Use proper HTTP status codes
`);

writeFileSync(join(skillsDir, 'general-style.md'), `# General Code Style
- Be consistent
- Write tests
`);

// Load skills
const skills = loadSkills(tempDir);
assert.strictEqual(skills.length, 3, `Should load 3 skills, got ${skills.length}`);

// Verify skill shapes
const reactSkill = skills.find(s => s.name === 'react-patterns');
assert.ok(reactSkill, 'Should find react-patterns skill');
assert.deepEqual(reactSkill!.appliesTo, ['frontend'], 'react-patterns should apply to frontend');
assert.ok(reactSkill!.content.includes('functional components'), 'react-patterns should have content');

const apiSkill = skills.find(s => s.name === 'api-patterns');
assert.ok(apiSkill, 'Should find api-patterns skill');
assert.deepEqual(apiSkill!.appliesTo, ['backend', 'database'], 'api-patterns should apply to backend, database');

const generalSkill = skills.find(s => s.name === 'general-style');
assert.ok(generalSkill, 'Should find general-style skill');
assert.strictEqual(generalSkill!.appliesTo, 'all', 'Skills without frontmatter should apply to all');

// Filter skills for specialist
const frontendSkills = getSkillsForSpecialist(skills, 'frontend');
assert.ok(frontendSkills.some(s => s.name === 'react-patterns'), 'Frontend should get react-patterns');
assert.ok(frontendSkills.some(s => s.name === 'general-style'), 'Frontend should get general-style (applies to all)');
assert.ok(!frontendSkills.some(s => s.name === 'api-patterns'), 'Frontend should NOT get api-patterns');

const backendSkills = getSkillsForSpecialist(skills, 'backend');
assert.ok(backendSkills.some(s => s.name === 'api-patterns'), 'Backend should get api-patterns');
assert.ok(backendSkills.some(s => s.name === 'general-style'), 'Backend should get general-style');
assert.ok(!backendSkills.some(s => s.name === 'react-patterns'), 'Backend should NOT get react-patterns');

// Empty skills dir
const emptySkills = loadSkills('/tmp/nonexistent-dir-12345');
assert.strictEqual(emptySkills.length, 0, 'Should return empty array for nonexistent dir');

// Cleanup
rmSync(tempDir, { recursive: true, force: true });

console.log('4. Skills loading and filtering: PASSED');

// ── 5. Subtask type includes specialist ──────────────────────────────────────
import type { Subtask } from '../types.js';

const _subtaskWithSpecialist: Subtask = {
  id: '1',
  description: 'Fix auth',
  relevantFiles: ['src/auth.ts'],
  plan: '1. Fix token expiry',
  specialist: 'backend',
  scopeDirectory: 'src',
  entryFiles: ['src/auth.ts'],
  researchSummary: 'Auth lives in src/auth.ts.',
  builderBrief: 'Read src/auth.ts first and patch token expiry there.',
};
assert.strictEqual(_subtaskWithSpecialist.specialist, 'backend');

console.log('5. Subtask type includes specialist: PASSED');

// ── 6. Architect response parsing includes specialist ────────────────────────
import { parseArchitectResponse } from '../architect.js';

// Single plan with specialist
{
  const json = JSON.stringify({ type: 'single', plan: '1. Change X', specialist: 'frontend' });
  const result = parseArchitectResponse(json);
  assert.strictEqual(result.type, 'single');
  assert.strictEqual(result.plan, '1. Change X');
}

// Split with specialist per subtask
{
  const json = JSON.stringify({
    type: 'split',
    reason: 'Independent changes',
    subtasks: [
      {
        id: '1',
        description: 'Fix UI',
        relevantFiles: ['src/App.tsx'],
        plan: '1. Update',
        specialist: 'frontend',
        scopeDirectory: 'src',
        entryFiles: ['src/App.tsx'],
        researchSummary: 'App.tsx is the main composition root.',
        builderBrief: 'Read App.tsx first and keep the existing UI patterns.',
      },
      {
        id: '2',
        description: 'Fix API',
        relevantFiles: ['src/api.ts'],
        plan: '1. Fix route',
        specialist: 'backend',
        scopeDirectory: 'src',
        entryFiles: ['src/api.ts'],
        researchSummary: 'api.ts owns the route wiring.',
        builderBrief: 'Read api.ts first and patch the route in place.',
      },
    ],
  });
  const result = parseArchitectResponse(json);
  assert.strictEqual(result.type, 'split');
  assert.strictEqual(result.subtasks![0].specialist, 'frontend');
  assert.strictEqual(result.subtasks![1].specialist, 'backend');
  assert.strictEqual(result.subtasks![0].scopeDirectory, 'src');
  assert.deepStrictEqual(result.subtasks![0].entryFiles, ['src/App.tsx']);
}

// Missing specialist defaults to 'general'
{
  const json = JSON.stringify({
    type: 'split',
    subtasks: [
      { id: '1', description: 'Something', relevantFiles: ['src/foo.ts'], plan: '1. Do it' },
    ],
  });
  const result = parseArchitectResponse(json);
  // Should use detectSpecialist as fallback -> 'general' for src/foo.ts
  assert.ok(result.subtasks![0].specialist, 'Missing specialist should have a fallback');
}

console.log('6. Architect parsing with specialist: PASSED');

// ── 7. BuilderOptions includes specialist ────────────────────────────────────
import type { BuilderOptions } from '../builder.js';

const _builderOptsWithSpec: BuilderOptions = {
  isolated: true,
  specialist: 'frontend',
};
assert.strictEqual(_builderOptsWithSpec.specialist, 'frontend');

console.log('7. BuilderOptions includes specialist: PASSED');

console.log('\nAll specialist & skills tests passed!');
