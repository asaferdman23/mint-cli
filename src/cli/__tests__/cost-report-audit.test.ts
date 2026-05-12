/**
 * Audit-grade CSV (P4 of Phase-4 plan): tamper-evident hash chain.
 *
 *  - Each row's hash = sha256(prev_hash + '\n' + canonical_row).
 *  - The first row's prev_hash = literal "GENESIS".
 *  - Mutating any column breaks the chain at that row and propagates forward.
 */
import { describe, it, expect } from 'vitest';
import { auditRowHash, verifyAuditChain } from '../commands/cost-report.js';
import type { UsageRecord } from '../../usage/db.js';

function row(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: 0,
    timestamp: 1715520000000, // fixed instant — keep hash stable across CI runs
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
    taskPreview: 'audit',
    latencyMs: 100,
    costSonnet: 0.01,
    cacheReadTokens: 500,
    cacheCreationTokens: 100,
    developer: 'alice@example.com',
    ...overrides,
  };
}

describe('audit-grade CSV — tamper-evident chain', () => {
  it('produces deterministic hashes for an unchanged row sequence', () => {
    const rows = [row({ sessionId: 's1' }), row({ sessionId: 's2' }), row({ sessionId: 's3' })];
    let prev = 'GENESIS';
    const a: string[] = [];
    for (const r of rows) {
      prev = auditRowHash(r, prev);
      a.push(prev);
    }
    let prev2 = 'GENESIS';
    const b: string[] = [];
    for (const r of rows) {
      prev2 = auditRowHash(r, prev2);
      b.push(prev2);
    }
    expect(a).toEqual(b);
    expect(a[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('mutating one column breaks the chain at that row and forward', () => {
    const rows = [row({ sessionId: 's1' }), row({ sessionId: 's2' }), row({ sessionId: 's3' })];
    const hashes: string[] = [];
    let prev = 'GENESIS';
    for (const r of rows) {
      prev = auditRowHash(r, prev);
      hashes.push(prev);
    }
    // Original chain verifies.
    expect(verifyAuditChain(rows, hashes)).toBe(true);

    // Tamper: change the cost of row 1.
    const tampered = [rows[0], { ...rows[1], cost: 99.99 }, rows[2]];
    expect(verifyAuditChain(tampered, hashes)).toBe(false);
  });

  it('verifyAuditChain returns false on length mismatch', () => {
    const rows = [row()];
    expect(verifyAuditChain(rows, [])).toBe(false);
  });

  it('different starting prev_hash produces different chain', () => {
    const r = row();
    const a = auditRowHash(r, 'GENESIS');
    const b = auditRowHash(r, 'OTHER');
    expect(a).not.toBe(b);
  });
});
