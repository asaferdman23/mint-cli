/**
 * Agent Build Smoke Test (TDD RED phase)
 * Verifies agent files exist, exports correct functions, and CLI registers 'agent' command.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = '/Users/user/Desktop/axon-cli';

// --- File existence checks ---
const requiredFiles = [
  'src/agent/tools.ts',
  'src/agent/loop.ts',
  'src/agent/index.ts',
];

for (const f of requiredFiles) {
  const abs = path.join(root, f);
  assert.ok(existsSync(abs), `Missing required file: ${f}`);
  console.log(`  OK: ${f}`);
}

// --- tools.ts: TOOLS array and executeTool ---
const toolsSrc = readFileSync(path.join(root, 'src/agent/tools.ts'), 'utf8');
assert.ok(toolsSrc.includes('export const TOOLS'), "tools.ts must export TOOLS array");
console.log(`  OK: tools.ts exports TOOLS`);
assert.ok(toolsSrc.includes('export async function executeTool'), "tools.ts must export executeTool");
console.log(`  OK: tools.ts exports executeTool`);
assert.ok(toolsSrc.includes("name: 'bash'"), "tools.ts must define bash tool");
console.log(`  OK: tools.ts defines bash tool`);
assert.ok(toolsSrc.includes("name: 'read_file'"), "tools.ts must define read_file tool");
console.log(`  OK: tools.ts defines read_file tool`);
assert.ok(toolsSrc.includes("name: 'write_file'"), "tools.ts must define write_file tool");
console.log(`  OK: tools.ts defines write_file tool`);
assert.ok(toolsSrc.includes("name: 'edit_file'"), "tools.ts must define edit_file tool");
console.log(`  OK: tools.ts defines edit_file tool`);
assert.ok(toolsSrc.includes("name: 'find_files'"), "tools.ts must define find_files tool");
console.log(`  OK: tools.ts defines find_files tool`);
assert.ok(toolsSrc.includes("name: 'grep_files'"), "tools.ts must define grep_files tool");
console.log(`  OK: tools.ts defines grep_files tool`);

// --- loop.ts: agentLoop generator ---
const loopSrc = readFileSync(path.join(root, 'src/agent/loop.ts'), 'utf8');
assert.ok(loopSrc.includes('export async function* agentLoop'), "loop.ts must export agentLoop generator");
console.log(`  OK: loop.ts exports agentLoop generator`);
assert.ok(loopSrc.includes('TOOLS'), "loop.ts must reference TOOLS");
console.log(`  OK: loop.ts references TOOLS`);
assert.ok(loopSrc.includes('executeTool'), "loop.ts must call executeTool");
console.log(`  OK: loop.ts calls executeTool`);
assert.ok(loopSrc.includes('streamComplete'), "loop.ts must use streamComplete");
console.log(`  OK: loop.ts uses streamComplete`);

// --- index.ts: runAgent export ---
const indexSrc = readFileSync(path.join(root, 'src/agent/index.ts'), 'utf8');
assert.ok(indexSrc.includes('export async function runAgent'), "index.ts must export runAgent");
console.log(`  OK: index.ts exports runAgent`);
assert.ok(indexSrc.includes('buildSystemPrompt'), "index.ts must define or import buildSystemPrompt");
console.log(`  OK: index.ts has buildSystemPrompt`);

// --- CLI: 'agent' command registered ---
const cliSrc = readFileSync(path.join(root, 'src/cli/index.ts'), 'utf8');
assert.ok(cliSrc.includes("command('agent')"), "src/cli/index.ts must define an 'agent' command");
console.log(`  OK: 'agent' command registered in src/cli/index.ts`);

// --- providers/types.ts: tools field in CompletionRequest ---
const typesSrc = readFileSync(path.join(root, 'src/providers/types.ts'), 'utf8');
assert.ok(typesSrc.includes('tools?:') || typesSrc.includes('tools ?: '), "providers/types.ts must have tools? field in CompletionRequest");
console.log(`  OK: providers/types.ts has tools? in CompletionRequest`);

// --- AgentStreamChunk types exist in loop.ts ---
assert.ok(loopSrc.includes("type: 'text'") || loopSrc.includes("type: 'tool_call'"), "loop.ts must yield typed chunks with type field");
console.log(`  OK: loop.ts yields typed chunks`);

// --- spawnSync used in tools.ts for bash safety ---
assert.ok(toolsSrc.includes('spawnSync'), "tools.ts must use spawnSync for bash execution");
console.log(`  OK: tools.ts uses spawnSync for bash`);

// --- 64KB output cap enforced ---
assert.ok(toolsSrc.includes('64'), "tools.ts must cap output at 64KB");
console.log(`  OK: tools.ts enforces output cap`);

// --- 30s timeout enforced ---
assert.ok(toolsSrc.includes('30000'), "tools.ts must enforce 30s timeout");
console.log(`  OK: tools.ts enforces 30s timeout`);

console.log('\nAll agent smoke checks passed.');
