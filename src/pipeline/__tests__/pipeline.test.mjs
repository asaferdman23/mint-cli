/**
 * Smoke test for the pipeline module (Phase 3).
 * Tests the components that don't require a live API call.
 * Run with: npx tsx src/pipeline/__tests__/pipeline.test.mjs
 */

async function main() {
  const { parseDiffs, hasDiffs, formatDiffs, formatCostSummary } = await import('../index.js');
  const { buildFocusedPrompt } = await import('../prompt.js');
  const { searchRelevantFiles } = await import('../../context/search.js');
  const { loadIndex, indexProject } = await import('../../context/index.js');

  let passed = 0;
  let failed = 0;

  function assert(name, condition) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}`);
      failed++;
    }
  }

  // ─── 1. Diff Parser ─────────────────────────────────────────────────────

  console.log('\n--- Diff Parser ---');

  const sampleResponse = `
Here's the fix for the auth bug:

\`\`\`diff
--- a/src/auth/token.ts
+++ b/src/auth/token.ts
@@ -10,7 +10,7 @@
 function validateToken(token) {
-  return token.length > 0;
+  return token.length > 0 && !isExpired(token);
 }
\`\`\`

And here's a new file:

\`\`\`diff
--- /dev/null
+++ b/src/auth/isExpired.ts
@@ -0,0 +1,5 @@
+export function isExpired(token) {
+  const payload = JSON.parse(atob(token.split('.')[1]));
+  return Date.now() > payload.exp * 1000;
+}
\`\`\`

This should fix the issue.
`;

  const diffs = parseDiffs(sampleResponse);
  assert('parses 2 diffs', diffs.length === 2);
  assert('first diff path', diffs[0]?.filePath === 'src/auth/token.ts');
  assert('second diff path', diffs[1]?.filePath === 'src/auth/isExpired.ts');
  assert('first diff has hunks', diffs[0]?.hunks.length === 1);
  assert('first hunk has add+remove',
    diffs[0]?.hunks[0]?.lines.some(l => l.type === 'add') &&
    diffs[0]?.hunks[0]?.lines.some(l => l.type === 'remove')
  );
  assert('second diff is new file', diffs[1]?.hunks[0]?.lines.every(l => l.type === 'add' || l.type === 'context'));

  assert('hasDiffs detects diffs', hasDiffs(sampleResponse));
  assert('hasDiffs rejects plain text', !hasDiffs('just some regular text'));

  // No diffs case
  assert('parseDiffs empty on plain text', parseDiffs('no diffs here').length === 0);

  // ─── 2. Diff Display ────────────────────────────────────────────────────

  console.log('\n--- Diff Display ---');

  const formatted = formatDiffs(diffs);
  assert('formatDiffs returns string', typeof formatted === 'string');
  assert('formatDiffs contains file path', formatted.includes('src/auth/token.ts'));
  assert('formatDiffs has content', formatted.length > 50);

  const costSummary = formatCostSummary(0.003, 1.50, 2500, ['src/auth/token.ts']);
  assert('costSummary returns string', typeof costSummary === 'string');
  assert('costSummary contains cost', costSummary.includes('0.3'));
  assert('costSummary contains savings', costSummary.includes('%'));

  // ─── 3. Prompt Builder ───────────────────────────────────────────────────

  console.log('\n--- Prompt Builder ---');

  // Build index first
  const cwd = process.cwd();
  let index = await loadIndex(cwd);
  if (!index) {
    index = await indexProject(cwd);
  }

  const searchResults = await searchRelevantFiles(cwd, 'model routing logic', index);
  assert('search finds files', searchResults.length > 0);

  const { systemPrompt, contextTokens, filesIncluded } = await buildFocusedPrompt(
    cwd,
    searchResults,
    'deepseek-v3',
  );

  assert('prompt is string', typeof systemPrompt === 'string');
  assert('prompt has rules', systemPrompt.includes('<rules>'));
  assert('prompt has context', systemPrompt.includes('<context>'));
  assert('prompt has file blocks', systemPrompt.includes('<file path='));
  assert('contextTokens > 0', contextTokens > 0);
  assert('filesIncluded > 0', filesIncluded.length > 0);
  assert('files from search included', filesIncluded.some(f => f.includes('router')));

  // Test with ultra-tier model (heavy compression)
  const { systemPrompt: ultraPrompt, contextTokens: ultraTokens } = await buildFocusedPrompt(
    cwd,
    searchResults,
    'groq-llama-8b',
  );
  assert('ultra prompt is shorter', ultraTokens <= contextTokens);

  // ─── 4. Pipeline integration check ───────────────────────────────────────

  console.log('\n--- Pipeline Module ---');

  // Verify exports exist
  const pipeline = await import('../index.js');
  assert('runPipeline exported', typeof pipeline.runPipeline === 'function');
  assert('collectPipeline exported', typeof pipeline.collectPipeline === 'function');
  assert('parseDiffs exported', typeof pipeline.parseDiffs === 'function');
  assert('formatDiffs exported', typeof pipeline.formatDiffs === 'function');
  assert('formatCostSummary exported', typeof pipeline.formatCostSummary === 'function');

  // ─── Done ────────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
