/**
 * Public entry point for the unified brain agent.
 *
 * Consumers import from this file only — the internals (loop, session, memory,
 * classifier, retriever) are not part of the stable surface yet and will shift
 * across the migration steps.
 */
export { runBrain, type RunBrainOptions } from './loop.js';
export { runHeadless, type HeadlessOptions, type HeadlessResult } from './headless.js';
export { Session } from './session.js';
export { openTrace, generateSessionId } from './trace.js';
export { countTokens, countTokensMany, approxCostUsd, TokenBudget } from './tokens.js';
export {
  loadRoutingTable,
  resolveRoute,
  type RouteEntry,
  type RoutingTable,
  type ClassifierConfig,
  type ResolveOverrides,
  type RouteRequest,
} from './router.js';
export {
  classify,
  preclassify,
  fallbackClassify,
  ClassifyDecisionSchema,
  TASK_KINDS,
  COMPLEXITIES,
  type ClassifyDecision,
  type ClassifyResult,
  type ClassifyFeatures,
  type ClassifyOptions,
} from './classifier.js';

// Loop layer
export { runToolCalls, type BrainToolCall, type BrainToolResult } from './tools-host.js';
export { askApproval, needsApproval, needsDiffPreview } from './approvals.js';
export { maybeCompact, messageTokens, type CompactResult } from './compact.js';
export { writeCode, type WriteCodeInput, type WriteCodeResult } from './write-code.js';
export {
  runDeepMode,
  shouldUseDeepMode,
  synthesizePlanFromHeuristic,
  type DeepModeInput,
  type DeepModeResult,
} from './deep-mode.js';

// Memory substrate
export {
  OutcomesStore,
  openOutcomesStore,
  hashTask,
  type OutcomeRow,
  type RecordOutcomeInput,
} from './memory/outcomes.js';
export {
  BM25Index,
  buildBM25Index,
  tokenize,
  type BM25Document,
  type BM25SearchResult,
} from './memory/bm25.js';
export {
  EmbeddingsStore,
  openEmbeddingsStore,
  probeEmbeddings,
  makeEmbeddingProvider,
  cosineSimilarity,
  EMBEDDING_DIM,
  type EmbeddingProvider,
  type ProbeResult,
  type ChunkRow,
} from './memory/embeddings.js';
export {
  retrieve,
  type RetrieverDependencies,
  type RetrieveInput,
  type RetrieveResult,
} from './memory/retriever.js';
export {
  MODE_POLICIES,
  requiresToolApproval,
  isWriteTool,
  isReadOnlyTool,
  isReadOnlyBash,
  writesBlocked,
} from './modes.js';
export type { ModePolicy } from './modes.js';
export type {
  AgentEvent,
  AgentEventType,
  BrainResult,
  Complexity,
  Hunk,
  Mode,
  OutcomeMatch,
  PhaseName,
  PlanStep,
  RetrievedFile,
  TaskKind,
  ApprovalReason,
} from './events.js';
export { isEventType, serializableEvent } from './events.js';
