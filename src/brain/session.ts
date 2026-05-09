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
  private _toolCalls = 0;
  private _iterations = 0;

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
      toolCalls: this._toolCalls,
      iterations: this._iterations,
      filesTouched: this.filesTouched,
    };
  }

  recordFile(path: string): void {
    this._filesTouched.add(path);
  }

  recordCost(inputTokens: number, outputTokens: number, usd: number): void {
    this._inputTokens += inputTokens;
    this._outputTokens += outputTokens;
    this._costUsd += usd;
  }

  recordToolCall(): void {
    this._toolCalls += 1;
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
