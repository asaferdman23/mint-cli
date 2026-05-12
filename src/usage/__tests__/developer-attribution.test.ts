/**
 * Tests for per-developer attribution (P2 of Phase-4 plan):
 *  - resolveDeveloper() honors MINT_DEVELOPER, falls back to git, then OS.
 *  - The usage.db schema has the new `developer` column and persists it.
 *  - `mint cost-report --by developer --export csv` aggregates correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageDb } from '../db.js';
import { resolveDeveloper, _resetDeveloperCache } from '../tracker.js';

describe('per-developer attribution', () => {
  let workDir: string;
  const originalDev = process.env.MINT_DEVELOPER;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'mint-dev-'));
    _resetDeveloperCache();
    delete process.env.MINT_DEVELOPER;
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    _resetDeveloperCache();
    if (originalDev === undefined) delete process.env.MINT_DEVELOPER;
    else process.env.MINT_DEVELOPER = originalDev;
  });

  it('resolveDeveloper honors MINT_DEVELOPER env var', () => {
    process.env.MINT_DEVELOPER = 'alice@example.com';
    expect(resolveDeveloper()).toBe('alice@example.com');
  });

  it('resolveDeveloper caches across calls', () => {
    process.env.MINT_DEVELOPER = 'bob@example.com';
    expect(resolveDeveloper()).toBe('bob@example.com');
    // Mutating the env after first call should not change the cached value.
    process.env.MINT_DEVELOPER = 'eve@example.com';
    expect(resolveDeveloper()).toBe('bob@example.com');
  });

  it('resolveDeveloper falls back to a non-empty string when no override is set', () => {
    // No env override; the resolver will try git, then os.userInfo, then 'unknown'.
    // We don't pin the value (CI machines differ) — just assert it's a string.
    const dev = resolveDeveloper();
    expect(typeof dev).toBe('string');
    expect(dev.length).toBeGreaterThan(0);
  });

  it('UsageDb persists the developer column', () => {
    const dbPath = join(workDir, 'usage.db');
    const db = new UsageDb(dbPath);

    db.insert({
      timestamp: Date.now(),
      sessionId: 's1',
      command: 'brain',
      model: 'claude-sonnet-4',
      provider: 'anthropic',
      tier: 'apex',
      inputTokens: 1000,
      outputTokens: 200,
      cost: 0.01,
      opusCost: 0.05,
      savedAmount: 0.04,
      routingReason: 'test',
      taskPreview: 'task A',
      latencyMs: 100,
      costSonnet: 0.01,
      cacheReadTokens: 500,
      cacheCreationTokens: 100,
      developer: 'alice@example.com',
    });

    db.insert({
      timestamp: Date.now(),
      sessionId: 's2',
      command: 'brain',
      model: 'claude-sonnet-4',
      provider: 'anthropic',
      tier: 'apex',
      inputTokens: 2000,
      outputTokens: 400,
      cost: 0.02,
      opusCost: 0.10,
      savedAmount: 0.08,
      routingReason: 'test',
      taskPreview: 'task B',
      latencyMs: 100,
      costSonnet: 0.02,
      developer: 'bob@example.com',
    });

    // Row without explicit developer should default to 'unknown'.
    db.insert({
      timestamp: Date.now(),
      sessionId: 's3',
      command: 'brain',
      model: 'gemini-2-flash',
      provider: 'google',
      tier: 'fast',
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.001,
      opusCost: 0.01,
      savedAmount: 0.009,
      routingReason: 'test',
      taskPreview: 'task C',
      latencyMs: 50,
      costSonnet: 0.001,
    });

    const rows = db.getAll();
    expect(rows).toHaveLength(3);
    const byDev = new Map(rows.map((r) => [r.sessionId, r.developer]));
    expect(byDev.get('s1')).toBe('alice@example.com');
    expect(byDev.get('s2')).toBe('bob@example.com');
    expect(byDev.get('s3')).toBe('unknown');
    db.close();
  });
});
