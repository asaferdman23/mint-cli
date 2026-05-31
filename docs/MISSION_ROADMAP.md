# Mint mission roadmap

Three promises to developers:
**save money · give real quality · agent + system persistence (both the agent
persists through hard problems, and the system persists context across
sessions).**

The full openspec planning view is at [`openspec/ROADMAP.md`](../openspec/ROADMAP.md).
This doc is the **strategic view** — pillars, scorecard, and which openspec
change closes what. The openspec doc is the **operational view** — which
changes are ready to execute, which are still drafts, in what order.

## Mission scorecard → openspec change mapping

| Pillar | Today (% done · % measured) | Active changes | Future changes | Status |
|---|---|---|---|---|
| **Save money** | 70% built · 0% validated | `multi-axis-token-efficiency` | `cross-provider-caching` | proposed; needs Sonnet run |
| **Useful work / quality** | 70% built · 0% measured | (bench infra) | `quality-eval-harness` | infra ready, awaits run |
| **Context engineering** | 75% — pinning gap is real | `multi-axis-token-efficiency` | `lsp-symbol-retrieval` | proposed |
| **Caching** | 50% — single-provider coverage | (regression test only) | `cross-provider-caching` | drafted |
| **Harness engineering** | 85% | `multi-axis-token-efficiency` | `mcp-server-and-client`, `hooks-and-lifecycle` | mixed |
| **Token efficiency** | 60% | `multi-axis-token-efficiency` | — | proposed |
| **Agent memory** | ~50% — invisible, uncontrolled | `agent-memory-efficiency` | — | proposed |
| **Persistence** (named in mission reframe) | not built | (none yet) | `agent-persistence-and-resilience` | drafted |
| **Proof / validation** | 95% built · 0% executed | (bench + audit infra) | `quality-eval-harness` | infra ready, awaits run |
| **Floor: MCP** | ❌ | — | `mcp-server-and-client` | drafted |
| **Floor: parallel work** | ❌ | — | `subagents-parallel-exploration` | drafted |
| **Floor: apply UX** | basic | — | `apply-mode-polish` | drafted |
| **Floor: model freshness** | manual | — | `day-one-model-registry` | drafted |

## How the openspec changes are sequenced

See [`openspec/ROADMAP.md`](../openspec/ROADMAP.md) for the dependency graph
and wave assignment. Summary:

- **Wave 1 (now, next 2 weeks):** `multi-axis-token-efficiency` +
  `agent-memory-efficiency`. Sharpens our wedge and proves it with real data.
- **Wave 2 (weeks 3–5):** MCP, subagents, apply polish, model registry,
  cross-provider caching. Closes the most painful floor gaps.
- **Wave 3 (weeks 6–8):** quality eval, persistence, LSP retrieval, hooks.
  Starts winning the comparison, not just matching.

## Execution gate — the one thing only the founder can do

Until a real Sonnet session has produced an actual `mint audit` screenshot,
every claim in every change proposal above is modeled, not measured.

```bash
git checkout feat/beta-11-proof-system
npm run build
mint --diff --cap 0.50 "real task on real repo"
mint audit <session-id>
mint audit
```

The outcome of that one run determines whether Wave 1's
`multi-axis-token-efficiency` needs retrieval pinning to ship FIRST (if cache
hit % < 30%) or whether tools pruning + audit expansion are the higher-leverage
starting points (if cache hit % > 50% already).

## How to read this

If you're a contributor: start here, then jump to the openspec change that
matches the pillar you care about. Active changes have full design/specs/tasks
and validate; drafts are stubs that need full authoring before execution.
