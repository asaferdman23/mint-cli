/**
 * Hybrid retriever — fuses BM25 with optional dense embeddings, expands via
 * the dependency graph, and packs results into a token budget.
 *
 * Used by:
 *   - classifier.ts (topFiles for feature extraction)
 *   - loop.ts       (context window packing before each turn)
 */
import { DependencyGraph } from '../../context/graph.js';
import type { ProjectIndex } from '../../context/indexer.js';
import type { OutcomeMatch, RetrievedFile } from '../events.js';
import { TokenBudget, countTokens } from '../tokens.js';
import type { BM25Index, BM25SearchResult } from './bm25.js';
import {
  cosineSimilarity,
  type EmbeddingProvider,
  type EmbeddingsStore,
} from './embeddings.js';
import type { OutcomesStore } from './outcomes.js';

const RRF_K = 60;

export interface RetrieverDependencies {
  index: ProjectIndex;
  bm25: BM25Index;
  embeddings?: {
    store: EmbeddingsStore;
    provider: EmbeddingProvider;
  };
  outcomes?: OutcomesStore;
}

export interface RetrieveInput {
  task: string;
  /** Token budget for packed context. Defaults to 40% of the model's window. */
  budget: TokenBudget;
  /** How many files to keep after packing. Default 12. */
  maxFiles?: number;
  /** How many past outcomes to surface. Default 5. */
  maxOutcomes?: number;
  signal?: AbortSignal;
}

export interface RetrieveResult {
  files: RetrievedFile[];
  outcomes: OutcomeMatch[];
  tokenBudget: number;
  tokensUsed: number;
}

// ─── Reciprocal rank fusion ─────────────────────────────────────────────────

interface RankedHit {
  path: string;
  rank: number;
  summary?: string;
}

function rrf(lists: RankedHit[][]): Map<string, { score: number; summary: string }> {
  const fused = new Map<string, { score: number; summary: string }>();
  for (const list of lists) {
    for (const hit of list) {
      const contribution = 1 / (RRF_K + hit.rank);
      const existing = fused.get(hit.path);
      if (existing) {
        existing.score += contribution;
        if (!existing.summary && hit.summary) existing.summary = hit.summary;
      } else {
        fused.set(hit.path, { score: contribution, summary: hit.summary ?? '' });
      }
    }
  }
  return fused;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function retrieve(
  input: RetrieveInput,
  deps: RetrieverDependencies,
): Promise<RetrieveResult> {
  const { task, budget } = input;
  const maxFiles = input.maxFiles ?? 12;
  const maxOutcomes = input.maxOutcomes ?? 5;
  const retrievalBudget = budget.retrievalBudget();

  // 1. BM25 top-40
  const bm25Hits = deps.bm25.search(task, 40);
  const bm25Ranked: RankedHit[] = bm25Hits.map((h, i) => ({
    path: h.path,
    rank: i + 1,
    summary: h.summary,
  }));

  // 2. Dense top-40, if available
  let denseRanked: RankedHit[] = [];
  if (deps.embeddings && deps.embeddings.provider.kind !== 'none') {
    try {
      const [queryVec] = await deps.embeddings.provider.embed([task]);
      const rows = deps.embeddings.store.loadAll();
      const scored = rows
        .map((row) => ({
          path: row.path,
          score: cosineSimilarity(queryVec, row.embedding),
          summary: row.summary,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 40);
      denseRanked = scored.map((s, i) => ({ path: s.path, rank: i + 1, summary: s.summary }));
    } catch {
      // Quietly fall back to BM25-only. The caller has already seen a warn
      // event if the probe failed, and any embedding error later is a
      // transient degradation.
      denseRanked = [];
    }
  }

  // 3. Fuse via reciprocal rank fusion
  const fused = rrf([bm25Ranked, denseRanked]);
  const fusedRanked: RetrievedFile[] = [...fused.entries()]
    .map(([path, v]) => ({
      path,
      score: v.score,
      summary: v.summary || deps.index.files[path]?.summary || '',
      source: denseRanked.length > 0 ? ('fusion' as const) : ('bm25' as const),
    }))
    .sort((a, b) => b.score - a.score);

  // 4. Expand top-3 via dependency graph (one hop)
  const graph = DependencyGraph.fromJSON(deps.index.graph);
  const seeds = fusedRanked.slice(0, 3).map((f) => f.path);
  const expanded = new Set(graph.expand(seeds, 1));

  const withGraph: RetrievedFile[] = [...fusedRanked];
  for (const path of expanded) {
    if (withGraph.some((f) => f.path === path)) continue;
    if (!deps.index.files[path]) continue;
    withGraph.push({
      path,
      score: 0,
      summary: deps.index.files[path].summary ?? '',
      source: 'graph',
    });
  }

  // 5. Pack within the token budget
  let tokensUsed = 0;
  const packed: RetrievedFile[] = [];
  for (const f of withGraph) {
    if (packed.length >= maxFiles) break;
    const estimatedTokens = countTokens(f.summary ?? '') + countTokens(f.path) + 8;
    if (tokensUsed + estimatedTokens > retrievalBudget) break;
    tokensUsed += estimatedTokens;
    packed.push(f);
  }

  // 6. Outcomes — past-task memory for classifier few-shots
  const outcomeMatches: OutcomeMatch[] = [];
  if (deps.outcomes) {
    try {
      const rows = deps.outcomes.findSimilar(task, maxOutcomes);
      for (const r of rows) {
        outcomeMatches.push({
          taskPreview: r.task.slice(0, 120),
          kind: r.kind,
          complexity: r.complexity,
          success: r.success,
          costUsd: r.costUsd,
        });
      }
    } catch {
      /* ignore — outcomes are a nice-to-have for retrieval */
    }
  }

  return {
    files: packed,
    outcomes: outcomeMatches,
    tokenBudget: retrievalBudget,
    tokensUsed,
  };
}
