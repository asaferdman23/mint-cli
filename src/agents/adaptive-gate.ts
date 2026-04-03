import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { indexProject, loadIndex, searchRelevantFiles } from '../context/index.js';
import { collectPathHintFiles, extractHotspots, type Hotspot, type SearchResult } from '../context/search.js';
import {
  formatSessionMemorySummary,
  getSessionMemoryCandidateFiles,
  getSessionMemoryScopeHints,
  isReferentialTask,
  loadSessionMemorySnapshot,
  type SessionMemorySnapshot,
} from '../context/session-memory.js';
import { detectSpecialist, detectSpecialistFromTask } from './specialists/index.js';
import { getConversationBypass } from './conversation-gate.js';
import { classifyTaskHeuristically } from './scout.js';
import { inferBuilderTaskIntent } from './task-intent.js';
import type { AgentInput, Subtask, TaskComplexity } from './types.js';

export type AdaptiveGateMode =
  | 'chat'
  | 'question'
  | 'direct_builder'
  | 'direct_builder_with_memory'
  | 'architect_pipeline'
  | 'clarify'
  | 'spec_required';

export interface AdaptiveGateDecision {
  mode: AdaptiveGateMode;
  complexity: TaskComplexity;
  response?: string;
  searchResults: SearchResult[];
  hotspots: Hotspot[];
  scoutSummary: string;
  scoutModelLabel: string;
  directSubtask?: Subtask;
}

interface LocalDiscoveryResult {
  searchResults: SearchResult[];
  explicitHintFiles: string[];
  usedMemory: boolean;
}

const PLANNING_HEAVY_HINTS =
  /\b(architect|plan|redesign|refactor|system|feature|flow|pipeline|orchestr|multi[- ]agent|integrat|migration|migrate|cross[- ]domain|end[- ]to[- ]end|from scratch)\b/i;

const HIGH_TASTE_HINTS =
  /\b(best|beaut[a-z]*|stunning|gorgeous|premium|world[- ]class|amazing|incredible|perfect|professional|sleek|modern|clean|minimal[a-z]*|elegant)\b/i;

const GREENFIELD_SURFACE_HINTS =
  /\b(frontend|website|site|landing page|homepage|page|game|app|ui|interface)\b/i;

const GENERIC_UNDERSPECIFIED_CHANGE =
  /^(?:please\s+)?(?:fix|change|update|edit|modify|make|build|create|improve|review|scan|check)(?:\s+(?:it|that|this|thing|stuff|bug|issue|page|site|frontend))?(?:[!?.\s]*)$/i;

export async function resolveAdaptiveGate(args: {
  input: AgentInput;
}): Promise<AdaptiveGateDecision> {
  const { input } = args;
  const bypass = getConversationBypass(input.task);
  if (bypass) {
    return {
      mode: 'chat',
      complexity: 'trivial',
      response: bypass.response,
      searchResults: [],
      hotspots: [],
      scoutSummary: bypass.reason,
      scoutModelLabel: 'conversation',
    };
  }

  const sessionSnapshot = await loadSessionMemorySnapshot(input.cwd).catch(() => null);
  const referential = isReferentialTask(input.task);

  const discovery = await runLocalDiscovery({
    input,
    sessionSnapshot,
  });
  const searchResults = discovery.searchResults;
  const hotspots = extractHotspots(searchResults, input.task);
  const files = searchResults.map((file) => file.path);
  const domains = countDistinctDomains(files);
  const clearDirectoryCluster = hasClearDirectoryCluster(files);
  const scopeKnown = files.length > 0;
  const builderIntent = inferBuilderTaskIntent(input.task);
  const planningHeavy = PLANNING_HEAVY_HINTS.test(input.task);
  const highTaste = HIGH_TASTE_HINTS.test(input.task);
  const greenfieldSurface = GREENFIELD_SURFACE_HINTS.test(input.task);
  const complexity = estimateGateComplexity({
    task: input.task,
    scopeKnown,
    fileCount: files.length,
    domainCount: domains,
    planningHeavy,
  });
  const memoryConflict = hasMemoryConflict(sessionSnapshot, discovery.explicitHintFiles);
  const usableMemory = referential && hasUsableMemory(sessionSnapshot) && !memoryConflict;

  // Greenfield + no existing files + vague prompt → need more info before building
  // But NOT when the user wants to fix/update something existing — the builder can read the files
  const isFixIntent = /\b(fix|update|change|edit|modify|patch|debug|repair)\b/i.test(input.task);
  if (greenfieldSurface && !scopeKnown && !isFixIntent) {
    const hasConcreteSpec = input.task.length > 150
      || /\b(section|hero|pricing|footer|feature|testimonial|navbar|sidebar)\b/i.test(input.task)
      || /\b(react|next|vue|svelte|vite|tailwind|html|css)\b/i.test(input.task);

    if (!hasConcreteSpec) {
      return {
        mode: 'clarify',
        complexity,
        searchResults,
        hotspots,
        scoutSummary: 'need business context',
        scoutModelLabel: 'local gate',
      };
    }

    if (highTaste) {
      return {
        mode: 'spec_required',
        complexity,
        response: buildSpecRequiredResponse(input.task),
        searchResults,
        hotspots,
        scoutSummary: 'spec required',
        scoutModelLabel: 'local gate',
      };
    }
  }

  if (referential && usableMemory && scopeKnown) {
    return {
      mode: 'direct_builder_with_memory',
      complexity: complexity === 'trivial' ? 'simple' : complexity,
      searchResults,
      hotspots,
      scoutSummary: formatScoutSummary('direct builder + memory', searchResults),
      scoutModelLabel: 'memory + index',
      directSubtask: buildDirectBuilderSubtask({
        task: input.task,
        searchResults,
        sessionSnapshot,
        useMemory: true,
      }),
    };
  }

  if (referential && !usableMemory && !scopeKnown) {
    return {
      mode: 'clarify',
      complexity,
      searchResults,
      hotspots,
      scoutSummary: 'clarification required',
      scoutModelLabel: 'local gate',
    };
  }

  if (builderIntent === 'change' && scopeKnown && domains <= 1 && (files.length <= 3 || clearDirectoryCluster) && !planningHeavy) {
    return {
      mode: 'direct_builder',
      complexity: complexity === 'trivial' ? 'simple' : complexity,
      searchResults,
      hotspots,
      scoutSummary: formatScoutSummary('direct builder', searchResults),
      scoutModelLabel: 'index',
      directSubtask: buildDirectBuilderSubtask({
        task: input.task,
        searchResults,
        sessionSnapshot: memoryConflict ? null : sessionSnapshot,
        useMemory: false,
      }),
    };
  }

  if (!scopeKnown && shouldClarify(input.task)) {
    return {
      mode: 'clarify',
      complexity,
      searchResults,
      hotspots,
      scoutSummary: 'clarification required',
      scoutModelLabel: 'local gate',
    };
  }

  // Questions / inspection requests → answer from found files, skip build pipeline
  if (builderIntent === 'analysis') {
    return {
      mode: 'question',
      complexity: 'simple',
      searchResults,
      hotspots,
      scoutSummary: formatScoutSummary('question', searchResults),
      scoutModelLabel: 'local gate',
    };
  }

  return {
    mode: 'architect_pipeline',
    complexity,
    searchResults,
    hotspots,
    scoutSummary: formatScoutSummary('architect pipeline', searchResults),
    scoutModelLabel: 'local gate',
  };
}

async function runLocalDiscovery(args: {
  input: AgentInput;
  sessionSnapshot: SessionMemorySnapshot | null;
}): Promise<LocalDiscoveryResult> {
  const { input, sessionSnapshot } = args;
  let index = await loadIndex(input.cwd);
  if (!index || index.totalFiles === 0) {
    index = await indexProject(input.cwd);
  }

  const explicitHintFiles = collectPathHintFiles(input.task, index, 6);
  const referential = isReferentialTask(input.task);
  const memoryConflict = hasMemoryConflict(sessionSnapshot, explicitHintFiles);
  const useMemory = referential && hasUsableMemory(sessionSnapshot) && !memoryConflict;
  const alwaysInclude = uniqueStrings([
    ...explicitHintFiles,
    ...(useMemory ? getSessionMemoryCandidateFiles(sessionSnapshot) : []),
  ]);
  const query = buildLocalSearchQuery(input.task, input.history, useMemory ? sessionSnapshot : null);

  let searchResults = await searchRelevantFiles(input.cwd, query, index, {
    maxFiles: 10,
    alwaysInclude,
  });

  if (searchResults.length === 0 && alwaysInclude.length > 0) {
    searchResults = await hydrateSearchResults(input.cwd, index, alwaysInclude, useMemory ? 'session memory' : 'path hint');
  }

  return {
    searchResults,
    explicitHintFiles,
    usedMemory: useMemory,
  };
}

function buildLocalSearchQuery(
  task: string,
  history: AgentInput['history'],
  sessionSnapshot: SessionMemorySnapshot | null,
): string {
  const parts: string[] = [task];
  if (history && history.length > 0) {
    const historySummary = history
      .slice(-3)
      .map((message) => `${message.role}: ${message.content.trim()}`)
      .filter((line) => line.length > 0)
      .join('\n');
    if (historySummary) {
      parts.push(`Recent conversation:\n${historySummary}`);
    }
  }
  if (sessionSnapshot) {
    parts.push(`Session memory:\n${formatSessionMemorySummary(sessionSnapshot)}`);
  }
  return parts.join('\n\n');
}

async function hydrateSearchResults(
  cwd: string,
  index: Awaited<ReturnType<typeof loadIndex>>,
  filePaths: string[],
  reason: string,
): Promise<SearchResult[]> {
  if (!index) return [];

  const results: SearchResult[] = [];
  for (const filePath of uniqueStrings(filePaths).slice(0, 10)) {
    try {
      const content = await readFile(join(cwd, filePath), 'utf8');
      results.push({
        path: filePath,
        content,
        language: index.files[filePath]?.language ?? 'text',
        score: 100,
        reason,
      });
    } catch {
      // Ignore missing files.
    }
  }
  return results;
}

function buildDirectBuilderSubtask(args: {
  task: string;
  searchResults: SearchResult[];
  sessionSnapshot: SessionMemorySnapshot | null;
  useMemory: boolean;
}): Subtask {
  const files = args.searchResults.map((file) => file.path);
  const scopeDirectory = args.useMemory
    ? args.sessionSnapshot?.scopeDirectories.find(Boolean) ?? deriveScopeDirectory(files)
    : deriveScopeDirectory(files);
  const entryFiles = uniqueStrings([
    ...(args.useMemory ? args.sessionSnapshot?.entryFiles ?? [] : []),
    ...files,
  ]).slice(0, 3);
  const writeTargets = uniqueStrings([
    ...(args.useMemory ? args.sessionSnapshot?.writeTargets ?? [] : []),
    ...files,
  ]);
  const memoryHints = args.useMemory && args.sessionSnapshot
    ? getSessionMemoryScopeHints(args.sessionSnapshot)
    : [];
  const researchSummary = [
    files.length > 0 ? `Resolved local scope: ${files.join(', ')}.` : undefined,
    memoryHints.length > 0 ? `Prior scope: ${memoryHints.join(', ')}.` : undefined,
    args.useMemory ? 'Use session memory only as grounding for this continuation request.' : undefined,
  ].filter(Boolean).join(' ');

  const builderBrief = [
    scopeDirectory ? `Start in ${scopeDirectory}.` : 'Start in the resolved files.',
    entryFiles.length > 0 ? `Read ${entryFiles.join(', ')} first.` : undefined,
    args.useMemory ? 'Use the last successful scope to interpret the referential request before making changes.' : 'This is a local bounded change. Stay inside the resolved scope unless you hit a hard dependency.',
  ].filter(Boolean).join(' ');

  return {
    id: '0',
    description: describeScope(files, 'Work on the requested change'),
    relevantFiles: files,
    plan: args.useMemory
      ? `Resolve this continuation using the stored scope and current files: ${args.task}`
      : `Implement this local change directly in the resolved scope: ${args.task}`,
    specialist: (() => {
      const fromFiles = detectSpecialist(writeTargets.length > 0 ? writeTargets : files);
      return fromFiles !== 'general' ? fromFiles : detectSpecialistFromTask(args.task);
    })(),
    ...(scopeDirectory ? { scopeDirectory } : {}),
    ...(entryFiles.length > 0 ? { entryFiles } : {}),
    ...(researchSummary ? { researchSummary } : {}),
    ...(builderBrief ? { builderBrief } : {}),
    ...(writeTargets.length > 0 ? { writeTargets } : {}),
  };
}

function estimateGateComplexity(args: {
  task: string;
  scopeKnown: boolean;
  fileCount: number;
  domainCount: number;
  planningHeavy: boolean;
}): TaskComplexity {
  let complexity = classifyTaskHeuristically(args.task) ?? 'moderate';

  if (args.domainCount > 1 || args.planningHeavy) {
    complexity = bumpComplexity(complexity, 'moderate');
  }
  if (!args.scopeKnown || args.fileCount > 6) {
    complexity = bumpComplexity(complexity, 'moderate');
  }
  if (args.fileCount > 10) {
    complexity = 'complex';
  }
  if (args.scopeKnown && args.domainCount <= 1 && args.fileCount <= 3 && !args.planningHeavy) {
    complexity = 'simple';
  }

  return complexity;
}

function bumpComplexity(current: TaskComplexity, next: TaskComplexity): TaskComplexity {
  const rank: Record<TaskComplexity, number> = {
    trivial: 0,
    simple: 1,
    moderate: 2,
    complex: 3,
  };
  return rank[next] > rank[current] ? next : current;
}

function countDistinctDomains(files: string[]): number {
  const domains = new Set<string>();
  for (const file of files) {
    domains.add(detectSpecialist([file]));
  }
  domains.delete('general');
  return domains.size === 0 ? 1 : domains.size;
}

function hasClearDirectoryCluster(files: string[]): boolean {
  if (files.length <= 1) return true;
  const root = deriveScopeDirectory(files);
  if (!root) return false;
  return files.every((file) => file === root || file.startsWith(`${root}/`));
}

function shouldClarify(task: string): boolean {
  const normalized = task.trim();
  if (!normalized) return true;
  if (GENERIC_UNDERSPECIFIED_CHANGE.test(normalized)) return true;
  return normalized.split(/\s+/).length <= 4 && !/[/.#]/.test(normalized);
}

function buildSpecRequiredResponse(task: string): string {
  return [
    `This is too open-ended to build well from "${task}" in one pass.`,
    '',
    'Give me a minimum spec first:',
    '1. Target surface or directory',
    '2. One or two visual references',
    '3. Must-have sections or behaviors',
    '4. Constraints like framework, colors, or existing design system',
    '5. What "good" should look like when it is done',
  ].join('\n');
}

function formatScoutSummary(routeLabel: string, searchResults: SearchResult[]): string {
  const filesLabel = searchResults.length === 1 ? '1 file' : `${searchResults.length} files`;
  return `${routeLabel} · ${filesLabel}`;
}

function hasUsableMemory(snapshot: SessionMemorySnapshot | null): boolean {
  if (!snapshot) return false;
  return snapshot.entryFiles.length > 0 || snapshot.writeTargets.length > 0 || snapshot.scopeDirectories.length > 0;
}

function hasMemoryConflict(
  snapshot: SessionMemorySnapshot | null,
  explicitHintFiles: string[],
): boolean {
  if (!snapshot || explicitHintFiles.length === 0) return false;
  const memoryPaths = new Set(getSessionMemoryCandidateFiles(snapshot));
  return !explicitHintFiles.some((file) => memoryPaths.has(file));
}

function deriveScopeDirectory(files: string[]): string | undefined {
  if (files.length === 0) return undefined;
  const first = files.find((file) => file.includes('/'));
  if (!first) return undefined;
  const parts = first.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : undefined;
}

function describeScope(files: string[], fallback: string): string {
  if (files.length === 0) return fallback;
  if (files.length === 1) return `Work on ${files[0]}`;
  const preview = files.slice(0, 2).join(', ');
  const remaining = files.length - 2;
  return remaining > 0 ? `Work on ${preview}, +${remaining} more` : `Work on ${preview}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
