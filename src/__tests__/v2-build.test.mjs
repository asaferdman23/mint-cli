/**
 * v2-build.test.mjs — Smoke tests for axon v2 build
 * Tests all new files exist and key exports are present.
 * Usage: node src/__tests__/v2-build.test.mjs
 */

import { existsSync } from 'node:fs';
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

function fileExists(rel) {
  return existsSync(join(root, rel));
}

console.log('\n=== axon v2 smoke tests ===\n');

// ─── Phase 1: Provider files ───────────────────────────────────────────────────
console.log('Phase 1: Provider files');
check('src/providers/tiers.ts exists', fileExists('src/providers/tiers.ts'));
check('src/providers/openai-compatible.ts exists', fileExists('src/providers/openai-compatible.ts'));
check('src/providers/grok.ts exists', fileExists('src/providers/grok.ts'));
check('src/providers/groq.ts exists', fileExists('src/providers/groq.ts'));
check('src/providers/gemini.ts exists', fileExists('src/providers/gemini.ts'));
// Enterprise compliance (2026-05-12): Chinese-origin providers removed.
check('src/providers/deepseek.ts REMOVED', !fileExists('src/providers/deepseek.ts'));
check('src/providers/kimi.ts REMOVED', !fileExists('src/providers/kimi.ts'));
check('src/providers/qwen.ts REMOVED', !fileExists('src/providers/qwen.ts'));

// ─── Phase 1: tiers.ts exports ────────────────────────────────────────────────
console.log('\nPhase 1: tiers.ts exports');
try {
  const tiers = await import(join(root, 'src/providers/tiers.ts').replace('.ts', '.js').replace('/src/', '/dist/'));
  // Try dist first, fallback handled by error
  check('tiers.ts: getTier export', typeof tiers.getTier === 'function');
  check('tiers.ts: getBudget export', typeof tiers.getBudget === 'function');
  check('tiers.ts: MODEL_TIERS export', typeof tiers.MODEL_TIERS === 'object');
  check('tiers.ts: CONTEXT_BUDGETS export', typeof tiers.CONTEXT_BUDGETS === 'object');
} catch {
  // Not compiled yet - check source file
  const tiersSource = existsSync(join(root, 'src/providers/tiers.ts'));
  check('tiers.ts: source exists (pre-build check)', tiersSource);
  if (tiersSource) {
    const content = (await import('node:fs')).readFileSync(join(root, 'src/providers/tiers.ts'), 'utf-8');
    check('tiers.ts: exports getTier', content.includes('export function getTier'));
    check('tiers.ts: exports getBudget', content.includes('export function getBudget'));
    check('tiers.ts: exports MODEL_TIERS', content.includes('export const MODEL_TIERS'));
    check('tiers.ts: exports CONTEXT_BUDGETS', content.includes('export const CONTEXT_BUDGETS'));
  }
}

// ─── Phase 1: New ModelIds in types.ts ────────────────────────────────────────
console.log('\nPhase 1: New ModelIds in types.ts');
const typesSource = (await import('node:fs')).readFileSync(join(root, 'src/providers/types.ts'), 'utf-8');
check('types.ts: grok-3 ModelId', typesSource.includes("'grok-3'"));
check('types.ts: grok-3-fast ModelId', typesSource.includes("'grok-3-fast'"));
check('types.ts: grok-3-mini-fast ModelId', typesSource.includes("'grok-3-mini-fast'"));
check('types.ts: gemini-1-5-flash ModelId', typesSource.includes("'gemini-1-5-flash'"));
check('types.ts: gemini-1-5-pro ModelId', typesSource.includes("'gemini-1-5-pro'"));
check('types.ts: groq-llama-70b ModelId', typesSource.includes("'groq-llama-70b'"));
check('types.ts: groq-llama-8b ModelId', typesSource.includes("'groq-llama-8b'"));
check('types.ts: grok ProviderId', typesSource.includes("'grok'"));
check('types.ts: groq ProviderId', typesSource.includes("'groq'"));
// Enterprise compliance (2026-05-12): Chinese-origin models MUST be absent
check('types.ts: kimi-k2 REMOVED', !typesSource.includes("'kimi-k2'"));
check('types.ts: deepseek-v3 REMOVED', !typesSource.includes("'deepseek-v3'"));
check('types.ts: deepseek-coder REMOVED', !typesSource.includes("'deepseek-coder'"));
check('types.ts: moonshot-v1-8k REMOVED', !typesSource.includes("'moonshot-v1-8k'"));
check('types.ts: moonshot-v1-32k REMOVED', !typesSource.includes("'moonshot-v1-32k'"));
check('types.ts: qwen-coder-32b REMOVED', !typesSource.includes("'qwen-coder-32b'"));
check('types.ts: kimi ProviderId REMOVED', !typesSource.includes("'kimi'"));
check('types.ts: deepseek ProviderId REMOVED', !typesSource.includes("'deepseek'"));

// ─── Phase 2: Context files ────────────────────────────────────────────────────
console.log('\nPhase 2: Context files');
check('src/context/budget.ts exists', fileExists('src/context/budget.ts'));
check('src/context/compress.ts exists', fileExists('src/context/compress.ts'));
check('src/context/agentmd.ts exists', fileExists('src/context/agentmd.ts'));
check('src/context/pack.ts exists', fileExists('src/context/pack.ts'));

// ─── Phase 2: Key function exports (source check) ─────────────────────────────
console.log('\nPhase 2: Context exports');
if (fileExists('src/context/agentmd.ts')) {
  const src = (await import('node:fs')).readFileSync(join(root, 'src/context/agentmd.ts'), 'utf-8');
  check('agentmd.ts: exports loadAgentMd', src.includes('export async function loadAgentMd'));
  check('agentmd.ts: exports formatAgentMdForPrompt', src.includes('export function formatAgentMdForPrompt'));
}
if (fileExists('src/context/pack.ts')) {
  const src = (await import('node:fs')).readFileSync(join(root, 'src/context/pack.ts'), 'utf-8');
  check('pack.ts: exports buildContextPack', src.includes('export async function buildContextPack'));
  check('pack.ts: ContextPack interface', src.includes('export interface ContextPack'));
}
if (fileExists('src/context/compress.ts')) {
  const src = (await import('node:fs')).readFileSync(join(root, 'src/context/compress.ts'), 'utf-8');
  check('compress.ts: exports compressContext', src.includes('export function compressContext'));
  check('compress.ts: exports compressToolOutput', src.includes('export function compressToolOutput'));
}
if (fileExists('src/context/budget.ts')) {
  const src = (await import('node:fs')).readFileSync(join(root, 'src/context/budget.ts'), 'utf-8');
  check('budget.ts: exports estimateTokens', src.includes('export function estimateTokens'));
  check('budget.ts: exports truncateToTokens', src.includes('export function truncateToTokens'));
}

// ─── Phase 3: TUI files ────────────────────────────────────────────────────────
console.log('\nPhase 3: TUI files');
check('src/tui/hooks/useAgentEvents.ts exists', fileExists('src/tui/hooks/useAgentEvents.ts'));
check('src/tui/components/FileTracker.tsx exists', fileExists('src/tui/components/FileTracker.tsx'));
check('src/tui/components/RightPanel.tsx exists', fileExists('src/tui/components/RightPanel.tsx'));

// ─── Phase 3: TUI source content checks ──────────────────────────────────────
console.log('\nPhase 3: TUI content');
if (fileExists('src/tui/hooks/useAgentEvents.ts')) {
  const src = (await import('node:fs')).readFileSync(join(root, 'src/tui/hooks/useAgentEvents.ts'), 'utf-8');
  check('useAgentEvents.ts: exports useAgentEvents', src.includes('export function useAgentEvents'));
  check('useAgentEvents.ts: PanelState interface', src.includes('export interface PanelState'));
}
if (fileExists('src/tui/components/RightPanel.tsx')) {
  const src = (await import('node:fs')).readFileSync(join(root, 'src/tui/components/RightPanel.tsx'), 'utf-8');
  check('RightPanel.tsx: exports RightPanel', src.includes('export function RightPanel'));
}
if (fileExists('src/tui/components/FileTracker.tsx')) {
  const src = (await import('node:fs')).readFileSync(join(root, 'src/tui/components/FileTracker.tsx'), 'utf-8');
  check('FileTracker.tsx: exports FileTracker', src.includes('export function FileTracker'));
}

// ─── App.tsx split-pane check ─────────────────────────────────────────────────
console.log('\nPhase 3: App.tsx split-pane');
const appSource = (await import('node:fs')).readFileSync(join(root, 'src/tui/App.tsx'), 'utf-8');
check('App.tsx: imports RightPanel', appSource.includes('RightPanel'));
check('App.tsx: uses useAgentEvents', appSource.includes('useAgentEvents'));
check('App.tsx: flexDirection row (split-pane)', appSource.includes('flexDirection="row"'));

// ─── Phase 4: Agent mode ──────────────────────────────────────────────────────
console.log('\nPhase 4: Agent modes');
const toolsSrc = (await import('node:fs')).readFileSync(join(root, 'src/agent/tools.ts'), 'utf-8');
check('tools.ts: AgentMode type', toolsSrc.includes('AgentMode'));
check('tools.ts: yolo mode', toolsSrc.includes("'yolo'"));
check('tools.ts: plan mode', toolsSrc.includes("'plan'"));
check('tools.ts: diff mode', toolsSrc.includes("'diff'"));

const cliSrc = (await import('node:fs')).readFileSync(join(root, 'src/cli/index.ts'), 'utf-8');
check('cli/index.ts: --yolo flag', cliSrc.includes('--yolo'));
check('cli/index.ts: --plan flag', cliSrc.includes('--plan'));
check('cli/index.ts: --diff flag', cliSrc.includes('--diff'));
check('cli/index.ts: axon models command', cliSrc.includes("'models'") || cliSrc.includes('"models"') || cliSrc.includes('.command(\'models\')') || cliSrc.includes('.command("models")'));

// ─── Build check ──────────────────────────────────────────────────────────────
console.log('\nBuild check');
try {
  const distExists = fileExists('dist/cli/index.js');
  check('dist/cli/index.js exists', distExists);
} catch {
  check('dist/cli/index.js exists', false);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailed checks:');
  failures.forEach(f => console.log(`  - ${f}`));
}
process.exit(failed > 0 ? 1 : 0);
