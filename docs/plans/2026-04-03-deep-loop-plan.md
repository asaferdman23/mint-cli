# Deep Loop (4-Phase Structured Agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single flat agentLoop for complex tasks with a 4-phase structured loop (EXPLORE → PLAN → IMPLEMENT → VERIFY) that produces dramatically better results by giving each phase focused context and the right model.

**Architecture:** When the adaptive gate routes to `architect_pipeline`, the builder worker switches from a single agentLoop call to 4 sequential sessions. Each session gets its own model, tool set, iteration limit, and system prompt. Context flows between sessions as structured JSON (~1000 tokens), not raw message history (10K+ tokens). An internal verify→implement retry loop (max 3) handles quality issues before bubbling up to the outer pipeline reviewer.

**Tech Stack:** TypeScript, existing `runAgentSession()` from `src/agent/index.ts`, existing tool system.

---

## File Structure

```
src/agents/deep-loop.ts          — NEW: 4-phase orchestrator (runDeepLoop)
src/agents/prompts/explore.ts    — NEW: explore phase system prompt
src/agents/prompts/plan-phase.ts — NEW: plan phase system prompt
src/agents/prompts/verify.ts     — NEW: verify phase system prompt
src/agents/model-selector.ts     — MODIFY: add 'explore' and 'verify' roles
src/agents/types.ts              — MODIFY: add AgentRole variants, DeepLoopResult type
src/agents/worker-agent.ts       — MODIFY: runBuilderWorkerAgent calls runDeepLoop when gateMode = architect_pipeline
src/agents/prompts/builder.ts    — MODIFY: add "follow the plan" instruction for deep loop
```

---

### Task 1: Add explore/verify roles to model-selector

**Files:**
- Modify: `src/agents/types.ts:5`
- Modify: `src/agents/model-selector.ts:13-37`

- [ ] **Step 1: Add the new agent roles to the type**

In `src/agents/types.ts`, extend `AgentRole`:

```typescript
export type AgentRole = 'scout' | 'architect' | 'builder' | 'reviewer' | 'explore' | 'plan' | 'verify';
```

- [ ] **Step 2: Add explore/plan/verify rows to MODEL_MATRIX**

In `src/agents/model-selector.ts`, add after the `reviewer` entry:

```typescript
  explore: {
    trivial:  'mistral-small',
    simple:   'mistral-small',
    moderate: 'mistral-small',    // fast reader, just needs to grep and summarize
    complex:  'mistral-small',
  },
  plan: {
    trivial:  'mistral-small',
    simple:   'grok-4.1-fast',    // reasoning OFF for simple
    moderate: 'grok-4.1-fast',    // reasoning ON for moderate — deep thinking at $0.20/$0.50
    complex:  'grok-4-beta',      // strongest reasoning for complex planning
  },
  verify: {
    trivial:  'mistral-small',
    simple:   'mistral-small',
    moderate: 'mistral-small',    // fast pattern matching, reads files + runs build
    complex:  'deepseek-v3',      // complex verify needs deeper analysis
  },
```

- [ ] **Step 3: Update getModelOptions for the new roles**

In the `getModelOptions` function, the existing logic already handles `grok-4.1-fast` and `mistral-small` by model ID, so the new `plan` and `explore`/`verify` roles will automatically get the correct provider options. No change needed here — verify by reading the function.

- [ ] **Step 4: Build and run tests**

Run: `npm run build && npx tsx src/agents/__tests__/agents-pipeline.test.ts`
Expected: Build success, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agents/types.ts src/agents/model-selector.ts
git commit -m "feat: add explore/plan/verify roles to model selector"
```

---

### Task 2: Create the explore phase prompt

**Files:**
- Create: `src/agents/prompts/explore.ts`

- [ ] **Step 1: Create the explore prompt**

```typescript
export const EXPLORE_PROMPT = `You are an EXPLORE agent. Your job is to understand the codebase and produce a structured briefing for the builder.

Read files, search for patterns, understand the project structure. Do NOT write code. Do NOT suggest solutions. Do NOT create files.

## What to investigate

1. **Stack detection**: What framework, language, build tool, CSS approach?
2. **Project structure**: Where do components live? Where are styles? Where are routes?
3. **Existing patterns**: How are components structured? What naming conventions? What imports style?
4. **Entry points**: Which file is the main entry? Where do new pages/components get registered?
5. **Dependencies**: What libraries are installed? What's available without adding new deps?
6. **Build command**: What command builds the project? (check package.json scripts)

## How to investigate

- Use list_dir to understand the directory structure
- Use read_file on package.json, tsconfig.json, and the main entry file
- Use grep_files to find patterns (e.g., how existing components are structured)
- Use find_files to locate relevant files by name pattern
- Read 2-3 existing files similar to what will need to be created

## Output format

After investigating, output ONLY a JSON block (no markdown fences, no explanation):

{"stack":"Vite + React 18 + Tailwind CSS","buildCommand":"npm run build","projectRoot":"src","structure":"Components in src/components/, styles in src/index.css, routes in src/App.tsx","existingPatterns":"Functional components, arrow functions, Tailwind utility classes, no state management library","relevantFiles":[{"path":"src/App.tsx","snippet":"first 20 lines of the file","why":"Entry point — new routes and imports go here"},{"path":"package.json","snippet":"dependencies section","why":"Available libraries"}],"dependencies":["react","react-dom","react-router-dom","tailwindcss"],"concerns":"No existing components — building from scratch in empty project"}

Keep relevantFiles to 3-5 entries max. Snippets should be 5-20 lines — enough context for the builder to match patterns, not full file dumps.`;
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Build success.

- [ ] **Step 3: Commit**

```bash
git add src/agents/prompts/explore.ts
git commit -m "feat: add explore phase system prompt"
```

---

### Task 3: Create the plan phase prompt

**Files:**
- Create: `src/agents/prompts/plan-phase.ts`

- [ ] **Step 1: Create the plan phase prompt**

```typescript
export const PLAN_PHASE_PROMPT = `You are a PLAN agent. Given an explore briefing and a task, create a step-by-step implementation plan.

You have NO tools. You cannot read files or run commands. The explore briefing contains everything you need.

Think carefully about:
1. What files need to be created vs modified
2. What order to make changes (dependencies first)
3. What each file should contain (be specific about sections, components, functions)
4. What the verification criteria are (how do we know it's done?)

## Output format

Output ONLY a JSON block (no markdown fences, no explanation):

{"steps":[{"file":"src/components/Landing.tsx","action":"create","description":"Main landing page with 6 sections","details":"Hero section with gradient background and large headline. Features grid with 3 cards. Testimonials with 3 quotes. Pricing with 3 tiers. CTA band. Footer with 4 columns. Use Tailwind, match existing component patterns from the briefing."},{"file":"src/App.tsx","action":"modify","description":"Add Landing route","details":"Import Landing from ./components/Landing. Add Route path=/ element={Landing} inside the existing Routes block."}],"verificationSteps":["Build command exits 0","All sections render with real content — no TODOs or placeholders","Forms have styled inputs with focus states","Responsive layout works at 375px and 1440px"]}

Rules:
- Every step must specify file path, action (create/modify), description, and details
- Details must describe WHAT goes in the file — specific sections, specific functionality
- Do not be vague. "Add a hero section" is bad. "Hero: full viewport height, gradient bg, centered h1 with the business name, subtitle with value proposition, two CTA buttons" is good.
- Include verification steps that the verify phase can mechanically check
- Max 6 steps. If more are needed, combine related changes into one step.`;
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Build success.

- [ ] **Step 3: Commit**

```bash
git add src/agents/prompts/plan-phase.ts
git commit -m "feat: add plan phase system prompt"
```

---

### Task 4: Create the verify phase prompt

**Files:**
- Create: `src/agents/prompts/verify.ts`

- [ ] **Step 1: Create the verify prompt (the strong one)**

```typescript
export const VERIFY_PROMPT = `You are VERIFY — an independent quality inspector. A builder just finished implementing code. Your job: determine if the mission is COMPLETE and the code is PRODUCTION-READY.

You MUST use your tools. Do NOT guess. Read every file that was created or modified.

## Verification protocol (follow ALL steps in order)

### 1. BUILD CHECK (mandatory — do this first)
Run the build command from the plan. If it fails, FAIL immediately with the exact error.
Common build commands: check package.json scripts for "build", "dev", or "typecheck".

### 2. FILE-BY-FILE COMPLETENESS CHECK (mandatory)
For EACH file in the plan's steps:
- Use read_file to read the full file
- Is it fully implemented? (no TODOs, no placeholder text like "Lorem ipsum", no empty function bodies, no "Feature 1" generic text)
- Are all imports valid? (use find_files to verify imported paths exist)
- For frontend components: count the distinct sections. Does the count match the plan?
- For backend: are all endpoints implemented with request validation and error handling?

### 3. QUALITY CHECK (mandatory)
Read the main files again with a critical eye:
- Are styles consistent throughout? (same spacing values, same color palette, same typography)
- Do forms have styled inputs? (padding, border, rounded corners, focus ring — NOT browser defaults)
- Do buttons have hover states and transitions?
- Is there dead code, console.logs, or commented-out blocks?
- Is the content realistic and specific to the business? (not generic "Welcome to Our Website")

### 4. PLAN COMPLIANCE (mandatory)
Go through each step in the plan. For each one: was it implemented? Mark it done or missing.
Go through each verification step. For each one: does it pass?

## Output format

Output ONLY a JSON block (no markdown fences):

{"passed":false,"buildPassed":true,"filesChecked":["src/components/Landing.tsx","src/App.tsx"],"planCompliance":[{"step":"Create Landing.tsx with 6 sections","done":true,"issues":["Pricing section has 1 tier, plan says 3"]},{"step":"Modify App.tsx with route","done":true,"issues":[]}],"completenessIssues":["Pricing section has only 1 tier — plan requires 3 with highlighted middle","Footer has only copyright — plan requires 4-column grid"],"qualityIssues":["Contact form inputs have no focus ring styling"],"summary":"4 of 6 sections complete. Pricing and footer need work."}

## Standards
- Be THOROUGH. Read every file. Run the build. Count sections.
- If the plan says 6 sections and you count 4, that is a FAIL — list the missing ones.
- If any text says "Lorem ipsum", "Feature 1", "Your Business Name", or "TODO" — FAIL.
- If the build fails — FAIL with the exact error.
- Only PASS when you would confidently deploy this.`;
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Build success.

- [ ] **Step 3: Commit**

```bash
git add src/agents/prompts/verify.ts
git commit -m "feat: add verify phase system prompt"
```

---

### Task 5: Create the deep loop orchestrator

**Files:**
- Create: `src/agents/deep-loop.ts`

This is the core new file — it orchestrates the 4 phases.

- [ ] **Step 1: Create the deep loop module**

```typescript
import { runAgentSession, type RunAgentSessionResult } from '../agent/index.js';
import { getAllowedToolNamesForRole } from '../tools/index.js';
import { selectAgentModel, getModelOptions } from './model-selector.js';
import { getSpecialist } from './specialists/index.js';
import { loadSkills, getSkillsForSpecialist } from '../context/skills.js';
import { loadProjectRules, formatProjectRulesForPrompt } from '../context/project-rules.js';
import { EXPLORE_PROMPT } from './prompts/explore.js';
import { PLAN_PHASE_PROMPT } from './prompts/plan-phase.js';
import { BUILDER_PROMPT } from './prompts/builder.js';
import { VERIFY_PROMPT } from './prompts/verify.js';
import type { TaskComplexity } from './types.js';
import type { SpecialistType } from './specialists/types.js';
import type { WorkerTaskReporter } from './runtime.js';
import type { AgentMode } from '../agent/tools.js';

export interface DeepLoopInput {
  task: string;
  cwd: string;
  complexity: TaskComplexity;
  specialist?: SpecialistType;
  signal?: AbortSignal;
  reporter?: WorkerTaskReporter;
  mode?: AgentMode;
}

export interface DeepLoopResult {
  response: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
  phases: {
    explore: { duration: number; cost: number };
    plan: { duration: number; cost: number };
    implement: { duration: number; cost: number; attempts: number };
    verify: { duration: number; cost: number; passed: boolean };
  };
}

interface ExploreBriefing {
  stack: string;
  buildCommand: string;
  projectRoot?: string;
  structure: string;
  existingPatterns: string;
  relevantFiles: Array<{ path: string; snippet: string; why: string }>;
  dependencies: string[];
  concerns: string;
}

interface PlanOutput {
  steps: Array<{ file: string; action: string; description: string; details: string }>;
  verificationSteps: string[];
}

interface VerifyOutput {
  passed: boolean;
  buildPassed: boolean;
  filesChecked: string[];
  planCompliance: Array<{ step: string; done: boolean; issues: string[] }>;
  completenessIssues: string[];
  qualityIssues: string[];
  summary: string;
}

const MAX_VERIFY_RETRIES = 3;

export async function runDeepLoop(input: DeepLoopInput): Promise<DeepLoopResult> {
  const { task, cwd, complexity, specialist, signal, reporter, mode } = input;
  const startTime = Date.now();
  const totals = { inputTokens: 0, outputTokens: 0, cost: 0 };
  const phaseTimes: DeepLoopResult['phases'] = {
    explore: { duration: 0, cost: 0 },
    plan: { duration: 0, cost: 0 },
    implement: { duration: 0, cost: 0, attempts: 0 },
    verify: { duration: 0, cost: 0, passed: false },
  };

  // ── PHASE 1: EXPLORE ────────────────────────────────────────────────────
  await reporter?.progress('deep loop: exploring codebase');
  await reporter?.log('[deep-loop] phase 1/4: EXPLORE');

  const exploreModel = selectAgentModel('explore', complexity);
  const exploreStart = Date.now();

  const exploreSession = await runAgentSession(
    `Task: ${task}\n\nExplore the codebase and produce a JSON briefing. Do NOT write code.`,
    {
      cwd,
      model: exploreModel,
      signal,
      mode: mode ?? 'auto',
      toolNames: ['read_file', 'grep_files', 'find_files', 'list_dir'],
      systemPrompt: EXPLORE_PROMPT,
      maxIterations: 15,
      maxTokens: 8192,
      providerOptions: getModelOptions('explore', complexity),
    },
  );

  phaseTimes.explore = { duration: Date.now() - exploreStart, cost: exploreSession.cost };
  totals.inputTokens += exploreSession.inputTokens;
  totals.outputTokens += exploreSession.outputTokens;
  totals.cost += exploreSession.cost;

  const briefing = parseJSON<ExploreBriefing>(exploreSession.output) ?? {
    stack: 'unknown',
    buildCommand: 'npm run build',
    structure: '',
    existingPatterns: '',
    relevantFiles: [],
    dependencies: [],
    concerns: exploreSession.output.slice(0, 500),
  };

  await reporter?.log(`[deep-loop] explore done: ${briefing.stack}, ${briefing.relevantFiles.length} files mapped`);

  // ── PHASE 2: PLAN ───────────────────────────────────────────────────────
  await reporter?.progress('deep loop: planning implementation');
  await reporter?.log('[deep-loop] phase 2/4: PLAN');

  const planModel = selectAgentModel('plan', complexity);
  const planStart = Date.now();

  const briefingText = JSON.stringify(briefing, null, 2);
  const planSession = await runAgentSession(
    `Task: ${task}\n\nExplore briefing:\n${briefingText}\n\nCreate an implementation plan. Output JSON only.`,
    {
      cwd,
      model: planModel,
      signal,
      mode: mode ?? 'auto',
      toolNames: [],
      systemPrompt: PLAN_PHASE_PROMPT,
      maxIterations: 1,
      maxTokens: 4096,
      providerOptions: getModelOptions('plan', complexity),
    },
  );

  phaseTimes.plan = { duration: Date.now() - planStart, cost: planSession.cost };
  totals.inputTokens += planSession.inputTokens;
  totals.outputTokens += planSession.outputTokens;
  totals.cost += planSession.cost;

  const plan = parseJSON<PlanOutput>(planSession.output) ?? {
    steps: [{ file: 'unknown', action: 'create', description: task, details: planSession.output.slice(0, 500) }],
    verificationSteps: ['Build passes'],
  };

  await reporter?.log(`[deep-loop] plan done: ${plan.steps.length} steps, ${plan.verificationSteps.length} checks`);

  // ── Build system prompt for implement phase ─────────────────────────────
  const implementSystemParts: string[] = [
    'You are a BUILDER. Follow the implementation plan step by step.',
    'The plan was created by a senior architect who analyzed the codebase. Trust it.',
  ];

  if (specialist) {
    implementSystemParts.push(getSpecialist(specialist).systemPrompt);
    try {
      const skills = loadSkills(cwd);
      const matched = getSkillsForSpecialist(skills, specialist);
      if (matched.length > 0) {
        implementSystemParts.push(
          `<skills>\n${matched.map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`).join('\n\n')}\n</skills>`,
        );
      }
    } catch { /* ignore */ }
  }

  implementSystemParts.push(BUILDER_PROMPT);
  implementSystemParts.push(`Repository root: ${cwd}`);

  try {
    const rules = await loadProjectRules(cwd);
    if (rules) implementSystemParts.push(formatProjectRulesForPrompt(rules));
  } catch { /* ignore */ }

  const implementSystemPrompt = implementSystemParts.join('\n\n');

  // ── Build implement task with plan + briefing context ───────────────────
  const briefingContext = briefing.relevantFiles
    .map((f) => `<file path="${f.path}" why="${f.why}">\n${f.snippet}\n</file>`)
    .join('\n\n');

  const planText = plan.steps
    .map((s, i) => `${i + 1}. [${s.action}] ${s.file}: ${s.description}\n   ${s.details}`)
    .join('\n\n');

  const buildImplementTask = (retryIssues?: string) => {
    const parts = [
      `Task: ${task}`,
      `Stack: ${briefing.stack}`,
      `Build command: ${briefing.buildCommand}`,
      briefingContext ? `Reference files:\n${briefingContext}` : null,
      `Implementation plan:\n${planText}`,
      retryIssues ? `RETRY — the verifier found these issues. Fix ONLY these:\n${retryIssues}` : null,
      'Follow the plan step by step. Implement every step completely. Run the build when done.',
    ];
    return parts.filter(Boolean).join('\n\n');
  };

  // ── PHASE 3 + 4: IMPLEMENT → VERIFY loop ──────────────────────────────
  let lastImplementOutput = '';
  let verifyResult: VerifyOutput | null = null;

  for (let attempt = 0; attempt <= MAX_VERIFY_RETRIES; attempt++) {
    // ── IMPLEMENT ──
    const isRetry = attempt > 0;
    const retryIssues = verifyResult
      ? [...verifyResult.completenessIssues, ...verifyResult.qualityIssues].join('\n')
      : undefined;

    await reporter?.progress(isRetry ? `deep loop: rebuilding (attempt ${attempt + 1})` : 'deep loop: implementing');
    await reporter?.log(`[deep-loop] phase 3/4: IMPLEMENT${isRetry ? ` (retry ${attempt})` : ''}`);

    const implModel = selectAgentModel('builder', complexity);
    const implStart = Date.now();

    const implSession = await runAgentSession(
      buildImplementTask(retryIssues),
      {
        cwd,
        model: implModel,
        signal,
        mode: mode ?? 'auto',
        toolNames: getAllowedToolNamesForRole('builder'),
        systemPrompt: implementSystemPrompt,
        maxIterations: 50,
        maxTokens: 16384,
        providerOptions: getModelOptions('builder', complexity),
      },
    );

    const implDuration = Date.now() - implStart;
    phaseTimes.implement.duration += implDuration;
    phaseTimes.implement.cost += implSession.cost;
    phaseTimes.implement.attempts = attempt + 1;
    totals.inputTokens += implSession.inputTokens;
    totals.outputTokens += implSession.outputTokens;
    totals.cost += implSession.cost;
    lastImplementOutput = implSession.output;

    await reporter?.log(`[deep-loop] implement done (${(implDuration / 1000).toFixed(1)}s)`);

    // ── VERIFY ──
    await reporter?.progress('deep loop: verifying quality');
    await reporter?.log('[deep-loop] phase 4/4: VERIFY');

    const verifyModel = selectAgentModel('verify', complexity);
    const verifyStart = Date.now();

    const verifyTask = [
      `Original task: ${task}`,
      `Build command: ${briefing.buildCommand}`,
      `Implementation plan:\n${planText}`,
      `Verification criteria:\n${plan.verificationSteps.map((v, i) => `${i + 1}. ${v}`).join('\n')}`,
      `Files the builder claims to have changed:\n${plan.steps.map((s) => `  ${s.action}: ${s.file}`).join('\n')}`,
      'Read every file listed above. Run the build. Check completeness against the plan. Output JSON only.',
    ].join('\n\n');

    const verifySession = await runAgentSession(verifyTask, {
      cwd,
      model: verifyModel,
      signal,
      mode: mode ?? 'auto',
      toolNames: ['read_file', 'grep_files', 'find_files', 'list_dir', 'bash', 'run_tests'],
      systemPrompt: VERIFY_PROMPT,
      maxIterations: 15,
      maxTokens: 8192,
      providerOptions: getModelOptions('verify', complexity),
    });

    const verifyDuration = Date.now() - verifyStart;
    phaseTimes.verify.duration += verifyDuration;
    phaseTimes.verify.cost += verifySession.cost;
    totals.inputTokens += verifySession.inputTokens;
    totals.outputTokens += verifySession.outputTokens;
    totals.cost += verifySession.cost;

    verifyResult = parseJSON<VerifyOutput>(verifySession.output) ?? {
      passed: false,
      buildPassed: false,
      filesChecked: [],
      planCompliance: [],
      completenessIssues: ['Could not parse verify output'],
      qualityIssues: [],
      summary: verifySession.output.slice(0, 300),
    };

    phaseTimes.verify.passed = verifyResult.passed;

    if (verifyResult.passed) {
      await reporter?.log(`[deep-loop] VERIFY PASSED: ${verifyResult.summary}`);
      break;
    }

    const issueCount = verifyResult.completenessIssues.length + verifyResult.qualityIssues.length;
    await reporter?.log(
      `[deep-loop] VERIFY FAILED (${issueCount} issues): ${verifyResult.summary}`,
    );

    if (attempt >= MAX_VERIFY_RETRIES) {
      await reporter?.log('[deep-loop] max retries reached — passing to outer reviewer');
    }
  }

  return {
    response: lastImplementOutput,
    model: selectAgentModel('builder', complexity),
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cost: totals.cost,
    duration: Date.now() - startTime,
    phases: phaseTimes,
  };
}

function parseJSON<T>(text: string): T | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
  } catch { /* ignore */ }
  return null;
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Build success.

- [ ] **Step 3: Commit**

```bash
git add src/agents/deep-loop.ts
git commit -m "feat: add 4-phase deep loop orchestrator (explore → plan → implement → verify)"
```

---

### Task 6: Wire deep loop into the builder worker

**Files:**
- Modify: `src/agents/worker-agent.ts:234-335`

- [ ] **Step 1: Import runDeepLoop**

At the top of `src/agents/worker-agent.ts`, add:

```typescript
import { runDeepLoop } from './deep-loop.js';
```

- [ ] **Step 2: Add deep loop branch to runBuilderWorkerAgent**

Inside `runBuilderWorkerAgent`, right after the line that computes `const model = selectAgentModel('builder', complexity, gateMode);` and before `const intent = ...`, add:

```typescript
  // ── Deep loop for complex architect_pipeline tasks ──
  const useDeepLoop = gateMode === 'architect_pipeline' && complexity !== 'trivial' && complexity !== 'simple';

  if (useDeepLoop) {
    await reporter?.log(`[builder] using DEEP LOOP (4-phase) for ${complexity} task`);
    const result = await runDeepLoop({
      task: input.task,
      cwd,
      complexity,
      specialist,
      signal,
      reporter,
      mode: args.mode,
    });

    await reporter?.log(
      `[builder] deep loop complete: ${result.phases.implement.attempts} impl attempts, ` +
      `verify ${result.phases.verify.passed ? 'PASSED' : 'FAILED'}, ` +
      `${(result.duration / 1000).toFixed(1)}s, $${result.cost.toFixed(4)}`,
    );

    return {
      response: result.response,
      model: result.model as import('../providers/types.js').ModelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cost: result.cost,
      duration: result.duration,
    };
  }
```

The rest of the function (the existing flat loop path) stays unchanged for `direct_builder` and simple tasks.

- [ ] **Step 3: Add "read first" nudge to fast loop**

Find the line in `buildBuilderWorkerSystemPrompt` that starts with `isAnalysis ? 'Use read/search tools...'`. Add before it:

```typescript
    'IMPORTANT: Before writing ANY code, use read_file to read the target files first. Understand what exists before changing it.',
```

- [ ] **Step 4: Build and run tests**

Run: `npm run build && npx tsx src/agents/__tests__/agents-pipeline.test.ts`
Expected: Build success, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agents/worker-agent.ts
git commit -m "feat: wire deep loop into builder worker for architect_pipeline tasks"
```

---

### Task 7: Update builder prompt for plan-following mode

**Files:**
- Modify: `src/agents/prompts/builder.ts`

- [ ] **Step 1: Add plan-following instruction**

At the top of `BUILDER_PROMPT`, before the "## Workflow" section, add:

```typescript
## If you received an implementation plan

When a plan is provided, follow it step by step:
1. Read each step in order
2. Implement exactly what the step describes — do not skip steps or combine them
3. After implementing all steps, run the build command from the plan
4. If the build fails, fix the error and re-run

The plan was created by a senior architect who analyzed the codebase. Trust it. Do not spend time re-exploring what the plan already describes.

```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Build success.

- [ ] **Step 3: Commit**

```bash
git add src/agents/prompts/builder.ts
git commit -m "feat: add plan-following instructions to builder prompt"
```

---

### Task 8: Integration test — verify deep loop activates

**Files:**
- No new files — manual verification

- [ ] **Step 1: Build final**

Run: `npm run build`
Expected: Build success, clean output.

- [ ] **Step 2: Run existing tests**

Run: `npx tsx src/agents/__tests__/agents-pipeline.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Verify deep loop activates for architect_pipeline**

Create a test workspace and run:
```bash
mkdir -p /tmp/test-deep-loop && cd /tmp/test-deep-loop
npm init -y
# Run mint with a complex task to trigger architect_pipeline
node /Users/user/Desktop/mint-cli/dist/cli/index.js --plan "build a landing page for a fitness coaching business with hero, features, pricing, and contact sections"
```

Expected: TUI shows `[builder] using DEEP LOOP (4-phase)` in the task inspector logs. You should see 4 distinct phase log entries: EXPLORE, PLAN, IMPLEMENT, VERIFY.

- [ ] **Step 4: Verify fast loop still works for simple tasks**

```bash
cd /tmp/test-deep-loop
node /Users/user/Desktop/mint-cli/dist/cli/index.js --plan "add a comment to package.json explaining what the project does"
```

Expected: No deep loop — should use the flat loop directly.

- [ ] **Step 5: Commit all if any uncommitted changes remain**

```bash
git add -A && git commit -m "feat: deep loop integration complete"
```
