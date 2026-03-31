// src/context/agentmd.ts
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AgentMd {
  raw: string;
  sections: {
    project?: string;
    rules?: string;
    architecture?: string;
    gotchas?: string;
    commands?: string;
  };
  sourcePath: string;
  loadedAt: number;
}

interface CacheEntry {
  data: AgentMd;
  mtime: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Search order (first found wins):
 *   1. {cwd}/AGENT.md
 *   2. {cwd}/.axon/AGENT.md
 *   3. ~/.axon/AGENT.md
 *
 * Returns null if none found.
 * Caches with mtime invalidation — safe to call on every agent iteration.
 */
export async function loadAgentMd(cwd: string): Promise<AgentMd | null> {
  const candidates = [
    join(cwd, 'AGENT.md'),
    join(cwd, '.mint', 'AGENT.md'),
    join(homedir(), '.mint', 'AGENT.md'),
  ];

  for (const candidatePath of candidates) {
    try {
      const stats = await stat(candidatePath);
      const mtime = stats.mtimeMs;

      // Cache hit: same mtime → return cached
      const cached = cache.get(candidatePath);
      if (cached && cached.mtime === mtime) {
        return cached.data;
      }

      // Cache miss or stale: re-read
      const raw = await readFile(candidatePath, 'utf-8');
      const data: AgentMd = {
        raw,
        sections: parseSections(raw),
        sourcePath: candidatePath,
        loadedAt: Date.now(),
      };
      cache.set(candidatePath, { data, mtime });
      return data;
    } catch {
      // File doesn't exist at this path — try next
      continue;
    }
  }

  return null;
}

/**
 * Format the AGENT.md content for injection into the system prompt.
 * Always injected FIRST — highest priority context.
 */
export function formatAgentMdForPrompt(agentMd: AgentMd): string {
  return `<agent_context source="${agentMd.sourcePath}">
${agentMd.raw}
</agent_context>

`;
}

// ─── Section parser ──────────────────────────────────────────────────────────

function parseSections(raw: string): AgentMd['sections'] {
  const sections: AgentMd['sections'] = {};
  const sectionRegex = /^##\s+(\w+)\s*$/gm;

  let match: RegExpExecArray | null;
  const boundaries: Array<{ name: string; start: number }> = [];

  while ((match = sectionRegex.exec(raw)) !== null) {
    boundaries.push({ name: match[1].toLowerCase(), start: match.index + match[0].length });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const { name, start } = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1].start : raw.length;
    const content = raw.slice(start, end).trim();

    switch (name) {
      case 'project':      sections.project = content; break;
      case 'rules':        sections.rules = content; break;
      case 'architecture': sections.architecture = content; break;
      case 'gotchas':      sections.gotchas = content; break;
      case 'commands':     sections.commands = content; break;
    }
  }

  return sections;
}
