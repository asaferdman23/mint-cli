/**
 * Brain session — the context object every component of the loop reads from.
 *
 * Owns: session id, cwd, mode, abort signal, trace writer, a typed emit() that
 * stamps timestamp + sessionId onto every event before it reaches the trace
 * file and the consumer.
 */
import { TokenBudget } from './tokens.js';
import type { AgentEvent, AgentEventInit, Mode } from './events.js';
import { openTrace, generateSessionId, type TraceWriter } from './trace.js';
import type { ModelId } from '../providers/types.js';

export type EventSink = (event: AgentEvent) => void;

export interface SessionOptions {
  task: string;
  cwd: string;
  mode: Mode;
  signal?: AbortSignal;
  /** Optional sessionId — if omitted, one is generated. */
  sessionId?: string;
  /** Optional initial model — TokenBudget is lazy-bound on first add(). */
  model?: ModelId;
  /** Consumer callback; receives every event after it's been stamped + traced. */
  onEvent?: EventSink;
}

export class Session {
  readonly id: string;
  readonly task: string;
  readonly cwd: string;
  readonly mode: Mode;
  readonly signal?: AbortSignal;
  readonly trace: TraceWriter;
  private readonly sink: EventSink;
  private _budget: TokenBudget | null;
  private _filesTouched = new Set<string>();
  private _costUsd = 0;
  private _inputTokens = 0;
  private _outputTokens = 0;
  private _cacheReadTokens = 0;
  private _cacheCreationTokens = 0;
  private _toolCalls = 0;
  private _iterations = 0;
  /** Consecutive rejection counter — incremented on approval rejection,
   *  reset on any approval or non-rejection tool result. Used to abort
   *  the turn when the user is clearly trying to redirect the agent. */
  private _consecutiveRejections = 0;
  /** Rolling window of recent tool-call signatures (name + stable-hashed
   *  input), newest last. Powers runaway-loop detection. */
  private _toolSignatures: string[] = [];
  /** Set once the user has explicitly approved continuing past the spend
   *  cap — prevents nagging on every subsequent iteration. */
  private _spendCapApproved = false;

  constructor(options: SessionOptions) {
    this.id = options.sessionId ?? generateSessionId();
    this.task = options.task;
    this.cwd = options.cwd;
    this.mode = options.mode;
    this.signal = options.signal;
    this.trace = openTrace(this.id);
    this.sink = options.onEvent ?? noopSink;
    this._budget = options.model ? new TokenBudget(options.model) : null;
  }

  /** Stamp + trace + forward an event. Caller supplies everything except sessionId and ts. */
  emit(partial: AgentEventInit): void {
    const event = { ...partial, sessionId: this.id, ts: Date.now() } as AgentEvent;
    this.trace.write(event);
    this.sink(event);
  }

  rebindModel(model: ModelId): TokenBudget {
    this._budget = new TokenBudget(model);
    return this._budget;
  }

  get budget(): TokenBudget | null {
    return this._budget;
  }

  get filesTouched(): string[] {
    return [...this._filesTouched];
  }

  get totals() {
    return {
      costUsd: this._costUsd,
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
      cacheReadTokens: this._cacheReadTokens,
      cacheCreationTokens: this._cacheCreationTokens,
      toolCalls: this._toolCalls,
      iterations: this._iterations,
      filesTouched: this.filesTouched,
    };
  }

  recordFile(path: string): void {
    this._filesTouched.add(path);
  }

  /** @returns the new consecutive rejection count after incrementing. */
  incrementRejection(): number {
    return ++this._consecutiveRejections;
  }

  resetRejections(): void {
    this._consecutiveRejections = 0;
  }

  get consecutiveRejections(): number {
    return this._consecutiveRejections;
  }

  recordCost(
    inputTokens: number,
    outputTokens: number,
    usd: number,
    cache?: { cacheReadInputTokens?: number; cacheCreationInputTokens?: number },
  ): void {
    this._inputTokens += inputTokens;
    this._outputTokens += outputTokens;
    this._cacheReadTokens += cache?.cacheReadInputTokens ?? 0;
    this._cacheCreationTokens += cache?.cacheCreationInputTokens ?? 0;
    this._costUsd += usd;
  }

  recordToolCall(): void {
    this._toolCalls += 1;
  }

  /** Record a tool-call signature for runaway-loop detection. The signature
   *  is the tool name plus a stable serialization of its input, so two calls
   *  with the same input (regardless of key order) hash equal. */
  recordToolSignature(name: string, input: Record<string, unknown>): void {
    this._toolSignatures.push(`${name}::${stableStringify(input)}`);
    // Bound the window — only the recent tail matters for repeat detection.
    if (this._toolSignatures.length > 24) this._toolSignatures.shift();
  }

  /** Detect a runaway loop: returns the repeated tool and run length when the
   *  most recent `threshold`+ tool calls are byte-identical, else null. */
  detectRepeatPattern(threshold: number): { tool: string; count: number } | null {
    const sigs = this._toolSignatures;
    if (sigs.length < threshold) return null;
    const last = sigs[sigs.length - 1];
    let count = 0;
    for (let i = sigs.length - 1; i >= 0 && sigs[i] === last; i--) count++;
    if (count < threshold) return null;
    return { tool: last.slice(0, last.indexOf('::')), count };
  }

  get spendCapApproved(): boolean {
    return this._spendCapApproved;
  }

  approveSpendCap(): void {
    this._spendCapApproved = true;
  }

  recordIteration(): void {
    this._iterations += 1;
  }

  close(): void {
    this.trace.close();
  }

  aborted(): boolean {
    return this.signal?.aborted ?? false;
  }
}

function noopSink(_event: AgentEvent): void {
  /* no-op */
}

/** Deterministic JSON serialization — keys sorted recursively so logically
 *  equal inputs always produce the same string. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
