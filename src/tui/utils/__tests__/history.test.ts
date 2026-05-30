/**
 * Tests for the persistent input-history ring buffer (Batch D).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHistory, appendHistory, HISTORY_CAP } from '../history.js';

describe('tui input history', () => {
  let workDir: string;
  let historyPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'mint-history-'));
    historyPath = join(workDir, 'history');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns [] when the history file is missing', async () => {
    const entries = await loadHistory(historyPath);
    expect(entries).toEqual([]);
  });

  it('returns [] when the parent directory is missing', async () => {
    const missing = join(workDir, 'does-not-exist', 'history');
    const entries = await loadHistory(missing);
    expect(entries).toEqual([]);
  });

  it('round-trips append → load', async () => {
    await appendHistory('first prompt', historyPath);
    await appendHistory('second prompt', historyPath);
    await appendHistory('third prompt', historyPath);
    const entries = await loadHistory(historyPath);
    expect(entries).toEqual(['first prompt', 'second prompt', 'third prompt']);
  });

  it('skips empty strings on append', async () => {
    await appendHistory('a', historyPath);
    await appendHistory('', historyPath);
    await appendHistory('   ', historyPath);
    await appendHistory('b', historyPath);
    const entries = await loadHistory(historyPath);
    expect(entries).toEqual(['a', 'b']);
  });

  it('dedupes consecutive identical submissions', async () => {
    await appendHistory('same', historyPath);
    await appendHistory('same', historyPath);
    await appendHistory('different', historyPath);
    await appendHistory('same', historyPath);
    const entries = await loadHistory(historyPath);
    expect(entries).toEqual(['same', 'different', 'same']);
  });

  it('enforces the HISTORY_CAP, evicting oldest entries', async () => {
    // Seed the file directly with > CAP lines so we don't pay the append cost.
    const seed: string[] = [];
    for (let i = 0; i < HISTORY_CAP + 50; i++) seed.push(`entry-${i}`);
    writeFileSync(historyPath, seed.join('\n') + '\n', 'utf8');

    const loaded = await loadHistory(historyPath);
    expect(loaded.length).toBe(HISTORY_CAP);
    expect(loaded[0]).toBe(`entry-50`);
    expect(loaded[loaded.length - 1]).toBe(`entry-${HISTORY_CAP + 49}`);

    // Appending past the cap must keep the buffer at the cap and evict oldest.
    await appendHistory('newest', historyPath);
    const after = await loadHistory(historyPath);
    expect(after.length).toBe(HISTORY_CAP);
    expect(after[after.length - 1]).toBe('newest');
    expect(after[0]).toBe(`entry-51`);
  });

  it('returns [] when the file is binary/corrupt', async () => {
    // Buffer with control bytes that the loader rejects.
    writeFileSync(historyPath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]));
    const entries = await loadHistory(historyPath);
    expect(entries).toEqual([]);
  });

  it('appendHistory swallows errors when path is unwritable', async () => {
    // A path under a file (not a dir) — mkdir will fail. Should not throw.
    const filePath = join(workDir, 'blocker');
    writeFileSync(filePath, 'x');
    await expect(
      appendHistory('hello', join(filePath, 'history')),
    ).resolves.toBeUndefined();
  });

  it('persists with trailing newline so external tooling can append', async () => {
    await appendHistory('one', historyPath);
    const raw = readFileSync(historyPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });
});
