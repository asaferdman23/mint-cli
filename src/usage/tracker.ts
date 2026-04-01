import { homedir } from 'node:os';
import { join } from 'node:path';
import { UsageDb } from './db.js';
import type { UsageRecord } from './db.js';
import { OPUS_INPUT_PRICE_PER_M, OPUS_OUTPUT_PRICE_PER_M, SONNET_INPUT_PRICE_PER_M, SONNET_OUTPUT_PRICE_PER_M } from './pricing.js';

export function calculateOpusCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * OPUS_INPUT_PRICE_PER_M +
         (outputTokens / 1_000_000) * OPUS_OUTPUT_PRICE_PER_M;
}

export function calculateSonnetCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * SONNET_INPUT_PRICE_PER_M +
         (outputTokens / 1_000_000) * SONNET_OUTPUT_PRICE_PER_M;
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
