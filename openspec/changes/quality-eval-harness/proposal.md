> **🚧 DRAFT — planned (Wave 3). Not ready to execute.**
> Full spec + tasks land when prioritized. Order in ROADMAP.

## Why

We claim "real quality of coding" but we have no published quality numbers.
SWE-bench is the industry-standard eval — anyone serious about "best CLI in
the world" needs numbers there or on something comparable.

Today `mint bench` exists but runs against `bench/tasks.json` (10 tasks on
mint-cli itself, internal). We need:
- A larger, harder, project-diverse eval set
- Automated quality judgment (LLM-as-judge with a reference rubric,
  fallback to test-pass rate when tests exist)
- CI integration: every release runs the eval and gates merge on quality
  regression
- Published leaderboard: Mint vs Claude Code vs Cursor (where possible) on
  the same task set

## What Changes

- Extend `mint bench` to support multi-project task sets (clone N
  reference repos, run task on each).
- New `eval/` directory with hand-curated tasks from real OSS issues
  (subset of SWE-bench Lite to start).
- LLM-as-judge scorer: a separate model evaluates the diff against the
  rubric, returns `pass | partial | fail`.
- `npm run eval` runs against the standard set, writes JSON results.
- CI gate: PR must not regress aggregate pass rate by > 5%.
- Public publishing flow: anonymized aggregate published to a leaderboard.

## Capabilities

### New Capabilities
- `quality-eval`: Multi-project eval harness, LLM-as-judge scorer, CI gating,
  public reporting.

## Impact

- Affected: `src/cli/commands/bench.ts` (extend), new `eval/` directory,
  new `src/cli/commands/eval.ts`, CI workflow.
- Risk: eval cost (running tasks on N repos × M tasks = $) — eval runs are
  expensive; default to small set, opt into large set via flag.

## Dependencies / order

- Should land after both Wave 1 changes — only worth running quality eval
  against a product whose cost story is validated.
