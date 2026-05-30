import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __testing } from '../loop.js';

const { buildSystemPrompt } = __testing;

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mint-prompt-'));
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

describe('buildSystemPrompt', () => {
  it('omits <agent_context source=...> block when AGENT.md is absent', async () => {
    const cwd = makeTempDir();
    const out = await buildSystemPrompt(cwd, []);
    expect(out).not.toMatch(/<agent_context source=/);
  });

  it('omits <project_rules source=...> block when MINT.md is absent', async () => {
    const cwd = makeTempDir();
    const out = await buildSystemPrompt(cwd, []);
    expect(out).not.toMatch(/<project_rules source=/);
  });

  it('emits both blocks in correct order when both present', async () => {
    const cwd = makeTempDir();
    writeFileSync(join(cwd, 'AGENT.md'), '# Agent rules\nAGENT_FIXTURE_TOKEN', 'utf-8');
    writeFileSync(join(cwd, 'MINT.md'), '# Project rules\nMINT_FIXTURE_TOKEN', 'utf-8');

    const out = await buildSystemPrompt(cwd, []);
    expect(out).toContain('<agent_context source=');
    expect(out).toContain('AGENT_FIXTURE_TOKEN');
    expect(out).toContain('<project_rules source=');
    expect(out).toContain('MINT_FIXTURE_TOKEN');

    const agentIdx = out.indexOf('<agent_context source=');
    const rulesIdx = out.indexOf('<project_rules source=');
    expect(agentIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeGreaterThan(agentIdx);
  });

  it('places retrieved-files <context> block below memory blocks', async () => {
    const cwd = makeTempDir();
    writeFileSync(join(cwd, 'AGENT.md'), 'AGENT_FIXTURE_TOKEN', 'utf-8');
    writeFileSync(join(cwd, 'MINT.md'), 'MINT_FIXTURE_TOKEN', 'utf-8');

    const out = await buildSystemPrompt(cwd, [
      { path: 'src/foo.ts', summary: 'foo module' },
    ]);

    const agentIdx = out.indexOf('<agent_context source=');
    const rulesIdx = out.indexOf('<project_rules source=');
    const ctxIdx = out.indexOf('<context>');
    expect(agentIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeGreaterThan(agentIdx);
    expect(ctxIdx).toBeGreaterThan(rulesIdx);
    expect(out).toContain('src/foo.ts');
  });

  it('includes the project_conventions instruction in the header', async () => {
    const cwd = makeTempDir();
    const out = await buildSystemPrompt(cwd, []);
    expect(out).toContain('<project_conventions>');
    expect(out).toContain('<agent_context>');
    expect(out).toContain('<project_rules>');
  });

  it('places CRITICAL RULES (no clarifying questions, pronoun resolution) above <rules>', async () => {
    const cwd = makeTempDir();
    const out = await buildSystemPrompt(cwd, []);
    expect(out).toContain('CRITICAL RULES');
    expect(out).toContain('NEVER ask the user clarifying questions');
    expect(out).toContain('RESOLVE PRONOUNS FROM PRIOR_TURNS FIRST');

    const criticalIdx = out.indexOf('CRITICAL RULES');
    const rulesIdx = out.indexOf('<rules>');
    expect(criticalIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeGreaterThan(criticalIdx);
  });
});
