/**
 * Security fixes test suite — Task 5
 * Tests all 6 security fixes for the mint-cli pre-publish audit.
 * Run: node src/__tests__/security-fixes.test.mjs
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

// ── FIX 1: tsup.config.ts — no hardcoded env var defines ────────────────────

console.log('\nFIX 1: tsup.config.ts — no env var defines baking tokens');

const tsupConfig = readFileSync(join(root, 'tsup.config.ts'), 'utf-8');

test('tsup.config.ts does not define MINT_API_TOKEN', () => {
  assert.ok(
    !tsupConfig.includes('MINT_API_TOKEN'),
    'MINT_API_TOKEN still present in tsup.config.ts define block',
  );
});

test('tsup.config.ts does not define MINT_GATEWAY_URL', () => {
  assert.ok(
    !tsupConfig.includes('MINT_GATEWAY_URL'),
    'MINT_GATEWAY_URL still present in tsup.config.ts define block',
  );
});

test('tsup.config.ts has no define block at all', () => {
  assert.ok(
    !tsupConfig.includes('define:'),
    'define: block still present in tsup.config.ts',
  );
});

// ── FIX 2: src/cli/index.ts — path traversal check in applyDiffs ────────────

console.log('\nFIX 2: src/cli/index.ts — path traversal in applyDiffs');

const cliIndex = readFileSync(join(root, 'src/cli/index.ts'), 'utf-8');

test('applyDiffs imports resolve and sep from node:path', () => {
  // Either top-level import or inline — just check the traversal guard exists
  assert.ok(
    cliIndex.includes('resolve(') && cliIndex.includes('sep'),
    'applyDiffs does not import resolve/sep from node:path',
  );
});

test('applyDiffs has startsWith boundary check', () => {
  assert.ok(
    cliIndex.includes('startsWith(cwdAbs'),
    'applyDiffs missing startsWith boundary check',
  );
});

test('applyDiffs blocks path outside project', () => {
  assert.ok(
    cliIndex.includes('Blocked path outside project'),
    'applyDiffs does not log warning for blocked paths',
  );
});

// ── FIX 3: src/tools/list-dir.ts — path traversal protection ────────────────

console.log('\nFIX 3: src/tools/list-dir.ts — path traversal protection');

const listDir = readFileSync(join(root, 'src/tools/list-dir.ts'), 'utf-8');

test('list-dir has boundary check (startsWith cwdAbs)', () => {
  assert.ok(
    listDir.includes('startsWith(cwdAbs'),
    'list-dir.ts missing startsWith boundary check',
  );
});

test('list-dir throws or returns error for out-of-bounds path', () => {
  // Must have either a throw or an error return
  assert.ok(
    listDir.includes('Path outside') || listDir.includes('outside working') || listDir.includes('outside project'),
    'list-dir.ts does not throw/return error for out-of-bounds path',
  );
});

// ── FIX 4: src/tools/grep.ts — path traversal protection ────────────────────

console.log('\nFIX 4: src/tools/grep.ts — path traversal protection');

const grep = readFileSync(join(root, 'src/tools/grep.ts'), 'utf-8');

test('grep has boundary check (startsWith cwdAbs)', () => {
  assert.ok(
    grep.includes('startsWith(cwdAbs'),
    'grep.ts missing startsWith boundary check',
  );
});

test('grep returns error for out-of-bounds path', () => {
  assert.ok(
    grep.includes('Path outside') || grep.includes('outside working') || grep.includes('outside project'),
    'grep.ts does not return error for out-of-bounds path',
  );
});

// ── FIX 5: src/cli/commands/config.ts — no partial API key leak ─────────────

console.log('\nFIX 5: src/cli/commands/config.ts — no partial API key shown');

const configCmd = readFileSync(join(root, 'src/cli/commands/config.ts'), 'utf-8');

test('config.ts does not show last 4 chars of apiKey', () => {
  assert.ok(
    !configCmd.includes('.slice(-4)'),
    'config.ts still shows last 4 chars of API key via .slice(-4)',
  );
});

test('config.ts shows [configured] or **** without real chars', () => {
  assert.ok(
    configCmd.includes('[configured]') || (configCmd.includes('****') && !configCmd.includes('slice')),
    'config.ts does not show safe placeholder for configured API key',
  );
});

// ── FIX 6: src/tools/index.ts — run_tests not in READ_ONLY_TOOLS ────────────

console.log('\nFIX 6: src/tools/index.ts — run_tests removed from READ_ONLY_TOOLS');

const toolsIndex = readFileSync(join(root, 'src/tools/index.ts'), 'utf-8');

test('run_tests not in READ_ONLY_TOOLS', () => {
  // Extract the READ_ONLY_TOOLS block and check it doesn't contain run_tests
  const readOnlyBlock = toolsIndex.match(/READ_ONLY_TOOLS\s*=\s*new Set\(\[[\s\S]*?\]\)/)?.[0] ?? '';
  assert.ok(
    !readOnlyBlock.includes('run_tests'),
    'run_tests is still listed in READ_ONLY_TOOLS',
  );
});

test('run_tests not in CONCURRENCY_SAFE_TOOLS', () => {
  const concurrencyBlock = toolsIndex.match(/CONCURRENCY_SAFE_TOOLS\s*=\s*new Set\(\[[\s\S]*?\]\)/)?.[0] ?? '';
  assert.ok(
    !concurrencyBlock.includes('run_tests'),
    'run_tests is still listed in CONCURRENCY_SAFE_TOOLS',
  );
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
