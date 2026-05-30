import { describe, it, expect } from 'vitest';
import { classify, preclassify, fallbackClassify, extractClassifierFeatures, COMPLEXITIES } from '../classifier.js';
import { loadRoutingTable, resolveRoute } from '../router.js';
import type { TaskKind, Complexity } from '../events.js';

const table = loadRoutingTable(process.cwd());
const config = table.classifier;

interface GoldenCase {
  task: string;
  expectKind: TaskKind;
  expectComplexityAtMost?: Complexity;
  expectComplexityAtLeast?: Complexity;
}

/** Rank complexity so "A <= B" is comparable. */
const rank = (c: Complexity) => COMPLEXITIES.indexOf(c);

const GOLDEN: GoldenCase[] = [
  // questions / explains — deterministic pre-check
  { task: 'what does runBrain do?', expectKind: 'question' },
  { task: 'how does the router resolve complexity overrides?', expectKind: 'question' },
  { task: 'can you explain the adaptive-gate flow?', expectKind: 'explain' },
  { task: 'why is the orchestrator using grok 4.1 fast?', expectKind: 'question' },
  { task: 'describe the pipeline phases', expectKind: 'explain' },
  { task: 'walk me through the session-memory lifecycle', expectKind: 'explain' },
  { task: 'can you teach about skills in Claude Code?', expectKind: 'explain' },
  { task: 'can we plan an app together?', expectKind: 'scaffold', expectComplexityAtLeast: 'moderate' },

  // small edits
  { task: 'fix the typo in the welcome banner', expectKind: 'edit_small', expectComplexityAtMost: 'simple' },
  { task: 'change the hero title to "Ship code faster"', expectKind: 'edit_small', expectComplexityAtMost: 'simple' },
  { task: 'update the button color to blue', expectKind: 'edit_small', expectComplexityAtMost: 'simple' },
  { task: 'rename handleClick to onClick', expectKind: 'refactor', expectComplexityAtMost: 'simple' },
  { task: 'add a retry on 429 to fetchUser', expectKind: 'edit_small', expectComplexityAtMost: 'moderate' },

  // multi-file edits
  { task: 'update the logger across all services to include request id', expectKind: 'edit_multi', expectComplexityAtLeast: 'simple' },
  { task: 'add telemetry to every tool call in the agent loop', expectKind: 'edit_multi', expectComplexityAtLeast: 'simple' },
  { task: 'rename the auth module and update every import throughout the project', expectKind: 'refactor', expectComplexityAtLeast: 'moderate' },

  // refactors
  { task: 'refactor the orchestrator to split the write path', expectKind: 'refactor', expectComplexityAtLeast: 'moderate' },
  { task: 'consolidate the four execution engines into one', expectKind: 'refactor', expectComplexityAtLeast: 'moderate' },
  { task: 'migrate the test suite from node:test to vitest', expectKind: 'refactor', expectComplexityAtLeast: 'simple' },

  // debug
  { task: 'the build is failing with a type error in App.tsx', expectKind: 'debug' },
  { task: 'debug the crash in runMintTask when the signal aborts', expectKind: 'debug' },
  { task: 'there is a stack trace when I click submit', expectKind: 'debug' },
  { task: 'the tests are failing after my last change', expectKind: 'debug' },

  // scaffold
  { task: 'create a new Settings component', expectKind: 'scaffold' },
  { task: 'scaffold a pricing page with three tiers', expectKind: 'scaffold' },

  // review (no edits)
  { task: 'review the classifier for edge cases', expectKind: 'review' },
  { task: 'audit the auth flow for security issues', expectKind: 'review' },
  { task: 'sanity check the routing table', expectKind: 'review' },

  // mixed — edit verb beats question mark
  { task: 'can you fix the auth bug?', expectKind: 'debug' }, // "bug" is a debug signal
  { task: 'could you add a retry helper?', expectKind: 'edit_small' },

  // complexity signals
  { task: 'redesign the context engine across the entire codebase', expectKind: 'refactor', expectComplexityAtLeast: 'moderate' },
  { task: 'overhaul the tool registry throughout the app', expectKind: 'refactor', expectComplexityAtLeast: 'moderate' },
  { task: 'fix the typo', expectKind: 'edit_small', expectComplexityAtMost: 'simple' },
  { task: 'add test for the new fallback scorer', expectKind: 'edit_small' },
];

describe('classifier golden suite', () => {
  it('has at least 30 cases', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(30);
  });

  for (const c of GOLDEN) {
    it(`classifies: ${c.task}`, async () => {
      // skipLlm forces the pre-check → fallback path, keeping the test deterministic
      const result = await classify({ task: c.task, projectFileCount: 150 }, { config, skipLlm: true });

      expect(result.kind, `expected ${c.expectKind}, got ${result.kind}`).toBe(c.expectKind);

      if (c.expectComplexityAtMost) {
        expect(rank(result.complexity)).toBeLessThanOrEqual(rank(c.expectComplexityAtMost));
      }
      if (c.expectComplexityAtLeast) {
        expect(rank(result.complexity)).toBeGreaterThanOrEqual(rank(c.expectComplexityAtLeast));
      }
    });
  }
});

describe('preclassify', () => {
  it('returns null for imperative edits', () => {
    expect(preclassify('add a pricing section')).toBeNull();
    expect(preclassify('fix the mobile menu')).toBeNull();
  });

  it('flags questions', () => {
    const r = preclassify('what does this function do?');
    expect(r?.kind).toBe('question');
  });

  it('does not preclassify deeper questions as trivial', () => {
    expect(preclassify('what can we do better?')).toBeNull();
    expect(preclassify('what is the best approach for reliability?')).toBeNull();
  });

  it('does not preclassify contextual follow-up questions when history exists', () => {
    expect(preclassify('what about the second option?', { hasRecentContext: true })).toBeNull();
  });

  it('does not flag questions with edit verbs', () => {
    expect(preclassify('can you fix the auth bug?')).toBeNull();
  });

  it('lets action-intent questions reach the real classifier', () => {
    expect(preclassify('can you review this file?')).toBeNull();
    expect(preclassify('can you debug the failing tests?')).toBeNull();
    expect(preclassify('can you run the test suite?')).toBeNull();
  });

  it('routes product planning questions to the scaffold planner path', () => {
    const r = preclassify('can we plan an app together?');
    expect(r?.kind).toBe('scaffold');
    expect(r?.needsPlan).toBe(true);
  });
});

describe('fallbackClassify', () => {
  it('bumps complexity when a past outcome was complex', () => {
    const base = fallbackClassify(
      { task: 'update the header', projectFileCount: 10 },
      config,
    );
    // Baseline is at most "simple" — no refactor verbs, few files.
    expect(rank(base.complexity)).toBeLessThanOrEqual(rank('simple'));

    const withPrior = fallbackClassify(
      {
        task: 'update the header',
        projectFileCount: 10,
        pastOutcomes: [
          { taskPreview: 'update the header', kind: 'refactor', complexity: 'complex', success: true },
        ],
      },
      config,
    );
    expect(rank(withPrior.complexity)).toBeGreaterThan(rank(base.complexity));
  });

  it('marks debug tasks as debug kind', () => {
    const r = fallbackClassify({ task: 'the CI is failing with a crash' }, config);
    expect(r.kind).toBe('debug');
  });

  it('uses top-file mentions as a complexity signal', () => {
    const vec = extractClassifierFeatures({
      task: 'what should we change in src/brain/router.ts?',
      topFiles: ['src/brain/router.ts'],
    });
    expect(vec.topFileMention).toBe(1);
  });

  it('uses deeper question wording as a complexity signal', () => {
    const vec = extractClassifierFeatures({
      task: 'what is the best approach for reliability?',
    });
    expect(vec.deepQuestion).toBe(1);
  });

  it('uses recent context as a follow-up signal', () => {
    const vec = extractClassifierFeatures({
      task: 'what about the second option?',
      recentUserTurns: ['We discussed two architecture options.'],
    });
    expect(vec.contextualFollowup).toBe(1);
  });

  it('prefers prior successful small-edit outcomes for similar simple tasks', () => {
    const r = fallbackClassify(
      {
        task: 'update the header',
        projectFileCount: 10,
        pastOutcomes: [
          { taskPreview: 'update the header', kind: 'edit_small', complexity: 'simple', success: true },
        ],
      },
      config,
    );
    expect(r.kind).toBe('edit_small');
    expect(rank(r.complexity)).toBeLessThanOrEqual(rank('simple'));
  });
});

describe('routing table', () => {
  it('has a route for every TaskKind', () => {
    const kinds: TaskKind[] = [
      'question',
      'edit_small',
      'edit_multi',
      'refactor',
      'debug',
      'scaffold',
      'review',
      'explain',
    ];
    for (const k of kinds) {
      expect(table.routes[k], `missing route for ${k}`).toBeDefined();
    }
  });

  it('writeCode uses a coding model', () => {
    expect(table.writeCode.model).toBeTruthy();
    expect(table.writeCode.fallbacks.length).toBeGreaterThan(0);
  });

  it('keeps shallow questions cheap through the trivial override', () => {
    const route = resolveRoute({
      kind: 'question',
      complexity: 'trivial',
      table,
    });
    expect(route.model).toBe('mistral-small');
  });

  it('routes non-trivial questions to a stronger model', () => {
    const route = resolveRoute({
      kind: 'question',
      complexity: 'simple',
      table,
    });
    expect(route.model).toBe('gemini-2-flash');
  });
});
