/**
 * Embeddings layer — semantic vectors for files and task outcomes.
 *
 * The Mint gateway does NOT expose /v1/embeddings today (verified against
 * mint-gateway repo). This module probes for it and degrades gracefully to
 * BM25-only retrieval when absent. A BYOK OpenAI key unlocks embeddings
 * immediately via the OpenAI API.
 *
 * Persistence: .mint/embeddings.sqlite
 *   CREATE TABLE chunks (
 *     id INTEGER PK,
 *     path TEXT,
 *     start INTEGER,
 *     end INTEGER,
 *     sha TEXT,
 *     embedding BLOB,    -- f32 buffer
 *     summary TEXT
 *   );
 */
import Database, { type Database as Db } from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../utils/config.js';

export const EMBEDDING_DIM = 1536; // OpenAI text-embedding-3-small

export interface EmbeddingProvider {
  kind: 'gateway' | 'openai' | 'none';
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface ProbeResult {
  available: boolean;
  provider: 'gateway' | 'openai' | 'none';
  reason?: string;
}

// ─── Capability probe ───────────────────────────────────────────────────────

/**
 * Check once per session whether an embeddings endpoint is reachable.
 * Order of preference: gateway → OpenAI BYOK → none (BM25-only).
 */
export async function probeEmbeddings(signal?: AbortSignal): Promise<ProbeResult> {
  const gatewayUrl = config.getGatewayUrl();
  try {
    const res = await fetch(`${gatewayUrl}/v1/embeddings`, {
      method: 'OPTIONS',
      signal,
    });
    // Gateway currently returns 404 for this path. Any 2xx/4xx-not-404 is
    // treated as "endpoint exists, probably usable".
    if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 404)) {
      return { available: true, provider: 'gateway' };
    }
  } catch {
    /* fall through */
  }

  const providerKeys = (() => {
    try {
      return config.get('providers') as Record<string, string> | undefined;
    } catch {
      return undefined;
    }
  })();
  if (providerKeys?.openai) {
    return { available: true, provider: 'openai' };
  }

  return {
    available: false,
    provider: 'none',
    reason: 'no /v1/embeddings endpoint and no openai key configured',
  };
}

// ─── Providers ──────────────────────────────────────────────────────────────

function getOpenAIKey(): string | null {
  try {
    const providerKeys = config.get('providers') as Record<string, string> | undefined;
    return providerKeys?.openai ?? null;
  } catch {
    return null;
  }
}

async function openaiEmbed(
  texts: string[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status}`);
  const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return body.data.map((d) => Float32Array.from(d.embedding));
}

async function gatewayEmbed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
  const gatewayUrl = config.getGatewayUrl();
  const token = config.get('gatewayToken') as string | undefined;
  if (!token) throw new Error('no gateway token; run `mint login`');

  const res = await fetch(`${gatewayUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ input: texts, model: 'embedding-small' }),
    signal,
  });
  if (!res.ok) throw new Error(`gateway embeddings failed: ${res.status}`);
  const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return body.data.map((d) => Float32Array.from(d.embedding));
}

/** Construct a provider based on a completed probe. */
export function makeEmbeddingProvider(probe: ProbeResult): EmbeddingProvider {
  if (probe.provider === 'openai') {
    const key = getOpenAIKey();
    if (!key) return noopProvider();
    return {
      kind: 'openai',
      embed: (texts) => openaiEmbed(texts, key),
    };
  }
  if (probe.provider === 'gateway') {
    return { kind: 'gateway', embed: (texts) => gatewayEmbed(texts) };
  }
  return noopProvider();
}

function noopProvider(): EmbeddingProvider {
  return {
    kind: 'none',
    async embed() {
      throw new Error('embeddings unavailable — BM25 only');
    },
  };
}

// ─── Vector store ───────────────────────────────────────────────────────────

export interface ChunkRow {
  id: number;
  path: string;
  start: number;
  end: number;
  sha: string;
  embedding: Float32Array;
  summary: string;
}

export class EmbeddingsStore {
  private readonly db: Db;
  private readonly insertStmt;
  private readonly dropFileStmt;
  private readonly fetchAllStmt;
  private readonly shaByPathStmt;

  constructor(dbPath: string) {
    const dir = join(dbPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        start INTEGER NOT NULL,
        end INTEGER NOT NULL,
        sha TEXT NOT NULL,
        embedding BLOB NOT NULL,
        summary TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE INDEX IF NOT EXISTS idx_chunks_sha ON chunks(path, sha);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO chunks (path, start, end, sha, embedding, summary)
      VALUES (@path, @start, @end, @sha, @embedding, @summary)
    `);
    this.dropFileStmt = this.db.prepare(`DELETE FROM chunks WHERE path = ?`);
    this.fetchAllStmt = this.db.prepare(
      `SELECT id, path, start, end, sha, embedding, summary FROM chunks`,
    );
    this.shaByPathStmt = this.db.prepare(
      `SELECT DISTINCT sha FROM chunks WHERE path = ? LIMIT 1`,
    );
  }

  /** Replace all chunks for a file with a new set. */
  replaceFile(path: string, chunks: Array<Omit<ChunkRow, 'id'>>): void {
    const txn = this.db.transaction(() => {
      this.dropFileStmt.run(path);
      for (const c of chunks) {
        this.insertStmt.run({
          path: c.path,
          start: c.start,
          end: c.end,
          sha: c.sha,
          embedding: Buffer.from(c.embedding.buffer),
          summary: c.summary ?? '',
        });
      }
    });
    txn();
  }

  /** Has this file been indexed at this sha already? */
  hasFileSha(path: string, sha: string): boolean {
    const row = this.shaByPathStmt.get(path) as { sha: string } | undefined;
    return row?.sha === sha;
  }

  /** Pull all chunks into memory for similarity scoring. Cheap up to ~50k chunks. */
  loadAll(): ChunkRow[] {
    const rows = this.fetchAllStmt.all() as Array<{
      id: number;
      path: string;
      start: number;
      end: number;
      sha: string;
      embedding: Buffer;
      summary: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      start: r.start,
      end: r.end,
      sha: r.sha,
      summary: r.summary ?? '',
      embedding: new Float32Array(
        r.embedding.buffer,
        r.embedding.byteOffset,
        r.embedding.byteLength / 4,
      ),
    }));
  }

  close(): void {
    this.db.close();
  }
}

export function openEmbeddingsStore(cwd: string): EmbeddingsStore {
  return new EmbeddingsStore(join(cwd, '.mint', 'embeddings.sqlite'));
}

// ─── Similarity ─────────────────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
