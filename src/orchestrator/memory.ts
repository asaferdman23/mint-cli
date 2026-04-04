/**
 * Persistent memory across sessions.
 * Saves to .mint/memory.json — what files were edited, project info, user preferences.
 * Loaded at session start, injected into the orchestrator system prompt.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface ProjectMemory {
  /** Last updated timestamp */
  updatedAt: string;
  /** Files the user has edited in past sessions */
  recentFiles: string[];
  /** What the project is (detected from package.json, readme, etc) */
  projectDescription?: string;
  /** Primary language */
  language?: string;
  /** Key directories the user works in */
  activeDirectories: string[];
  /** User preferences observed from past sessions */
  preferences: string[];
  /** Summary of what was done in recent sessions */
  sessionSummaries: string[];
}

const MEMORY_PATH = '.mint/memory.json';
const MAX_RECENT_FILES = 20;
const MAX_SUMMARIES = 10;

export function loadMemory(cwd: string): ProjectMemory | null {
  try {
    const content = readFileSync(join(cwd, MEMORY_PATH), 'utf-8');
    return JSON.parse(content) as ProjectMemory;
  } catch {
    return null;
  }
}

export function saveMemory(cwd: string, memory: ProjectMemory): void {
  const fullPath = join(cwd, MEMORY_PATH);
  try {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(memory, null, 2), 'utf-8');
  } catch {
    // Non-fatal — memory is best-effort
  }
}

export function updateMemory(
  cwd: string,
  update: {
    editedFiles?: string[];
    sessionSummary?: string;
    projectDescription?: string;
    language?: string;
  },
): void {
  const existing = loadMemory(cwd) ?? {
    updatedAt: new Date().toISOString(),
    recentFiles: [],
    activeDirectories: [],
    preferences: [],
    sessionSummaries: [],
  };

  if (update.editedFiles) {
    const combined = [...new Set([...update.editedFiles, ...(existing.recentFiles ?? [])])];
    existing.recentFiles = combined.slice(0, MAX_RECENT_FILES);
    const dirs = new Set(existing.activeDirectories ?? []);
    for (const f of update.editedFiles) {
      const parts = f.split('/');
      if (parts.length > 1) dirs.add(parts.slice(0, -1).join('/'));
    }
    existing.activeDirectories = [...dirs].slice(0, 10);
  }

  if (update.sessionSummary) {
    existing.sessionSummaries = [
      update.sessionSummary,
      ...(existing.sessionSummaries ?? []),
    ].slice(0, MAX_SUMMARIES);
  }

  if (update.projectDescription) existing.projectDescription = update.projectDescription;
  if (update.language) existing.language = update.language;

  existing.updatedAt = new Date().toISOString();
  saveMemory(cwd, existing);
}

export function formatMemoryForPrompt(memory: ProjectMemory): string {
  const parts: string[] = [];

  if (memory.projectDescription) {
    parts.push(`Project: ${memory.projectDescription}`);
  }
  if (memory.language) {
    parts.push(`Language: ${memory.language}`);
  }
  if (memory.recentFiles?.length > 0) {
    parts.push(`Recently edited files: ${memory.recentFiles.slice(0, 10).join(', ')}`);
  }
  if (memory.activeDirectories?.length > 0) {
    parts.push(`Active directories: ${memory.activeDirectories.join(', ')}`);
  }
  if (memory.sessionSummaries?.length > 0) {
    parts.push(`Recent session: ${memory.sessionSummaries[0]}`);
  }

  return parts.length > 0
    ? `\n<project_memory>\n${parts.join('\n')}\n</project_memory>`
    : '';
}

/**
 * Load project instructions from MINT.md, CLAUDE.md, or .mint/rules/*.md
 * These override default behavior — the orchestrator must follow them.
 */
export async function loadProjectInstructions(cwd: string): Promise<string | null> {
  const candidates = [
    'MINT.md',
    '.mint/MINT.md',
    'CLAUDE.md',
    '.claude/CLAUDE.md',
  ];

  const parts: string[] = [];

  for (const candidate of candidates) {
    const fullPath = join(cwd, candidate);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8').trim();
        if (content.length > 0 && content.length < 40_000) {
          parts.push(`# ${candidate}\n${content}`);
        }
      } catch { /* ignore */ }
    }
  }

  // Also load .mint/rules/*.md
  const rulesDir = join(cwd, '.mint', 'rules');
  if (existsSync(rulesDir)) {
    try {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(rulesDir) as string[];
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const content = readFileSync(join(rulesDir, file), 'utf-8').trim();
          if (content.length > 0 && content.length < 10_000) {
            parts.push(`# .mint/rules/${file}\n${content}`);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}
