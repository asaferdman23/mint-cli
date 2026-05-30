// Tests for Phase 0.1 safety guards on the Session: runaway-loop detection
// (recordToolSignature + detectRepeatPattern) and the spend-cap approval flag.
import { describe, it, expect } from 'vitest';
import { Session } from '../session.js';

function newSession(): Session {
  return new Session({ task: 't', cwd: process.cwd(), mode: 'auto' });
}

describe('Session.detectRepeatPattern', () => {
  it('returns null until the threshold of identical calls is reached', () => {
    const s = newSession();
    s.recordToolSignature('read_file', { path: 'a.ts' });
    s.recordToolSignature('read_file', { path: 'a.ts' });
    expect(s.detectRepeatPattern(3)).toBeNull();
    s.recordToolSignature('read_file', { path: 'a.ts' });
    expect(s.detectRepeatPattern(3)).toEqual({ tool: 'read_file', count: 3 });
  });

  it('treats input key order as equal (stable serialization)', () => {
    const s = newSession();
    s.recordToolSignature('edit_file', { path: 'a.ts', content: 'x' });
    s.recordToolSignature('edit_file', { content: 'x', path: 'a.ts' });
    s.recordToolSignature('edit_file', { path: 'a.ts', content: 'x' });
    expect(s.detectRepeatPattern(3)).toEqual({ tool: 'edit_file', count: 3 });
  });

  it('does not trip when inputs differ', () => {
    const s = newSession();
    s.recordToolSignature('read_file', { path: 'a.ts' });
    s.recordToolSignature('read_file', { path: 'b.ts' });
    s.recordToolSignature('read_file', { path: 'c.ts' });
    expect(s.detectRepeatPattern(3)).toBeNull();
  });

  it('counts only the trailing run — a different call resets it', () => {
    const s = newSession();
    s.recordToolSignature('bash', { cmd: 'ls' });
    s.recordToolSignature('bash', { cmd: 'ls' });
    s.recordToolSignature('bash', { cmd: 'pwd' });
    expect(s.detectRepeatPattern(2)).toBeNull();
    s.recordToolSignature('bash', { cmd: 'pwd' });
    expect(s.detectRepeatPattern(2)).toEqual({ tool: 'bash', count: 2 });
  });
});

describe('Session spend-cap approval flag', () => {
  it('starts unapproved and latches once approved', () => {
    const s = newSession();
    expect(s.spendCapApproved).toBe(false);
    s.approveSpendCap();
    expect(s.spendCapApproved).toBe(true);
  });
});
