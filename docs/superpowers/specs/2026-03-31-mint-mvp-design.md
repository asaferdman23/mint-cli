# Mint MVP Design
**Date:** 2026-03-31  
**Status:** Approved

---

## Overview

Mint is a zero-setup AI coding CLI. Users run `mint` and immediately talk to a coding agent. No API keys, no accounts, no configuration. The developer holds a Groq API key compiled into the binary. Smart 3-tier routing selects the cheapest model capable of handling each task.

---

## Goals

- `mint` opens TUI in <200ms, ready for input
- Zero setup for the user — key is compiled in
- 3-tier Groq routing minimizes cost while preserving quality
- Usage instrumented locally to validate routing decisions
- Clean minimal interface — no banner, no verbose status

---

## Architecture

```
User types `mint`
      │
      ▼
TUI opens (App.tsx)
      │
      ▼
User submits message
      │
      ▼
Task classifier (router.ts)
  detects: simple / medium / complex
      │
      ├── simple   → llama-3.1-8b-instant     ($0.05/$0.08)
      ├── medium   → openai/gpt-oss-120b       ($0.15/$0.60)
      └── complex  → llama-3.3-70b-versatile   ($0.59/$0.79)
                     + claude-haiku-4-5 overflow (if needed)
      │
      ▼
Groq API (developer's key, compiled in)
      │
      ▼
Stream back to TUI
      │
      ▼
Log usage metadata locally (SQLite)
```

---

## Components

### 1. Entry point — `mint` opens TUI by default

**File:** `src/cli/index.ts`

- When called with no arguments → open TUI (currently shows help)
- When called with arguments → one-shot prompt (existing behavior, keep)
- Remove the ASCII banner from startup

### 2. Groq provider — add gpt-oss-120b

**File:** `src/providers/groq.ts`

Add two new models to the model map:
- `groq-gpt-oss-120b` → `openai/gpt-oss-120b` ($0.15 input / $0.60 output, 500 t/s)
- `groq-gpt-oss-20b` → `openai/gpt-oss-20b` ($0.075 input / $0.30 output, 1000 t/s)

Add to `src/providers/types.ts` ModelId union and MODELS map.

### 3. API key — compiled in at build time

**File:** `src/providers/groq.ts`

The Groq key is injected via environment variable at build time using tsup's `define`:

```ts
// In groq.ts — key falls back to compiled constant
const GROQ_KEY = process.env.MINT_GROQ_KEY ?? ''
```

**tsup.config.ts** defines `process.env.MINT_GROQ_KEY` from the build environment. The shipped binary contains the key. No user configuration required.

### 4. Router — rewire to 3-tier Groq

**File:** `src/providers/router.ts`

Replace the current `MODEL_TIERS` (which points at DeepSeek/GPT-4o/Opus) with:

```
simple:   groq-llama-8b       (explain, Q&A, rename, small edits)
medium:   groq-gpt-oss-120b   (code gen, debug, refactor, review)
complex:  groq-llama-70b      (agent loops, multi-file, architecture)
```

Task classifier stays as-is. Complexity mapping:
- `explain`, `general` → simple
- `code`, `debug`, `refactor`, `review` → medium  
- Tasks with context > 20K tokens → bump up one tier

### 5. TUI — clean minimal interface

**File:** `src/tui/App.tsx`, `src/tui/components/StatusBar.tsx`, `src/tui/components/Banner.tsx`

- Remove `<Banner />` from App.tsx
- Status bar shows: `{model} · {total_tokens} tokens · ${total_cost}`
- No "Welcome to Mint", no instructions, no ASCII art on TUI open
- Default height uses full terminal: `process.stdout.rows`

### 6. Usage instrumentation

**File:** `src/usage/tracker.ts` (already exists, extend)

Every completed request appends one row to local SQLite:

```
task_type    TEXT     -- simple | medium | complex
model_used   TEXT     -- groq-llama-8b | groq-gpt-oss-120b | groq-llama-70b
input_tok    INTEGER
output_tok   INTEGER
cost_actual  REAL     -- what Groq charged
cost_sonnet  REAL     -- what claude-sonnet-4-6 would have cost
latency_ms   INTEGER
ts           INTEGER  -- unix timestamp
```

`cost_sonnet` is computed client-side using Sonnet 4.6 pricing ($3/$15 per M).

---

## What is NOT in MVP

- Auth / login / accounts
- Gateway backend
- Multi-user billing
- Web dashboard
- Enterprise BYOC
- Haiku overflow (add in sprint 2 once we see where 70B fails)

---

## Success Criteria

After 2 weeks of use (target: 20 sessions):
1. **Routing accuracy** — does the tier classifier match task complexity? (manual spot check)
2. **Cost baseline** — what is avg cost_actual per session?
3. **Savings proof** — what is avg (cost_sonnet - cost_actual) / cost_sonnet?
4. **UX** — does `mint` open and feel ready? (no friction reports)

---

## Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Key delivery | Compiled in at build | Zero backend, ship today |
| Default model tier | medium (gpt-oss-120b) | Best value, fast, capable |
| No banner | Removed | Clean UX, Claude Code style |
| No auth MVP | Skipped | Validate routing first |
| Domain | api.usemint.dev | Future gateway target |
