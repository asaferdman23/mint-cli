// Tests for `isStickyEligible` — the predicate that gates whether the loop
// reuses the prior turn's model. Same kind across turns + prior in the
// route's fallbacks (or equal to route.model) + prior present in MODELS
// registry. Anything else → fall through to the freshly-resolved model.
import { describe, it, expect } from 'vitest';
import { isStickyEligible, loadRoutingTable, resolveRoute } from '../router.js';

describe('isStickyEligible', () => {
  const table = loadRoutingTable(process.cwd());

  it('returns true when prior model equals the freshly resolved route.model', () => {
    const route = resolveRoute({ kind: 'question', complexity: 'trivial', table });
    // trivial-complexity override forces mistral-small for any kind.
    expect(route.model).toBe('mistral-small');
    expect(isStickyEligible('mistral-small', route)).toBe(true);
  });

  it('returns true when prior model is in route.fallbacks', () => {
    // question/simple resolves to gemini-2-flash with fallbacks
    // ['mistral-small', 'groq-llama-70b'] in the default table.
    const route = resolveRoute({ kind: 'question', complexity: 'simple', table });
    expect(route.model).toBe('gemini-2-flash');
    expect(route.fallbacks).toContain('mistral-small');
    expect(isStickyEligible('mistral-small', route)).toBe(true);
  });

  it('returns false when prior model is neither route.model nor in fallbacks', () => {
    const route = resolveRoute({ kind: 'question', complexity: 'simple', table });
    // claude-opus-4 isn't the resolved model for question/simple, and isn't
    // listed in its fallbacks — sticky should not engage.
    expect(route.model).not.toBe('claude-opus-4');
    expect(route.fallbacks).not.toContain('claude-opus-4');
    expect(isStickyEligible('claude-opus-4', route)).toBe(false);
  });

  it('returns false when prior model is not in the MODELS registry', () => {
    const route = resolveRoute({ kind: 'question', complexity: 'simple', table });
    // Cast — we're deliberately passing an unknown ModelId to verify the
    // availability guard. Mid-session a provider could be deprecated and the
    // prior model would no longer round-trip the registry.
    expect(isStickyEligible('does-not-exist' as never, route)).toBe(false);
  });
});

describe('sticky-route scenario (user-reported flow)', () => {
  // Walks the exact scenario from the bug report:
  //   Turn 3: "do you have agent md?" → kind=question, trivial → mistral-small
  //   Turn 4: "whats wrriten there?"   → kind=question, simple  → would resolve
  //   to gemini-2-flash, but sticky should keep mistral-small.
  const table = loadRoutingTable(process.cwd());

  it('stickies mistral-small (trivial) across to question/simple', () => {
    const prior = resolveRoute({ kind: 'question', complexity: 'trivial', table });
    expect(prior.model).toBe('mistral-small');

    const fresh = resolveRoute({ kind: 'question', complexity: 'simple', table });
    expect(fresh.model).toBe('gemini-2-flash');
    // The kind is unchanged, prior is in the fresh route's fallbacks →
    // eligible. The loop will overwrite fresh.model with prior.model.
    expect(isStickyEligible(prior.model, fresh)).toBe(true);
  });

  it('does NOT sticky across different kinds', () => {
    // If the kind changes, the loop never even consults isStickyEligible —
    // but verify here that a `refactor/simple` route would correctly NOT
    // pick mistral-small as eligible (mistral-small isn't in its fallbacks).
    const refactorRoute = resolveRoute({ kind: 'refactor', complexity: 'simple', table });
    expect(refactorRoute.fallbacks).not.toContain('mistral-small');
    expect(isStickyEligible('mistral-small', refactorRoute)).toBe(false);
  });
});
