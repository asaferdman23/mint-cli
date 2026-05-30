import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { EmbeddingsStore, openEmbeddingsStore } from '../embeddings.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mint-emb-'));
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

describe('EmbeddingsStore — project_root isolation', () => {
  it('two cwds indexing the same file path produce independent rows', () => {
    // Single shared sqlite file (simulating ~/.mint/embeddings.sqlite) opened
    // under two project_roots.
    const sharedDir = makeTempDir();
    const dbPath = join(sharedDir, 'embeddings.sqlite');

    const projA = '/Users/test/projA';
    const projB = '/Users/test/projB';

    const a = new EmbeddingsStore(dbPath, projA);
    const b = new EmbeddingsStore(dbPath, projB);

    const fakeChunk = (path: string, sha: string) => ({
      path,
      start: 0,
      end: 10,
      sha,
      embedding: Float32Array.from([0.1, 0.2, 0.3]),
      summary: `${path} from ${sha}`,
    });

    a.replaceFile('src/foo.ts', [fakeChunk('src/foo.ts', 'sha-a')]);
    b.replaceFile('src/foo.ts', [fakeChunk('src/foo.ts', 'sha-b')]);

    const rowsA = a.loadAll();
    const rowsB = b.loadAll();

    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0].sha).toBe('sha-a');
    expect(rowsB[0].sha).toBe('sha-b');

    a.close();
    b.close();
  });

  it('query from one cwd does not return another cwd chunks', () => {
    const sharedDir = makeTempDir();
    const dbPath = join(sharedDir, 'embeddings.sqlite');

    const a = new EmbeddingsStore(dbPath, '/proj/a');
    const b = new EmbeddingsStore(dbPath, '/proj/b');

    a.replaceFile('src/only-in-a.ts', [
      {
        path: 'src/only-in-a.ts',
        start: 0,
        end: 5,
        sha: 'a',
        embedding: Float32Array.from([1]),
        summary: 'a',
      },
    ]);

    const rowsB = b.loadAll();
    expect(rowsB).toHaveLength(0);

    a.close();
    b.close();
  });

  it('migration is idempotent — reopening after migration does not error', () => {
    const sharedDir = makeTempDir();
    const dbPath = join(sharedDir, 'embeddings.sqlite');

    const a = new EmbeddingsStore(dbPath, '/proj/a');
    a.close();
    // Reopen — schema is already at v1, migration must be a no-op.
    const b = new EmbeddingsStore(dbPath, '/proj/a');
    b.close();
    const c = new EmbeddingsStore(dbPath, '/proj/a');
    c.close();
  });

  it('opens a legacy DB (chunks table without project_root) and adds the column', () => {
    const sharedDir = makeTempDir();
    const dbPath = join(sharedDir, 'embeddings.sqlite');

    // Hand-roll a pre-PR4 schema.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        start INTEGER NOT NULL,
        end INTEGER NOT NULL,
        sha TEXT NOT NULL,
        embedding BLOB NOT NULL,
        summary TEXT
      );
    `);
    legacy.close();

    // Now open via EmbeddingsStore — migration should add the column.
    const store = new EmbeddingsStore(dbPath, '/proj/a');
    expect(() =>
      store.replaceFile('src/foo.ts', [
        {
          path: 'src/foo.ts',
          start: 0,
          end: 1,
          sha: 'x',
          embedding: Float32Array.from([1]),
          summary: '',
        },
      ]),
    ).not.toThrow();
    store.close();
  });

  it('openEmbeddingsStore wires the cwd as project_root', () => {
    const cwd = makeTempDir();
    const store = openEmbeddingsStore(cwd);
    store.replaceFile('foo.ts', [
      {
        path: 'foo.ts',
        start: 0,
        end: 1,
        sha: 's',
        embedding: Float32Array.from([1]),
        summary: '',
      },
    ]);
    expect(store.loadAll()).toHaveLength(1);
    store.close();
  });
});
