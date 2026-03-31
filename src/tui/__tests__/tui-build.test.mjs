/**
 * TUI Build Smoke Test (GREEN phase)
 * Verifies TUI files exist, build artifact is present, and chat command is registered.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = '/Users/user/Desktop/axon-cli';

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
  console.log(`  OK: ${f}`);
}

// --- Dist build checks ---
const distFile = path.join(root, 'dist/cli/index.js');
assert.ok(existsSync(distFile), `Missing dist file (run npm run build): dist/cli/index.js`);
console.log(`  OK: dist/cli/index.js`);

// --- chat command registered in source ---
const cliSrc = readFileSync(path.join(root, 'src/cli/index.ts'), 'utf8');
assert.ok(cliSrc.includes("command('chat')"), "src/cli/index.ts must define a 'chat' command");
console.log(`  OK: 'chat' command registered in src/cli/index.ts`);

// --- App.tsx exports App function ---
const appSrc = readFileSync(path.join(root, 'src/tui/App.tsx'), 'utf8');
assert.ok(appSrc.includes('export function App'), "App.tsx must export function App");
console.log(`  OK: App.tsx exports function App`);

// --- Banner exports Banner ---
const bannerSrc = readFileSync(path.join(root, 'src/tui/components/Banner.tsx'), 'utf8');
assert.ok(bannerSrc.includes('export function Banner'), "Banner.tsx must export function Banner");
console.log(`  OK: Banner.tsx exports function Banner`);

// --- MessageList exports MessageList ---
const msgSrc = readFileSync(path.join(root, 'src/tui/components/MessageList.tsx'), 'utf8');
assert.ok(msgSrc.includes('export function MessageList'), "MessageList.tsx must export function MessageList");
console.log(`  OK: MessageList.tsx exports function MessageList`);

// --- InputBox exports InputBox ---
const inputSrc = readFileSync(path.join(root, 'src/tui/components/InputBox.tsx'), 'utf8');
assert.ok(inputSrc.includes('export function InputBox'), "InputBox.tsx must export function InputBox");
console.log(`  OK: InputBox.tsx exports function InputBox`);

// --- StatusBar exports StatusBar ---
const statusSrc = readFileSync(path.join(root, 'src/tui/components/StatusBar.tsx'), 'utf8');
assert.ok(statusSrc.includes('export function StatusBar'), "StatusBar.tsx must export function StatusBar");
console.log(`  OK: StatusBar.tsx exports function StatusBar`);

// --- Streaming is wired in App ---
assert.ok(appSrc.includes('streamComplete'), "App.tsx must use streamComplete");
console.log(`  OK: App.tsx wires streamComplete`);

// --- selectModel is used ---
assert.ok(appSrc.includes('selectModel'), "App.tsx must use selectModel");
console.log(`  OK: App.tsx uses selectModel`);

console.log('\nAll TUI smoke checks passed.');
