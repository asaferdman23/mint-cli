## 1. Foundation — config + events + scaffolding module skeleton

- [ ] 1.1 Add `brain.scaffolding` config block to `src/utils/config.ts`: `{cotThreshold: 8, validateRetries: 1, normalize: true, modelPatches: true}` with defaults
- [ ] 1.2 Add `scaffolding.applied` event type to `src/brain/events.ts`: `{type: 'cot_hint' | 'validate_retry' | 'normalize' | 'model_patch', model, kind?, tool?, detail?}`
- [ ] 1.3 Create `src/brain/scaffolding/index.ts` re-export surface; create `cot-hints.ts`, `validate.ts`, `normalize.ts`, `model-patches.ts` as empty stubs
- [ ] 1.4 Add `scaffolding?: 'on' | 'off'` to `RunBrainOptions` (loop.ts) and `HeadlessOptions` (headless.ts); plumb through with default `'on'`
- [ ] 1.5 Add `--no-scaffold` CLI flag to the root `mint` command in `src/cli/index.ts`

## 2. CoT hints by task kind

- [ ] 2.1 Define `KIND_COT_HINTS: Record<TaskKind, string>` in `src/brain/scaffolding/cot-hints.ts` with the seed hints from the proposal
- [ ] 2.2 Implement `getCotHint(model: ModelId, kind: TaskKind, threshold: number): string | null` — returns hint when `MODELS[model].capabilities.reasoning < threshold` and the kind has a non-empty hint
- [ ] 2.3 In `loop.ts`, call `getCotHint()` after route resolution and pass the result into `buildPromptTiers` (new optional `cotHint` field on BuildTiersInput)
- [ ] 2.4 In `prompt-tiers.ts`, append the CoT hint to the dynamic tier as a `<scaffolding_hint>` block (top of dynamic, above retrieved context)
- [ ] 2.5 Emit `scaffolding.applied` event with type `'cot_hint'` when a hint fires
- [ ] 2.6 Tests: 6 cases — frontier model gets no hint, weak model gets hint, threshold override works, read-only kinds skip, hint lands in tier-3 not tier-1, hint cleared when scaffolding off

## 3. Tool call validation + single retry

- [ ] 3.1 Implement minimal JSON Schema validator in `src/brain/scaffolding/validate.ts` — handles `type`, `properties`, `required`; returns `{ok: true} | {ok: false, errors: string[]}`. No new dep
- [ ] 3.2 Add `formatValidationError(errors: string[]): string` helper that produces a model-readable correction prompt
- [ ] 3.3 In `loop.ts`, after the tool-call streaming step completes, iterate the parsed tool calls; for each, validate input against the tool's `input_schema` (lookup via `getToolDefinitions()`)
- [ ] 3.4 On validation failure with `brain.scaffolding.validateRetries >= 1`: emit `warn` + `scaffolding.applied` events; append a correction message to the conversation; re-run the streaming step ONCE for that turn
- [ ] 3.5 Track per-turn retry count on `Session` so the cap halt check prevents runaway retries
- [ ] 3.6 Verify the existing `brain.spendCap` halt fires correctly when a retry would breach the cap
- [ ] 3.7 Tests: 5 cases — valid input dispatches normally, invalid triggers retry, retry success dispatches, retry failure falls through, cap halt blocks retry

## 4. Format normalization

- [ ] 4.1 Implement `normalizeToolInput(input: Record<string, unknown>, schema: ToolDefinition['input_schema']): { input, normalizations: NormalizationDiff[] }` in `src/brain/scaffolding/normalize.ts`
- [ ] 4.2 Normalization rules (each as a small pure function, composable):
  - `normalizeKeyCase` — `Path` → `path`, `FileName` → `path` (closest case-insensitive match against schema properties)
  - `splitCommaToArray` — array-typed properties: split string on `,` and trim
  - `coerceBooleanStrings` — `"true"` → `true`, `"false"` → `false` when schema expects boolean
  - `normalizePathStrings` — strip leading `./`, expand `~`, collapse `..` for path-typed fields (detected by property name `path` / `file` / suffix `_path`)
- [ ] 4.3 In `tools-host.ts`, call `normalizeToolInput()` BEFORE validation (order: normalize → validate → retry → dispatch)
- [ ] 4.4 For each normalization applied, emit one `warn` (human-readable diff) and one `scaffolding.applied` event with type `'normalize'` and the rule name
- [ ] 4.5 Honor `brain.scaffolding.normalize: false` to skip the step entirely
- [ ] 4.6 Tests: one per rule (4 tests), one for the chain (multi-rule input), one for the disabled flag, one for the audit event emission

## 5. Per-model prompt patches

- [ ] 5.1 Define `MODEL_PROMPT_PATCHES: Partial<Record<ModelId, Partial<Record<TaskKind, string>>>>` in `src/brain/scaffolding/model-patches.ts` with seed entries from the proposal
- [ ] 5.2 Implement `getModelPatch(model: ModelId, kind: TaskKind): string | null`
- [ ] 5.3 In `loop.ts`, after `getCotHint()`, also call `getModelPatch()` and concatenate to the CoT hint with a separator
- [ ] 5.4 Emit `scaffolding.applied` event with type `'model_patch'` when a patch fires
- [ ] 5.5 Honor `brain.scaffolding.modelPatches: false` to skip
- [ ] 5.6 Tests: 4 cases — known combo fires, unknown combo no-op, frontier model has no patches, disable flag works

## 6. Audit visibility

- [ ] 6.1 In `src/cli/commands/audit.ts`, extend `readTurns` (or add a parallel reader) to count `scaffolding.applied` events per model per type
- [ ] 6.2 Add `scaffold/turn` column to the per-model aggregate table, showing avg scaffolding events per turn (any type combined)
- [ ] 6.3 Add a "Scaffolding breakdown" subsection below the main table when any model has scaffolding events: per-model per-type counts
- [ ] 6.4 Per-session `mint audit <id>`: list scaffolding events inline with the turn where they fired, with type + brief detail
- [ ] 6.5 Tests: synthetic trace JSONL with known scaffolding events; assert aggregator counts correctly and renders the column

## 7. Bench integration for A/B validation

- [ ] 7.1 Add `--no-scaffold` flag to `mint bench` so a run can compare scaffolding-on vs scaffolding-off
- [ ] 7.2 Extend the bench results JSON to record whether scaffolding was on for the run
- [ ] 7.3 The bench report renderer: if both `--scaffold` and `--no-scaffold` runs exist, show a delta column (cost diff, quality diff, scaffold-fires per task)
- [ ] 7.4 Add a bench task to `bench/tasks.json` specifically designed to exercise weak-model failure modes (e.g., a task known to elicit malformed tool calls on Llama 70B)

## 8. Documentation + commit

- [ ] 8.1 Update `README.md` mentioning `mint --no-scaffold` and the scaffolding section in `mint audit`
- [ ] 8.2 New doc `docs/SCAFFOLDING.md` explaining the four scaffolding types, the capability threshold, how to add a new prompt patch, how to interpret the audit column
- [ ] 8.3 Update `docs/launch/COMPARISON_BLOG.md` and the landing page with the scaffolding angle: "Mint makes weak models punch above their weight"
- [ ] 8.4 Update `MISSION_ROADMAP.md` and `openspec/ROADMAP.md` to mark old-model-scaffolding active (was draft)
- [ ] 8.5 Bump version, commit, run `openspec validate old-model-scaffolding`
- [ ] 8.6 After merge: `openspec archive old-model-scaffolding`
