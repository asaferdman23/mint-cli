/**
 * Routing table — turns a classifier decision into concrete model + budget.
 *
 * Merge order (last wins):
 *   1. Packaged default (routing.default.json)
 *   2. Project override (.mint/routing.json)
 *   3. Env override (MINT_ROUTE_OVERRIDE — JSON)
 *   4. CLI overrides passed to resolveRoute()
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Complexity, TaskKind } from './events.js';
import type { ModelId } from '../providers/types.js';
import { MODELS } from '../providers/types.js';

export interface RouteEntry {
  model: ModelId;
  fallbacks: ModelId[];
  toolBudget: number;
  maxIterations: number;
  needsPlan: boolean;
  compactionTokens: number;
  providerOptions?: Record<string, unknown>;
}

export interface ClassifierConfig {
  model: ModelId;
  timeoutMs: number;
  weights: Record<string, number>;
}

export interface RoutingTable {
  version: number;
  defaults: {
    toolBudget: number;
    maxIterations: number;
    compactionTokens: number;
  };
  routes: Record<TaskKind, Partial<RouteEntry> & { model: ModelId }>;
  complexityOverrides: Record<Complexity, Partial<RouteEntry>>;
  writeCode: { model: ModelId; fallbacks: ModelId[] };
  embedding: { model: string };
  classifier: ClassifierConfig;
}

export interface ResolveOverrides {
  /** Force a specific model after classification (e.g. --model flag). */
  model?: ModelId;
  /** Force the reasoning toggle (e.g. --think / --fast). */
  reasoning?: boolean;
}

// ─── Table loading ──────────────────────────────────────────────────────────

let cachedDefault: RoutingTable | null = null;

function loadPackagedDefault(): RoutingTable {
  if (cachedDefault) return cachedDefault;
  // Resolve routing.default.json relative to this module. Works both in source
  // (ts files under src/) and in the tsup ESM bundle (dist/cli/index.js) — in
  // the bundle the JSON is inlined below as a fallback.
  try {
    const here = fileURLToPath(import.meta.url);
    const dir = here.replace(/[\\/][^\\/]+$/, '');
    const path = join(dir, 'routing.default.json');
    if (existsSync(path)) {
      cachedDefault = JSON.parse(readFileSync(path, 'utf-8')) as RoutingTable;
      return cachedDefault;
    }
  } catch {
    /* fall through */
  }
  // tsup bundles this module into a single file; the JSON alongside it is NOT
  // bundled, so fall back to the embedded default.
  cachedDefault = EMBEDDED_DEFAULT;
  return cachedDefault;
}

function loadProjectOverride(cwd: string): Partial<RoutingTable> | null {
  try {
    const path = join(cwd, '.mint', 'routing.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as Partial<RoutingTable>;
  } catch {
    return null;
  }
}

function loadEnvOverride(): Partial<RoutingTable> | null {
  const raw = process.env.MINT_ROUTE_OVERRIDE;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<RoutingTable>;
  } catch {
    return null;
  }
}

// Deep-merge two routing tables — arrays are replaced, objects are merged.
function mergeTable(base: RoutingTable, patch: Partial<RoutingTable>): RoutingTable {
  const out: RoutingTable = {
    ...base,
    ...patch,
    defaults: { ...base.defaults, ...(patch.defaults ?? {}) },
    routes: { ...base.routes },
    complexityOverrides: { ...base.complexityOverrides },
    writeCode: { ...base.writeCode, ...(patch.writeCode ?? {}) },
    embedding: { ...base.embedding, ...(patch.embedding ?? {}) },
    classifier: {
      ...base.classifier,
      ...(patch.classifier ?? {}),
      weights: { ...base.classifier.weights, ...(patch.classifier?.weights ?? {}) },
    },
  };
  if (patch.routes) {
    for (const kind of Object.keys(patch.routes) as TaskKind[]) {
      out.routes[kind] = { ...base.routes[kind], ...patch.routes[kind] } as RoutingTable['routes'][TaskKind];
    }
  }
  if (patch.complexityOverrides) {
    for (const c of Object.keys(patch.complexityOverrides) as Complexity[]) {
      out.complexityOverrides[c] = {
        ...base.complexityOverrides[c],
        ...patch.complexityOverrides[c],
      };
    }
  }
  return out;
}

/** Load the fully-merged routing table for a given cwd. Cheap — no I/O beyond json reads. */
export function loadRoutingTable(cwd: string): RoutingTable {
  let table = loadPackagedDefault();
  const project = loadProjectOverride(cwd);
  if (project) table = mergeTable(table, project);
  const env = loadEnvOverride();
  if (env) table = mergeTable(table, env);
  return table;
}

// ─── Resolution ─────────────────────────────────────────────────────────────

export interface RouteRequest {
  kind: TaskKind;
  complexity: Complexity;
  table: RoutingTable;
  overrides?: ResolveOverrides;
}

/**
 * Resolve a (kind, complexity) decision into the concrete route used by the
 * loop. Complexity overrides win over kind defaults; CLI overrides win over both.
 */
export function resolveRoute(req: RouteRequest): RouteEntry {
  const { kind, complexity, table, overrides } = req;
  const kindRoute = table.routes[kind];
  const complexityPatch = table.complexityOverrides[complexity] ?? {};

  const merged: RouteEntry = {
    model: (kindRoute?.model ?? 'deepseek-v3') as ModelId,
    fallbacks: kindRoute?.fallbacks ?? [],
    toolBudget: kindRoute?.toolBudget ?? table.defaults.toolBudget,
    maxIterations: kindRoute?.maxIterations ?? table.defaults.maxIterations,
    needsPlan: kindRoute?.needsPlan ?? false,
    compactionTokens: kindRoute?.compactionTokens ?? table.defaults.compactionTokens,
    providerOptions: kindRoute?.providerOptions,
    ...complexityPatch,
  };

  if (overrides?.model) {
    merged.model = overrides.model;
  }
  if (overrides?.reasoning !== undefined) {
    merged.providerOptions = {
      ...(merged.providerOptions ?? {}),
      reasoning: { enabled: overrides.reasoning },
    };
  }

  // Sanity — if the resolved model isn't in the registry, fall back to the
  // first fallback or claude-sonnet-4.
  if (!MODELS[merged.model]) {
    const first = merged.fallbacks.find((m) => MODELS[m]) as ModelId | undefined;
    merged.model = first ?? 'claude-sonnet-4';
  }

  return merged;
}

// ─── Embedded default ──────────────────────────────────────────────────────
// Inlined so the tsup bundle works without the JSON sidecar file.

const EMBEDDED_DEFAULT: RoutingTable = {
  version: 2,
  defaults: { toolBudget: 20, maxIterations: 30, compactionTokens: 80_000 },
  routes: {
    question: { model: 'mistral-small', fallbacks: ['groq-llama-70b', 'gemini-2-flash'], toolBudget: 3, maxIterations: 4, needsPlan: false },
    edit_small: { model: 'gemini-2-flash', fallbacks: ['claude-sonnet-4', 'groq-llama-70b'], toolBudget: 10, maxIterations: 15, needsPlan: false },
    edit_multi: { model: 'claude-sonnet-4', fallbacks: ['gemini-2-pro', 'groq-llama-70b'], toolBudget: 20, maxIterations: 25, needsPlan: false },
    refactor: { model: 'claude-sonnet-4', fallbacks: ['gemini-2-pro', 'gpt-4o'], toolBudget: 30, maxIterations: 40, needsPlan: true },
    debug: {
      model: 'grok-4.1-fast',
      fallbacks: ['claude-sonnet-4', 'gemini-2-pro'],
      toolBudget: 25,
      maxIterations: 30,
      needsPlan: false,
      providerOptions: { reasoning: { enabled: true } },
    },
    scaffold: { model: 'claude-sonnet-4', fallbacks: ['gemini-2-pro', 'gpt-4o'], toolBudget: 15, maxIterations: 20, needsPlan: true },
    review: { model: 'mistral-small', fallbacks: ['gemini-2-flash', 'claude-sonnet-4'], toolBudget: 5, maxIterations: 6, needsPlan: false },
    explain: { model: 'mistral-small', fallbacks: ['groq-llama-70b', 'gemini-2-flash'], toolBudget: 0, maxIterations: 2, needsPlan: false },
  },
  complexityOverrides: {
    complex: { model: 'grok-4-beta', providerOptions: { reasoning: { enabled: true } } },
    moderate: {},
    simple: {},
    trivial: { model: 'mistral-small' },
  },
  writeCode: { model: 'claude-sonnet-4', fallbacks: ['gemini-2-pro', 'gpt-4o'] },
  embedding: { model: 'embedding-small' },
  classifier: {
    model: 'mistral-small',
    timeoutMs: 4000,
    weights: {
      fileCount: 0.35,
      taskLength: 0.15,
      verbComplex: 0.25,
      pastSuccess: -0.25,
      hasMultipleFiles: 0.2,
      mentionsTest: 0.1,
    },
  },
};
