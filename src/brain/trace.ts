/**
 * JSONL trace writer.
 *
 * Every AgentEvent from a brain session is appended to
 *   ~/.mint/traces/<sessionId>.jsonl
 *
 * Non-serializable fields (e.g. approval.needed.resolve) are stripped first.
 * Older sessions are pruned — only the most recent RETAIN_SESSIONS stay on disk.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from './events.js';
import { serializableEvent } from './events.js';

const RETAIN_SESSIONS = 50;

export interface TraceWriter {
  write(event: AgentEvent): void;
  path: string | null;
  close(): void;
}

function traceDir(): string {
  return join(homedir(), '.mint', 'traces');
}

function ensureDir(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prune trace files older than the retention cap. Called lazily on session open.
 * Silent on failure — trace persistence is best-effort.
 */
function pruneOldSessions(dir: string): void {
  try {
    const entries = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of entries.slice(RETAIN_SESSIONS)) {
      try {
        unlinkSync(join(dir, entry.name));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore — non-critical */
  }
}

/**
 * Open a trace writer for this session. If the filesystem isn't writable
 * (e.g. read-only container), returns a no-op writer with `path = null`.
 */
export function openTrace(sessionId: string): TraceWriter {
  const dir = traceDir();
  const ok = ensureDir(dir);
  if (!ok) {
    return {
      path: null,
      write() {
        /* no-op */
      },
      close() {
        /* no-op */
      },
    };
  }

  pruneOldSessions(dir);
  const path = join(dir, `${sessionId}.jsonl`);
  let broken = false;

  return {
    path,
    write(event) {
      if (broken) return;
      try {
        const line = JSON.stringify(serializableEvent(event));
        appendFileSync(path, line + '\n', 'utf-8');
      } catch {
        // Filesystem went away mid-session — stop trying.
        broken = true;
      }
    },
    close() {
      /* appendFileSync is synchronous; nothing to flush */
    },
  };
}

export function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rnd}`;
}
