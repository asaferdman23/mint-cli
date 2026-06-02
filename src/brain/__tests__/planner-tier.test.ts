import { describe, it, expect } from 'vitest';
import { loadRoutingTable, resolveRoute } from '../router.js';

describe('planner tier (route.planModel)', () => {
  it('refactor route uses claude-opus-4-8 as planner, claude-sonnet-4-6 as executor', () => {
    const table = loadRoutingTable(process.cwd());
    const route = resolveRoute({
      kind: 'refactor',
      complexity: 'moderate',
      table,
    });
    expect(route.needsPlan).toBe(true);
    expect(route.model).toBe('claude-sonnet-4-6');
    expect(route.planModel).toBe('claude-opus-4-8');
  });

  it('scaffold route uses grok-4.3 planner with reasoning enabled', () => {
    const table = loadRoutingTable(process.cwd());
    const route = resolveRoute({
      kind: 'scaffold',
      complexity: 'moderate',
      table,
    });
    expect(route.needsPlan).toBe(true);
    expect(route.model).toBe('claude-sonnet-4-6');
    expect(route.planModel).toBe('grok-4.3');
    expect(route.planProviderOptions).toEqual({ reasoning: { enabled: true } });
  });

  it('non-planning routes leave planModel undefined (planner falls back to executor)', () => {
    const table = loadRoutingTable(process.cwd());
    const route = resolveRoute({
      kind: 'edit_small',
      complexity: 'simple',
      table,
    });
    expect(route.needsPlan).toBe(false);
    expect(route.planModel).toBeUndefined();
  });

  it('complex complexity override pairs claude-opus-4-8 executor with claude-opus-4-8 planner', () => {
    const table = loadRoutingTable(process.cwd());
    const route = resolveRoute({
      kind: 'edit_multi',
      complexity: 'complex',
      table,
    });
    // complexityOverrides.complex overrides the model + planModel
    expect(route.model).toBe('claude-opus-4-8');
    expect(route.planModel).toBe('claude-opus-4-8');
  });
});
