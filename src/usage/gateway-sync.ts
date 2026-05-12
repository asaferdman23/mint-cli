/**
 * Optional, fire-and-forget upload of a single usage row to the gateway's
 * `/v1/usage/ingest` endpoint. Used by `trackBrainRun` so an organisation
 * running the gateway gets a fleet-wide view of cache hit rate + spend
 * without each developer having to ship CSVs.
 *
 * Opt-in:
 *   - env: MINT_GATEWAY_SYNC=1
 *   - config: `usageGatewaySync: true` in ~/.mint/config.json
 *
 * Privacy:
 *   - Only the row that gets persisted to ~/.mint/usage.db is uploaded.
 *   - taskPreview is truncated to 200 chars on the gateway side anyway.
 *   - Failures are swallowed silently — this must never affect the main flow.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../utils/config.js';

interface UploadInput {
  developer: string;
  sessionId: string;
  ts: number;
  model: string;
  provider?: string;
  taskPreview?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd: number;
  opusBaselineUsd?: number;
  durationMs?: number;
}

function isEnabled(): boolean {
  if (process.env.MINT_GATEWAY_SYNC === '1') return true;
  if (process.env.MINT_GATEWAY_SYNC === '0') return false;
  try {
    return Boolean((config.get('usageGatewaySync') as boolean | undefined) ?? false);
  } catch {
    return false;
  }
}

function getAuthHeader(): string | null {
  const envTok = process.env.MINT_GATEWAY_TOKEN ?? process.env.MINT_API_TOKEN;
  if (envTok) return `Bearer ${envTok}`;
  try {
    const stored = config.get('gatewayToken') as string | undefined;
    if (stored) return `Bearer ${stored}`;
  } catch {
    // config not initialized
  }
  return null;
}

function getGatewayUrl(): string {
  try {
    return process.env.MINT_GATEWAY_URL ?? config.getGatewayUrl();
  } catch {
    return process.env.MINT_GATEWAY_URL ?? 'https://api.usemint.dev';
  }
}

/**
 * Fire-and-forget upload. Returns immediately; the actual POST runs detached.
 * Failures are silently swallowed (logged to stderr only when DEBUG=mint:*).
 */
export function uploadUsageEvent(input: UploadInput): void {
  if (!isEnabled()) return;
  const auth = getAuthHeader();
  if (!auth) return; // no auth, no upload

  const event = {
    id: randomUUID(),
    developer: input.developer,
    session_id: input.sessionId,
    ts: input.ts,
    model: input.model,
    provider: input.provider ?? '',
    task_preview: input.taskPreview ?? '',
    input_tokens: input.inputTokens | 0,
    output_tokens: input.outputTokens | 0,
    cache_read_tokens: (input.cacheReadTokens ?? 0) | 0,
    cache_creation_tokens: (input.cacheCreationTokens ?? 0) | 0,
    cost_usd: input.costUsd,
    opus_baseline_usd: input.opusBaselineUsd ?? 0,
    duration_ms: (input.durationMs ?? 0) | 0,
  };

  // Detach: don't await, don't return promise. Hard 3s timeout so a slow
  // gateway never blocks the next prompt.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  fetch(`${getGatewayUrl()}/v1/usage/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ events: [event] }),
    signal: controller.signal,
  })
    .catch(() => {
      // Silent. The user already has the row in local sqlite.
    })
    .finally(() => clearTimeout(timeout));
}
