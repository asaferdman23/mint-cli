import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.log(`  [FAIL] ${label}`);
  }
}

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

console.log('\n=== Agent Fallbacks ===\n');

const providersIndex = read('src/providers/index.ts');
check('streamAgent treats 402 as retryable',
  providersIndex.includes("err.message.includes('402')"));
check('streamAgent treats insufficient balance as retryable',
  providersIndex.includes('/insufficient balance/i'));
check('streamAgent builds candidate fallback list',
  providersIndex.includes('const candidates: Array<{ label: string; request: CompletionRequest; provider: AgentProvider }> = [];'));
check('streamAgent retries later candidates',
  providersIndex.includes("failed, trying next..."));

const gatewayAgentRoute = read('packages/gateway/src/routes/agent.ts');
check('gateway agent route imports FALLBACK',
  gatewayAgentRoute.includes("selectTarget, FALLBACK"));
check('gateway agent route falls back when primary raw stream fails',
  gatewayAgentRoute.includes("event: 'agent_fallback'"));
check('gateway agent route retries with fallback raw stream',
  gatewayAgentRoute.includes('getRawStreamForTarget(FALLBACK)'));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
