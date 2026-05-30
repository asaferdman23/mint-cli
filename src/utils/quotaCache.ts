// src/utils/quotaCache.ts
//
// Quota state lives in ~/.mint-quota-cache.json so the status bar can show a
// stale-but-useful number on cold start / offline. Extracted from BrainApp so
// the dynamic `await import('fs'|'path'|'os')` cycle and the synchronous
// `writeFileSync` don't sit on the React render path. Static imports here are
// free; file IO is async (`fs.promises`) so the event loop keeps moving.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { config } from './config.js';

const CACHE_FILENAME = '.mint-quota-cache.json';

export interface QuotaCache {
  requests_used: number;
  requests_limit: number;
  plan_type?: string;
}

function cachePath(): string {
  return path.join(os.homedir(), CACHE_FILENAME);
}

export async function loadQuotaCache(): Promise<QuotaCache | null> {
  try {
    const raw = await fs.promises.readFile(cachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<QuotaCache>;
    if (parsed.requests_used == null || parsed.requests_limit == null) return null;
    return {
      requests_used: parsed.requests_used,
      requests_limit: parsed.requests_limit,
      plan_type: parsed.plan_type,
    };
  } catch {
    return null;
  }
}

export async function saveQuotaCache(c: QuotaCache): Promise<void> {
  try {
    await fs.promises.writeFile(cachePath(), JSON.stringify(c), 'utf-8');
  } catch {
    // Cache write failure is non-fatal.
  }
}

/**
 * Fetch the live quota from the gateway, seeding from the on-disk cache when
 * the caller hasn't yet observed a value. Returns null when the user isn't
 * authenticated or the gateway is unreachable — callers must treat quota as
 * advisory and never break the TUI on a failure here.
 */
export async function fetchQuota(opts: {
  /** When true and no live value is known yet, return the cached value so the
   *  status bar has something to render before the network resolves. */
  seedFromCache?: boolean;
} = {}): Promise<{ used: number; limit: number; planType?: string; fromCache: boolean } | null> {
  if (!config.isAuthenticated()) return null;

  const gatewayUrl = config.getGatewayUrl();
  const apiToken = config.get('gatewayToken');

  let seeded: { used: number; limit: number; planType?: string; fromCache: boolean } | null = null;
  if (opts.seedFromCache) {
    const cached = await loadQuotaCache();
    if (cached) {
      seeded = {
        used: cached.requests_used,
        limit: cached.requests_limit,
        planType: cached.plan_type,
        fromCache: true,
      };
    }
  }

  try {
    const response = await fetch(`${gatewayUrl}/auth/quota`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return seeded;

    const data = (await response.json()) as {
      requests_used: number;
      requests_limit: number;
      plan_type?: string;
    };

    // Fire-and-forget cache write; intentionally not awaited so the caller
    // isn't blocked on disk IO when all it needs is the live value.
    void saveQuotaCache({
      requests_used: data.requests_used,
      requests_limit: data.requests_limit,
      plan_type: data.plan_type,
    });

    return {
      used: data.requests_used,
      limit: data.requests_limit,
      planType: data.plan_type,
      fromCache: false,
    };
  } catch {
    return seeded;
  }
}
