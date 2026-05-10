/**
 * Record / replay harness for `streamAgent`.
 *
 * Two modes, controlled by env vars:
 *   MINT_RECORD=1                       — capture every streamAgent call to
 *                                          test/fixtures/recordings/<hash>.jsonl
 *   MINT_REPLAY=<dir>                   — replay matching fixtures from <dir>
 *                                          instead of calling the real provider
 *
 * Hash key: SHA256 of (model + systemPrompt + messages + tools). Two calls with
 * the same inputs share the same fixture, which is the whole point of the
 * cost-regression suite — we want deterministic cost comparisons across runs.
 *
 * The recordings store both the streamed chunks AND a `meta` line summarizing
 * what was recorded (model, ts, cost estimate). The replay path streams chunks
 * back in order with no provider call.
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AgentStreamChunk, CompletionRequest } from './types.js';

interface RecordingMeta {
  type: 'meta';
  model: string;
  ts: number;
  hash: string;
  systemPromptPreview: string;
  taskPreview: string;
}

type RecordingLine = RecordingMeta | { type: 'chunk'; chunk: AgentStreamChunk };

function recordingKey(request: CompletionRequest): string {
  const payload = {
    model: request.model,
    systemPrompt: request.systemPrompt ?? '',
    messages: request.messages,
    tools: request.tools?.map((t) => t.name) ?? [],
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

function recordingsBaseDir(): string {
  // Default to <cwd>/test/fixtures/recordings; override with MINT_REPLAY=<abs-path>.
  return resolve(process.cwd(), 'test', 'fixtures', 'recordings');
}

export function isRecording(): boolean {
  return process.env.MINT_RECORD === '1';
}

export function isReplaying(): boolean {
  return !!process.env.MINT_REPLAY;
}

function replayDir(): string {
  const v = process.env.MINT_REPLAY;
  if (!v || v === '1') return recordingsBaseDir();
  return resolve(v);
}

/**
 * Wrap a streamAgent producer with recording: every chunk is yielded AND
 * appended to the fixture for this request.
 */
export async function* recordStream(
  request: CompletionRequest,
  inner: AsyncIterable<AgentStreamChunk>,
): AsyncIterable<AgentStreamChunk> {
  const hash = recordingKey(request);
  const dir = recordingsBaseDir();
  const path = join(dir, `${hash}.jsonl`);

  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const meta: RecordingMeta = {
      type: 'meta',
      model: request.model,
      ts: Date.now(),
      hash,
      systemPromptPreview: (request.systemPrompt ?? '').slice(0, 200),
      taskPreview: JSON.stringify(request.messages).slice(0, 300),
    };
    // Truncate the file at the start of each capture so we don't double-write
    // when a fixture is re-recorded.
    const fs = await import('node:fs');
    fs.writeFileSync(path, JSON.stringify(meta) + '\n', 'utf-8');
  } catch (err) {
    // Recording is best-effort — surface but don't break the run.
    process.stderr.write(`[mint-record] init failed: ${(err as Error).message}\n`);
  }

  for await (const chunk of inner) {
    try {
      const line: RecordingLine = { type: 'chunk', chunk };
      appendFileSync(path, JSON.stringify(line) + '\n', 'utf-8');
    } catch {
      /* fixture write failure is non-fatal */
    }
    yield chunk;
  }
}

/**
 * Replay a fixture that matches this request. Returns null if no fixture is
 * found — caller should fall through to a live call (or fail in tests).
 */
export async function* replayStream(
  request: CompletionRequest,
): AsyncIterable<AgentStreamChunk> {
  const hash = recordingKey(request);
  const dir = replayDir();
  const path = join(dir, `${hash}.jsonl`);

  if (!existsSync(path)) {
    throw new Error(
      `[mint-replay] no fixture for ${request.model} (hash=${hash}). Re-record with MINT_RECORD=1.`,
    );
  }

  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    let parsed: RecordingLine;
    try {
      parsed = JSON.parse(line) as RecordingLine;
    } catch {
      continue;
    }
    if (parsed.type === 'chunk') {
      yield parsed.chunk;
    }
  }
}

/** List all fixture hashes in <dir>. Useful for replay tests. */
export function listFixtures(dir = recordingsBaseDir()): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''));
}

/** Read a fixture's metadata (the first line). Returns null if absent/malformed. */
export function readFixtureMeta(hash: string, dir = recordingsBaseDir()): RecordingMeta | null {
  const path = join(dir, `${hash}.jsonl`);
  if (!existsSync(path)) return null;
  const firstLine = readFileSync(path, 'utf-8').split('\n', 1)[0];
  try {
    const parsed = JSON.parse(firstLine);
    if (parsed?.type === 'meta') return parsed as RecordingMeta;
  } catch {
    /* fall through */
  }
  return null;
}

// Suppress unused-warning on dirname import (kept for future cross-platform use).
void dirname;
