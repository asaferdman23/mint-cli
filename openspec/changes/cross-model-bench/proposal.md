> **🚧 DRAFT — planned (Wave 1.5). The proof artifact for the model-agnostic pitch.**
> Full spec + tasks land when prioritized; ships right after Wave 1.

## Why

The Mint pitch is shifting from "Sonnet with working caching" to **"every
model in our fleet gets multi-axis efficiency — old or new, cheap or
frontier."** That claim only holds up if we can show, on real data, what
each model's cost/quality profile looks like *with Mint's mechanics applied*.

Today `mint bench` runs against one model at a time (whatever the routing
picks). To prove the model-agnostic story we need to run the same task set
across the fleet and publish the table:

```
Task           Sonnet     Mistral S   Gemini Flash   Llama 70B   GPT-4o
edit_small     $0.025/✓   $0.0008/✓   $0.0009/✓      $0.003/⚠    $0.018/✓
edit_multi     $0.12/✓    $0.04/⚠     $0.02/✓        $0.08/⚠     $0.09/✓
refactor       $0.40/✓    fail        $0.18/⚠        fail        $0.32/✓
debug          $0.08/✓    $0.02/⚠     $0.03/✓        $0.04/⚠     $0.06/✓
```

That table is unforgeable proof of three things at once:
1. Mint's mechanics work across providers (the cheap-model wins are real).
2. Each model has a ceiling we honestly identify (no marketing fluff).
3. `mint tune` has signal to learn from — its proposed swaps reference
   this table.

No competitor can produce this table. Pi has 15+ providers but no audit.
Cursor's Auto is opaque. Aider has no telemetry. Mint's existing audit
infrastructure is the only thing that makes this measurable.

## What Changes

**1. `mint bench` gains `--models` flag**
- `mint bench --models=claude-sonnet-4,mistral-small,gemini-2-flash,
  groq-llama-70b,gpt-4o` runs each task once per listed model.
- Default model list comes from `bench/models.json` (versioned) so runs
  are reproducible.
- Each task × model = one trace + one rating prompt. (Or `--no-rate` for
  unattended runs that score by `success` flag only.)

**2. Per-model results JSON**
- `bench/results/<run-id>.json` extends to `{ taskId, modelId, ...metrics }`
  per row instead of `{ taskId, ...metrics }`.
- Reports group by task across models (the cell view above).

**3. Cross-model markdown report**
- Aggregate report shows the task × model table.
- Per-model summary: total cost, quality distribution, where it broke.
- Per-task summary: which model nailed it cheapest, where the cheap models
  fail and you must escalate.

**4. Publishable artifact**
- The report is the screenshot for the new "model-agnostic" pitch.
- Anonymizable: `mint bench --export-anon` strips task descriptions but
  keeps the structure for sharing publicly.

**Explicitly out of scope:**
- LLM-as-judge scoring (that's `quality-eval-harness` Wave 3) — for v1
  we use the existing `--no-rate` (auto-success) or the inline rating
  prompt.
- Multi-repo cross-project bench — that's `quality-eval-harness` too.
  This change targets the fleet, not the task diversity.
- Comparison-vs-naive baseline (`--baseline=opus-naive` from earlier
  designs) — fold in if easy, defer otherwise.

## Capabilities

### New Capabilities
- `cross-model-bench`: Multi-model bench execution, per-cell results
  storage, cross-model aggregate reporting, anonymized export.

### Modified Capabilities
- (Extends `mint bench` surface but doesn't break the single-model
  default — backward-compatible CLI.)

## Impact

**Affected code:**
- `src/cli/commands/bench.ts` — accept and iterate over `--models` list
- `bench/models.json` — new versioned default model list
- Report renderer — grouped-by-task and grouped-by-model views

**Risk:**
- Cross-model bench is **expensive** — 10 tasks × 5 models × $0.05 avg =
  $2.50 per full run. Acceptable for a flagship validation but expensive
  in CI.
  - Mitigation: `--no-rate` mode for unattended; `--cheap-only` flag that
    skips frontier models in routine runs.
- Bench tasks designed for mint-cli repo may not exercise model
  capabilities representatively. Mitigation: tasks chosen to cover all
  routing kinds (already true in current `tasks.json`); user can pass
  custom task file.

## Dependencies / order

- Hard dependency on `multi-axis-token-efficiency` Task 1 (audit
  instrumentation) — cross-model report leans on the new tokens/turn,
  tools/turn, compaction columns.
- Soft dependency on `cross-provider-caching` — if OpenAI implicit and
  Gemini explicit caching are wired before this ships, the cross-model
  table tells a stronger story (non-Anthropic models also have non-zero
  cache hit %).
- Wave 1.5 — ships immediately after `multi-axis-token-efficiency` and
  `agent-memory-efficiency`, before any Wave 2 work. **The proof artifact
  for the model-agnostic strategic shift.**
