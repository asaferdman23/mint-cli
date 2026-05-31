## Context

The Mint routing decision today is "pick a model for this task." After it
picks, the rest of the system treats every model identically — same prompt,
same tools, same retry behavior, same tool-call parsing. That's correct for
frontier models. It's wasteful (and often broken) for weak models:

- **Llama 70B** emits `{path: "src/a.ts, src/b.ts"}` when the tool expects an
  array. Tool errors. Model has to figure out why from the error string.
- **Mistral Small** over-explains an `edit_small` task instead of just
  emitting a tool call — wasted output tokens, no edit happens.
- **Gemini Flash** jumps to a hack on `debug` without listing causes — the
  fix is wrong, model spends 5 more iterations correcting itself.
- **GPT-OSS-20B** mis-keys arguments (`Path` instead of `path`). Tool errors.
  Wastes a turn.

Each of these is a deterministic, observable failure mode. Each is fixable in
the harness without touching the model. The competitive insight: nobody else
does this because they don't have the routing + audit + tune loop that makes
it *worth* doing. We do.

## Goals / Non-Goals

**Goals:**
- Per-(model, task-kind) intervention applied automatically.
- Every intervention observable in trace + audit — no silent magic.
- Bounded cost: max 1 retry per tool call, hard-capped by `brain.spendCap`.
- Honest scope: lift weak models to their own ceiling, don't lie about
  capability substitution.
- Zero impact on frontier models (capability threshold gates everything).

**Non-Goals:**
- Fine-tuning, ensembles, tree-of-thought, multi-sample voting (cost killers).
- Per-language scaffolding (defer until kind+model dimensions are exhausted).
- Per-project hint customization via MINT.md (defer to a follow-on change).
- Self-tuning of `MODEL_PROMPT_PATCHES` via `mint tune` (defer — first ship
  the static registry, then automate from bench data).
- Substituting an LLM call to repair tool calls (too expensive; correction
  prompt re-runs the original turn, no extra LLM hop).

## Decisions

### Decision 1: Capability threshold = `reasoning < 8`

The `MODELS` registry has a `capabilities.reasoning` score 1-10. We use it as
the gate for CoT hints. At `reasoning < 8`:

- gemini-2-flash (7) ✅ scaffolded
- groq-llama-70b (7) ✅ scaffolded
- groq-llama-8b (6) ✅ scaffolded
- mistral-small (6) ✅ scaffolded
- groq-gpt-oss-20b (7) ✅ scaffolded
- claude-sonnet-4 (9) ❌ skipped
- gemini-2-pro (9) ❌ skipped
- gpt-4o (8) ❌ skipped (borderline — exactly at threshold)
- grok-4-beta (10) ❌ skipped
- grok-4.1-fast (9) ❌ skipped

**Alternatives considered:**
- `<= 7` would include gpt-4o. Empirically gpt-4o doesn't need the scaffold;
  adding it just costs tokens.
- Threshold per-feature (separate thresholds for CoT vs validation vs
  normalization). Overengineered for v1 — single threshold is enough.
- Per-model opt-out only, no threshold (always scaffold by default).
  Backwards — frontier models pay tokens for no gain.

The threshold is config-configurable (`brain.scaffolding.cotThreshold`) for
users who want to A/B test it on their fleet.

### Decision 2: CoT hints live in tier-3 (dynamic), not tier-1

Tier-1 (base) and tier-2 (project) are cache-stable across turns of a session.
Adding CoT hints there would invalidate the cache prefix when the task kind
changes between turns — a steep cost.

Tier-3 is already dynamic per-turn (retrieval results change anyway). Putting
the hint there means it's "free" from a cache perspective on Anthropic; on
non-caching providers it's just text appended to system, no different.

**Trade-off:** tier-3 is the *last* cache breakpoint, so on Anthropic the hint
gets cached on turn 1, then re-cached on turn 2 if the kind changes. Most
sessions stay on one kind, so this is usually a single cache write. Acceptable.

### Decision 3: Validation uses a minimal in-house JSON Schema checker, not ajv

Tool input schemas in Mint are dead simple — `{type: 'object', properties:
{...}, required: [...]}`. We need to check:
1. All required properties present
2. Type of each provided property matches schema

That's ~30 LoC of pure TypeScript with no dependencies. Ajv would add ~50KB
to the bundle and runtime cost for features we don't use. Custom validator
wins on every axis.

The validator returns `{ok: true} | {ok: false, errors: string[]}` — errors
are human-readable and get pasted into the correction prompt verbatim.

### Decision 4: Retry is single-shot, not a loop

If retry #1 also produces invalid input, we let the tool error normally (as
today). The thinking:

- Two retries × N tool calls × M iterations = exponential cost explosion on
  pathological weak models.
- One retry catches the "model just typo'd the field name" case (the
  overwhelming majority of malformations in our sample).
- The cases that need >1 retry are signals the model can't do the task —
  better to surface them as failures than to thrash.

The retry counts against `brain.spendCap` so even the single retry is bounded
in total cost.

### Decision 5: Normalization happens BEFORE validation

Order matters:
1. Parse tool call from stream
2. **Normalize** (best-effort coercion) — `tools-host.ts:normalizeToolInput`
3. Validate against schema
4. If invalid: emit warn + correction prompt + retry once
5. If valid: dispatch tool

Normalization first means cases like `Path: "x"` get fixed silently (visible
in warn event) before validation, so the model doesn't get hit with a
correction prompt for a tiny mistake the harness could fix itself. Saves a
turn.

**What we normalize (v1 list, conservative):**
- Capitalized keys → camelCase (`Path` → `path`, `FileName` → `path`)
- Comma-separated string in array fields → split into array
- Path normalization: strip leading `./`, expand `~`, collapse `..`
- Trailing whitespace and balanced-quote weirdness in stringified args
- Boolean strings (`"true"`, `"false"`) → actual booleans

**What we DON'T normalize (would be wrong):**
- Reshape entire object (too aggressive — would hide real bugs)
- Coerce numbers from strings (could mask intent)
- Add missing required fields with guesses (no — let validation catch it
  so the model knows)

### Decision 6: `MODEL_PROMPT_PATCHES` ships with conservative defaults; tuned from bench data

Seed values (v1) are intuition-based — the patches I'd write today knowing
each model's pattern. They land in the same file (`model-patches.ts`) and
are versioned so we can show before/after when bench data lands.

When `cross-model-bench` produces real cell-by-cell quality data, we can
add patches for the (model, kind) cells where the cheap model "almost
works" — exactly the cells where a one-line prompt nudge changes outcomes.
This is a future PR that strengthens the registry, not v1 scope.

### Decision 7: Audit visibility is non-negotiable

Every scaffolding intervention emits a `scaffolding.applied` event. The
audit then aggregates per-model per-type. The user can SEE:
- mistral-small had 24 normalizations across 8 turns → 3 per turn → that
  model is struggling with format
- groq-llama-70b had 2 validate_retry events → routing might be wrong
- gemini-2-flash had 0 scaffolding fires across 12 turns → it's handling
  the work cleanly, scaffolding isn't even needed

Without this visibility, scaffolding is a black-box claim. With it, it's
provable per-model.

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Frontier models accidentally scaffolded | Low | `capabilities.reasoning < 8` gate + per-model config opt-out |
| Normalization masks a real model bug | Medium | Every normalization emits `warn` event with diff; visible in trace |
| Retry doubles cost on a chronic-failure model | Low | Max 1 retry; counts against `brain.spendCap`; `mint tune` will swap routes that show high retry rate |
| CoT hint hurts a model that doesn't need it | Medium | Threshold + per-model opt-out; bench data validates threshold over time |
| Static `KIND_COT_HINTS` map gets stale | Low | One-sentence hints aged well in practice; per-project override deferred to v2 |
| Validator false-positive (rejects valid input) | Low | Validator is conservative — only checks required + type; doesn't enforce enum/min/max etc. |
| `MODEL_PROMPT_PATCHES` written from intuition | Medium | Ship v1 with seeds, replace with bench-derived patches in follow-on PR |

## Open Questions

- Should `scaffolding.applied` events be omitted from trace JSONL when no
  scaffolding fired (vs always emitting a "scaffolding: noop" event)?
  Probably omit — fewer bytes, audit can infer noop from absence.
- Should normalization be more aggressive (e.g., auto-fix unbalanced quotes
  in stringified args)? Punt to v2 — too easy to break things.
- Should `MODEL_PROMPT_PATCHES` support inheritance (e.g., "all Llama models
  share this patch")? Premature — wait until we have ≥3 patches per family.
- Should we offer a `--scaffold-debug` flag that dumps every intervention
  verbosely to stderr? Useful for tuning the maps; defer to a follow-up.
