# Axon v2 — Context Engineering & Provider Expansion Plan

> **For Claude:** REQUIRED: Follow this plan phase-by-phase using TDD.
> Read every cited file before touching it. ESM `.js` extensions on all imports.
> `tsup` builds to `dist/cli/index.js`. Ink v5. `assertInCwd()` path guard already exists in `src/agent/tools.ts`.

**Goal:** Add 5 new providers, a tier-aware context compression system, AGENT.md project intelligence, a split-pane TUI right panel, and 4 agent autonomy modes.

**Architecture:**
- Providers share a thin `OpenAICompatibleProvider` base class (80% code reuse vs current copy-paste pattern)
- `ModelId` union in `types.ts` is the single source of truth for all model IDs
- Context compression is pure functions (no side effects) keyed on `ContextTier` enum
- TUI right panel is a separate Ink component receiving events through a shared `useAgentEvents` hook
- Agent modes are flag-driven wrappers around the existing `agentLoop` generator

**Tech Stack:** Node 20+, TypeScript ESM, `openai` SDK (for all OpenAI-compatible providers), `@google/generative-ai` (Gemini), Ink v5 + React 18, Commander.js

**Prerequisites:**
- Existing providers: `src/providers/deepseek.ts` (OpenAI SDK), `src/providers/anthropic.ts` (native SDK)
- `tiktoken` already in `package.json` — use it for accurate token counting
- `diff` already in `package.json` — use for `--diff` mode
- `better-sqlite3` in `package.json` — available for future session storage (not needed in this plan)

---

## Relevant Codebase Files

### Core Provider Files
- `src/providers/types.ts` (lines 1-157) — `ModelId` union, `MODELS` record, `Provider` interface, `AgentStreamChunk`
- `src/providers/deepseek.ts` (lines 11-210) — OpenAI-compatible base pattern (all new providers follow this)
- `src/providers/index.ts` (lines 1-63) — registry map, `streamAgent()` cast pattern `as Provider & { streamAgent? }`
- `src/providers/router.ts` (lines 23-28) — `MODEL_TIERS` object — extend, don't replace

### Agent Files
- `src/agent/loop.ts` (lines 40-137) — `agentLoop()` generator — add mode parameter
- `src/agent/index.ts` (lines 9-39) — `buildSystemPrompt()` — inject AGENT.md here
- `src/agent/tools.ts` — `assertInCwd()` path guard, `executeTool()`, `TOOLS` array

### TUI Files
- `src/tui/App.tsx` (lines 1-277) — single-pane layout — split into left+right
- `src/tui/components/StatusBar.tsx` — bottom bar — extend for mode display

### CLI Entry
- `src/cli/index.ts` (lines 107-144) — `agent` command — add `--yolo`, `--plan`, `--diff` flags

### Context
- `src/context/gather.ts` (lines 104-173) — existing context gatherer — `buildContextPack()` replaces this for agent use

---

## Phase 1: Provider Tier System + New Providers

> **Exit Criteria:** `axon config:set providers.kimi <key>` works. `axon agent "hello" -m kimi-k2` routes to Kimi and streams a response. `axon config:set providers.groq <key>` works. All 5 new providers visible in `axon models` list. TypeScript builds clean.

### Task 1.1: Extend `types.ts` with new ModelIds and tier metadata

**Files:**
- Modify: `src/providers/types.ts`

**Step 1:** Read `src/providers/types.ts` in full (already done above — line 1-157).

**Step 2:** Replace the `ModelId` type union to add 10 new model IDs.

Add these to the union (after `'qwen-coder-32b'`):
```typescript
  | 'kimi-k2'
  | 'moonshot-v1-8k'
  | 'moonshot-v1-32k'
  | 'grok-3'
  | 'grok-3-fast'
  | 'grok-3-mini-fast'
  | 'gemini-1-5-flash'
  | 'gemini-1-5-pro'
  | 'groq-llama-70b'
  | 'groq-llama-8b'
```

**Step 3:** Add new models to the `MODELS` record after `qwen-coder-32b`:

```typescript
  'kimi-k2': {
    id: 'kimi-k2',
    provider: 'kimi',
    name: 'Kimi K2',
    inputPrice: 0.60,
    outputPrice: 2.50,
    contextWindow: 128000,
    capabilities: { coding: 8, reasoning: 8, speed: 9 },
  },
  'moonshot-v1-8k': {
    id: 'moonshot-v1-8k',
    provider: 'kimi',
    name: 'Moonshot v1 8k',
    inputPrice: 0.12,
    outputPrice: 0.12,
    contextWindow: 8000,
    capabilities: { coding: 7, reasoning: 7, speed: 10 },
  },
  'moonshot-v1-32k': {
    id: 'moonshot-v1-32k',
    provider: 'kimi',
    name: 'Moonshot v1 32k',
    inputPrice: 0.24,
    outputPrice: 0.24,
    contextWindow: 32000,
    capabilities: { coding: 7, reasoning: 7, speed: 10 },
  },
  'grok-3': {
    id: 'grok-3',
    provider: 'grok',
    name: 'Grok 3',
    inputPrice: 3.0,
    outputPrice: 15.0,
    contextWindow: 131072,
    capabilities: { coding: 9, reasoning: 9, speed: 7 },
  },
  'grok-3-fast': {
    id: 'grok-3-fast',
    provider: 'grok',
    name: 'Grok 3 Fast',
    inputPrice: 5.0,
    outputPrice: 25.0,
    contextWindow: 131072,
    capabilities: { coding: 8, reasoning: 8, speed: 10 },
  },
  'grok-3-mini-fast': {
    id: 'grok-3-mini-fast',
    provider: 'grok',
    name: 'Grok 3 Mini Fast',
    inputPrice: 0.60,
    outputPrice: 4.0,
    contextWindow: 131072,
    capabilities: { coding: 7, reasoning: 8, speed: 10 },
  },
  'gemini-1-5-flash': {
    id: 'gemini-1-5-flash',
    provider: 'gemini',
    name: 'Gemini 1.5 Flash',
    inputPrice: 0.075,
    outputPrice: 0.30,
    contextWindow: 1000000,
    capabilities: { coding: 7, reasoning: 7, speed: 10 },
  },
  'gemini-1-5-pro': {
    id: 'gemini-1-5-pro',
    provider: 'gemini',
    name: 'Gemini 1.5 Pro',
    inputPrice: 1.25,
    outputPrice: 5.0,
    contextWindow: 2000000,
    capabilities: { coding: 8, reasoning: 9, speed: 7 },
  },
  'groq-llama-70b': {
    id: 'groq-llama-70b',
    provider: 'groq',
    name: 'Llama 3.3 70B (Groq)',
    inputPrice: 0.59,
    outputPrice: 0.79,
    contextWindow: 128000,
    capabilities: { coding: 8, reasoning: 7, speed: 10 },
  },
  'groq-llama-8b': {
    id: 'groq-llama-8b',
    provider: 'groq',
    name: 'Llama 3.1 8B (Groq)',
    inputPrice: 0.05,
    outputPrice: 0.08,
    contextWindow: 128000,
    capabilities: { coding: 6, reasoning: 6, speed: 10 },
  },
```

**Step 4:** Add `'kimi' | 'grok' | 'groq'` to the `ProviderId` union (existing: `'anthropic' | 'deepseek' | 'openrouter' | 'gemini' | 'openai'`).

**Step 5:** Build: `cd /Users/user/Desktop/axon-cli && npm run build`
Expected: TypeScript errors about unknown providers in `index.ts` — fix in Task 1.3.

**Step 6:** Commit.
```bash
git add src/providers/types.ts
git commit -m "feat: add 10 new model IDs and provider types"
```

---

### Task 1.2: Create `src/providers/tiers.ts`

**Files:**
- Create: `src/providers/tiers.ts`

This is the single place where tier classification lives. All context budget + compression code imports from here.

**Step 1:** Create the file:

```typescript
// src/providers/tiers.ts
import type { ModelId } from './types.js';

export type ContextTier = 'apex' | 'smart' | 'fast' | 'ultra';

/**
 * Model tier classification.
 * - APEX:  Claude Opus, GPT-4o, Gemini 1.5 Pro — full context, no compression
 * - SMART: Claude Sonnet, DeepSeek-V3, Grok-3, Gemini 2 Pro — light compression
 * - FAST:  Kimi K2, Grok-3-fast, Gemini Flash, Qwen-Coder, Groq 70B — heavy compression
 * - ULTRA: Groq 8B, Moonshot 8k — max compression, skeleton context only
 */
export const MODEL_TIERS: Record<ModelId, ContextTier> = {
  'claude-opus-4':        'apex',
  'gpt-4o':               'apex',
  'gemini-2-pro':         'apex',
  'gemini-1-5-pro':       'apex',
  'claude-sonnet-4':      'smart',
  'deepseek-v3':          'smart',
  'grok-3':               'smart',
  'gemini-2-flash':       'smart',
  'kimi-k2':              'fast',
  'grok-3-fast':          'fast',
  'grok-3-mini-fast':     'fast',
  'gemini-1-5-flash':     'fast',
  'qwen-coder-32b':       'fast',
  'groq-llama-70b':       'fast',
  'deepseek-coder':       'fast',
  'moonshot-v1-32k':      'ultra',
  'moonshot-v1-8k':       'ultra',
  'groq-llama-8b':        'ultra',
};

/** Maximum context tokens to send to the model (reserve the rest for output). */
export const CONTEXT_BUDGETS: Record<ContextTier, { maxContextTokens: number; reservedOutputTokens: number }> = {
  apex:  { maxContextTokens: 180_000, reservedOutputTokens: 20_000 },
  smart: { maxContextTokens:  60_000, reservedOutputTokens:  8_000 },
  fast:  { maxContextTokens:  20_000, reservedOutputTokens:  4_000 },
  ultra: { maxContextTokens:   8_000, reservedOutputTokens:  2_000 },
};

export function getTier(modelId: ModelId): ContextTier {
  return MODEL_TIERS[modelId] ?? 'fast';
}

export function getBudget(modelId: ModelId) {
  return CONTEXT_BUDGETS[getTier(modelId)];
}
```

**Step 2:** Build: `npm run build` — should be clean.

**Step 3:** Commit.
```bash
git add src/providers/tiers.ts
git commit -m "feat: add provider tier system with context budgets"
```

---

### Task 1.3: Create `src/providers/openai-compatible.ts` (base class)

**Files:**
- Create: `src/providers/openai-compatible.ts`

This base class gives all OpenAI-compatible providers (`kimi`, `grok`, `groq`, `qwen`) their full implementation for free. The concrete providers just supply `baseURL`, `apiKeyConfigPath`, and `modelMap`.

**Step 1:** Create the file. Pattern is identical to `deepseek.ts` but parameterized:

```typescript
// src/providers/openai-compatible.ts
import OpenAI from 'openai';
import type { Provider, CompletionRequest, CompletionResponse, ModelId, AgentStreamChunk } from './types.js';
import { calculateCost } from './router.js';
import { config } from '../utils/config.js';

export interface OpenAICompatibleConfig {
  providerId: string;
  providerName: string;
  baseURL: string;
  /** Dot-path into config store, e.g. "providers.kimi" */
  apiKeyConfigPath: string;
  /** Map from our ModelId to the actual API model string */
  modelMap: Partial<Record<ModelId, string>>;
}

export class OpenAICompatibleProvider implements Provider {
  readonly id: string;
  readonly name: string;
  private client: OpenAI | null = null;
  private cfg: OpenAICompatibleConfig;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.providerId;
    this.name = cfg.providerName;
    this.cfg = cfg;
  }

  private getClient(): OpenAI {
    if (this.client) return this.client;
    // Navigate dot-path in config, e.g. "providers.kimi" → config.get("providers")?.kimi
    const [section, key] = this.cfg.apiKeyConfigPath.split('.') as [string, string];
    const sectionData = config.get(section as never) as Record<string, string> | undefined;
    const apiKey = sectionData?.[key];
    if (!apiKey) {
      throw new Error(
        `${this.cfg.providerName} API key not configured. Run: axon config:set ${this.cfg.apiKeyConfigPath} <key>`
      );
    }
    this.client = new OpenAI({ apiKey, baseURL: this.cfg.baseURL });
    return this.client;
  }

  private resolveModel(modelId: ModelId): string {
    const mapped = this.cfg.modelMap[modelId];
    if (!mapped) {
      throw new Error(`Model ${modelId} not supported by ${this.cfg.providerName} provider`);
    }
    return mapped;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const client = this.getClient();
    const modelString = this.resolveModel(request.model);
    const startTime = Date.now();

    const messages = buildOAIMessages(request);
    const response = await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      messages,
    });

    const latency = Date.now() - startTime;
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const content = response.choices[0]?.message?.content ?? '';

    return {
      content,
      model: request.model,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      cost: calculateCost(request.model, inputTokens, outputTokens),
      latency,
    };
  }

  async *streamComplete(request: CompletionRequest): AsyncIterable<string> {
    const client = this.getClient();
    const modelString = this.resolveModel(request.model);
    const messages = buildOAIMessages(request);

    const stream = await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      messages,
      stream: true,
    }, { signal: request.signal });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  async *streamAgent(request: CompletionRequest): AsyncIterable<AgentStreamChunk> {
    const client = this.getClient();
    const modelString = this.resolveModel(request.model);
    const messages = buildOAIAgentMessages(request);

    const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = request.tools?.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const stream = await client.chat.completions.create({
      model: modelString,
      max_tokens: request.maxTokens ?? 8192,
      temperature: request.temperature ?? 0.7,
      messages,
      tools,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      stream: true,
    }, { signal: request.signal });

    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) yield { type: 'text', text: delta.content };

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallAccumulators.has(idx)) {
            toolCallAccumulators.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' });
          }
          const acc = toolCallAccumulators.get(idx)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }

      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason === 'tool_calls' || finishReason === 'stop') {
        for (const [, acc] of toolCallAccumulators) {
          let parsedInput: Record<string, unknown> = {};
          try { parsedInput = JSON.parse(acc.arguments || '{}'); }
          catch { parsedInput = { raw: acc.arguments }; }
          yield { type: 'tool_call', toolName: acc.name, toolInput: parsedInput, toolCallId: acc.id };
        }
        toolCallAccumulators.clear();
      }
    }
  }
}

// ─── Message builders (shared with streamAgent) ───────────────────────────────

function buildOAIMessages(request: CompletionRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (request.systemPrompt) out.push({ role: 'system', content: request.systemPrompt });
  for (const m of request.messages) {
    out.push({ role: m.role as 'user' | 'assistant' | 'system', content: m.content });
  }
  return out;
}

type AgentMessage = { role: string; content: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>; toolResults?: Array<{ toolCallId: string; content: string }> };

function buildOAIAgentMessages(request: CompletionRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (request.systemPrompt) out.push({ role: 'system', content: request.systemPrompt });

  for (const m of request.messages) {
    const am = m as AgentMessage;
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (am.toolCalls && am.toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: am.toolCalls.map(tc => ({
            id: tc.id, type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    } else if (m.role === 'tool') {
      const results = am.toolResults;
      if (results) {
        for (const r of results) {
          out.push({ role: 'tool', content: r.content, tool_call_id: r.toolCallId });
        }
      }
    }
  }
  return out;
}
```

**Step 2:** Build: `npm run build`. Expected: clean.

**Step 3:** Commit.
```bash
git add src/providers/openai-compatible.ts
git commit -m "feat: add OpenAICompatibleProvider base class"
```

---

### Task 1.4: Create thin provider files for Kimi, Grok, Groq, Qwen

**Files:**
- Create: `src/providers/kimi.ts`
- Create: `src/providers/grok.ts`
- Create: `src/providers/groq.ts`
- Modify: `src/providers/openrouter.ts` (Qwen is already in MODELS via openrouter, but needs streamAgent)

Each file is ~25 lines — just config wired to `OpenAICompatibleProvider`.

**Step 1:** Create `src/providers/kimi.ts`:

```typescript
// src/providers/kimi.ts
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const kimiProvider = new OpenAICompatibleProvider({
  providerId: 'kimi',
  providerName: 'Kimi (Moonshot AI)',
  baseURL: 'https://api.moonshot.cn/v1',
  apiKeyConfigPath: 'providers.kimi',
  modelMap: {
    'kimi-k2':          'kimi-k2-0711-preview',
    'moonshot-v1-8k':   'moonshot-v1-8k',
    'moonshot-v1-32k':  'moonshot-v1-32k',
  },
});
```

**Step 2:** Create `src/providers/grok.ts`:

```typescript
// src/providers/grok.ts
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const grokProvider = new OpenAICompatibleProvider({
  providerId: 'grok',
  providerName: 'Grok (xAI)',
  baseURL: 'https://api.x.ai/v1',
  apiKeyConfigPath: 'providers.grok',
  modelMap: {
    'grok-3':           'grok-3',
    'grok-3-fast':      'grok-3-fast',
    'grok-3-mini-fast': 'grok-3-mini-fast',
  },
});
```

**Step 3:** Create `src/providers/groq.ts`:

```typescript
// src/providers/groq.ts
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const groqProvider = new OpenAICompatibleProvider({
  providerId: 'groq',
  providerName: 'Groq',
  baseURL: 'https://api.groq.com/openai/v1',
  apiKeyConfigPath: 'providers.groq',
  modelMap: {
    'groq-llama-70b': 'llama-3.3-70b-versatile',
    'groq-llama-8b':  'llama-3.1-8b-instant',
  },
});
```

**Step 4:** Check `src/providers/index.ts` — `qwen-coder-32b` is already provider `openrouter`. Verify whether `openrouter.ts` exists. If not, create `src/providers/qwen.ts` that reuses `OpenAICompatibleProvider` with OpenRouter base URL:

```typescript
// src/providers/qwen.ts  (only create if openrouter.ts doesn't exist or lacks streamAgent)
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const qwenProvider = new OpenAICompatibleProvider({
  providerId: 'openrouter',
  providerName: 'Qwen (OpenRouter)',
  baseURL: 'https://openrouter.ai/api/v1',
  apiKeyConfigPath: 'providers.openrouter',
  modelMap: {
    'qwen-coder-32b': 'qwen/qwen-2.5-coder-32b-instruct',
  },
});
```

**Step 5:** Wire all new providers into `src/providers/index.ts`. In the `providers` Map constructor, add:

```typescript
import { kimiProvider } from './kimi.js';
import { grokProvider } from './grok.js';
import { groqProvider } from './groq.js';
import { qwenProvider } from './qwen.js';   // or openrouterProvider if that file exists

// In the Map constructor:
['kimi', kimiProvider],
['grok', grokProvider],
['groq', groqProvider],
['openrouter', qwenProvider],   // replaces any stub
```

**Step 6:** Also add a `axon models` CLI command in `src/cli/index.ts`:

```typescript
program
  .command('models')
  .description('List available models and their tiers')
  .action(async () => {
    const { listModels } = await import('../providers/index.js');
    const { getTier } = await import('../providers/tiers.js');
    for (const m of listModels()) {
      const tier = getTier(m.id as import('../providers/types.js').ModelId);
      console.log(`${m.id.padEnd(22)} ${m.provider.padEnd(12)} ${tier}`);
    }
  });
```

**Step 7:** Build: `npm run build`. Fix any TypeScript errors.

**Step 8:** Commit.
```bash
git add src/providers/kimi.ts src/providers/grok.ts src/providers/groq.ts src/providers/qwen.ts src/providers/index.ts src/cli/index.ts
git commit -m "feat: add Kimi, Grok, Groq, Qwen providers via OpenAICompatibleProvider"
```

---

### Task 1.5: Add Gemini provider using `@google/generative-ai`

Gemini does NOT use the OpenAI SDK — it uses Google's own SDK. This provider is written separately.

**Files:**
- Create: `src/providers/gemini.ts`

**Step 1:** Install the SDK:
```bash
cd /Users/user/Desktop/axon-cli && npm install @google/generative-ai
```

**Step 2:** Create `src/providers/gemini.ts`. Implement `complete`, `streamComplete`, and `streamAgent`. For `streamAgent` with tool calls, use `functionDeclarations` in the Gemini SDK:

```typescript
// src/providers/gemini.ts
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import type { Provider, CompletionRequest, CompletionResponse, ModelId, AgentStreamChunk } from './types.js';
import { calculateCost } from './router.js';
import { config } from '../utils/config.js';

const MODEL_MAP: Partial<Record<ModelId, string>> = {
  'gemini-2-flash':    'gemini-2.0-flash',
  'gemini-2-pro':      'gemini-2.0-pro-exp',
  'gemini-1-5-flash':  'gemini-1.5-flash',
  'gemini-1-5-pro':    'gemini-1.5-pro',
};

export class GeminiProvider implements Provider {
  id = 'gemini' as const;
  name = 'Gemini (Google)';
  private sdk: GoogleGenerativeAI | null = null;

  private getSDK(): GoogleGenerativeAI {
    if (this.sdk) return this.sdk;
    const sectionData = config.get('providers') as Record<string, string> | undefined;
    const apiKey = sectionData?.['gemini'];
    if (!apiKey) throw new Error('Gemini API key not configured. Run: axon config:set providers.gemini <key>');
    this.sdk = new GoogleGenerativeAI(apiKey);
    return this.sdk;
  }

  private getModel(modelId: ModelId): GenerativeModel {
    const modelString = MODEL_MAP[modelId];
    if (!modelString) throw new Error(`Model ${modelId} not supported by Gemini provider`);
    return this.getSDK().getGenerativeModel({ model: modelString });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = this.getModel(request.model);
    const startTime = Date.now();

    const history = request.messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const lastMsg = request.messages[request.messages.length - 1];
    const chat = model.startChat({
      history,
      systemInstruction: request.systemPrompt,
    });

    const result = await chat.sendMessage(lastMsg.content);
    const content = result.response.text();
    const latency = Date.now() - startTime;

    const usage = result.response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;

    return {
      content,
      model: request.model,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      cost: calculateCost(request.model, inputTokens, outputTokens),
      latency,
    };
  }

  async *streamComplete(request: CompletionRequest): AsyncIterable<string> {
    const model = this.getModel(request.model);
    const history = request.messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    const lastMsg = request.messages[request.messages.length - 1];
    const chat = model.startChat({ history, systemInstruction: request.systemPrompt });
    const result = await chat.sendMessageStream(lastMsg.content);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }

  async *streamAgent(request: CompletionRequest): AsyncIterable<AgentStreamChunk> {
    // Gemini function-calling: use generateContentStream with tools
    const modelString = MODEL_MAP[request.model];
    if (!modelString) throw new Error(`Model ${request.model} not supported by Gemini provider`);

    const tools = request.tools ? [{
      functionDeclarations: request.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    }] : undefined;

    const model = this.getSDK().getGenerativeModel({
      model: modelString,
      tools,
      systemInstruction: request.systemPrompt,
    });

    const history = request.messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const lastMsg = request.messages[request.messages.length - 1];
    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMsg.content);

    for await (const chunk of result.stream) {
      // Text parts
      const text = chunk.text();
      if (text) yield { type: 'text', text };

      // Function call parts
      const candidates = chunk.candidates ?? [];
      for (const candidate of candidates) {
        for (const part of candidate.content.parts) {
          if (part.functionCall) {
            yield {
              type: 'tool_call',
              toolName: part.functionCall.name,
              toolInput: part.functionCall.args as Record<string, unknown>,
              toolCallId: `gemini_${Date.now()}`,
            };
          }
        }
      }
    }
  }
}

export const geminiProvider = new GeminiProvider();
```

**Step 3:** Wire into `src/providers/index.ts`:
```typescript
import { geminiProvider } from './gemini.js';
// In Map: ['gemini', geminiProvider],
```

**Step 4:** Build and verify: `npm run build`

**Step 5:** Commit.
```bash
git add src/providers/gemini.ts src/providers/index.ts package.json package-lock.json
git commit -m "feat: add Gemini provider with streamAgent tool support"
```

---

## Phase 2: Context Engineering

> **Exit Criteria:** `axon agent "explain this codebase" -m groq-llama-8b` auto-compresses context to skeleton-only. `axon agent "refactor auth" -m claude-opus-4` gets full raw context. Creating `.axon/AGENT.md` in a project dir injects it at the top of every agent system prompt. `buildContextPack()` returns `{ systemContext, tokenEstimate, filesIncluded }`.

### Task 2.1: Create `src/context/budget.ts`

**Files:**
- Create: `src/context/budget.ts`

**Step 1:** Create the file. This is a thin re-export + utility layer over `tiers.ts`:

```typescript
// src/context/budget.ts
export { CONTEXT_BUDGETS, getTier, getBudget, type ContextTier } from '../providers/tiers.js';

/**
 * Rough token estimate: 4 chars ≈ 1 token.
 * Use tiktoken for accurate counts when performance allows.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to approximately maxTokens tokens.
 * Preserves first `keepRatio` fraction if text must be cut.
 */
export function truncateToTokens(text: string, maxTokens: number, keepRatio = 0.9): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const keepChars = Math.floor(maxChars * keepRatio);
  return text.slice(0, keepChars) + `\n... [truncated: ${Math.ceil((text.length - keepChars) / 4)} tokens omitted]`;
}
```

**Step 2:** Commit.
```bash
git add src/context/budget.ts
git commit -m "feat: add context budget utilities"
```

---

### Task 2.2: Create `src/context/compress.ts`

**Files:**
- Create: `src/context/compress.ts`

This is the heart of context engineering. Pure functions — no I/O.

**Step 1:** Create the file:

```typescript
// src/context/compress.ts
import type { ContextTier } from '../providers/tiers.js';
import { truncateToTokens, estimateTokens } from './budget.js';

export interface FileEntry {
  path: string;
  content: string;
  language?: string;
}

export interface CompressedContext {
  files: FileEntry[];
  tokenEstimate: number;
  compressionApplied: string[];   // human-readable log of what was compressed
}

/**
 * Apply tier-appropriate compression to a set of files.
 * APEX: no changes. SMART: truncate large outputs. FAST: heavy. ULTRA: skeleton only.
 */
export function compressContext(files: FileEntry[], tier: ContextTier): CompressedContext {
  const log: string[] = [];

  switch (tier) {
    case 'apex':
      return { files, tokenEstimate: sumTokens(files), compressionApplied: ['none'] };

    case 'smart': {
      const compressed = files.map(f => {
        if (estimateTokens(f.content) > 2000) {
          log.push(`truncated ${f.path} (>${2000} tokens)`);
          return { ...f, content: truncateToTokens(f.content, 2000) };
        }
        return f;
      });
      return { files: compressed, tokenEstimate: sumTokens(compressed), compressionApplied: log.length ? log : ['none'] };
    }

    case 'fast': {
      const compressed = files.map(f => {
        // Strip single-line comments from code
        let content = stripComments(f.content, f.language ?? '');
        // Truncate each file to 500 tokens
        if (estimateTokens(content) > 500) {
          log.push(`truncated ${f.path} to 500 tokens`);
          content = truncateToTokens(content, 500);
        }
        return { ...f, content };
      });
      log.push('stripped comments');
      return { files: compressed, tokenEstimate: sumTokens(compressed), compressionApplied: log };
    }

    case 'ultra': {
      // Skeleton only: extract function/class signatures, no bodies
      const compressed = files.map(f => ({
        ...f,
        content: extractSkeleton(f.content, f.language ?? ''),
      }));
      log.push('skeleton-only (signatures extracted)', 'bodies removed');
      return { files: compressed, tokenEstimate: sumTokens(compressed), compressionApplied: log };
    }
  }
}

/**
 * Compress tool output (bash results, file reads) per tier.
 * Used in agent loop to trim tool results before re-injecting into context.
 */
export function compressToolOutput(output: string, tier: ContextTier): string {
  const limits: Record<ContextTier, number> = {
    apex:  100_000,
    smart:  2_000,
    fast:     500,
    ultra:    200,
  };
  return truncateToTokens(output, limits[tier]);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function sumTokens(files: FileEntry[]): number {
  return files.reduce((sum, f) => sum + estimateTokens(f.content), 0);
}

function stripComments(code: string, language: string): string {
  const lineComment = /\/\/.*/g;
  const blockComment = /\/\*[\s\S]*?\*\//g;
  const hashComment = /#.*/g;

  if (['typescript', 'javascript', 'go', 'java', 'rust', 'csharp', 'cpp', 'c'].includes(language)) {
    return code.replace(blockComment, '').replace(lineComment, '');
  }
  if (['python', 'ruby', 'bash', 'yaml'].includes(language)) {
    return code.replace(hashComment, '');
  }
  return code;
}

/**
 * Extract function/class/type signatures without bodies.
 * Handles TypeScript/JavaScript. Falls back to first-line-of-each-block heuristic.
 */
function extractSkeleton(code: string, language: string): string {
  if (!['typescript', 'javascript'].includes(language)) {
    // Generic: return first 10 lines only
    return code.split('\n').slice(0, 10).join('\n') + '\n... [body omitted]';
  }

  const lines = code.split('\n');
  const skeleton: string[] = [];
  let depth = 0;
  let inSignature = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Always include imports, exports, type/interface/class/function declarations
    const isDecl = /^(import|export|type |interface |class |function |const |let |var |async function|export default)/.test(trimmed);

    if (isDecl && depth === 0) {
      skeleton.push(line);
      inSignature = true;
    } else if (inSignature && depth === 0 && trimmed === '{') {
      skeleton.push(line);
      depth++;
    } else if (depth > 0) {
      if (trimmed.includes('{')) depth++;
      if (trimmed.includes('}')) depth--;
      if (depth === 0) {
        skeleton.push('  // ... body omitted');
        skeleton.push('}');
        inSignature = false;
      }
    }
  }

  return skeleton.join('\n');
}
```

**Step 2:** Build: `npm run build`. Expected: clean.

**Step 3:** Commit.
```bash
git add src/context/compress.ts
git commit -m "feat: add tier-aware context compression (compress.ts)"
```

---

### Task 2.3: Create `src/context/agentmd.ts`

**Files:**
- Create: `src/context/agentmd.ts`

**Step 1:** Create the file. Implements file discovery, parsing, and mtime-based caching:

```typescript
// src/context/agentmd.ts
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AgentMd {
  raw: string;
  sections: {
    project?: string;
    rules?: string;
    architecture?: string;
    gotchas?: string;
    commands?: string;
  };
  sourcePath: string;
  loadedAt: number;
}

interface CacheEntry {
  data: AgentMd;
  mtime: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Search order (first found wins):
 *   1. {cwd}/AGENT.md
 *   2. {cwd}/.axon/AGENT.md
 *   3. ~/.axon/AGENT.md
 *
 * Returns null if none found.
 * Caches with mtime invalidation — safe to call on every agent iteration.
 */
export async function loadAgentMd(cwd: string): Promise<AgentMd | null> {
  const candidates = [
    join(cwd, 'AGENT.md'),
    join(cwd, '.axon', 'AGENT.md'),
    join(homedir(), '.axon', 'AGENT.md'),
  ];

  for (const candidatePath of candidates) {
    try {
      const stats = await stat(candidatePath);
      const mtime = stats.mtimeMs;

      // Cache hit: same mtime → return cached
      const cached = cache.get(candidatePath);
      if (cached && cached.mtime === mtime) {
        return cached.data;
      }

      // Cache miss or stale: re-read
      const raw = await readFile(candidatePath, 'utf-8');
      const data: AgentMd = {
        raw,
        sections: parseSections(raw),
        sourcePath: candidatePath,
        loadedAt: Date.now(),
      };
      cache.set(candidatePath, { data, mtime });
      return data;
    } catch {
      // File doesn't exist at this path — try next
      continue;
    }
  }

  return null;
}

/**
 * Format the AGENT.md content for injection into the system prompt.
 * Always injected FIRST — highest priority context.
 */
export function formatAgentMdForPrompt(agentMd: AgentMd): string {
  return `<agent_context source="${agentMd.sourcePath}">
${agentMd.raw}
</agent_context>

`;
}

// ─── Section parser ────────────────────────────────────────────────────────────

function parseSections(raw: string): AgentMd['sections'] {
  const sections: AgentMd['sections'] = {};
  const sectionRegex = /^##\s+(\w+)\s*$/gm;

  let match: RegExpExecArray | null;
  const boundaries: Array<{ name: string; start: number }> = [];

  while ((match = sectionRegex.exec(raw)) !== null) {
    boundaries.push({ name: match[1].toLowerCase(), start: match.index + match[0].length });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const { name, start } = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1].start : raw.length;
    const content = raw.slice(start, end).trim();

    switch (name) {
      case 'project':      sections.project = content; break;
      case 'rules':        sections.rules = content; break;
      case 'architecture': sections.architecture = content; break;
      case 'gotchas':      sections.gotchas = content; break;
      case 'commands':     sections.commands = content; break;
    }
  }

  return sections;
}
```

**Step 2:** Build: `npm run build`. Expected: clean.

**Step 3:** Commit.
```bash
git add src/context/agentmd.ts
git commit -m "feat: add AGENT.md loader with mtime cache (agentmd.ts)"
```

---

### Task 2.4: Create `src/context/pack.ts` (context assembler)

**Files:**
- Create: `src/context/pack.ts`

This is the single entry point the agent calls to get a ready-to-use context pack.

**Step 1:** Create the file:

```typescript
// src/context/pack.ts
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative } from 'node:path';
import { readFile } from 'node:fs/promises';
import { glob } from 'glob';
import ignore from 'ignore';
import type { ModelId } from '../providers/types.js';
import { getTier } from '../providers/tiers.js';
import { estimateTokens, getBudget } from './budget.js';
import { compressContext, type FileEntry } from './compress.js';
import { loadAgentMd, formatAgentMdForPrompt } from './agentmd.js';

const execAsync = promisify(exec);

export interface ContextPack {
  /** Ready-to-inject system context string */
  systemContext: string;
  /** Estimated token count of systemContext */
  tokenEstimate: number;
  /** Paths of files included */
  filesIncluded: string[];
  /** Was AGENT.md found and injected? */
  agentMdFound: boolean;
  /** Compression tier applied */
  tier: string;
}

/**
 * Build a complete context pack for an agent task.
 *
 * @param cwd   - Project working directory
 * @param modelId - The model that will receive this context (determines tier)
 * @param task  - The task description (used for semantic relevance ranking)
 */
export async function buildContextPack(cwd: string, modelId: ModelId, task: string): Promise<ContextPack> {
  const tier = getTier(modelId);
  const budget = getBudget(modelId);

  const parts: string[] = [];
  let agentMdFound = false;

  // 1. AGENT.md — highest priority, always first
  const agentMd = await loadAgentMd(cwd);
  if (agentMd) {
    parts.push(formatAgentMdForPrompt(agentMd));
    agentMdFound = true;
  }

  // 2. Git context (cheap, high-signal)
  const gitContext = await getGitContext(cwd);
  if (gitContext) {
    parts.push(`<git_context>\n${gitContext}\n</git_context>\n`);
  }

  // 3. File tree (2 levels deep, .gitignore filtered)
  const fileTree = await getFileTree(cwd);
  parts.push(`<file_tree>\n${fileTree}\n</file_tree>\n`);

  // 4. Relevant source files
  const tokenBudgetForFiles = budget.maxContextTokens - estimateTokens(parts.join(''));
  const files = await gatherRelevantFiles(cwd, task, tokenBudgetForFiles);
  const { files: compressedFiles, compressionApplied } = compressContext(files, tier);

  const filesIncluded: string[] = [];
  for (const f of compressedFiles) {
    const snippet = `<file path="${f.path}">\n${f.content}\n</file>`;
    parts.push(snippet);
    filesIncluded.push(f.path);
  }

  const systemContext = parts.join('\n');

  return {
    systemContext,
    tokenEstimate: estimateTokens(systemContext),
    filesIncluded,
    agentMdFound,
    tier,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getGitContext(cwd: string): Promise<string | null> {
  try {
    const [status, diffStat] = await Promise.all([
      execAsync('git status --short', { cwd }),
      execAsync('git diff --stat HEAD~1 2>/dev/null || echo "(no prior commit)"', { cwd }),
    ]);
    return `$ git status --short\n${status.stdout}\n$ git diff --stat HEAD~1\n${diffStat.stdout}`;
  } catch {
    return null;
  }
}

async function getFileTree(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync('find . -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -maxdepth 3 -print | sort | head -80', { cwd });
    return stdout.trim();
  } catch {
    return '(could not generate file tree)';
  }
}

async function getGitignore(cwd: string) {
  const ig = ignore();
  ig.add(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '*.lock', '.env*']);
  try {
    const content = await readFile(join(cwd, '.gitignore'), 'utf-8');
    ig.add(content.split('\n').filter(l => l.trim() && !l.startsWith('#')));
  } catch { /* no .gitignore */ }
  return ig;
}

/**
 * Find the top N files most likely relevant to `task`.
 * Strategy: keyword grep for task words → score by match count → top 10.
 */
async function gatherRelevantFiles(cwd: string, task: string, tokenBudget: number): Promise<FileEntry[]> {
  const ig = await getGitignore(cwd);

  const allFiles = (await glob('**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,md}', {
    cwd,
    nodir: true,
    absolute: false,
  })).filter(f => !ig.ignores(f));

  // Score files by keyword overlap with task
  const keywords = task.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scored: Array<{ path: string; score: number }> = await Promise.all(
    allFiles.map(async (filePath) => {
      try {
        const content = await readFile(join(cwd, filePath), 'utf-8');
        const lower = content.toLowerCase();
        const score = keywords.reduce((n, kw) => n + (lower.includes(kw) ? 1 : 0), 0);
        return { path: filePath, score };
      } catch {
        return { path: filePath, score: 0 };
      }
    })
  );

  scored.sort((a, b) => b.score - a.score);

  // Take top 10 by relevance, then fill budget
  const topFiles = scored.slice(0, 10);
  const result: FileEntry[] = [];
  let used = 0;

  for (const { path: filePath } of topFiles) {
    try {
      const content = await readFile(join(cwd, filePath), 'utf-8');
      const tokens = estimateTokens(content);
      if (used + tokens > tokenBudget) break;
      result.push({ path: filePath, content, language: detectLanguage(filePath) });
      used += tokens;
    } catch { /* skip */ }
  }

  return result;
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', go: 'go', rs: 'rust', java: 'java', rb: 'ruby',
    md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
  };
  return map[ext] ?? 'text';
}
```

**Step 2:** Build: `npm run build`. Expected: clean.

**Step 3:** Commit.
```bash
git add src/context/pack.ts
git commit -m "feat: add context pack assembler (pack.ts)"
```

---

### Task 2.5: Wire context pack into agent system prompt

**Files:**
- Modify: `src/agent/index.ts`

**Step 1:** Read `src/agent/index.ts` (done above — lines 1-117).

**Step 2:** Modify `buildSystemPrompt()` to accept an optional `agentMdOverride` param and inject AGENT.md at the TOP. Also add a new exported function `buildEnrichedSystemPrompt()` that async-loads AGENT.md and the context pack:

```typescript
// In src/agent/index.ts — add after existing imports:
import { buildContextPack } from '../context/pack.js';
import type { ModelId } from '../providers/types.js';

// New async function — used by agentLoop when mode !== 'plan':
export async function buildEnrichedSystemPrompt(
  task: string,
  cwd: string,
  modelId: ModelId,
): Promise<string> {
  const base = buildSystemPrompt(cwd);
  const pack = await buildContextPack(cwd, modelId, task);

  return pack.systemContext + '\n\n' + base;
}
```

**Step 3:** In `runAgent()`, replace `buildSystemPrompt(cwd)` with a call to `buildEnrichedSystemPrompt()`:

```typescript
// Replace:
//   const systemPrompt = buildSystemPrompt(cwd);
// With:
  const resolvedModel = (options.model ?? 'deepseek-v3') as ModelId;
  const systemPrompt = await buildEnrichedSystemPrompt(task, cwd, resolvedModel);
```

**Step 4:** Build: `npm run build`. Fix TypeScript errors.

**Step 5:** Test manually:
```bash
echo "## Project\nTest project" > /tmp/test-axon/AGENT.md
axon agent "what files are in this project" --model deepseek-v3 -v
```
Expected: Agent system prompt contains AGENT.md content.

**Step 6:** Commit.
```bash
git add src/agent/index.ts
git commit -m "feat: inject AGENT.md + context pack into agent system prompt"
```

---

## Phase 3: Right Panel TUI

> **Exit Criteria:** `axon agent "task" --tui` (or `axon chat`) shows a split-pane: left=streaming chat, right=live panel with files touched, tools called, cost. Bottom status bar shows model + mode. Ctrl+C exits cleanly.

### Task 3.1: Create `src/tui/hooks/useAgentEvents.ts`

**Files:**
- Create: `src/tui/hooks/useAgentEvents.ts`

This hook is the state machine for the right panel. It consumes `AgentLoopChunk` events and produces panel state.

**Step 1:** Create the directory: `mkdir -p src/tui/hooks`

**Step 2:** Create the file:

```typescript
// src/tui/hooks/useAgentEvents.ts
import { useState, useCallback } from 'react';

export type FileStatus = 'READ' | 'EDIT' | 'NEW' | 'BASH';

export interface TrackedFile {
  path: string;
  status: FileStatus;
  timestamp: number;
}

export interface ToolCall {
  name: string;
  count: number;
}

export interface PanelState {
  files: TrackedFile[];
  toolCalls: ToolCall[];
  totalCost: number;
  totalTokens: number;
  iterationCount: number;
}

export function useAgentEvents() {
  const [panelState, setPanelState] = useState<PanelState>({
    files: [],
    toolCalls: [],
    totalCost: 0,
    totalTokens: 0,
    iterationCount: 0,
  });

  const onToolCall = useCallback((toolName: string, toolInput: Record<string, unknown>) => {
    setPanelState(prev => {
      // Track files
      const newFiles = [...prev.files];
      const fileStatus = inferFileStatus(toolName);
      if (fileStatus && toolInput.path) {
        const path = String(toolInput.path);
        const existing = newFiles.findIndex(f => f.path === path);
        if (existing >= 0) {
          newFiles[existing] = { path, status: fileStatus, timestamp: Date.now() };
        } else {
          newFiles.push({ path, status: fileStatus, timestamp: Date.now() });
        }
      }

      // Track tool calls
      const newToolCalls = [...prev.toolCalls];
      const existingTool = newToolCalls.find(t => t.name === toolName);
      if (existingTool) {
        existingTool.count++;
      } else {
        newToolCalls.push({ name: toolName, count: 1 });
      }

      return {
        ...prev,
        files: newFiles,
        toolCalls: newToolCalls,
        iterationCount: prev.iterationCount + 1,
      };
    });
  }, []);

  const onCostUpdate = useCallback((cost: number, tokens: number) => {
    setPanelState(prev => ({
      ...prev,
      totalCost: prev.totalCost + cost,
      totalTokens: prev.totalTokens + tokens,
    }));
  }, []);

  const reset = useCallback(() => {
    setPanelState({
      files: [],
      toolCalls: [],
      totalCost: 0,
      totalTokens: 0,
      iterationCount: 0,
    });
  }, []);

  return { panelState, onToolCall, onCostUpdate, reset };
}

function inferFileStatus(toolName: string): FileStatus | null {
  switch (toolName) {
    case 'read_file':  return 'READ';
    case 'write_file': return 'NEW';
    case 'edit_file':  return 'EDIT';
    case 'bash':       return null;  // bash tracked as tool, not file
    default:           return null;
  }
}
```

**Step 3:** Commit.
```bash
git add src/tui/hooks/useAgentEvents.ts
git commit -m "feat: add useAgentEvents hook for right panel state"
```

---

### Task 3.2: Create `src/tui/components/FileTracker.tsx`

**Files:**
- Create: `src/tui/components/FileTracker.tsx`

**Step 1:** Create the file:

```typescript
// src/tui/components/FileTracker.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { TrackedFile } from '../hooks/useAgentEvents.js';

interface FileTrackerProps {
  files: TrackedFile[];
  maxVisible?: number;
}

const STATUS_COLORS: Record<string, string> = {
  READ: 'blue',
  EDIT: 'yellow',
  NEW:  'green',
  BASH: 'cyan',
};

export function FileTracker({ files, maxVisible = 8 }: FileTrackerProps): React.ReactElement {
  const visible = files.slice(-maxVisible);  // most recent

  if (visible.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>no files yet</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visible.map((f) => {
        const name = f.path.split('/').pop() ?? f.path;
        const color = STATUS_COLORS[f.status] ?? 'white';
        return (
          <Box key={`${f.path}-${f.timestamp}`} gap={1}>
            <Text dimColor>{name.slice(0, 14).padEnd(14)}</Text>
            <Text color={color as Parameters<typeof Text>[0]['color']}>{f.status}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
```

**Step 2:** Commit.
```bash
git add src/tui/components/FileTracker.tsx
git commit -m "feat: add FileTracker component"
```

---

### Task 3.3: Create `src/tui/components/RightPanel.tsx`

**Files:**
- Create: `src/tui/components/RightPanel.tsx`

**Step 1:** Create the file:

```typescript
// src/tui/components/RightPanel.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { FileTracker } from './FileTracker.js';
import type { PanelState } from '../hooks/useAgentEvents.js';

interface RightPanelProps {
  state: PanelState;
  currentModel: string | null;
  mode?: string;
  width?: number;
}

export function RightPanel({ state, currentModel, mode = 'auto', width = 24 }: RightPanelProps): React.ReactElement {
  const toolSummary = state.toolCalls
    .map(t => `${t.name.replace('_', '')}×${t.count}`)
    .join(' ');

  const costStr = state.totalCost < 0.001
    ? `${(state.totalCost * 100 * 100).toFixed(3)}¢`
    : `$${state.totalCost.toFixed(4)}`;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      {/* Files Section */}
      <Text bold color="cyan"> FILES</Text>
      <FileTracker files={state.files} maxVisible={6} />

      <Box marginTop={1} />

      {/* Tools Section */}
      <Text bold color="cyan"> TOOLS ({state.iterationCount})</Text>
      {toolSummary ? (
        <Text wrap="truncate">{toolSummary}</Text>
      ) : (
        <Text dimColor>none yet</Text>
      )}

      <Box marginTop={1} />

      {/* Cost Section */}
      <Text bold color="cyan"> COST</Text>
      <Text color="green">{costStr}</Text>
      {state.totalTokens > 0 && (
        <Text dimColor>{state.totalTokens.toLocaleString()} tok</Text>
      )}

      <Box marginTop={1} />

      {/* Model + Mode */}
      {currentModel && (
        <Text dimColor wrap="truncate">{currentModel}</Text>
      )}
      <Text color={modeColor(mode)}>{mode}</Text>
    </Box>
  );
}

function modeColor(mode: string): string {
  switch (mode) {
    case 'yolo': return 'red';
    case 'plan': return 'blue';
    case 'diff': return 'yellow';
    default:     return 'green';
  }
}
```

**Step 2:** Commit.
```bash
git add src/tui/components/RightPanel.tsx
git commit -m "feat: add RightPanel TUI component"
```

---

### Task 3.4: Redesign `src/tui/App.tsx` with split-pane layout

**Files:**
- Modify: `src/tui/App.tsx`

**Step 1:** Read `src/tui/App.tsx` in full (done above).

**Step 2:** Add import for `RightPanel` and `useAgentEvents`. Wrap the main content in a horizontal `<Box>` split:

Key changes:
1. Import `RightPanel` from `./components/RightPanel.js`
2. Import `useAgentEvents` from `./hooks/useAgentEvents.js`
3. Add `agentMode?: 'yolo' | 'plan' | 'diff' | 'auto'` to `AppProps`
4. Add `const { panelState, onToolCall, onCostUpdate, reset } = useAgentEvents();`
5. After each `tool_call` chunk received (in `handleSubmit`), call `onToolCall(chunk.toolName, chunk.toolInput)`
6. After streaming completes, call `onCostUpdate(cost.total, inputTokens + outputTokens)`
7. Replace the outer `<Box flexDirection="column">` layout with:

```tsx
<Box flexDirection="column" height={process.stdout.rows ?? 24}>
  <Banner />
  {errorMsg && (
    <Box paddingX={1}>
      <Text color="red">{errorMsg}</Text>
    </Box>
  )}

  {/* Main split-pane */}
  <Box flexDirection="row" flexGrow={1}>
    {/* Left: chat */}
    <Box flexDirection="column" flexGrow={1}>
      <MessageList messages={messages} streamingContent={streamingContent} />
      <InputBox
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isBusy={isBusy}
        isRouting={isRouting}
      />
    </Box>

    {/* Right: panel */}
    <RightPanel
      state={panelState}
      currentModel={currentModel}
      mode={agentMode ?? 'auto'}
      width={26}
    />
  </Box>

  <StatusBar
    currentModel={currentModel}
    sessionTokens={sessionTokens}
    sessionCost={sessionCost}
    messageCount={messages.length}
  />
</Box>
```

**Step 3:** Build: `npm run build`. Fix any TypeScript errors.

**Step 4:** Test: `axon chat` — should show split pane.

**Step 5:** Commit.
```bash
git add src/tui/App.tsx
git commit -m "feat: split-pane TUI with right panel showing files/tools/cost"
```

---

## Phase 4: Agent Autonomy Modes

> **Exit Criteria:** `axon agent "add logging" --yolo` runs without any approval prompts. `axon agent "refactor auth" --plan` outputs a plan and exits without writing any files. `axon agent "fix bug" --diff` shows each proposed file change as a unified diff and prompts "Apply? [y/n]". Default `axon agent "task"` prompts before any `write_file` or `bash` destructive commands.

### Task 4.1: Add `AgentMode` type and update `AgentOptions`

**Files:**
- Modify: `src/agent/tools.ts`

**Step 1:** Read `src/agent/tools.ts` to understand `AgentOptions` (check existing interface).

**Step 2:** Add to `AgentOptions`:

```typescript
export type AgentMode = 'yolo' | 'plan' | 'diff' | 'auto';

// In AgentOptions interface, add:
mode?: AgentMode;
onApprovalNeeded?: (toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>;
onDiffProposed?: (path: string, diff: string) => Promise<boolean>;
```

**Step 3:** Build. Commit.
```bash
git add src/agent/tools.ts
git commit -m "feat: add AgentMode type to agent options"
```

---

### Task 4.2: Wire modes into `executeTool()`

**Files:**
- Modify: `src/agent/tools.ts`

The mode enforcement happens in `executeTool()` — the single chokepoint where all tool calls pass through.

**Step 1:** Read `src/agent/tools.ts` `executeTool` function in full.

**Step 2:** Wrap destructive tool calls with mode checks. The pattern:

```typescript
// In executeTool(), before the switch statement:
const isDestructive = ['write_file', 'edit_file', 'bash'].includes(name);
const mode = options.mode ?? 'auto';

// --plan mode: block all writes
if (mode === 'plan' && isDestructive) {
  return {
    toolCallId,
    toolName: name,
    content: `[PLAN MODE] Would execute: ${name}(${JSON.stringify(input).slice(0, 200)}) — skipped (--plan mode)`,
    isError: false,
  };
}

// --yolo mode: no checks, proceed
// (fall through to normal execution)

// --diff mode: for write_file/edit_file, show diff and ask
if (mode === 'diff' && (name === 'write_file' || name === 'edit_file')) {
  // Generate diff preview
  const diffPreview = await generateDiffPreview(name, input, options.cwd);

  if (options.onDiffProposed) {
    const approved = await options.onDiffProposed(String(input.path ?? ''), diffPreview);
    if (!approved) {
      return {
        toolCallId,
        toolName: name,
        content: `[DIFF MODE] Change rejected by user for ${input.path}`,
        isError: false,
      };
    }
  }
}

// --auto mode (default): prompt for destructive bash commands
if (mode === 'auto' && name === 'bash') {
  const cmd = String(input.command ?? '');
  const isRisky = /\b(rm|mv|del|format|truncate|drop|delete|unlink)\b/.test(cmd);
  if (isRisky && options.onApprovalNeeded) {
    const approved = await options.onApprovalNeeded(name, input);
    if (!approved) {
      return {
        toolCallId,
        toolName: name,
        content: `[AUTO MODE] Command rejected by user: ${cmd}`,
        isError: false,
      };
    }
  }
}
```

**Step 3:** Add `generateDiffPreview()` helper:

```typescript
async function generateDiffPreview(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string
): Promise<string> {
  const { createTwoFilesPatch } = await import('diff');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  if (toolName === 'write_file') {
    const path = String(input.path ?? '');
    const newContent = String(input.content ?? '');
    let oldContent = '';
    try {
      oldContent = await readFile(join(cwd, path), 'utf-8');
    } catch { /* new file */ }
    return createTwoFilesPatch(path, path, oldContent, newContent, 'old', 'new');
  }

  if (toolName === 'edit_file') {
    const path = String(input.path ?? '');
    const oldStr = String(input.old_string ?? '');
    const newStr = String(input.new_string ?? '');
    return createTwoFilesPatch(path, path, oldStr, newStr, 'old', 'new');
  }

  return '';
}
```

**Step 4:** Build: `npm run build`. Fix errors.

**Step 5:** Commit.
```bash
git add src/agent/tools.ts
git commit -m "feat: implement yolo/plan/diff/auto mode enforcement in executeTool"
```

---

### Task 4.3: Add CLI flags and interactive approvals

**Files:**
- Modify: `src/cli/index.ts`

**Step 1:** Read `src/cli/index.ts` agent command (lines 107-144).

**Step 2:** Add flags to the `agent` command:

```typescript
.option('--yolo', 'No approvals — full autonomy mode')
.option('--plan', 'Plan only — no writes, show intent')
.option('--diff', 'Show diffs and require approval for each change')
```

**Step 3:** In the action handler, detect mode and create interactive approval callbacks:

```typescript
const mode: AgentMode =
  options.yolo ? 'yolo' :
  options.plan ? 'plan' :
  options.diff ? 'diff' : 'auto';

console.log(chalk.cyan(`\n[axon agent] Task: ${task}`));
console.log(chalk.gray(`[axon agent] Model: ${options.model} | Mode: ${mode} | cwd: ${process.cwd()}\n`));

// Interactive approval callbacks (only used in auto/diff modes)
const readline = await import('node:readline');

const onApprovalNeeded = async (toolName: string, toolInput: Record<string, unknown>): Promise<boolean> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(
      chalk.yellow(`\n[approve] ${toolName}(${JSON.stringify(toolInput).slice(0, 80)})\nAllow? [y/n] `),
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      }
    );
  });
};

const onDiffProposed = async (path: string, diff: string): Promise<boolean> => {
  console.log(chalk.blue(`\n--- diff: ${path} ---`));
  console.log(diff);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(chalk.yellow('Apply? [y/n] '), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
};

await runAgent(task, {
  model: options.model,
  cwd: process.cwd(),
  signal: abortController.signal,
  verbose: options.verbose ?? false,
  mode,
  onApprovalNeeded: mode !== 'yolo' ? onApprovalNeeded : undefined,
  onDiffProposed: mode === 'diff' ? onDiffProposed : undefined,
});
```

**Step 4:** Pass `mode`, `onApprovalNeeded`, `onDiffProposed` through `runAgent()` → `agentLoop()` → `executeTool()`. This requires updating `RunAgentOptions` in `src/agent/index.ts` and `AgentOptions` in `src/agent/tools.ts` to thread the callbacks through.

**Step 5:** Build: `npm run build`. Fix all errors.

**Step 6:** Manual test:
```bash
axon agent "create a file called test.txt with hello world" --plan
```
Expected: Shows intent, creates no files.

```bash
axon agent "create a file called test.txt with hello world" --diff
```
Expected: Shows unified diff, prompts y/n.

**Step 7:** Commit.
```bash
git add src/cli/index.ts src/agent/index.ts
git commit -m "feat: add --yolo/--plan/--diff/auto agent modes with interactive approval"
```

---

## Task Dependency Graph

```
Phase 1:
  Task 1.1 (types.ts ModelId expansion)
    └─→ Task 1.2 (tiers.ts)
    └─→ Task 1.3 (openai-compatible.ts base class)
          └─→ Task 1.4 (kimi, grok, groq, qwen thin providers)
                └─→ register all in index.ts
  Task 1.5 (Gemini provider)  [can run in parallel with 1.3/1.4]

Phase 2 (depends on Phase 1 complete):
  Task 2.1 (budget.ts) ← uses tiers.ts from Task 1.2
  Task 2.2 (compress.ts) ← uses budget.ts from Task 2.1
  Task 2.3 (agentmd.ts) [independent]
  Task 2.4 (pack.ts) ← uses compress.ts + agentmd.ts + budget.ts
  Task 2.5 (wire into agent/index.ts) ← uses pack.ts

Phase 3 (can start alongside Phase 2):
  Task 3.1 (useAgentEvents hook) [independent]
  Task 3.2 (FileTracker component) ← uses hook types
  Task 3.3 (RightPanel component) ← uses FileTracker
  Task 3.4 (App.tsx split-pane) ← uses RightPanel + hook

Phase 4 (depends on Phase 1 complete, Phase 3 optional):
  Task 4.1 (AgentMode type) [independent, adds to tools.ts]
  Task 4.2 (mode enforcement in executeTool) ← needs 4.1
  Task 4.3 (CLI flags + interactive approvals) ← needs 4.1, 4.2
```

---

## Risk Register

| Risk | P | I | Score | Mitigation |
|------|---|---|-------|------------|
| Gemini SDK API changes (function calling syntax) | 3 | 3 | 9 | Pin `@google/generative-ai` to specific minor version. Test with `gemini-1.5-flash` first. |
| Kimi/Grok API endpoints not yet stable | 3 | 3 | 9 | Wrap all provider instantiation in try/catch; `getProvider()` throws if key missing, not on import. |
| Context compression skeleton extraction breaks valid TS | 3 | 2 | 6 | `extractSkeleton()` falls back to first-10-lines on any parse failure. |
| Ink `flexGrow` split-pane not working on narrow terminals | 3 | 2 | 6 | Add `process.stdout.columns < 80` guard — hide right panel on narrow TTY. |
| `--diff` mode blocking readline interrupts Ink render | 4 | 3 | 12 | Diff mode runs in non-TUI (stdout mode), not in Ink render. Keep them separate code paths. |
| `buildContextPack` too slow for large repos (all files scored) | 3 | 2 | 6 | Limit `gatherRelevantFiles` to top 50 files before scoring, not all files. Already in plan. |
| ESM `.js` imports missing in new files | 5 | 4 | 20 | All imports must end in `.js`. TypeScript resolves to `.ts` at dev, `.js` at runtime. |
| `config.get('providers')` type is `unknown` — needs assertion | 4 | 2 | 8 | Use `as Record<string, string> | undefined` cast consistently (already done in deepseek.ts). |
| Model ID strings diverge from provider API strings | 3 | 3 | 9 | Each provider's `modelMap` is the single source of translation. Never use `ModelId` directly as API string. |
| Agent mode flags conflict with existing `-m` model flag | 2 | 2 | 4 | Commander option parsing: `--yolo/--plan/--diff` are boolean flags, `-m` is string. No conflict. |

---

## New Dependencies to Install

```bash
npm install @google/generative-ai
```

No other new npm packages required:
- `openai` SDK already installed — covers Kimi, Grok, Groq
- `diff` already installed — used in `--diff` mode
- `glob` already installed — used in pack.ts
- `ignore` already installed — used in pack.ts

---

## Success Criteria

- [ ] `axon models` lists all 18 model IDs with tiers
- [ ] `axon config:set providers.kimi <key> && axon "hello" -m kimi-k2` streams response
- [ ] `axon config:set providers.groq <key> && axon agent "list files" -m groq-llama-8b` runs with ultra-compressed context
- [ ] AGENT.md in project root appears in agent system prompt (check with `--verbose`)
- [ ] `axon chat` shows split-pane with right panel
- [ ] `axon agent "task" --plan` produces plan, writes zero files
- [ ] `axon agent "task" --yolo` runs to completion with zero prompts
- [ ] `axon agent "task" --diff` shows unified diff before each write
- [ ] `npm run build` exits 0
- [ ] `npm run typecheck` exits 0

---

## Key Code Patterns (Gotcha Prevention)

### ESM imports — CRITICAL
```typescript
// RIGHT:
import { kimiProvider } from './kimi.js';
// WRONG:
import { kimiProvider } from './kimi';
```

### Provider registration pattern
```typescript
// In src/providers/index.ts, the Map constructor:
const providers: Map<string, Provider> = new Map([
  ['anthropic', anthropicProvider],
  ['deepseek', deepseekProvider],
  ['kimi', kimiProvider],       // NEW
  ['grok', grokProvider],       // NEW
  ['groq', groqProvider],       // NEW
  ['openrouter', qwenProvider], // NEW (replaces existing openrouter entry)
  ['gemini', geminiProvider],   // NEW
]);
```

### Config access pattern (existing convention)
```typescript
const sectionData = config.get('providers') as Record<string, string> | undefined;
const apiKey = sectionData?.['gemini'];  // bracket notation for safety
```

### streamAgent cast pattern (existing convention in index.ts)
```typescript
// OpenAICompatibleProvider has streamAgent as a regular method — no cast needed
// Only AnthropicProvider uses the cast pattern since Provider interface doesn't declare streamAgent
```

### Ink right panel — always constrain width
```tsx
// RIGHT — always set explicit width on right panel:
<RightPanel width={26} ... />

// Use process.stdout.columns to conditionally hide:
{process.stdout.columns >= 80 && <RightPanel ... />}
```
