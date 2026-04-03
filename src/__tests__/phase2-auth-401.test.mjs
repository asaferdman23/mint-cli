/**
 * phase2-auth-401.test.mjs — Tests for Phase 2: CLI Auth Commands + 401 Bug Fix
 *
 * Tests:
 * 1. tsup.config.ts does NOT define MINT_API_TOKEN at build time
 * 2. gateway.ts reads token from config at runtime (getToken function)
 * 3. gateway.ts has no GATEWAY_TOKEN constant
 * 4. auth.ts exports signup, login, logout, whoami
 * 5. config.ts exports getGatewayUrl
 * 6. CLI index.ts registers signup command
 *
 * Usage: node src/__tests__/phase2-auth-401.test.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../../');

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  [FAIL] ${label}`);
  }
}

function readFile(rel) {
  return readFileSync(join(root, rel), 'utf-8');
}

console.log('\n=== Phase 2: CLI Auth Commands + 401 Bug Fix ===\n');

// --- Task 2.1: 401 Bug Fix ---
console.log('--- Task 2.1: 401 Bug Fix ---');

const tsupConfig = readFile('tsup.config.ts');
check('tsup.config.ts does NOT define MINT_API_TOKEN',
  !tsupConfig.includes("'process.env.MINT_API_TOKEN'"));

const gateway = readFile('src/providers/gateway.ts');
check('gateway.ts imports config from utils/config',
  gateway.includes("import { config }") && gateway.includes("utils/config"));

check('gateway.ts has getToken() function',
  gateway.includes('function getToken()'));

check('gateway.ts does NOT have GATEWAY_TOKEN constant',
  !gateway.includes('const GATEWAY_TOKEN'));

check('gateway.ts uses getToken() in Authorization headers',
  gateway.includes('Bearer ${getToken()}'));

check('gateway.ts reads apiKey from config in getToken()',
  gateway.includes("config.get('apiKey')"));

check('gateway.ts reads gatewayToken from config in getToken()',
  gateway.includes("config.get('gatewayToken')"));

check('gateway.ts supports MINT_GATEWAY_TOKEN env override',
  gateway.includes('MINT_GATEWAY_TOKEN'));

check('gateway.ts uses config.getGatewayUrl() for gateway base URL',
  gateway.includes('config.getGatewayUrl()'));

// --- Task 2.2: Auth Commands Rewrite ---
console.log('\n--- Task 2.2: Auth Commands Rewrite ---');

const auth = readFile('src/cli/commands/auth.ts');
check('auth.ts exports signup function',
  auth.includes('export async function signup'));

check('auth.ts exports login function',
  auth.includes('export async function login'));

check('auth.ts exports logout function',
  auth.includes('export async function logout'));

check('auth.ts exports whoami function',
  auth.includes('export async function whoami'));

check('auth.ts calls /auth/signup endpoint',
  auth.includes('/auth/signup'));

check('auth.ts calls /auth/login endpoint',
  auth.includes('/auth/login'));

check('auth.ts calls /auth/tokens endpoint',
  auth.includes('/auth/tokens'));

check('auth.ts uses config.getGatewayUrl()',
  auth.includes('config.getGatewayUrl()'));

check('auth.ts does NOT reference axon.dev',
  !auth.includes('axon.dev'));

check('auth.ts does NOT reference SSO/device code',
  !auth.includes('deviceCode') && !auth.includes('device_code'));

// --- Config: getGatewayUrl ---
console.log('\n--- Config: getGatewayUrl ---');

const configFile = readFile('src/utils/config.ts');
check('config.ts exports getGatewayUrl function',
  configFile.includes('function getGatewayUrl'));

check('config.ts config object includes getGatewayUrl',
  configFile.includes('getGatewayUrl,') || configFile.includes('getGatewayUrl }'));

check('config.ts includes gatewayToken in schema',
  configFile.includes('gatewayToken'));

// --- Agent payload normalization ---
console.log('\n--- Agent payload normalization ---');

const openaiAgentFormat = readFile('src/providers/openai-agent-format.ts');
check('openai-agent-format exports buildOpenAICompatibleAgentMessages',
  openaiAgentFormat.includes('buildOpenAICompatibleAgentMessages'));

check('openai-agent-format serializes assistant tool calls as tool_calls',
  openaiAgentFormat.includes('tool_calls'));

check('openai-agent-format serializes tool results as tool_call_id',
  openaiAgentFormat.includes('tool_call_id'));

// --- CLI: signup registration ---
console.log('\n--- CLI: signup registration ---');

const cliIndex = readFile('src/cli/index.ts');
check('cli/index.ts imports signup from auth',
  cliIndex.includes('signup') && cliIndex.includes('./commands/auth'));

check('cli/index.ts registers signup command',
  cliIndex.includes("'signup'") || cliIndex.includes('"signup"'));

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
