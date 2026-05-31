/**
 * runBrain() — the single unified agent loop.
 *
 * Order of operations per session:
 *   1. Load project index → build BM25 → probe embeddings (if available)
 *   2. Classify the task (LLM-first, fallback scorer)
 *   3. Resolve route from classification → model + fallbacks + tool budget
 *   4. Retrieve context (hybrid search + graph expansion, token-packed)
 *   5. Stream from the chosen model with the tool registry
 *   6. Batch concurrency-safe tool calls, gate writes per Mode policy
 *   7. Compact on token-budget pressure
 *   8. Emit `done` with a BrainResult and persist the outcome
 *
 * Every step emits typed AgentEvents on the session's stream. Consumers are
 * the TUI adapter, `mint exec` headless JSON, and tests.
 */
import { Session, type EventSink } from './session.js';
import { TokenBudget, countTokens, approxCostUsd } from './tokens.js';
import { loadRoutingTable, resolveRoute, isStickyEligible, type RouteEntry } from './router.js';
import { classify, type ClassifyFeatures } from './classifier.js';
import { extractClassifierFeatures } from './classifier.js';
import { buildBM25Index } from './memory/bm25.js';
import { retrieve } from './memory/retriever.js';
import { openOutcomesStore } from './memory/outcomes.js';
import { openMemoryStore, type ScoredMemory } from './memory/store.js';
import { extractMemories } from './memory/extract.js';
import { trackPendingMemoryWrite } from './memory/pending.js';
import type { TurnInputs } from './memory/summarize-turn.js';
import {
  probeEmbeddings,
  makeEmbeddingProvider,
  openEmbeddingsStore,
  type EmbeddingProvider,
  type EmbeddingsStore,
} from './memory/embeddings.js';
import { runToolCalls, type BrainToolCall } from './tools-host.js';
import { maybeCompact } from './compact.js';
import { MODE_POLICIES } from './modes.js';
import { runDeepMode, shouldUseDeepMode } from './deep-mode.js';
import { streamAgent } from '../providers/index.js';
import { config } from '../utils/config.js';
import { askApproval } from './approvals.js';
import { getToolDefinitions } from '../tools/index.js';
import { loadIndex, indexProject } from '../context/indexer.js';
import type { ProjectIndex } from '../context/indexer.js';
import { buildPromptTiers, flattenTiers } from './prompt-tiers.js';
import type { AgentEvent, BrainResult, Mode, TaskKind } from './events.js';
import type { Message, ModelId } from '../providers/types.js';

export interface RunBrainOptions {
  task: string;
  cwd: string;
  mode?: Mode;
  signal?: AbortSignal;
  sessionId?: string;
  /** Force a model regardless of the classifier's choice. */
  model?: ModelId;
  /** Force reasoning on/off regardless of route defaults. */
  reasoning?: boolean;
  /** Skip the LLM classifier (use the deterministic fallback). */
  skipLlmClassify?: boolean;
  /** External event sink (in addition to the returned async iterable). */
  onEvent?: EventSink;
  /** Override the max iteration count for this run. */
  maxIterations?: number;
  /** Override the per-session spend cap (USD) for this run only. When undefined,
   *  the loop reads `brain.spendCap` from config. 0 disables the cap. */
  spendCap?: number;
  /** Recent user turns from the interactive session, used only for classification context. */
  recentUserTurns?: string[];
  /** L2 session memory — one-paragraph summaries of prior turns (oldest first).
   *  Injected into the dynamic tier so the executor sees continuity across
   *  follow-up prompts. Owned by `useSessionMemory` in the TUI. */
  priorTurnSummaries?: string[];
  /** L3 project memory — short text snippets from <cwd>/.mint/memory.sqlite,
   *  loaded by BrainApp at session start. Injected into the dynamic tier. */
  projectMemories?: string[];
  /** L4 user memory — preference texts from `~/.mint/memory.sqlite`, loaded
   *  by BrainApp at session start. Injected into the project tier as a
   *  `<user_preferences>` block above AGENT.md / MINT.md content. */
  userPreferences?: string[];
  /** Model selected for the prior turn in this conversation. When the kind is
   *  unchanged across turns, the loop reuses this model regardless of the
   *  classifier's freshly-resolved choice. Prevents jarring provider swaps on
   *  classifier wobble (e.g., trivial ↔ simple). */
  priorModel?: ModelId;
  /** Task kind of the prior turn. Used together with `priorModel` to gate
   *  sticky-model selection — only sticky when the same kind continues. */
  priorKind?: TaskKind;
}

const DEFAULT_MODE: Mode = 'diff';

function deriveRepoSignals(index: ProjectIndex): Pick<ClassifyFeatures, 'topLanguages' | 'frameworks'> {
  const langLoc = new Map<string, number>();
  for (const file of Object.values(index.files)) {
    langLoc.set(file.language, (langLoc.get(file.language) ?? 0) + file.loc);
  }
  const topLanguages = [...langLoc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([language]) => language);

  const paths = new Set(Object.keys(index.files));
  const has = (path: string) => paths.has(path);
  const frameworks = new Set<string>();
  if (has('package.json')) {
    const pkg = index.files['package.json'];
    const summary = `${pkg.summary} ${pkg.exports.join(' ')}`.toLowerCase();
    if (summary.includes('react') || [...paths].some((p) => p.endsWith('.tsx') || p.includes('/components/'))) frameworks.add('react');
    if ([...paths].some((p) => p.startsWith('app/') || p.startsWith('pages/') || p.includes('next.config'))) frameworks.add('nextjs');
    if ([...paths].some((p) => p.includes('vite.config'))) frameworks.add('vite');
  }
  if ([...paths].some((p) => p.includes('vitest.config'))) frameworks.add('vitest');
  if ([...paths].some((p) => p.includes('jest.config'))) frameworks.add('jest');
  if ([...paths].some((p) => p.endsWith('pyproject.toml'))) frameworks.add('python');
  if ([...paths].some((p) => p.endsWith('Cargo.toml'))) frameworks.add('rust');
  if ([...paths].some((p) => p.endsWith('go.mod'))) frameworks.add('go');

  return { topLanguages, frameworks: [...frameworks] };
}

export async function* runBrain(options: RunBrainOptions): AsyncGenerator<AgentEvent> {
  const startedAt = Date.now();
  const mode = options.mode ?? DEFAULT_MODE;

  // Guard against empty tasks — upstream callers shouldn't trigger this, but
  // if they do we emit a clear error rather than paying for an LLM call to
  // classify nothing.
  if (!options.task || !options.task.trim()) {
    yield {
      type: 'error',
      error: 'Task is empty. Type what you want Mint to do, then press Enter.',
      recoverable: false,
      sessionId: options.sessionId ?? 'empty',
      ts: Date.now(),
    } as AgentEvent;
    return;
  }

  const queue: AgentEvent[] = [];
  let wake: (() => void) | null = null;
  const pushWake = (): void => {
    const w = wake;
    if (w) {
      wake = null;
      w();
    }
  };

  const session = new Session({
    task: options.task,
    cwd: options.cwd,
    mode,
    signal: options.signal,
    sessionId: options.sessionId,
    onEvent: (event) => {
      queue.push(event);
      options.onEvent?.(event);
      pushWake();
    },
  });

  let finished = false;

  const work = (async () => {
    try {
      session.emit({
        type: 'session.start',
        mode,
        task: options.task,
        cwd: options.cwd,
      });

      const result = await runInner(session, options);

      session.emit({ type: 'done', result });
    } catch (err) {
      session.emit({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
        recoverable: false,
      });
    } finally {
      finished = true;
      session.close();
      pushWake();
    }
  })();

  try {
    while (true) {
      while (queue.length > 0) {
        const next = queue.shift()!;
        yield next;
        if (next.type === 'done' || next.type === 'error') {
          await work;
          return;
        }
      }
      if (finished) {
        await work;
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    await work.catch(() => {});
  }
}

// ─── Inner ─────────────────────────────────────────────────────────────────

async function runInner(session: Session, options: RunBrainOptions): Promise<BrainResult> {
  const startedAt = Date.now();
  const table = loadRoutingTable(session.cwd);

  // 1. Project index + BM25
  const index = (await loadIndex(session.cwd)) ?? (await indexProject(session.cwd));
  const bm25 = buildBM25Index(index);

  // 2. Optional embeddings — probe once; BM25-only if absent.
  const embeddings = await tryOpenEmbeddings(session);

  // 3. Outcomes store — best-effort.
  let outcomes: ReturnType<typeof openOutcomesStore> | null = null;
  try {
    outcomes = openOutcomesStore(session.cwd);
  } catch {
    outcomes = null;
  }

  // 4. Classify
  const topFiles = bm25.search(options.task, 5).map((h) => h.path);
  const pastOutcomes = outcomes?.findSimilar(options.task, 3).map((r) => ({
    taskPreview: r.task,
    kind: r.kind,
    complexity: r.complexity,
    success: r.success,
  })) ?? [];

  const features: ClassifyFeatures = {
    task: options.task,
    projectFileCount: index.totalFiles,
    language: index.language,
    ...deriveRepoSignals(index),
    topFiles,
    recentUserTurns: options.recentUserTurns,
    pastOutcomes,
  };

  const decision = await classify(features, {
    config: table.classifier,
    signal: session.signal,
    skipLlm: options.skipLlmClassify,
  });

  const route: RouteEntry = resolveRoute({
    kind: decision.kind,
    complexity: decision.complexity,
    table,
    overrides: { model: options.model, reasoning: options.reasoning },
  });

  // Sticky model: if the conversation continues in the same task kind,
  // reuse the prior turn's model. Prevents jarring provider swaps when
  // the classifier wobbles on complexity ("trivial" ↔ "simple"). Side
  // effect: keeps Anthropic prompt cache hot across the conversation.
  // Skipped when an explicit `--model` override is supplied — the user's
  // choice wins. Falls through to the freshly-resolved model if the prior
  // model has become unavailable mid-session.
  if (
    !options.model &&
    options.priorKind === decision.kind &&
    options.priorModel &&
    isStickyEligible(options.priorModel, route)
  ) {
    const swapped = route.model;
    if (swapped !== options.priorModel) {
      route.model = options.priorModel;
      try {
        session.trace.write({
          type: 'route.stickied',
          sessionId: session.id,
          ts: Date.now(),
          from: swapped,
          to: options.priorModel,
          kind: decision.kind,
        } as unknown as AgentEvent);
      } catch {
        /* telemetry is best-effort */
      }
    }
  }

  const needsPlan = decision.needsPlan || route.needsPlan;

  session.emit({
    type: 'classify',
    kind: decision.kind,
    complexity: decision.complexity,
    model: route.model,
    planModel: needsPlan ? route.planModel ?? route.model : undefined,
    estFilesTouched: decision.estFilesTouched,
    needsPlan,
    needsApproval: decision.needsApproval,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    source: decision.source,
  });

  session.rebindModel(route.model);
  const budget = new TokenBudget(route.model, { compactRatio: 0.6 });

  // 5. Retrieve context
  const retrieved = await retrieve(
    {
      task: options.task,
      budget,
      maxFiles: 12,
      maxOutcomes: 5,
      signal: session.signal,
    },
    {
      index,
      bm25,
      embeddings: embeddings ?? undefined,
      outcomes: outcomes ?? undefined,
    },
  );

  session.emit({
    type: 'context.retrieved',
    files: retrieved.files,
    skills: [],
    examples: [],
    outcomesMatched: retrieved.outcomes,
    tokenBudget: retrieved.tokenBudget,
    tokensUsed: retrieved.tokensUsed,
  });

  // 6a. Deep mode — for genuinely complex multi-file tasks, run a planner
  // pass up front so the tool loop has an explicit subtask list baked into
  // the system prompt. The classifier's complexity + estFilesTouched gates
  // this so simpler tasks skip the extra model call.
  let deepPlanBlock = '';
  if (shouldUseDeepMode({ ...decision, needsPlan })) {
    const deep = await runDeepMode(
      {
        session,
        task: options.task,
        decision,
        route,
        contextFiles: retrieved.files,
      },
      // Per-step executor — no-op announce. Plan steps are rendered by the
      // TUI via the structured plan.draft event (PlanPanel above the
      // assistant header), so emitting them as text.delta would duplicate
      // them inline in the response body.
      async (_step) => {},
    );
    if (deep.planSteps.length > 0) {
      const planLines = deep.planSteps
        .map((s) => `  ${s.id}. ${s.description}${s.filesHint?.length ? ` [${s.filesHint.join(', ')}]` : ''}`)
        .join('\n');
      deepPlanBlock = `\n\n<plan>\n${planLines}\n</plan>\n\nExecute the plan. Think carefully and verify each step before moving on.`;
      session.emit({
        type: 'cost.delta',
        model: route.model,
        inputTokens: 0,
        outputTokens: 0,
        usd: deep.planCostUsd + deep.reviewCostUsd,
      });
    }
  }

  // 5b. Per-turn hybrid memory retrieval (PR7). Supersedes the
  // bootstrap-on-mount `options.projectMemories` from BrainApp — the
  // bootstrap is a stopgap for first paint; per-turn retrieval is
  // task-aware so it produces better-targeted memories on every turn.
  // Decisions and open_questions are deliberately excluded from default
  // injection (too noisy) — they surface only via `/memory list`.
  let perTurnMemories: ScoredMemory[] = [];
  try {
    const memStartedAt = Date.now();
    const memStore = openMemoryStore(session.cwd);
    // PR8: retrieval K and half-life are user-tunable via config knobs.
    const retrievalK = (config.getPath<number>('memory.retrieval.k') ?? 10);
    const retrievalHalfLife = (config.getPath<number>('memory.retrieval.halfLifeDays') ?? 14);
    perTurnMemories = await memStore.queryScored({
      query: options.task,
      kinds: ['preference', 'fact', 'episode'],
      k: retrievalK,
      halfLifeDays: retrievalHalfLife,
    });
    memStore.close();
    const memElapsedMs = Date.now() - memStartedAt;
    if (memElapsedMs > 50) {
      try {
        session.trace.write({
          type: 'warn',
          message: `memory.retrieved slow: ${memElapsedMs}ms`,
          sessionId: session.id,
          ts: Date.now(),
        } as unknown as AgentEvent);
      } catch {
        /* trace is best-effort */
      }
    }
    // Emit a `memory.retrieved` trace event listing what fired this turn.
    // Bypasses session.emit() / AgentEvent (the union doesn't model this
    // shape) — trace JSONL is the source of truth for `mint trace --memory`.
    try {
      session.trace.write({
        type: 'memory.retrieved',
        sessionId: session.id,
        ts: Date.now(),
        task: options.task,
        memories: perTurnMemories.map((s) => ({
          id: s.memory.id,
          kind: s.memory.kind,
          text: summarizeMemoryForTrace(s.memory),
          score: s.score,
          components: s.components,
        })),
      } as unknown as AgentEvent);
    } catch {
      /* telemetry is best-effort */
    }
  } catch {
    /* per-turn retrieval is best-effort — fall back to bootstrap */
  }

  const perTurnTexts = perTurnMemories.map((s) => s.memory.text);
  // If per-turn retrieval succeeded, use it. Otherwise fall back to the
  // bootstrap list BrainApp loaded on mount.
  const projectMemoriesForTier =
    perTurnTexts.length > 0 ? perTurnTexts : options.projectMemories;

  // 6. Build initial messages — structured tiers for cache-aware Anthropic
  // requests; non-Anthropic providers receive the flattened string via
  // `systemPrompt` fallback below.
  const tiers = await buildPromptTiers({
    cwd: session.cwd,
    files: retrieved.files,
    deepPlanBlock,
    sessionSummaries: options.priorTurnSummaries,
    projectMemories: projectMemoriesForTier,
    userPreferences: options.userPreferences,
  });
  const systemPrompt = flattenTiers(tiers);
  let messages: Message[] = [{ role: 'user', content: options.task }];

  budget.add(countTokens(systemPrompt) + countTokens(options.task));

  // 7. Tool-call loop
  const tools = getToolDefinitions();
  // Pre-compute the tools-array token footprint once per session — tool
  // definitions don't change across iterations, so this is a constant we
  // can attach to every cost.delta to surface in `mint audit` how much of
  // input is fixed tool overhead vs task content (powers the tools-pruning
  // win measurement).
  const toolsArrayTokens = countTokens(JSON.stringify(tools));
  const maxIterations = Math.min(options.maxIterations ?? route.maxIterations, route.maxIterations);
  let totalOutput = '';
  // Track exit reason so the success flag can distinguish "LLM finished" from
  // "we ran out of iterations mid-task".
  let cleanExit = false;
  let aborted = false;
  let streamFailed = false;
  // Set when a safety guard (spend cap or runaway-loop detector) stops the
  // loop — distinct from a clean finish or a max-iterations overrun.
  let haltedBySafety = false;
  // Track how many times compaction fired this session — surfaces in audit
  // so users can see when long-session compaction kicked in vs not.
  let compactionCount = 0;

  // Safety knobs (Phase 0.1). spendCap 0 = disabled. Per-run override (from
  // `mint --cap=X` or programmatic callers) wins over the persistent config.
  const spendCap = options.spendCap ?? config.getPath<number>('brain.spendCap') ?? 0;
  const loopDetectionOn = config.getPath<boolean>('brain.runawayLoopDetection') !== false;
  const loopThreshold = config.getPath<number>('brain.loopDetectionThreshold') ?? 3;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (session.aborted()) {
      session.emit({ type: 'error', error: 'aborted', recoverable: true });
      aborted = true;
      break;
    }
    session.recordIteration();

    // 7·0 Spend cap — halt and ask before starting a turn that would run
    // past the user's hard ceiling. Once approved, don't nag again.
    if (spendCap > 0 && !session.spendCapApproved && session.totals.costUsd >= spendCap) {
      const ok = await askApproval(session, {
        reason: 'spend_limit',
        payload: {
          spentUsd: session.totals.costUsd,
          capUsd: spendCap,
          iteration: iteration + 1,
        },
      });
      if (!ok) {
        session.emit({
          type: 'warn',
          message: `Stopped at spend cap — $${session.totals.costUsd.toFixed(
            4,
          )} of $${spendCap.toFixed(2)}. Raise brain.spendCap to continue.`,
        });
        haltedBySafety = true;
        break;
      }
      session.approveSpendCap();
    }

    // 7a. Compact if needed before the next turn
    const compaction = await maybeCompact(messages, budget, session, {
      signal: session.signal,
    });
    messages = compaction.messages;
    if (compaction.compacted) compactionCount++;

    // 7b. Stream
    let turnText = '';
    const toolCalls: BrainToolCall[] = [];
    let turnFailed = false;
    let realUsage: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    } | null = null;

    try {
      for await (const chunk of streamAgent({
        model: route.model,
        messages,
        systemPrompt,
        systemTiers: tiers,
        tools,
        maxTokens: 4096,
        signal: session.signal,
        providerOptions: route.providerOptions,
      })) {
        if (chunk.type === 'text' && chunk.text) {
          turnText += chunk.text;
          session.emit({ type: 'text.delta', text: chunk.text });
        } else if (chunk.type === 'tool_call') {
          // Drop tool calls with no name — the provider returned malformed data.
          // Surface a warning so we notice instead of running with garbage input.
          const name = (chunk.toolName ?? '').trim();
          if (!name || name === 'unknown') {
            session.emit({
              type: 'warn',
              message: 'Dropped malformed tool call from provider (missing name)',
            });
            continue;
          }
          toolCalls.push({
            id: chunk.toolCallId ?? `tc_${Date.now()}_${toolCalls.length}`,
            name,
            input: chunk.toolInput ?? {},
          });
        } else if (chunk.type === 'usage' && chunk.usage) {
          // Authoritative token counts from the provider (Anthropic today).
          realUsage = chunk.usage;
        }
      }
    } catch (err) {
      session.emit({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
      turnFailed = true;
      streamFailed = true;
      break;
    }

    // Cost accounting — prefer real usage from the provider (Anthropic emits
    // a 'usage' chunk with cache stats); fall back to local estimate otherwise.
    if (!turnFailed) {
      const turnInputTokens = realUsage?.inputTokens ?? Math.max(0, budget.used);
      const turnOutputTokens = realUsage?.outputTokens ?? countTokens(turnText);
      const cacheRead = realUsage?.cacheReadInputTokens;
      const cacheWrite = realUsage?.cacheCreationInputTokens;
      const turnCost = approxCostUsd(route.model, turnInputTokens, turnOutputTokens, {
        cacheCreationInputTokens: cacheWrite,
        cacheReadInputTokens: cacheRead,
      });
      session.recordCost(turnInputTokens, turnOutputTokens, turnCost, {
        cacheReadInputTokens: cacheRead,
        cacheCreationInputTokens: cacheWrite,
      });
      session.emit({
        type: 'cost.delta',
        model: route.model,
        inputTokens: turnInputTokens,
        outputTokens: turnOutputTokens,
        cacheReadInputTokens: cacheRead,
        cacheCreationInputTokens: cacheWrite,
        toolsArrayTokens,
        usd: turnCost,
      });
      budget.add(turnOutputTokens);
      totalOutput += turnText;
    }

    // 7c. No tool calls → we're done
    if (toolCalls.length === 0) {
      cleanExit = true;
      break;
    }

    // 7c·1 Runaway-loop guard — record each call's signature, halt if the
    // model is repeating an identical tool call past the threshold.
    if (loopDetectionOn) {
      for (const call of toolCalls) {
        session.recordToolSignature(call.name, call.input);
      }
      const repeat = session.detectRepeatPattern(loopThreshold);
      if (repeat) {
        session.emit({
          type: 'loop.detected',
          tool: repeat.tool,
          count: repeat.count,
          iteration: iteration + 1,
        });
        session.emit({
          type: 'warn',
          message: `Stopped — ${repeat.tool} was called ${repeat.count}× with identical input (runaway loop). Send a new prompt to redirect.`,
        });
        haltedBySafety = true;
        break;
      }
    }

    // 7d. Record assistant message with tool-call metadata
    messages.push({
      role: 'assistant',
      content: turnText,
      // TypeScript's Message shape doesn't model toolCalls; providers read the
      // extension fields via structural access. We keep the cast narrow.
      ...( { toolCalls } as unknown as Record<string, unknown>),
    } as unknown as Message);

    // 7e. Execute tool calls through the host
    const results = await runToolCalls(session, toolCalls, {
      iteration: iteration + 1,
      requireIterationApproval: MODE_POLICIES[session.mode].gateIteration,
    });

    // 7f. Feed results back as a tool message
    messages.push({
      role: 'tool',
      content: '',
      ...( { toolResults: results.map((r) => ({ toolCallId: r.id, content: r.output })) } as unknown as Record<string, unknown>),
    } as unknown as Message);

    // 7g. Bail out if the user has rejected approvals twice in a row.
    // Continuing past this point would just make the model try yet another
    // tool — the user wants to redirect, not see more attempts.
    if (session.consecutiveRejections >= 2) {
      session.emit({
        type: 'warn',
        message: 'Stopped — too many rejections in a row. Send a new prompt to redirect.',
      });
      break;
    }
  }

  // Detect "hit max iterations without finishing" — surface it to the user
  // instead of silently claiming success on partial work.
  const hitMaxIterations = !cleanExit && !aborted && !streamFailed && !haltedBySafety;
  if (hitMaxIterations) {
    session.emit({
      type: 'warn',
      message: `Reached max iterations (${maxIterations}) — the task may be incomplete. Try breaking it into smaller steps.`,
    });
  }

  // 8. Persist outcome
  const totals = session.totals;
  const result: BrainResult = {
    output: totalOutput,
    model: route.model,
    totalCostUsd: totals.costUsd,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadInputTokens: totals.cacheReadTokens,
    cacheCreationInputTokens: totals.cacheCreationTokens,
    durationMs: Date.now() - startedAt,
    iterations: totals.iterations,
    toolCalls: totals.toolCalls,
    filesTouched: totals.filesTouched,
    // Success means: LLM finished its reasoning AND we weren't aborted or stream-failed.
    // Hitting maxIterations or aborting = incomplete, even if some tool calls succeeded.
    success: cleanExit && !aborted && !streamFailed,
  };

  try {
    outcomes?.record({
      sessionId: session.id,
      task: options.task,
      kind: decision.kind,
      complexity: decision.complexity,
      filesTouched: totals.filesTouched,
      model: route.model,
      fallbackModel: route.fallbacks[0],
      tokensIn: totals.inputTokens,
      tokensOut: totals.outputTokens,
      costUsd: totals.costUsd,
      durationMs: result.durationMs,
      toolCalls: totals.toolCalls,
      iterations: totals.iterations,
      success: result.success,
      classifierFeatures: extractClassifierFeatures(features),
      toolsArrayTokensAvg: toolsArrayTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      compactionCount,
    });
  } catch {
    /* outcomes are best-effort */
  }

  // Fire-and-forget L3 memory extraction. Mirrors `outcomes.record` above:
  // best-effort, swallow errors, do not block the `done` event. Persists to
  // <cwd>/.mint/memory.sqlite via openMemoryStore — never ~/.mint (that's L4
  // and lands in PR5).
  //
  // PR8: gated on `memory.extract.enabled`. When false, the entire block is
  // a no-op — no LLM call, no SQLite write.
  const extractEnabled = config.getPath<boolean>('memory.extract.enabled') !== false;
  if (extractEnabled) {
    const extractKinds =
      config.getPath<Array<'preference' | 'fact' | 'decision' | 'episode' | 'open_question'>>(
        'memory.extract.kinds',
      ) ?? ['preference', 'fact', 'episode'];
    const turnInputs: TurnInputs = {
      userTask: options.task,
      finalAssistant: totalOutput,
      filesTouched: totals.filesTouched,
      toolCalls: totals.toolCalls,
      outcome: result.success ? 'success' : aborted ? 'aborted' : 'partial',
      model: route.model,
    };
    trackPendingMemoryWrite(
      (async () => {
        try {
          const memStore = openMemoryStore(session.cwd, {
            onWrite: (ev) => {
              // Trace-only telemetry — never surfaced to the user. We bypass
              // session.emit() (and therefore the AgentEvent union) and write
              // straight to the trace JSONL so consumers of `mint trace
              // --memory` can reconstruct what was learned.
              try {
                session.trace.write({
                  type: 'memory.write',
                  sessionId: session.id,
                  kind: ev.kind,
                  action: ev.action,
                  ts: Date.now(),
                } as unknown as AgentEvent);
              } catch {
                /* telemetry is best-effort */
              }
            },
          });
          const memories = await extractMemories(turnInputs, {
            signal: session.signal,
            kinds: extractKinds,
            onFallback: (reason) => {
              try {
                session.trace.write({
                  type: 'memory.extract.fallback',
                  sessionId: session.id,
                  ts: Date.now(),
                  reason,
                } as unknown as AgentEvent);
              } catch {
                /* telemetry is best-effort */
              }
            },
          });
          for (const m of memories) await memStore.write(m.kind, m);
          memStore.close();
        } catch {
          /* best-effort */
        }
      })(),
    );
  }

  // Cleanup
  outcomes?.close();
  embeddings?.store.close();

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function tryOpenEmbeddings(
  session: Session,
): Promise<{ store: EmbeddingsStore; provider: EmbeddingProvider } | null> {
  try {
    const probe = await probeEmbeddings(session.signal);
    if (!probe.available) {
      if (probe.reason) session.emit({ type: 'warn', message: probe.reason });
      return null;
    }
    return {
      store: openEmbeddingsStore(session.cwd),
      provider: makeEmbeddingProvider(probe),
    };
  } catch {
    return null;
  }
}

/** Back-compat shim — returns the flattened system prompt that legacy callers
 *  (tests, headless paths that don't surface tiered caching) expect. New
 *  callers should use `buildPromptTiers()` + the provider `systemTiers` field.
 */
async function buildSystemPrompt(
  cwd: string,
  files: Array<{ path: string; summary?: string }>,
): Promise<string> {
  const tiers = await buildPromptTiers({ cwd, files });
  return flattenTiers(tiers);
}


/** Short, privacy-conscious label for a memory entering the trace JSONL.
 *  Never echoes raw user content — just the already-flattened summary text
 *  from QueryRow.text truncated to 80 chars. Path-like and key-string content
 *  is the most we leak. */
function summarizeMemoryForTrace(m: { kind: string; text: string }): string {
  const t = m.text ?? '';
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

export const __testing = { buildSystemPrompt, summarizeMemoryForTrace };
