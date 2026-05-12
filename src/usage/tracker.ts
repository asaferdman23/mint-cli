import { execSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { UsageDb } from './db.js';
import type { UsageRecord } from './db.js';
import { OPUS_INPUT_PRICE_PER_M, OPUS_OUTPUT_PRICE_PER_M, SONNET_INPUT_PRICE_PER_M, SONNET_OUTPUT_PRICE_PER_M } from './pricing.js';
import { uploadUsageEvent } from './gateway-sync.js';

export function calculateOpusCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * OPUS_INPUT_PRICE_PER_M +
         (outputTokens / 1_000_000) * OPUS_OUTPUT_PRICE_PER_M;
}

export function calculateSonnetCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * SONNET_INPUT_PRICE_PER_M +
         (outputTokens / 1_000_000) * SONNET_OUTPUT_PRICE_PER_M;
}

/**
 * Resolve the developer identity for attribution. Order:
 *   1. $MINT_DEVELOPER  (explicit override)
 *   2. `git config user.email` (cached after first call)
 *   3. os.userInfo().username
 *   4. 'unknown'
 */
let _developerCache: string | null = null;
export function resolveDeveloper(): string {
  if (_developerCache) return _developerCache;
  const envOverride = process.env.MINT_DEVELOPER?.trim();
  if (envOverride) {
    _developerCache = envOverride;
    return _developerCache;
  }
  try {
    const email = execSync('git config user.email', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
    }).trim();
    if (email) {
      _developerCache = email;
      return _developerCache;
    }
  } catch {
    // git not installed or user.email not set
  }
  try {
    const u = userInfo().username;
    if (u) {
      _developerCache = u;
      return _developerCache;
    }
  } catch {
    // fall through
  }
  _developerCache = 'unknown';
  return _developerCache;
}

/** Test hook: reset the cache so the next call re-resolves. */
export function _resetDeveloperCache(): void {
  _developerCache = null;
}

export interface TrackInput {
  model: string;
  provider: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  opusCost: number;
  savedAmount: number;
  routingReason: string;
  taskPreview: string;
  latencyMs: number;
  costSonnet: number;
}

let _db: UsageDb | null = null;

function getDb(): UsageDb {
  if (!_db) {
    _db = new UsageDb(join(homedir(), '.mint', 'usage.db'));
  }
  return _db;
}

export function createUsageTracker(sessionId: string, command: string) {
  return {
    track(input: TrackInput): void {
      try {
        const record: Omit<UsageRecord, 'id'> = {
          timestamp: Date.now(),
          sessionId,
          command,
          model: input.model,
          provider: input.provider,
          tier: input.tier,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          cost: input.cost,
          opusCost: input.opusCost,
          savedAmount: input.savedAmount,
          routingReason: input.routingReason,
          taskPreview: input.taskPreview.slice(0, 80),
          latencyMs: input.latencyMs,
          costSonnet: input.costSonnet,
          developer: resolveDeveloper(),
        };
        getDb().insert(record);
      } catch (e) {
        // Tracking failures should never crash the main flow
        process.stderr.write(`[axon:tracker] ${e instanceof Error ? e.message : String(e)}\n`);
      }
    },
  };
}

export function getUsageDb(): UsageDb {
  return getDb();
}

/**
 * Get the total cost for the current calendar month.
 * Safe to call at startup — returns 0 if no data.
 */
export function getMonthCost(): { cost: number; opusCost: number; saved: number; requests: number } {
  try {
    const summary = getDb().getMonthSummary();
    return { cost: summary.cost, opusCost: summary.opusCost, saved: summary.saved, requests: summary.requests };
  } catch {
    return { cost: 0, opusCost: 0, saved: 0, requests: 0 };
  }
}

// ─── Brain-stream tracking ──────────────────────────────────────────────────

/**
 * Track a brain run from its final BrainResult. Computes real Opus comparison
 * from actual token counts — no more hardcoded multipliers.
 */
export interface BrainRunSummary {
  sessionId: string;
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  durationMs: number;
  /** Optional — the kind/provider routing decision, for reporting. */
  kind?: string;
  provider?: string;
  tier?: string;
  /** Anthropic prompt-cache stats. */
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export function trackBrainRun(summary: BrainRunSummary): void {
  try {
    const opusCost = calculateOpusCost(summary.inputTokens, summary.outputTokens);
    const costSonnet = calculateSonnetCost(summary.inputTokens, summary.outputTokens);
    const record: Omit<UsageRecord, 'id'> = {
      timestamp: Date.now(),
      sessionId: summary.sessionId,
      command: 'brain',
      model: summary.model,
      provider: summary.provider ?? 'gateway',
      tier: summary.tier ?? 'brain',
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cost: summary.cost,
      opusCost,
      savedAmount: Math.max(0, opusCost - summary.cost),
      routingReason: summary.kind ? `brain → ${summary.kind}` : 'brain',
      taskPreview: summary.task.slice(0, 80),
      latencyMs: summary.durationMs,
      costSonnet,
      cacheReadTokens: summary.cacheReadTokens,
      cacheCreationTokens: summary.cacheCreationTokens,
      developer: resolveDeveloper(),
    };
    getDb().insert(record);
    // Opt-in fire-and-forget: ship the row to the gateway for org-wide
    // dashboards. No-op unless MINT_GATEWAY_SYNC=1 or config.usageGatewaySync.
    uploadUsageEvent({
      developer: record.developer ?? 'unknown',
      sessionId: record.sessionId,
      ts: record.timestamp,
      model: record.model,
      provider: record.provider,
      taskPreview: record.taskPreview,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cacheReadTokens: record.cacheReadTokens,
      cacheCreationTokens: record.cacheCreationTokens,
      costUsd: record.cost,
      opusBaselineUsd: record.opusCost,
      durationMs: record.latencyMs,
    });
  } catch {
    /* tracking failures never crash the main flow */
  }
}
