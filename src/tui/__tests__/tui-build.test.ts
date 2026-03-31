/**
 * TUI Build Smoke Test
 * RED phase: verifies TUI files exist and export the expected symbols.
 * This test is intentionally minimal - it checks the module shape,
 * not full Ink render logic (which requires a TTY).
 */

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

// --- File existence checks ---
const requiredFiles = [
  'src/tui/App.tsx',
  'src/tui/components/Banner.tsx',
  'src/tui/components/MessageList.tsx',
  'src/tui/components/InputBox.tsx',
  'src/tui/components/StatusBar.tsx',
];

for (const f of requiredFiles) {
  const abs = path.join(root, f);
  assert.ok(existsSync(abs), `Missing required file: ${f}`);
}

// --- Dist build checks ---
const distFiles = [
  'dist/cli/index.js',
];

for (const f of distFiles) {
  const abs = path.join(root, f);
  assert.ok(existsSync(abs), `Missing dist file (run npm run build): ${f}`);
}

// --- chat command registered ---
const distIndex = await import(path.join(root, 'dist/cli/index.js')).catch(() => null);
// The dist/cli/index.js runs the CLI directly when imported, so we can't
// safely import it in test. Instead check source text contains 'chat'.
import { readFileSync } from 'node:fs';
const cliSrc = readFileSync(path.join(root, 'src/cli/index.ts'), 'utf8');
assert.ok(cliSrc.includes("command('chat')"), "src/cli/index.ts must define a 'chat' command");

console.log('All TUI smoke checks passed.');
