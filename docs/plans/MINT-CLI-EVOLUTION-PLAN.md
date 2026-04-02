# Mint CLI: Evolution Plan for Claude Code

## Context for Claude Code

You are working on `mint-cli` (https://github.com/asaferdman23/mint-cli), a TypeScript CLI tool that currently provides a chat-based AI coding assistant with 3-tier model routing through a gateway backend. The goal is to evolve it into a **multi-agent agentic coding CLI** that can work on large codebases with intelligent context management and multi-model orchestration — delivering Claude Code-level results at 10-50x lower cost.

### Reference Architecture
Study the Claude Code source code architecture at https://github.com/chauncygu/collection-claude-code-source-code for patterns. Key files to study:
- `query.ts` — the main agent loop (how it orchestrates tool calls, streaming, and context)
- `coordinator/` — multi-agent coordination patterns
- `tools/` — tool system (40+ tools including FileReadTool, FileEditTool, BashTool, GrepTool, GlobTool, AgentTool)
- `services/` — business logic layer
- `context.ts` — context handling and autoCompact strategies
- `cost-tracker.ts` — API cost tracking
- `Tool.ts` — the Tool interface and buildTool factory pattern

---

## Current State of mint-cli

### What exists (KEEP):
- TypeScript CLI with `tsup` build, published as `usemint` on npm
- `commander.js` for arg parsing
- `ink` + React TUI with Vim mode, status bar, slash commands
- OpenAI, Anthropic, Google AI SDKs installed
- Gateway backend at `packages/gateway/` deployed on Railway
- 3-tier keyword routing: Simple → Groq Llama, Medium → DeepSeek V3, Complex → Grok-3-mini
- Token counting with `tiktoken`
- `diff` library for file operations
- `better-sqlite3` for local state
- `pino` for logging
- `zod` for validation
- Landing page in `/landing`
- Observability logging to Postgres + Axiom

### What's missing (BUILD):
1. No codebase indexing / project scanning
2. No multi-agent pipeline (Scout → Architect → Builder → Reviewer)
3. No context compaction / smart context loading
4. No file search / dependency graph
5. No modern cheap models (MiMo-Flash, DeepSeek V4, Gemini Flash)
6. No complexity-based routing with subtask splitting
7. No tool system (file read, file edit, bash exec, grep, glob)
8. No agent loop (plan → execute → verify cycle)
9. No MINT.md / project rules file

---

## Phase 1: Tool System (Days 1-2)

**Goal:** Build the foundation that lets the CLI actually interact with codebases, following Claude Code's tool pattern.

### Study first:
Read `claude-code-source-code/src/Tool.ts` for the Tool interface pattern. Read `claude-code-source-code/src/tools/` directory for implementations of FileReadTool, FileEditTool, BashTool, GrepTool, GlobTool.

### Create: `src/tools/` directory

```
src/tools/
├── index.ts              # Tool registry + buildTool factory
├── types.ts              # Tool interface definition
├── file-read.ts          # Read file contents (with line ranges)
├── file-edit.ts          # Apply unified diffs to files
├── file-write.ts         # Create new files
├── bash.ts               # Execute shell commands
├── grep.ts               # Search file contents (regex)
├── glob.ts               # Find files by pattern
└── list-dir.ts           # List directory structure
```

### Tool interface (src/tools/types.ts):
```typescript
export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute(params: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  cwd: string;
  projectRoot: string;
  abortSignal?: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  output: string;
  tokensUsed?: number;
  error?: string;
}
```

### Implementation notes:
- `file-read.ts`: Read files with optional line range `{ path, startLine?, endLine? }`. Return content with line numbers. Respect `.gitignore`.
- `file-edit.ts`: Accept unified diff format. Use the existing `diff` dependency. Apply patch, return success/failure with context.
- `bash.ts`: Execute commands with timeout (30s default). Capture stdout+stderr. Security: block dangerous commands (`rm -rf /`, `sudo`, etc).
- `grep.ts`: Use `child_process` to run `grep -rn` with regex. Return matches with file:line:content format. Respect `.gitignore`.
- `glob.ts`: Use existing `glob` dependency. Return file list matching pattern. Respect `.gitignore` via existing `ignore` dependency.

---

## Phase 2: Context Engine (Days 3-4)

**Goal:** Build the codebase indexing and smart context loading system. This is the key differentiator — what makes cheap models perform like expensive ones.

### Study first:
Read `claude-code-source-code/src/context.ts` for autoCompact strategies. Read the "frequent intentional compaction" technique from https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md

### Create: `src/context/` directory

```
src/context/
├── index.ts              # Context engine public API
├── indexer.ts            # Project scanner (mint init)
├── graph.ts              # Dependency graph data structure
├── search.ts             # File relevance search
├── compactor.ts          # Context compaction logic
└── project-rules.ts      # MINT.md reader/generator
```

### `indexer.ts` — Project Scanner (runs on `mint init`):
1. Walk the project directory, respect `.gitignore`
2. For each source file (.ts, .js, .py, .java, .go, etc):
   - Extract imports/requires/includes
   - Extract exported functions/classes/types (regex-based, not AST — keep it simple)
   - Generate a 2-3 line summary using the cheapest available model (GPT-5 Nano or local heuristics)
3. Build an adjacency list of file dependencies
4. Save to `.mint/context.json`:
```json
{
  "projectRoot": "/path/to/project",
  "totalFiles": 847,
  "totalLOC": 124000,
  "language": "typescript",
  "files": {
    "src/auth/tokenService.ts": {
      "imports": ["src/utils/crypto.ts", "src/config/index.ts"],
      "exports": ["refreshToken", "validateToken", "TokenPayload"],
      "summary": "JWT token refresh and validation service",
      "loc": 145
    }
  },
  "indexedAt": "2026-04-01T12:00:00Z"
}
```

### `search.ts` — File Relevance Search:
Given a task description, find the 4-8 most relevant files:
1. Keyword extraction from the task (simple: split on spaces, filter stop words)
2. Match against file paths, export names, and summaries
3. Walk dependency graph from matched files (1 level deep)
4. Score and rank by relevance
5. Return top files with their content

### `compactor.ts` — Context Compaction:
Before sending files to a model:
1. Strip comments (optional, configurable)
2. For files > 200 lines: keep imports + exported function signatures + relevant function bodies only
3. Target: keep total context under 40-60% of model's context window
4. Track token count using existing `tiktoken` dependency

### `project-rules.ts` — MINT.md:
- Auto-generate on `mint init` with detected patterns (framework, language, test runner, lint config)
- User can edit manually
- Injected into every prompt as system context

---

## Phase 3: Multi-Agent Pipeline (Days 5-7)

**Goal:** Replace the single chat-based model call with a 4-agent pipeline: Scout → Architect → Builder → Reviewer.

### Study first:
Read `claude-code-source-code/src/coordinator/` for multi-agent patterns. Read `claude-code-source-code/src/query.ts` for the main agent loop — specifically how it handles `StreamingToolExecutor` and `runTools()`. Also read the `AgentTool` in `claude-code-source-code/src/tools/` — Claude Code uses sub-agents (spawned with their own context window).

### Create: `src/agents/` directory

```
src/agents/
├── index.ts              # Pipeline orchestrator
├── types.ts              # Agent interfaces
├── scout.ts              # SCOUT agent — file search + task classification
├── architect.ts          # ARCHITECT agent — reasoning + planning
├── builder.ts            # BUILDER agent — code generation
├── reviewer.ts           # REVIEWER agent — verification
└── prompts/
    ├── scout.ts          # Scout system prompt
    ├── architect.ts      # Architect system prompt
    ├── builder.ts        # Builder system prompt
    └── reviewer.ts       # Reviewer system prompt
```

### Agent interface (src/agents/types.ts):
```typescript
export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';

export interface AgentInput {
  task: string;
  context: CompactedContext;
  projectRules?: string;
  previousOutput?: string; // output from previous agent in pipeline
}

export interface AgentOutput {
  result: string;
  filesModified?: string[];
  diffs?: UnifiedDiff[];
  tokensUsed: number;
  cost: number;
  model: string;
  duration: number;
}

export interface PipelineResult {
  phases: { agent: string; output: AgentOutput }[];
  totalCost: number;
  totalDuration: number;
  success: boolean;
}
```

### Pipeline orchestrator (src/agents/index.ts):

```typescript
export async function runPipeline(task: string, options: PipelineOptions): Promise<PipelineResult> {
  const phases = [];
  
  // Phase 1: SCOUT — classify task + find relevant files
  const scoutResult = await runScout(task, options);
  phases.push({ agent: 'scout', output: scoutResult });
  
  // Short-circuit for trivial tasks
  if (scoutResult.complexity === 'trivial') {
    const builderResult = await runBuilder(task, scoutResult, options);
    phases.push({ agent: 'builder', output: builderResult });
    return { phases, totalCost: sumCosts(phases), success: true };
  }
  
  // Phase 2: ARCHITECT — plan the implementation
  const architectResult = await runArchitect(task, scoutResult, options);
  phases.push({ agent: 'architect', output: architectResult });
  
  // Phase 3: BUILDER — generate code
  const builderResult = await runBuilder(task, architectResult, options);
  phases.push({ agent: 'builder', output: builderResult });
  
  // Phase 4: REVIEWER — verify the output
  const reviewerResult = await runReviewer(builderResult, options);
  phases.push({ agent: 'reviewer', output: reviewerResult });
  
  // Retry loop: if reviewer rejects, send back to builder (max 2 retries)
  if (!reviewerResult.approved && retries < 2) {
    // Loop back to builder with reviewer's feedback
  }
  
  return { phases, totalCost: sumCosts(phases), success: reviewerResult.approved };
}
```

### Model selection per agent:

```typescript
// src/agents/model-selector.ts
export function selectModel(agent: AgentRole, complexity: TaskComplexity): ModelConfig {
  const matrix = {
    scout: {
      trivial: 'groq/llama-3.1-8b',      // $0.05/M — fastest
      simple: 'groq/llama-3.1-8b',
      moderate: 'groq/llama-3.3-70b',
      complex: 'deepseek/deepseek-chat',
    },
    architect: {
      simple: 'deepseek/deepseek-chat',    // DeepSeek V3 — good reasoning
      moderate: 'deepseek/deepseek-chat',
      complex: 'deepseek/deepseek-reasoner', // DeepSeek R1 — deep reasoning
    },
    builder: {
      trivial: 'groq/llama-3.3-70b',
      simple: 'deepseek/deepseek-chat',
      moderate: 'deepseek/deepseek-chat',
      complex: 'deepseek/deepseek-chat',
    },
    reviewer: {
      trivial: 'groq/llama-3.1-8b',
      simple: 'groq/llama-3.1-8b',
      moderate: 'groq/llama-3.3-70b',
      complex: 'deepseek/deepseek-chat',
    },
  };
  return matrix[agent][complexity];
}
```

### Agent prompts — key principle:
Each agent gets a FOCUSED system prompt. Do NOT give all context to all agents. Scout gets the task + file list. Architect gets the task + only relevant file contents. Builder gets the spec + only the files it needs to modify. Reviewer gets the diffs + the original files.

---

## Phase 4: Upgrade Router + Gateway (Days 8-9)

**Goal:** Upgrade the existing gateway to support the new models and the multi-agent pipeline.

### Changes to `packages/gateway/`:

1. **Add new model providers:**
   - DeepSeek V4 (when available) / DeepSeek V3.2 chat + reasoner
   - MiMo-V2-Flash via OpenRouter or direct API
   - Gemini Flash via Google AI SDK (already installed)
   - Mistral Small 4 via Mistral API
   - Keep existing: Groq (Llama), Grok

2. **Add provider adapter pattern:**
```typescript
// src/gateway/providers/
├── base.ts               # Provider interface
├── deepseek.ts           # DeepSeek (OpenAI-compatible API)
├── groq.ts               # Groq (existing)
├── grok.ts               # Grok (existing)  
├── gemini.ts             # Google Gemini
├── mistral.ts            # Mistral
├── openrouter.ts         # OpenRouter (for MiMo, etc)
└── index.ts              # Provider registry
```

3. **Add automatic fallback chain:**
   If primary provider fails (429, 500, timeout) → try next provider for that tier.

4. **Add per-phase cost tracking:**
   Log which agent used which model, tokens consumed, cost, latency — per request.

---

## Phase 5: Agentic Commands (Days 10-11)

**Goal:** Replace the chat-only TUI with agentic commands that work on the codebase.

### New CLI commands:

```bash
mint init                    # Scan project, build context index
mint "fix the auth bug"      # Run multi-agent pipeline
mint --chat                  # Original chat TUI (keep as fallback)
mint status                  # Show project index stats + usage
mint savings                 # Cost comparison vs Claude Code (existing)
mint models                  # List available models (existing)
```

### Changes to `src/cli/index.ts`:
- Default mode: if user provides a task string, run the multi-agent pipeline
- If user runs `mint` with no args, open the TUI chat (existing behavior)
- Add `mint init` command that runs the context indexer
- After pipeline completes, show:
  ```
  ✅ Done in 34s
  📁 Modified: src/auth/tokenService.ts, src/middleware/auth.ts  
  💰 Cost: $0.033 (Claude Code estimate: $1.50 — saved 97%)
  
  Apply changes? [Y/n]
  ```

### Changes to TUI:
- Add phase indicators in the status bar (SCOUT → ARCHITECT → BUILDER → REVIEWER)
- Show real-time cost accumulation
- Show which model is running in each phase

---

## Phase 6: File Operations + Apply (Days 12-13)

**Goal:** The CLI must actually apply code changes to the filesystem.

### Implementation:
1. Builder agent outputs unified diffs
2. After Reviewer approves, present diffs to user with syntax highlighting
3. On user approval, apply diffs using the existing `diff` library
4. Create a `.mint/history/` entry with before/after snapshots for undo

### Diff display in terminal:
Use `chalk` (already installed) to show colored diffs:
- Green for additions
- Red for deletions  
- Gray for context lines
- Show file path header for each modified file

### Undo support:
```bash
mint undo              # Revert last applied change
```
Store pre-change file contents in `.mint/history/{timestamp}/` with a manifest.

---

## Phase 7: Polish + Ship (Day 14)

### Tasks:
1. Update README.md with new capabilities
2. Record terminal demo GIF showing multi-agent pipeline in action
3. Update landing page in `/landing`
4. Bump version to 0.2.0
5. Publish to npm
6. Test end-to-end on 3 real projects:
   - A small React app (~50 files)
   - A medium Node.js API (~200 files)  
   - A large monorepo (~500+ files)

---

## Architecture Principles (from Claude Code source)

### 1. Tool-use over chat
Claude Code doesn't just chat — it uses tools (file read, file edit, bash, grep) in loops. Your agents should output TOOL CALLS, not just text. The Builder agent should output specific file edits, not prose about what to change.

### 2. Context windowing
Claude Code's `autoCompact()` has three strategies: reactive compression (when context is full), micro-compression (per-turn), and trimmed compression (drop old turns). Implement at minimum reactive compression — when context exceeds 60% of model window, summarize old turns before continuing.

### 3. Streaming tool execution
Claude Code uses `StreamingToolExecutor` to run tools in parallel when possible. For your multi-agent pipeline, the Scout can start before all context is loaded. Tools within a phase can run in parallel (e.g., grep + glob simultaneously).

### 4. Sub-agents with isolated context
Claude Code's `AgentTool` spawns sub-agents with their own context window. This is exactly your multi-agent pipeline — each agent (Scout, Architect, Builder, Reviewer) is essentially a sub-agent with isolated context, preventing context pollution.

### 5. Cost tracking is a feature
Claude Code tracks API costs internally (`cost-tracker.ts`). Your cost tracking should be USER-FACING — show savings vs Claude Code/Cursor. This is your marketing differentiator.

---

## File Changes Summary

### New files to create:
```
src/tools/index.ts
src/tools/types.ts
src/tools/file-read.ts
src/tools/file-edit.ts
src/tools/file-write.ts
src/tools/bash.ts
src/tools/grep.ts
src/tools/glob.ts
src/tools/list-dir.ts
src/context/index.ts
src/context/indexer.ts
src/context/graph.ts
src/context/search.ts
src/context/compactor.ts
src/context/project-rules.ts
src/agents/index.ts
src/agents/types.ts
src/agents/scout.ts
src/agents/architect.ts
src/agents/builder.ts
src/agents/reviewer.ts
src/agents/model-selector.ts
src/agents/prompts/scout.ts
src/agents/prompts/architect.ts
src/agents/prompts/builder.ts
src/agents/prompts/reviewer.ts
```

### Existing files to modify:
```
src/cli/index.ts          — Add init command, pipeline mode, phase display
packages/gateway/          — Add new providers, fallback chain, per-phase tracking
package.json              — Add new dependencies if needed (tree-sitter?)
README.md                 — Update with new capabilities
tsup.config.ts            — Ensure new directories are included
```

### New dependencies to consider:
```
@anthropic-ai/sdk          — already installed
openai                     — already installed  
@google/generative-ai      — already installed
tiktoken                   — already installed
diff                       — already installed
glob                       — already installed
ignore                     — already installed
chalk                      — already installed
# Potentially add:
tree-sitter                — for better code parsing (optional, can use regex first)
```

---

## Success Metrics

After all phases, the CLI should be able to:

1. `mint init` on a 500-file project in < 30 seconds, costing < $0.02
2. `mint "fix the auth token refresh bug"` completing in < 60 seconds, costing < $0.05
3. Show 10-50x cost savings vs equivalent Claude Code task
4. Successfully modify the correct files 80%+ of the time on first attempt
5. Handle projects up to 200K LOC without context overflow
6. Gracefully fall back if any provider is down

---

## Naming Note

The project is currently called "mint" / "usemint". Consider renaming to avoid conflict with Intuit's Mint (shutdown but trademark may persist) and SEO competition. Candidate names: Mint, Forge, Volt, Flint. This is a find-and-replace task — do it early before shipping.
