import { describe, it, expect } from 'vitest';
import { redactSecrets, containsSecret } from '../redact.js';

describe('redactSecrets — pattern coverage', () => {
  it('catches Anthropic keys (sk-ant-*)', () => {
    const txt = 'my key is sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const r = redactSecrets(txt);
    expect(r.hits).toContain('anthropic');
    expect(r.redacted).toContain('[REDACTED:anthropic]');
    expect(r.redacted).not.toContain('sk-ant-api03');
  });

  it('catches OpenAI keys (sk-* and sk-proj-*)', () => {
    const r1 = redactSecrets('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123');
    // Either openai or env_assignment will catch this — both are acceptable.
    expect(r1.hits.length).toBeGreaterThan(0);
    expect(r1.redacted).not.toContain('sk-abcdefghijklm');

    const r2 = redactSecrets('token: sk-proj-AbCdEfGhIj0123456789KlMnOpQr');
    expect(r2.hits).toContain('openai');
    expect(r2.redacted).not.toContain('sk-proj-AbCdEfGhIj');
  });

  it('catches GitHub tokens (ghp_, gho_, ghs_, ghu_)', () => {
    for (const prefix of ['ghp', 'gho', 'ghs', 'ghu']) {
      const tok = `${prefix}_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab`;
      const r = redactSecrets(`use ${tok} please`);
      expect(r.hits).toContain('github');
      expect(r.redacted).not.toContain(tok);
    }
  });

  it('catches AWS access keys (AKIA*)', () => {
    const r = redactSecrets('AWS key AKIAIOSFODNN7EXAMPLE in config');
    expect(r.hits).toContain('aws_access_key');
    expect(r.redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('catches AWS secret when near "aws_secret_access_key"', () => {
    const r = redactSecrets('aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    expect(r.hits.some((h) => h === 'aws_secret' || h === 'env_assignment')).toBe(true);
    expect(r.redacted).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  });

  it('catches Slack tokens (xoxb-/xoxa-/.../xoxs-)', () => {
    const r = redactSecrets('slack token xoxb-12345-67890-abcdefghijkl');
    expect(r.hits).toContain('slack');
    expect(r.redacted).not.toContain('xoxb-12345');
  });

  it('catches JWTs (three base64url segments)', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3ODkw.SflKxwRJSMeKKF2QT4fwpMeJf';
    const r = redactSecrets(`Authorization: Bearer ${jwt}`);
    expect(r.hits).toContain('jwt');
    expect(r.redacted).not.toContain('eyJzdWIi');
  });

  it('catches .env-style assignment lines (multiline)', () => {
    const text = [
      'normal text here',
      'MY_API_KEY=abcdefghijklmnop',
      'DB_PASSWORD=hunter2hunter2',
      'NOT_A_SECRET=hi',
    ].join('\n');
    const r = redactSecrets(text);
    expect(r.hits.filter((h) => h === 'env_assignment').length).toBeGreaterThanOrEqual(2);
    expect(r.redacted).not.toContain('abcdefghijklmnop');
    expect(r.redacted).not.toContain('hunter2hunter2');
    expect(r.redacted).toContain('NOT_A_SECRET=hi');
  });

  it('catches postgres URL with embedded credentials', () => {
    const r = redactSecrets('DB=postgres://user:p4ssw0rd@db.example.com/app');
    expect(r.hits).toContain('postgres_url');
    expect(r.redacted).not.toContain('p4ssw0rd');
  });

  it('catches a secret inside a markdown code fence', () => {
    const txt = '```\nexport API_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789\n```';
    expect(containsSecret(txt)).toBe(true);
    const r = redactSecrets(txt);
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it('catches a secret with leading/trailing whitespace', () => {
    const txt = '   sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789   ';
    expect(containsSecret(txt)).toBe(true);
  });

  it('does NOT redact random base64-looking strings', () => {
    const txt = 'hash output: abc123def456ghi789jkl012';
    expect(containsSecret(txt)).toBe(false);
    const r = redactSecrets(txt);
    expect(r.hits).toHaveLength(0);
    expect(r.redacted).toBe(txt);
  });
});

describe('containsSecret', () => {
  it('returns true on the first matching pattern', () => {
    expect(containsSecret('hello sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')).toBe(true);
  });
  it('returns false on empty / clean text', () => {
    expect(containsSecret('')).toBe(false);
    expect(containsSecret('just some prose about refactoring')).toBe(false);
  });
});
