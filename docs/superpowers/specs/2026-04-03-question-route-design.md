# Question Route — Skip Build Pipeline for Analysis Tasks

## Problem

When the user asks a question like "can you see the landing page?", the system routes it through the full build pipeline (Scout → Architect → Builder → Reviewer → retry loop). The reviewer finds nothing wrong because nothing was supposed to be built, but since it can't "approve" either, the system burns through all retries doing nothing useful.

## Solution

Add a `'question'` gate mode that short-circuits the pipeline: Scout finds relevant files, a single LLM call answers the question using those files as context, and the pipeline returns immediately. No architect, no builder, no reviewer.

## Detection

`task-intent.ts` already classifies tasks as `'analysis'` vs `'change'`. The `'analysis'` intent fires when:
- The prompt contains a `?` question mark
- Keywords like `inspect`, `explain`, `review`, `scan`, `check`, `look at`, `explore`, `understand`, `compare`, `find`
- No explicit change keywords (`fix`, `add`, `build`, `create`, etc.)

Currently this intent is only used for direct-builder routing decisions. The new behavior: when intent is `'analysis'`, route to `'question'` mode instead of falling through to the architect pipeline.

## Changes

### 1. `src/agents/adaptive-gate.ts`

Add `'question'` to `AdaptiveGateMode` type.

Insert a new routing check before the final `architect_pipeline` fallback:

```ts
if (builderIntent === 'analysis') {
  return {
    mode: 'question',
    complexity: 'simple',
    searchResults,
    scoutSummary: formatScoutSummary('question', searchResults),
    scoutModelLabel: 'local gate',
  };
}
```

This goes after all existing checks (conversation bypass, clarify, direct_builder, etc.) but before the `architect_pipeline` return.

### 2. `src/agents/index.ts`

Handle `'question'` mode early in `runAgentPipeline`, alongside the existing `'chat'` handler. The question handler:

1. Emits a SCOUT phase-start/phase-done (showing the user what files were found)
2. Reads the content of found files (already available in `searchResults`)
3. Makes a single LLM call with the user's question + file contents as context
4. Returns the LLM response as text + done

No architect, builder, or reviewer phases run.

### 3. No other files change

- `task-intent.ts` — already works correctly
- `conversation-gate.ts` — no changes needed (questions with code-related keywords correctly skip the greeting bypass and proceed to the adaptive gate)
- `scout.ts` — no changes needed
- `types.ts` — no changes needed

## Edge Cases

- **Question with no files found**: Still route to `'question'`, LLM answers based on general knowledge + project context. Better than building nothing.
- **Question that's actually a change request** ("can you fix the landing page?"): `task-intent.ts` detects `fix` as a change keyword → intent stays `'change'` → normal pipeline runs. No false positives.
- **Ambiguous** ("the landing page looks broken"): No `?`, no analysis keywords, no change keywords → defaults to `'change'` → normal pipeline. Safe default.
