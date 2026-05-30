import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPromptTiers, flattenTiers } from '../prompt-tiers.js';
import { __testing } from '../loop.js';

const { buildSystemPrompt } = __testing;

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mint-tiers-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('buildPromptTiers', () => {
  it('returns all three tiers when AGENT.md + MINT.md + files + deepPlanBlock all present', async () => {
    const cwd = makeTempDir();
    writeFileSync(join(cwd, 'AGENT.md'), 'AGENT_FIXTURE', 'utf-8');
    writeFileSync(join(cwd, 'MINT.md'), 'MINT_FIXTURE', 'utf-8');

    const tiers = await buildPromptTiers({
      cwd,
      files: [{ path: 'src/foo.ts', summary: 'foo' }],
      deepPlanBlock: '\n\n<plan>\n  1. step\n</plan>\n\nExecute the plan.',
    });

    expect(tiers.base).toContain('You are Mint');
    expect(tiers.base).toContain('<rules>');
    expect(tiers.base).toContain('<project_conventions>');
    expect(tiers.project).toContain('<agent_context source=');
    expect(tiers.project).toContain('AGENT_FIXTURE');
    expect(tiers.project).toContain('<project_rules source=');
    expect(tiers.project).toContain('MINT_FIXTURE');
    expect(tiers.dynamic).toContain('<context>');
    expect(tiers.dynamic).toContain('src/foo.ts');
    expect(tiers.dynamic).toContain('<plan>');
  });

  it('project tier is null when AGENT.md and MINT.md are both absent', async () => {
    const cwd = makeTempDir();
    const tiers = await buildPromptTiers({ cwd, files: [] });
    expect(tiers.project).toBeNull();
  });

  it('dynamic tier is null with no files and no deepPlanBlock', async () => {
    const cwd = makeTempDir();
    const tiers = await buildPromptTiers({ cwd, files: [] });
    expect(tiers.dynamic).toBeNull();
  });

  it('dynamic tier holds only the context block when no deepPlanBlock is supplied', async () => {
    const cwd = makeTempDir();
    const tiers = await buildPromptTiers({
      cwd,
      files: [{ path: 'a.ts' }],
    });
    expect(tiers.dynamic).toContain('<context>');
    expect(tiers.dynamic).not.toContain('<plan>');
  });

  it('back-compat shim buildSystemPrompt() matches flattenTiers() for identical inputs', async () => {
    const cwd = makeTempDir();
    writeFileSync(join(cwd, 'AGENT.md'), 'AG', 'utf-8');
    writeFileSync(join(cwd, 'MINT.md'), 'MN', 'utf-8');

    const tiers = await buildPromptTiers({ cwd, files: [{ path: 'x.ts' }] });
    const flat = flattenTiers(tiers);
    const legacy = await buildSystemPrompt(cwd, [{ path: 'x.ts' }]);

    expect(legacy).toBe(flat);
  });

  it('flattenTiers omits null tiers', () => {
    const flat = flattenTiers({ base: 'A', project: null, dynamic: null });
    expect(flat).toBe('A');
  });

  it('flattenTiers joins all three tiers in order', () => {
    const flat = flattenTiers({ base: 'A', project: 'B', dynamic: 'C' });
    expect(flat).toBe('A\n\nB\n\nC');
  });

  it('sessionSummaries are rendered as a <prior_turns> block in the dynamic tier', async () => {
    const cwd = makeTempDir();
    const tiers = await buildPromptTiers({
      cwd,
      files: [],
      sessionSummaries: ['turn one summary', 'turn two summary'],
    });
    expect(tiers.dynamic).not.toBeNull();
    expect(tiers.dynamic).toContain('<prior_turns>');
    expect(tiers.dynamic).toContain('1. turn one summary');
    expect(tiers.dynamic).toContain('2. turn two summary');
    expect(tiers.dynamic).toContain('</prior_turns>');
  });

  it('empty sessionSummaries → no <prior_turns> block', async () => {
    const cwd = makeTempDir();
    const tiers = await buildPromptTiers({
      cwd,
      files: [{ path: 'a.ts' }],
      sessionSummaries: [],
    });
    expect(tiers.dynamic).not.toBeNull();
    expect(tiers.dynamic).not.toContain('<prior_turns>');
  });

  it('whitespace-only sessionSummaries are filtered out', async () => {
    const cwd = makeTempDir();
    const tiers = await buildPromptTiers({
      cwd,
      files: [],
      sessionSummaries: ['', '   ', '\n'],
    });
    expect(tiers.dynamic).toBeNull();
  });

  it('userPreferences render as a <user_preferences> block in the project tier', async () => {
    const cwd = makeTempDir();
    writeFileSync(join(cwd, 'AGENT.md'), 'AGENT_FIXTURE', 'utf-8');
    const tiers = await buildPromptTiers({
      cwd,
      files: [],
      userPreferences: ['user prefers vitest over jest', 'terse PR titles'],
    });
    expect(tiers.project).not.toBeNull();
    expect(tiers.project).toContain('<user_preferences>');
    expect(tiers.project).toContain('- user prefers vitest over jest');
    expect(tiers.project).toContain('- terse PR titles');
    expect(tiers.project).toContain('</user_preferences>');
  });

  it('empty userPreferences + no AGENT.md/MINT.md → project tier is null', async () => {
    const cwd = makeTempDir();
    const tiers = await buildPromptTiers({
      cwd,
      files: [],
      userPreferences: [],
    });
    expect(tiers.project).toBeNull();
  });

  it('<user_preferences> appears ABOVE <agent_context> and <project_rules>', async () => {
    const cwd = makeTempDir();
    writeFileSync(join(cwd, 'AGENT.md'), 'AGENT_FIXTURE', 'utf-8');
    writeFileSync(join(cwd, 'MINT.md'), 'MINT_FIXTURE', 'utf-8');
    const tiers = await buildPromptTiers({
      cwd,
      files: [],
      userPreferences: ['vitest pref'],
    });
    expect(tiers.project).not.toBeNull();
    const prefsIdx = tiers.project!.indexOf('<user_preferences>');
    const agentIdx = tiers.project!.indexOf('<agent_context');
    const rulesIdx = tiers.project!.indexOf('<project_rules');
    expect(prefsIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeGreaterThan(prefsIdx);
    expect(rulesIdx).toBeGreaterThan(agentIdx);
  });

  it('<prior_turns> appears before <context> in the dynamic tier (prefix-cache stability)', async () => {
    const cwd = makeTempDir();
    const tiers = await buildPromptTiers({
      cwd,
      files: [{ path: 'a.ts' }],
      sessionSummaries: ['turn one'],
    });
    expect(tiers.dynamic).not.toBeNull();
    const priorIdx = tiers.dynamic!.indexOf('<prior_turns>');
    const ctxIdx = tiers.dynamic!.indexOf('<context>');
    expect(priorIdx).toBeGreaterThanOrEqual(0);
    expect(ctxIdx).toBeGreaterThan(priorIdx);
  });
});
