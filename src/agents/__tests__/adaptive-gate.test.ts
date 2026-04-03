import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAdaptiveGate } from '../adaptive-gate.js';
import { persistSessionMemory, type SessionMemorySnapshot } from '../../context/session-memory.js';

function createFixtureDir(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mint-adaptive-gate-'));
  mkdirSync(join(cwd, 'landing'), { recursive: true });
  mkdirSync(join(cwd, 'src', 'dashboard'), { recursive: true });
  mkdirSync(join(cwd, 'src', 'api'), { recursive: true });

  writeFileSync(join(cwd, 'landing', 'index.html'), '<section id="hero"><button class="cta">Start</button></section>\n', 'utf8');
  writeFileSync(join(cwd, 'landing', 'styles.css'), '.cta { color: red; }\n', 'utf8');
  writeFileSync(join(cwd, 'src', 'dashboard', 'Page.tsx'), 'export function Page() { return <main>Dashboard</main>; }\n', 'utf8');
  writeFileSync(join(cwd, 'src', 'api', 'auth.ts'), 'export function addAuth() { return true; }\n', 'utf8');
  return cwd;
}

async function writeMemory(cwd: string, snapshot: Partial<SessionMemorySnapshot> = {}): Promise<void> {
  const base: SessionMemorySnapshot = {
    updatedAt: new Date().toISOString(),
    cwd,
    task: 'Change the landing page hero button color',
    complexity: 'simple',
    filesSearched: ['landing/index.html', 'landing/styles.css'],
    scopeDirectories: ['landing'],
    entryFiles: ['landing/index.html', 'landing/styles.css'],
    writeTargets: ['landing/styles.css'],
    architectResearch: ['The landing directory owns the hero and CTA styles.'],
    builderBriefs: ['Start in landing/index.html and landing/styles.css.'],
    ...snapshot,
  };
  await persistSessionMemory(cwd, base);
}

async function main(): Promise<void> {
  {
    const cwd = createFixtureDir();
    try {
      const decision = await resolveAdaptiveGate({
        input: { cwd, task: 'change button color in landing hero' },
      });
      assert.equal(decision.mode, 'direct_builder', 'explicit local scope should skip architect');
      assert.ok(decision.searchResults.some((file) => file.path === 'landing/index.html'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  {
    const cwd = createFixtureDir();
    try {
      await writeMemory(cwd);
      const decision = await resolveAdaptiveGate({
        input: { cwd, task: 'change it back' },
      });
      assert.equal(decision.mode, 'direct_builder_with_memory', 'referential request with memory should reuse prior scope');
      assert.ok(decision.directSubtask?.writeTargets?.includes('landing/styles.css'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  {
    const cwd = createFixtureDir();
    try {
      const decision = await resolveAdaptiveGate({
        input: { cwd, task: 'change it back' },
      });
      assert.equal(decision.mode, 'clarify', 'referential request without memory should clarify');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  {
    const cwd = createFixtureDir();
    try {
      const decision = await resolveAdaptiveGate({
        input: { cwd, task: 'build the most beautiful frontend ever' },
      });
      assert.equal(decision.mode, 'spec_required', 'high-taste greenfield prompt should require a spec');
      assert.match(decision.response ?? '', /minimum spec/i);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  {
    const cwd = createFixtureDir();
    try {
      const decision = await resolveAdaptiveGate({
        input: { cwd, task: 'add auth to dashboard and API' },
      });
      assert.equal(decision.mode, 'architect_pipeline', 'multi-domain task should use architect');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  {
    const cwd = createFixtureDir();
    try {
      await writeMemory(cwd, {
        task: 'Fix auth token expiry',
        filesSearched: ['src/api/auth.ts'],
        scopeDirectories: ['src/api'],
        entryFiles: ['src/api/auth.ts'],
        writeTargets: ['src/api/auth.ts'],
      });
      const decision = await resolveAdaptiveGate({
        input: { cwd, task: 'change button color in landing hero' },
      });
      assert.equal(decision.mode, 'direct_builder', 'explicit current scope should override stale memory');
      assert.ok(!decision.directSubtask?.writeTargets?.includes('src/api/auth.ts'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  console.log('Adaptive gate tests passed.');
}

await main();
