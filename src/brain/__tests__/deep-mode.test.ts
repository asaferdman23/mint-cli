import { describe, it, expect } from 'vitest';
import { shouldUseDeepMode, synthesizePlanFromHeuristic } from '../deep-mode.js';
import type { ClassifyResult } from '../classifier.js';

function classify(overrides: Partial<ClassifyResult>): ClassifyResult {
  return {
    kind: 'edit_small',
    complexity: 'simple',
    estFilesTouched: 1,
    needsPlan: false,
    needsApproval: 'per_diff',
    suggestedModelKey: 'edit_small',
    reasoning: 'test',
    confidence: 0.8,
    source: 'fallback',
    ...overrides,
  };
}

describe('shouldUseDeepMode', () => {
  it('triggers only on complex + >=4 files', () => {
    expect(shouldUseDeepMode(classify({ complexity: 'complex', estFilesTouched: 5 }))).toBe(true);
    expect(shouldUseDeepMode(classify({ complexity: 'complex', estFilesTouched: 4 }))).toBe(true);
  });

  it('does not trigger for simple tasks', () => {
    expect(shouldUseDeepMode(classify({ complexity: 'simple', estFilesTouched: 10 }))).toBe(false);
    expect(shouldUseDeepMode(classify({ complexity: 'moderate', estFilesTouched: 5 }))).toBe(false);
  });

  it('does not trigger for small complex tasks', () => {
    expect(shouldUseDeepMode(classify({ complexity: 'complex', estFilesTouched: 2 }))).toBe(false);
    expect(shouldUseDeepMode(classify({ complexity: 'complex', estFilesTouched: 0 }))).toBe(false);
  });
});

describe('synthesizePlanFromHeuristic', () => {
  it('splits a multi-sentence task into steps', () => {
    const steps = synthesizePlanFromHeuristic(
      'Add a Settings button. Wire it to open the preferences modal. Add tests.',
    );
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0].description).toContain('Settings');
  });

  it('returns empty for single-sentence tasks', () => {
    expect(synthesizePlanFromHeuristic('fix the typo')).toEqual([]);
  });

  it('splits on "then"/"and" conjunctions', () => {
    const steps = synthesizePlanFromHeuristic(
      'Rename the Auth module, then update every import, and add a migration.',
    );
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });
});
