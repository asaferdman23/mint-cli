// Tests for openUserMemoryStore + the explicit-path option on openMemoryStore.
// We mock homedir() via process.env.HOME redirect inside a tmpdir so the test
// never touches the real ~/.mint/memory.sqlite.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mint-user-mem-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  const fakeHome = makeTempDir();
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('openUserMemoryStore', () => {
  it('writes to ~/.mint/memory.sqlite (mocked homedir)', async () => {
    const { openUserMemoryStore } = await import('../store.js');
    const store = openUserMemoryStore();
    const expected = join(homedir(), '.mint', 'memory.sqlite');
    expect(existsSync(expected)).toBe(true);
    await store.write('preference', { kind: 'preference', text: 'user pref one' });
    store.close();
  });

  it('user-store writes are isolated from project store at the same time', async () => {
    const { openUserMemoryStore, openMemoryStore } = await import('../store.js');
    const projCwd = makeTempDir();

    const user = openUserMemoryStore();
    const proj = openMemoryStore(projCwd);

    await user.write('preference', { kind: 'preference', text: 'user only pref' });
    const userRows = await user.query({ kinds: ['preference'] });
    const projRows = await proj.query({ kinds: ['preference'] });
    user.close();
    proj.close();

    expect(userRows.map((r) => r.text)).toContain('user only pref');
    expect(projRows.map((r) => r.text)).not.toContain('user only pref');
    expect(projRows).toHaveLength(0);
  });

  it('openMemoryStore(_, { path }) overrides the cwd-based resolution', async () => {
    const { openMemoryStore } = await import('../store.js');
    const dir = makeTempDir();
    const explicit = join(dir, 'explicit.sqlite');
    const store = openMemoryStore('/nonexistent/cwd', { path: explicit });
    expect(existsSync(explicit)).toBe(true);
    store.close();
  });
});
