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
import { loadRoutingTable, resolveRoute, type RouteEntry } from './router.js';
import { classify, type ClassifyFeatures } from './classifier.js';
import { buildBM25Index } from './memory/bm25.js';
import { retrieve } from './memory/retriever.js';
import { openOutcomesStore } from './memory/outcomes.js';
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
import { getToolDefinitions } from '../tools/index.js';
import { loadIndex, indexProject } from '../context/indexer.js';
import type { AgentEvent, BrainResult, Mode } from './events.js';
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
}

const DEFAULT_MODE: Mode = 'diff';

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
    topFiles,
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

  session.emit({
    type: 'classify',
    kind: decision.kind,
    complexity: decision.complexity,
    model: route.model,
    estFilesTouched: decision.estFilesTouched,
    needsPlan: decision.needsPlan,
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
  if (shouldUseDeepMode(decision)) {
    const deep = await runDeepMode(
      {
        session,
        task: options.task,
        decision,
        route,
        contextFiles: retrieved.files,
      },
      // For now, deep mode just plans + reviews around the single tool loop.
      // The per-subtask executor receives each step and appends it as a user
      // turn in the main message history.
      async () => {
        /* no-op — single-pass deep mode for now */
      },
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

  // 6. Build initial messages
  const systemPrompt = buildSystemPrompt(session.cwd, retrieved.files) + deepPlanBlock;
  let messages: Message[] = [{ role: 'user', content: options.task }];

  budget.add(countTokens(systemPrompt) + countTokens(options.task));

  // 7. Tool-call loop
  const tools = getToolDefinitions();
  const maxIterations = Math.min(options.maxIterations ?? route.maxIterations, route.maxIterations);
  let totalOutput = '';
  // Track exit reason so the success flag can distinguish "LLM finished" from
  // "we ran out of iterations mid-task".
  let cleanExit = false;
  let aborted = false;
  let streamFailed = false;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (session.aborted()) {
      session.emit({ type: 'error', error: 'aborted', recoverable: true });
      aborted = true;
      break;
    }
    session.recordIteration();

    // 7a. Compact if needed before the next turn
    const compaction = await maybeCompact(messages, budget, session, {
      signal: session.signal,
    });
    messages = compaction.messages;

    // 7b. Stream
    let turnText = '';
    const toolCalls: BrainToolCall[] = [];
    let turnFailed = false;

    try {
      for await (const chunk of streamAgent({
        model: route.model,
        messages,
        systemPrompt,
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

    // Cost accounting — rough (provider responses through streamAgent don't
    // always return usage). Real numbers come from completeWithFallback paths.
    // Skip on turn failure so we don't charge users for partial/broken streams.
    if (!turnFailed) {
      const turnInputTokens = Math.max(0, budget.used);
      const turnOutputTokens = countTokens(turnText);
      const turnCost = approxCostUsd(route.model, turnInputTokens, turnOutputTokens);
      session.recordCost(turnInputTokens, turnOutputTokens, turnCost);
      session.emit({
        type: 'cost.delta',
        model: route.model,
        inputTokens: turnInputTokens,
        outputTokens: turnOutputTokens,
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
  }

  // Detect "hit max iterations without finishing" — surface it to the user
  // instead of silently claiming success on partial work.
  const hitMaxIterations = !cleanExit && !aborted && !streamFailed;
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
    });
  } catch {
    /* outcomes are best-effort */
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

function buildSystemPrompt(cwd: string, files: Array<{ path: string; summary?: string }>): string {
  const header = `You are Mint, a coding agent running in a terminal.

<environment>
  <cwd>${cwd}</cwd>
  <platform>${process.platform}</platform>
</environment>

<rules>
1. Think before acting. Plan before editing.
2. Use read_file before editing — never edit blindly.
3. Prefer edit_file for targeted changes, write_file for new files.
4. After changes, verify with bash (tests, build, type-check).
5. Keep changes minimal and focused on the task.
6. If a command fails, analyze the error and try again.
7. Summarize what you did when finished.
</rules>`;

  if (files.length === 0) return header;
  const context = files
    .slice(0, 10)
    .map((f) => `- ${f.path}${f.summary ? ` — ${f.summary}` : ''}`)
    .join('\n');
  return `${header}\n\n<context>\nRelevant files (from hybrid retrieval):\n${context}\n</context>`;
}
