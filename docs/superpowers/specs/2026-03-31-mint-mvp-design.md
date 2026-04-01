# Mint MVP Design
**Date:** 2026-03-31  
**Status:** Approved v2 — gateway + observability added

---

## Overview

Mint is a zero-setup AI coding CLI. Users run `mint` and immediately talk to a coding agent. No API keys, no accounts, no configuration. All provider keys live server-side on Railway. Smart 3-tier routing selects the cheapest model capable of handling each task. Every request, tool call, and routing decision is logged to PostgreSQL and streamed to Axiom for real-time debugging.

---

## Goals

- `mint` opens TUI in <200ms, ready for input
- Zero setup for the user — no keys, no config
- Gateway at `api.usemint.dev` holds all provider keys
- 3-tier routing across Groq + DeepSeek + Grok minimizes cost while preserving quality
- Every request, tool call, and routing decision tracked in Postgres + Axiom
- Admin endpoint to replay any session for debugging
- Clean minimal TUI — no banner, no verbose status

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
CLI sends POST api.usemint.dev/v1/chat
  Authorization: Bearer <MINT_API_TOKEN compiled in>
      │
      ▼
Gateway (Hono — Railway)
  ├── generates request_id (UUID)
  ├── classifies task: simple / medium / complex
  ├── selects provider + model
  ├── logs routing_decision to Postgres
  ├── calls provider API (streams)
  ├── logs request row on completion
  └── ships JSON log line to stdout → Axiom
      │
      ├── simple   → Groq llama-3.1-8b-instant     ($0.05/$0.08)
      ├── medium   → DeepSeek v3                    ($0.27/$1.10)
      └── complex  → Grok-3-mini-fast               ($0.60/$4.00)
        fallback   → Groq llama-3.3-70b-versatile   ($0.59/$0.79)
      │
      ▼
Stream SSE back to CLI
      │
      ▼
TUI renders streamed tokens
      │
      ▼
On completion: log usage row (tokens, cost, latency) to Postgres
```

---

## Components

### 1. Gateway server — `packages/gateway/`

New package in the repo. Hono on Node.js, deployed to Railway.

**Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/chat` | Main chat endpoint, SSE streaming |
| GET | `/admin/session/:id` | Debug replay — all events for a session |
| GET | `/health` | Railway health check |

**Auth:** Static bearer token. CLI sends `Authorization: Bearer $MINT_API_TOKEN`. Gateway validates against `process.env.MINT_API_TOKEN`. Wrong or missing token → 401. No user accounts in MVP.

**Environment variables on Railway:**
```
MINT_API_TOKEN=<shared secret>
GROQ_API_KEY=<groq key>
DEEPSEEK_API_KEY=<deepseek key>
GROK_API_KEY=<grok/xai key>
DATABASE_URL=<railway postgres>
AXIOM_TOKEN=<axiom ingest token>
AXIOM_DATASET=mint-logs
```

### 2. Routing — server-side

Task classifier and tier selection runs in the gateway, not the CLI.

```
simple:   explain, general → groq llama-8b        ($0.05/$0.08)
medium:   code, debug, refactor, review → deepseek-v3  ($0.27/$1.10)
complex:  architect + context >20K tokens → grok-3-mini-fast ($0.60/$4.00)
fallback: any failure → groq llama-70b            ($0.59/$0.79)
```

Complexity mapping:
- `explain`, `general` → simple
- `code`, `debug`, `refactor`, `review` → medium
- `architect` or context > 20K tokens → complex

### 3. Observability — PostgreSQL schema

Four tables, all keyed by `request_id`:

```sql
-- Every LLM call
CREATE TABLE requests (
  id            TEXT PRIMARY KEY,  -- UUID
  session_id    TEXT NOT NULL,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  model         TEXT NOT NULL,
  provider      TEXT NOT NULL,
  task_type     TEXT NOT NULL,     -- simple | medium | complex
  input_tok     INTEGER NOT NULL DEFAULT 0,
  output_tok    INTEGER NOT NULL DEFAULT 0,
  cost_actual   REAL NOT NULL DEFAULT 0,
  cost_sonnet   REAL NOT NULL DEFAULT 0,  -- what sonnet-4.6 would have cost
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  error         TEXT                       -- null if success
);

-- Every agent tool call
CREATE TABLE tool_calls (
  id            TEXT PRIMARY KEY,
  request_id    TEXT REFERENCES requests(id),
  session_id    TEXT NOT NULL,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  tool_name     TEXT NOT NULL,
  tool_input    JSONB,
  approved      BOOLEAN,           -- null if no approval needed
  success       BOOLEAN NOT NULL,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);

-- Router decisions (for tuning)
CREATE TABLE routing_decisions (
  id            TEXT PRIMARY KEY,
  request_id    TEXT REFERENCES requests(id),
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  prompt_preview TEXT NOT NULL,    -- first 120 chars
  classified_as TEXT NOT NULL,     -- simple | medium | complex
  selected_model TEXT NOT NULL,
  reason        TEXT NOT NULL,
  savings_pct   INTEGER NOT NULL DEFAULT 0
);

-- Errors for alerting
CREATE TABLE errors (
  id            TEXT PRIMARY KEY,
  request_id    TEXT,
  session_id    TEXT,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_type    TEXT NOT NULL,
  message       TEXT NOT NULL,
  stack         TEXT
);
```

### 4. Logging — structured JSON to stdout → Axiom

Every event emits one JSON line to stdout. Railway captures stdout. Axiom ingests via the Railway log drain (one env var: `AXIOM_TOKEN`).

```json
{"ts":"2026-03-31T14:22:01Z","request_id":"req_abc","session_id":"ses_xyz","event":"routing","task":"medium","model":"deepseek-v3","savings_pct":98}
{"ts":"2026-03-31T14:22:03Z","request_id":"req_abc","session_id":"ses_xyz","event":"complete","input_tok":1240,"output_tok":380,"cost":0.00079,"latency_ms":1820}
{"ts":"2026-03-31T14:22:05Z","request_id":"req_abc","session_id":"ses_xyz","event":"tool_call","tool":"bash","approved":true,"duration_ms":340,"success":true}
```

### 5. Admin debug endpoint

`GET /admin/session/:session_id` — protected by the same bearer token — returns full event history for a session:

```json
{
  "session_id": "ses_xyz",
  "requests": [...],
  "tool_calls": [...],
  "routing_decisions": [...],
  "errors": [...],
  "summary": {
    "total_cost": 0.0079,
    "total_tokens": 8420,
    "requests": 4,
    "tool_calls": 7
  }
}
```

### 6. CLI — talks to gateway

**File:** `src/providers/gateway.ts` (new provider)

The CLI sends all requests to the gateway instead of directly to providers. The gateway streams SSE back.

```ts
// Compiled in at build time
const GATEWAY_URL = process.env.MINT_GATEWAY_URL ?? 'https://api.usemint.dev'
const GATEWAY_TOKEN = process.env.MINT_API_TOKEN ?? ''
```

The existing `streamComplete` call in App.tsx routes through this provider. Model selection happens server-side — CLI sends the prompt and session context, gateway returns the chosen model in the response headers.

### 7. TUI — clean minimal interface

- Remove `<Banner />` from App.tsx
- Status bar shows: `{model} · {total_tokens} tokens · ${total_cost}`
- `mint` with no args opens TUI directly (currently shows help)
- No "Welcome to Mint", no ASCII art

### 8. Usage instrumentation — client-side supplement

Even though the gateway tracks everything server-side, the CLI continues writing to local SQLite (`~/.mint/usage.db`) for the `mint usage` dashboard. Fields extended with `latency_ms` and `cost_sonnet`.

---

## Deployment

### Railway setup
1. New Railway service: `mint-gateway` pointing at `packages/gateway/`
2. Add Railway PostgreSQL plugin to the project
3. Set all env vars listed above
4. Custom domain: `api.usemint.dev` → Railway service URL

### Build (CLI)
```bash
MINT_API_TOKEN=xxx MINT_GATEWAY_URL=https://api.usemint.dev npm run build
```
Compiled binary contains the gateway URL and bearer token. Users install and go.

---

## What is NOT in MVP

- User accounts / login / per-user billing
- Usage limits / rate limiting
- Web dashboard (use `mint usage` CLI command)
- Enterprise BYOC
- Qwen / OpenRouter (add in sprint 2)
- Real-time cost alerts

---

## Success Criteria

After 2 weeks of use (target: 20 sessions):
1. **Routing accuracy** — does the tier classifier match task complexity?
2. **Cost baseline** — avg cost_actual per session via Postgres query
3. **Savings proof** — avg (cost_sonnet - cost_actual) / cost_sonnet
4. **Debug capability** — can you replay any session in <30 seconds?
5. **UX** — `mint` opens and feels ready, no friction reports

---

## Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Keys location | Railway env vars | Zero backend = no leaks, users config nothing |
| Auth MVP | Static bearer token compiled in | No accounts needed to validate routing |
| Routing location | Server-side | Can improve without shipping new CLI |
| Logging | Postgres + Axiom | Postgres for queries, Axiom for real-time debug |
| Gateway stack | Hono on Node.js | Lightweight, TypeScript-native, streaming first-class |
| Providers | Groq + DeepSeek + Grok | Best coverage of cheap→capable spectrum |
| Domain | api.usemint.dev | Already owned, Railway custom domain |
