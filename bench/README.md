# Mint benchmark

`bench/tasks.json` is the canonical task suite. `mint bench` runs each task
through `runHeadless`, captures cost/cache/audit data, prompts you for a
quality rating, and writes a structured result to `bench/results/<run-id>.json`.
`mint bench report` aggregates the latest run into markdown.

The point: turn the "Mint vs naive" pitch into a screenshot from your own data.

## Run

```bash
# full suite, prompts for ratings after each task
mint bench

# custom task set
mint bench --tasks=./my-tasks.json

# CI / unattended (skips rating prompts, auto-rates by success flag)
mint bench --no-rate

# generate markdown report from the most recent run
mint bench report

# specific run
mint bench report --run=<run-id>
```

## Adding tasks

Each task:

```json
{
  "id": "short-id",
  "kind": "question | edit_small | edit_multi | refactor | debug | review | explain | scaffold",
  "task": "what the model should do",
  "expectModel": "optional — fail-soft if a different model handled it",
  "expectComplexity": "optional",
  "rubric": "what 'good' looks like — for the rater (you), not the model"
}
```

Add to `tasks.json` and commit. Same tasks every run → comparable results
across days, branches, model changes.

## Safety

Bench runs use `--diff` mode by default — every file edit gets gated through
the approval flow. To run unattended (CI), pass `--no-rate --auto`.

The benchmark suite targets the mint-cli repo itself by default so it's
self-contained. Run it on a worktree, not your main checkout.
