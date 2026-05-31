# OpenSpec roadmap — Mint best-in-world plan

Lives in `openspec/` alongside the change directories. Updated whenever a
change is added, prioritized, or archived. Read top-to-bottom for the full
strategic picture; jump to a row to see its proposal/spec/tasks.

## Mission

Bring developers **real cost savings, real quality, and persistence**
(both: the agent persists through hard problems, and the system persists
context across sessions). Beat Claude Code, Cursor, and the rest by being
narrower and better at what they can't do: auditable cost, hard caps,
observable memory, learned routing, multi-axis token efficiency.

## Status legend

- ✅ **Active** — proposal + design + specs + tasks complete, validates,
  ready to execute
- 🚧 **Draft** — proposal stub only; needs full spec + tasks before execution
- 🎯 **Wave 1** — ship now (sharpen our existing wedge with real data)
- ⛰ **Wave 2** — ship after Wave 1 (close the most painful floor gaps)
- 🏔 **Wave 3** — ship after Wave 2 (start beating, not just matching)

## The 11 change proposals

### Wave 1 — sharpen our existing wedge, prove with data (next 2 weeks)

| Wave | Status | Change | Pillar closed | Effort |
|---|---|---|---|---|
| 🎯 | ✅ Active | [multi-axis-token-efficiency](changes/multi-axis-token-efficiency/) | save money, context engineering, token efficiency, harness | ~5–7 days |
| 🎯 | ✅ Active | [agent-memory-efficiency](changes/agent-memory-efficiency/) | **agent memory** (the pillar named in May 31 mission reframe) | ~3–4 days |

**Wave 1 ship blocker:** one real Sonnet session + `mint audit` screenshot
from you. Until that happens, every claim is modeled, not measured.

### Wave 2 — close the most painful floor gaps (weeks 3–5)

| Wave | Status | Change | Pillar closed | Effort |
|---|---|---|---|---|
| ⛰ | 🚧 Draft | [mcp-server-and-client](changes/mcp-server-and-client/) | floor: MCP table stakes | ~1 week |
| ⛰ | 🚧 Draft | [subagents-parallel-exploration](changes/subagents-parallel-exploration/) | floor: parallel work parity | ~1 week |
| ⛰ | 🚧 Draft | [apply-mode-polish](changes/apply-mode-polish/) | floor: Cursor UX parity | ~3–4 days |
| ⛰ | 🚧 Draft | [day-one-model-registry](changes/day-one-model-registry/) | floor: model freshness | ~2–3 days |
| ⛰ | 🚧 Draft | [cross-provider-caching](changes/cross-provider-caching/) | caching pillar (50%→100%) | ~3–4 days |

### Wave 3 — start beating, not just matching (weeks 6–8)

| Wave | Status | Change | Pillar closed | Effort |
|---|---|---|---|---|
| 🏔 | 🚧 Draft | [quality-eval-harness](changes/quality-eval-harness/) | published quality numbers | ~1–2 weeks |
| 🏔 | 🚧 Draft | [agent-persistence-and-resilience](changes/agent-persistence-and-resilience/) | the "persistence" pillar | ~1 week |
| 🏔 | 🚧 Draft | [lsp-symbol-retrieval](changes/lsp-symbol-retrieval/) | typed-language retrieval edge | ~1–2 weeks |
| 🏔 | 🚧 Draft | [hooks-and-lifecycle](changes/hooks-and-lifecycle/) | enterprise policy customization | ~4–5 days |

## Dependency graph

```
multi-axis-token-efficiency ──┬─→ cross-provider-caching
                              ├─→ subagents-parallel-exploration
                              ├─→ lsp-symbol-retrieval
                              ├─→ hooks-and-lifecycle
                              ├─→ agent-persistence-and-resilience
                              └─→ quality-eval-harness

agent-memory-efficiency ──────┴─→ (above also benefit)

mcp-server-and-client ────────── apply-mode-polish ──── day-one-model-registry
       (independent)              (independent)         (independent)
```

Wave 1 is the keystone: most Wave 2/3 changes assume the audit + memory
observability landing first so they can prove their value.

## Pillar coverage matrix

| Pillar | Active changes that close it | Eventually closed by |
|---|---|---|
| Save money | `multi-axis-token-efficiency` | + `cross-provider-caching` (broader) |
| Useful work / quality | (bench infra ready, awaits run) | `quality-eval-harness` (published numbers) |
| Context engineering | `multi-axis-token-efficiency` (retrieval pinning) | + `lsp-symbol-retrieval` (symbol signal) |
| Caching | `multi-axis-token-efficiency` (Anthropic regression test) | + `cross-provider-caching` (OpenAI, Gemini) |
| Harness engineering | `multi-axis-token-efficiency` (mid-stream cap) | + `hooks-and-lifecycle`, `mcp-server-and-client` |
| Token efficiency | `multi-axis-token-efficiency` (tools pruning, prompt slim) | (mature after Wave 1) |
| **Agent memory** | `agent-memory-efficiency` | (mature after Wave 1) |
| Persistence | (none yet) | `agent-persistence-and-resilience` |
| Proof / validation | (infra exists, awaits run) | `quality-eval-harness` (CI gate) |
| Floor: MCP | (none yet) | `mcp-server-and-client` |
| Floor: parallel | (none yet) | `subagents-parallel-exploration` |
| Floor: apply UX | (none yet) | `apply-mode-polish` |
| Floor: model freshness | (none yet) | `day-one-model-registry` |

## How to work this

```bash
# Drop into a change directory
cd openspec/changes/<change-name>/

# When you're ready to execute a Draft (🚧) change:
# 1. Expand proposal.md with full Why/What
# 2. Add design.md (decisions, alternatives, risks)
# 3. Add specs/<capability>/spec.md (ADDED Requirements + Scenarios)
# 4. Add tasks.md (numbered sub-tasks)
# 5. Validate: openspec validate <change-name>
# 6. Execute the tasks
# 7. After merge: openspec archive <change-name>

# Status anytime
openspec list
openspec status --change <change-name>
openspec validate <change-name>
```

## Strategic principles guiding this roadmap

1. **Defend the moat first.** Wave 1 doubles down on what's unique to us
   (cost, audit, memory). Don't let competitors copy the wedge.
2. **Close the floor next.** Wave 2 puts us in the conversation everywhere
   we're currently locked out (MCP, parallel work, model freshness).
3. **Start winning the comparison in Wave 3.** Published quality numbers,
   real persistence, LSP-grade retrieval — moves us from "competitive" to
   "the one to beat in cost + observability."
4. **Don't try to be Cursor.** No IDE plugin in this roadmap. Our wedge is
   the auditable CLI for developers who run agents unattended; not an
   in-editor copilot.
5. **Every change validates before merge.** `openspec validate <name>`
   gates the merge.
