import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

async function freshImport() {
  vi.resetModules();
  return await import('../gateway-sync.js');
}

describe('uploadUsageEvent (P3 gateway sync)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MINT_GATEWAY_SYNC;
    delete process.env.MINT_GATEWAY_TOKEN;
    delete process.env.MINT_API_TOKEN;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ inserted: 1 }), { status: 200 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('is a no-op when MINT_GATEWAY_SYNC is unset', async () => {
    const { uploadUsageEvent } = await freshImport();
    uploadUsageEvent({
      developer: 'a@b.c',
      sessionId: 's1',
      ts: Date.now(),
      model: 'sonnet-4',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    });
    // Give the (non-existent) detached call a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('is a no-op when enabled but no auth token is present', async () => {
    process.env.MINT_GATEWAY_SYNC = '1';
    const { uploadUsageEvent } = await freshImport();
    uploadUsageEvent({
      developer: 'a@b.c',
      sessionId: 's1',
      ts: Date.now(),
      model: 'sonnet-4',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('POSTs an events batch to /v1/usage/ingest when enabled + authed', async () => {
    process.env.MINT_GATEWAY_SYNC = '1';
    process.env.MINT_GATEWAY_TOKEN = 'tkn-xyz';
    process.env.MINT_GATEWAY_URL = 'https://gw.example.com';
    const { uploadUsageEvent } = await freshImport();
    uploadUsageEvent({
      developer: 'alice',
      sessionId: 'sess-1',
      ts: 1700000000000,
      model: 'sonnet-4',
      provider: 'anthropic',
      taskPreview: 'refactor x',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 5,
      costUsd: 0.01,
      opusBaselineUsd: 0.05,
      durationMs: 1200,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://gw.example.com/v1/usage/ingest');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tkn-xyz');
    const body = JSON.parse(init.body as string);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      developer: 'alice',
      session_id: 'sess-1',
      model: 'sonnet-4',
      provider: 'anthropic',
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 20,
      cache_creation_tokens: 5,
      cost_usd: 0.01,
      opus_baseline_usd: 0.05,
      duration_ms: 1200,
    });
    expect(typeof body.events[0].id).toBe('string');
  });
});
