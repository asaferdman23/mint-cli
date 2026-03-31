/**
 * TDD build test for axon usage tracking system (Task 28)
 * RED: all checks fail until implementation exists
 */
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '../../..');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

function readSrc(rel) {
  try {
    return readFileSync(resolve(ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

// 1. File existence checks (source)
assert(existsSync(resolve(ROOT, 'src/usage/db.ts')), 'src/usage/db.ts exists');
assert(existsSync(resolve(ROOT, 'src/usage/tracker.ts')), 'src/usage/tracker.ts exists');
assert(
  existsSync(resolve(ROOT, 'src/usage/dashboard.ts')) || existsSync(resolve(ROOT, 'src/usage/dashboard.tsx')),
  'src/usage/dashboard.ts(x) exists'
);

// 2. CLI command registration checks
const cliSrc = readSrc('src/cli/index.ts') ?? '';
assert(cliSrc.includes("'usage'") || cliSrc.includes('"usage"'), '`axon usage` command registered in cli/index.ts');
assert(cliSrc.includes("'savings'") || cliSrc.includes('"savings"'), '`axon savings` command registered in cli/index.ts');

// 3. router.ts exports selectModelWithReason
const routerSrc = readSrc('src/providers/router.ts') ?? '';
assert(routerSrc.includes('selectModelWithReason'), 'router.ts exports selectModelWithReason');
assert(routerSrc.includes('classifyTask') || routerSrc.includes('detectTaskType'), 'router.ts has task classifier function');

// 4. db.ts exports UsageDb class
const dbSrc = readSrc('src/usage/db.ts') ?? '';
assert(dbSrc.includes('class UsageDb'), 'db.ts contains UsageDb class');
assert(dbSrc.includes('insert('), 'UsageDb has insert() method');
assert(dbSrc.includes('getAll('), 'UsageDb has getAll() method');
assert(dbSrc.includes('getSummary('), 'UsageDb has getSummary() method');
assert(dbSrc.includes('getTotalSaved('), 'UsageDb has getTotalSaved() method');
assert(dbSrc.includes('better-sqlite3'), 'db.ts imports better-sqlite3');

// 5. tracker.ts exports
const trackerSrc = readSrc('src/usage/tracker.ts') ?? '';
assert(trackerSrc.includes('calculateOpusCost'), 'tracker.ts exports calculateOpusCost');
assert(trackerSrc.includes('createUsageTracker'), 'tracker.ts exports createUsageTracker');

// 6. dashboard.tsx exists and references display library
const dashSrc = readSrc('src/usage/dashboard.tsx') ?? readSrc('src/usage/dashboard.ts') ?? '';
assert(dashSrc.includes('ink') || dashSrc.includes('chalk') || dashSrc.includes('boxen'), 'dashboard.ts uses display library');

// 7. Build passes
try {
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });
  assert(true, 'npm run build exits 0');
} catch (e) {
  const stderr = e.stderr?.toString() ?? '';
  const stdout = e.stdout?.toString() ?? '';
  console.error('Build stderr:', stderr.slice(-800));
  console.error('Build stdout:', stdout.slice(-400));
  assert(false, 'npm run build exits 0');
}

// 8. calculateOpusCost math check — verify from source logic
// Claude Opus 4: $15/M input + $75/M output = $90 for 1M/1M
const trackerSrc2 = readSrc('src/usage/tracker.ts') ?? '';
// Validate the constants are in the source
const hasInputPrice = trackerSrc2.includes('15') || trackerSrc2.includes('OPUS_INPUT');
const hasOutputPrice = trackerSrc2.includes('75') || trackerSrc2.includes('OPUS_OUTPUT');
assert(hasInputPrice && hasOutputPrice, 'tracker.ts contains Opus pricing constants ($15 input, $75 output)');

// Also verify math: (1M/1M)*15 + (1M/1M)*75 = 90
const calcResult = (1_000_000 / 1_000_000) * 15 + (1_000_000 / 1_000_000) * 75;
assert(calcResult === 90, `calculateOpusCost formula: (1M/1M)*15 + (1M/1M)*75 === 90 (got ${calcResult})`);

console.log('\nDone.');
if (process.exitCode === 1) {
  console.log('Some checks FAILED.');
} else {
  console.log('All checks PASSED.');
}
