/**
 * PR8 — verifies the new `memory.*` and `anthropic.cache1h` config keys are
 * declared with the right defaults and round-trip through Conf's dot-prop
 * accessors. We mock Conf so the test doesn't write to the developer's real
 * ~/.config/mint-cli.json.
 */
import { describe, it, expect, vi } from 'vitest';

// In-memory backing store for the mocked Conf.
const store: Record<string, unknown> = {};

vi.mock('conf', () => {
  class MockConf {
    public path = '/tmp/mock-config.json';
    public store = store;
    constructor(_opts: unknown) {
      // Honor any property-level defaults the schema declares so the test
      // observes the same shape the real Conf would.
      const opts = _opts as { schema?: Record<string, { default?: unknown }> };
      // The real Conf signature is `schema: { <key>: { type, default } }` — a
      // flat object, NOT nested under a `properties` key.
      const props = opts.schema ?? {};
      for (const [k, v] of Object.entries(props)) {
        if (typeof v === 'object' && v && 'default' in v && !(k in store)) {
          store[k] = JSON.parse(JSON.stringify(v.default));
        }
      }
    }
    get(key: string): unknown {
      // Dot-prop semantics for `a.b.c`.
      const parts = key.split('.');
      let cur: unknown = store;
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p];
        } else return undefined;
      }
      return cur;
    }
    set(key: string, value: unknown): void {
      const parts = key.split('.');
      let cur: Record<string, unknown> = store;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
        cur = cur[p] as Record<string, unknown>;
      }
      cur[parts[parts.length - 1]] = value;
    }
    delete(key: string): void {
      delete store[key];
    }
    clear(): void {
      for (const k of Object.keys(store)) delete store[k];
    }
  }
  return { default: MockConf };
});

// Note: we DON'T clear `store` between tests because Conf is instantiated at
// module-load time (single-shot). Defaults are populated by the mock
// constructor and must survive across tests.

describe('PR8 — memory + anthropic config keys', () => {
  it('declares defaults for memory.extract.* and memory.retrieval.*', async () => {
    const { config } = await import('../../utils/config.js');
    expect(config.getPath('memory.extract.enabled')).toBe(true);
    expect(config.getPath('memory.extract.kinds')).toEqual([
      'preference',
      'fact',
      'episode',
    ]);
    expect(config.getPath('memory.retrieval.k')).toBe(10);
    expect(config.getPath('memory.retrieval.halfLifeDays')).toBe(14);
  });

  it('declares default for anthropic.cache1h', async () => {
    const { config } = await import('../../utils/config.js');
    expect(config.getPath('anthropic.cache1h')).toBe(false);
  });

  it('setPath round-trips a nested key', async () => {
    const { config } = await import('../../utils/config.js');
    config.setPath('memory.extract.enabled', false);
    expect(config.getPath('memory.extract.enabled')).toBe(false);
    config.setPath('memory.retrieval.k', 25);
    expect(config.getPath('memory.retrieval.k')).toBe(25);
  });
});
