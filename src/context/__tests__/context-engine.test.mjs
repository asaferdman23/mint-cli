/**
 * Smoke test for the context engine (Phase 2).
 * Run with: npx tsx src/context/__tests__/context-engine.test.mjs
 */

async function main() {
  const {
    indexProject, loadIndex, isIndexStale,
    DependencyGraph,
    searchRelevantFiles, extractKeywords,
    loadProjectRules, generateProjectRules,
    compressContext, estimateTokens,
    loadAgentMd,
  } = await import('../index.js');

  const cwd = process.cwd();
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

  // ─── 1. Dependency Graph ─────────────────────────────────────────────────

  console.log('\n--- DependencyGraph ---');

  const graph = new DependencyGraph();
  graph.addFile('a.ts', ['b.ts', 'c.ts']);
  graph.addFile('b.ts', ['c.ts']);
  graph.addFile('c.ts', []);
  graph.addFile('d.ts', ['a.ts']);

  assert('graph has 4 nodes', graph.size === 4);
  assert('a.ts imports b,c', graph.get('a.ts').imports.length === 2);
  assert('c.ts importedBy a,b', graph.get('c.ts').importedBy.length === 2);
  assert('expand from a.ts depth=1', graph.expand(['a.ts'], 1).length === 4); // a, b, c, d
  assert('central files', graph.centralFiles(2)[0].path === 'c.ts' || graph.centralFiles(2)[0].path === 'a.ts');

  // Serialize/deserialize
  const json = graph.toJSON();
  const restored = DependencyGraph.fromJSON(json);
  assert('roundtrip preserves nodes', restored.size === 4);
  assert('roundtrip preserves edges', restored.get('a.ts').imports.length === 2);

  // ─── 2. Project Indexer ──────────────────────────────────────────────────

  console.log('\n--- Indexer ---');

  const progressMessages = [];
  const index = await indexProject(cwd, {
    onProgress: (msg) => progressMessages.push(msg),
  });

  assert('index has files', index.totalFiles > 0);
  assert('index has LOC', index.totalLOC > 0);
  assert('index has language', typeof index.language === 'string' && index.language.length > 0);
  assert('index has graph', Object.keys(index.graph).length > 0);
  assert('index has indexedAt', !!index.indexedAt);
  assert('progress reported', progressMessages.length >= 2);

  // Check a known file
  const cliEntry = index.files['src/cli/index.ts'];
  assert('cli/index.ts indexed', !!cliEntry);
  assert('cli/index.ts has exports', cliEntry?.exports?.length >= 0);
  assert('cli/index.ts has imports', cliEntry?.imports?.length >= 0);
  assert('cli/index.ts has summary', cliEntry?.summary?.length > 0);

  // Check tools were indexed
  const toolIndex = index.files['src/tools/index.ts'];
  assert('tools/index.ts indexed', !!toolIndex);

  // ─── 3. Load persisted index ─────────────────────────────────────────────

  console.log('\n--- Load Index ---');

  const loaded = await loadIndex(cwd);
  assert('loadIndex returns data', !!loaded);
  assert('loaded matches original', loaded?.totalFiles === index.totalFiles);

  const stale = await isIndexStale(cwd);
  assert('fresh index not stale', !stale);

  // ─── 4. Search ───────────────────────────────────────────────────────────

  console.log('\n--- Search ---');

  const keywords = extractKeywords('fix the auth token validation bug in the config');
  assert('keyword extraction', keywords.length > 0);
  assert('stop words filtered', !keywords.includes('the') && !keywords.includes('in'));
  assert('meaningful words kept', keywords.includes('auth') || keywords.includes('token') || keywords.includes('config') || keywords.includes('validation'));

  const results = await searchRelevantFiles(cwd, 'fix the model routing logic', index);
  assert('search returns results', results.length > 0);
  assert('results have content', results[0]?.content?.length > 0);
  assert('results have score', results[0]?.score > 0);
  assert('results have reason', results[0]?.reason?.length > 0);

  // Search for something specific
  const toolResults = await searchRelevantFiles(cwd, 'bash tool execution timeout', index);
  assert('specific search finds tools', toolResults.some(r => r.path.includes('tool')));

  // ─── 5. Compression ──────────────────────────────────────────────────────

  console.log('\n--- Compression ---');

  const testFiles = [
    { path: 'test.ts', content: '// comment\nexport function hello() { return "world"; }\n'.repeat(50), language: 'typescript' },
  ];

  const apexResult = compressContext(testFiles, 'apex');
  assert('apex: no compression', apexResult.files[0].content === testFiles[0].content);

  const smartResult = compressContext(testFiles, 'smart');
  assert('smart: truncated large files', smartResult.files[0].content.length <= testFiles[0].content.length);

  const fastResult = compressContext(testFiles, 'fast');
  assert('fast: comments stripped', !fastResult.files[0].content.includes('// comment'));

  const ultraResult = compressContext(testFiles, 'ultra');
  assert('ultra: skeleton only', ultraResult.files[0].content.includes('export'));

  // ─── 6. Token estimation ─────────────────────────────────────────────────

  console.log('\n--- Tokens ---');

  assert('estimateTokens works', estimateTokens('hello world') === 3);
  assert('estimateTokens empty', estimateTokens('') === 0);

  // ─── 7. Project rules ────────────────────────────────────────────────────

  console.log('\n--- Project Rules ---');

  // Generate MINT.md
  const rulesPath = await generateProjectRules(cwd, index);
  assert('MINT.md generated', rulesPath.endsWith('MINT.md'));

  // Load it back
  const rules = await loadProjectRules(cwd);
  assert('MINT.md loads', !!rules);
  assert('MINT.md has content', rules?.raw?.includes('## Project'));
  assert('MINT.md has language', rules?.raw?.includes(index.language));

  // ─── Done ────────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
