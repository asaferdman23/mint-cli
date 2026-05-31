# Mint mission roadmap

Three promises to developers:
**save money · give real quality · agent + system persistence (both the agent
persists through hard problems, and the system persists context across
sessions).**

**The model-agnostic frame (2026-05-31):** Whatever model you pick — frontier
or cheap, new or old — Mint runs it at its ceiling. 7 of 10 efficiency levers
work on any model (tools pruning, retrieval pinning, prompt slim, compaction,
hard cap, loop detector, mid-stream cap); caching is the bonus tier where the
provider supports it. We don't lie about old models matching frontier — we
make them hit their own ceiling more often, and route transparently to a
stronger model when the task exceeds it.

The full openspec planning view is at [`openspec/ROADMAP.md`](../openspec/ROADMAP.md).
This doc is the **strategic view** — pillars, scorecard, and which openspec
change closes what. The openspec doc is the **operational view** — which
changes are ready to execute, which are still drafts, in what order.

## Mission scorecard → openspec change mapping

| Pillar | Today (% done · % measured) | Active changes | Future changes | Status |
|---|---|---|---|---|
| **Save money** | 70% built · 0% validated | `multi-axis-token-efficiency` | `cross-provider-caching`, `old-model-scaffolding` | proposed; needs cross-model bench |
| **Useful work / quality** | 70% built · 0% measured | (bench infra) | `quality-eval-harness`, `old-model-scaffolding` | infra ready, awaits cross-model run |
| **Context engineering** | 75% — pinning gap is real | `multi-axis-token-efficiency` | `lsp-symbol-retrieval` | proposed |
| **Caching** | 50% — single-provider coverage | (regression test only) | `cross-provider-caching` | drafted |
| **Harness engineering** | 85% | `multi-axis-token-efficiency` | `mcp-server-and-client`, `hooks-and-lifecycle` | mixed |
| **Token efficiency** | 60% | `multi-axis-token-efficiency` | — | proposed |
| **Agent memory** | ~50% — invisible, uncontrolled | `agent-memory-efficiency` | — | proposed |
| **Persistence** (named in mission reframe) | not built | (none yet) | `agent-persistence-and-resilience` | drafted |
| **Proof / validation** | 95% built · 0% executed | (bench + audit infra) | `cross-model-bench` (Wave 1.5), then `quality-eval-harness` | infra ready, awaits cross-model run |
| **Cross-fleet performance** | foundation in multi-axis | `multi-axis-token-efficiency` | `cross-model-bench` (proof), `old-model-scaffolding` (weak-model lift) | proposed |
| **Floor: MCP** | ❌ | — | `mcp-server-and-client` | drafted |
| **Floor: parallel work** | ❌ | — | `subagents-parallel-exploration` | drafted |
| **Floor: apply UX** | basic | — | `apply-mode-polish` | drafted |
| **Floor: model freshness** | manual | — | `day-one-model-registry` | drafted |

## How the openspec changes are sequenced

See [`openspec/ROADMAP.md`](../openspec/ROADMAP.md) for the dependency graph
and wave assignment. Summary:

- **Wave 1 (now, next 2 weeks):** `multi-axis-token-efficiency` +
  `agent-memory-efficiency`. Sharpens the wedge — measurement first, then the
  4 model-agnostic optimization mechanisms (tools pruning, retrieval pinning,
  prompt slim, mid-stream cap).
- **Wave 1.5 (right after Wave 1, ~3-4 days):** `cross-model-bench`. The
  proof artifact for the model-agnostic story — runs the same task set across
  Sonnet, Mistral, Gemini Flash, Llama 70B, GPT-4o. Without this, the
  "any model gets to its ceiling" pitch is unsubstantiated.
- **Wave 2 (weeks 3–5):** MCP, subagents, apply polish, model registry,
  cross-provider caching, old-model scaffolding. Closes the most painful
  floor gaps + makes weak models punch above their weight.
- **Wave 3 (weeks 6–8):** quality eval, persistence, LSP retrieval, hooks.
  Starts winning the comparison, not just matching.

## Execution gate — the one thing only the founder can do

Until **`cross-model-bench`** has produced an actual published table
(Task × Model → cost/quality), the multi-axis model-agnostic pitch is
modeled, not measured.

Once Wave 1's audit instrumentation is solid (commit `52ed6a6` on
`feat/multi-axis-audit-foundation` already provides the foundation),
running cross-model bench is a ~30 min execution per model on the
existing `bench/tasks.json`:

```bash
git checkout feat/multi-axis-audit-foundation
npm run build
mint bench --models=claude-sonnet-4,mistral-small,gemini-2-flash --cap 0.50
mint bench report  # produces the cross-model table
```

The outcome determines:
- Which models warrant `old-model-scaffolding` investment (the ones that
  almost-succeeded but with bad output formatting)
- Whether retrieval pinning needs to ship before any of the other Wave 2
  work (if cache hit % is low on Sonnet AND tools/turn is high across all
  models, the dynamic-tier instability is the bottleneck)
- Where each model's ceiling actually is, so `mint tune`'s proposed routes
  can be defended with data not vibes

## How to read this

If you're a contributor: start here, then jump to the openspec change that
matches the pillar you care about. Active changes have full design/specs/tasks
and validate; drafts are stubs that need full authoring before execution.
