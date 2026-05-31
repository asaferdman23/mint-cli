## ADDED Requirements

### Requirement: Capability-Gated Chain-of-Thought Hints

The loop SHALL inject a task-kind-specific chain-of-thought hint into the
tier-3 (dynamic) system block when the resolved model's reasoning capability
is below the configured threshold. Frontier models SHALL receive no hint,
preserving their cache prefix and token economy.

#### Scenario: Weak model receives the kind-appropriate CoT hint

- **WHEN** the classifier resolves `kind: 'debug'` and the route resolves
  to a model with `capabilities.reasoning < brain.scaffolding.cotThreshold`
  (default 8)
- **THEN** the dynamic system block SHALL include the `KIND_COT_HINTS['debug']`
  string ("Before fixing, list 3 possible causes and rank by likelihood.")
- **AND** a `scaffolding.applied` event SHALL be emitted with
  `{type: 'cot_hint', model, kind, hint}`

#### Scenario: Frontier model skips the CoT hint

- **WHEN** the resolved model is `claude-sonnet-4` (reasoning 9)
- **THEN** the dynamic system block SHALL NOT include any CoT hint
- **AND** no `scaffolding.applied` event SHALL fire for CoT

#### Scenario: Read-only kinds skip the hint regardless of model

- **WHEN** the classified kind is `question` or `explain`
- **THEN** no CoT hint SHALL be injected, regardless of model capability
  (read tasks need direct answers, not reasoning scaffolds)

#### Scenario: User can override the threshold

- **WHEN** `brain.scaffolding.cotThreshold` is set to a value
- **THEN** the gate SHALL use that threshold instead of the default 8
- **AND** setting it to 0 SHALL disable CoT hint injection for all models

### Requirement: Tool Call Validation and Single Retry

After each tool call is parsed from the model stream, the loop SHALL validate
the call input against the tool's JSON Schema before dispatch. On validation
failure, the loop SHALL emit a correction prompt and re-run the streaming
step once. Repeated failure SHALL fall through to normal tool-error handling.

#### Scenario: Valid tool input dispatches normally

- **WHEN** a parsed tool call's input passes JSON Schema validation
- **THEN** the tool SHALL be dispatched without modification
- **AND** no `scaffolding.applied` event SHALL fire for validation

#### Scenario: Invalid tool input triggers a single retry

- **WHEN** a parsed tool call's input fails validation (missing required
  field or type mismatch)
- **AND** `brain.scaffolding.validateRetries` >= 1 (default 1)
- **THEN** a `warn` event SHALL be emitted with the validation error
- **AND** a correction prompt SHALL be appended to the conversation,
  describing the specific error
- **AND** the streaming step SHALL re-run for that turn
- **AND** a `scaffolding.applied` event SHALL fire with
  `{type: 'validate_retry', model, tool, errors}`

#### Scenario: Repeated failure falls through

- **WHEN** the retry's tool input also fails validation
- **THEN** the tool SHALL be dispatched anyway (legacy behavior)
- **AND** the tool's error response SHALL flow back to the model normally

#### Scenario: Retries are bounded by spend cap

- **WHEN** a retry would push session cost over `brain.spendCap`
- **THEN** the retry SHALL be skipped (cap halt fires per existing logic)
- **AND** the original (invalid) tool call SHALL be dispatched as-is

### Requirement: Best-Effort Format Normalization

The tool-host SHALL normalize known weak-model input malformations before
validation. Every normalization SHALL emit a `warn` event with the
before/after diff so trace and audit show when the harness intervened.

#### Scenario: Capitalized keys are normalized

- **WHEN** a tool call arrives with input `{Path: "x.ts"}` and the schema
  expects `{path: ...}`
- **THEN** the input SHALL be normalized to `{path: "x.ts"}` before validation
- **AND** a `warn` event SHALL fire with the normalization diff
- **AND** a `scaffolding.applied` event SHALL fire with
  `{type: 'normalize', model, tool, normalization: 'key_case'}`

#### Scenario: Comma-separated string in array field is split

- **WHEN** a tool call arrives with input `{paths: "a.ts, b.ts"}` and the
  schema expects `paths: array`
- **THEN** the input SHALL be normalized to `{paths: ["a.ts", "b.ts"]}`
- **AND** the relevant `warn` + `scaffolding.applied` events SHALL fire

#### Scenario: Boolean strings are coerced

- **WHEN** input contains `{recursive: "true"}` and the schema expects boolean
- **THEN** the input SHALL be normalized to `{recursive: true}`

#### Scenario: User can disable normalization

- **WHEN** `brain.scaffolding.normalize` is `false`
- **THEN** no normalization SHALL run; inputs flow through to validation as-is

### Requirement: Per-Model Per-Kind Prompt Patches

The loop SHALL apply per-model per-kind prompt nudges from a registry of
known weak spots. Patches SHALL be appended to the CoT hint in the dynamic
tier. The registry maps each model id to optional prompt patches keyed by
task kind.

#### Scenario: Known (model, kind) combo applies its patch

- **WHEN** the resolved model is `mistral-small` and kind is `edit_small`
- **AND** `MODEL_PROMPT_PATCHES['mistral-small']['edit_small']` is defined
- **THEN** the patch text SHALL be appended to the CoT hint in tier-3
- **AND** a `scaffolding.applied` event SHALL fire with
  `{type: 'model_patch', model, kind, patch}`

#### Scenario: Frontier model has no patches

- **WHEN** the resolved model is `claude-sonnet-4`
- **AND** `MODEL_PROMPT_PATCHES['claude-sonnet-4']` is undefined or empty
- **THEN** no patch SHALL be applied

#### Scenario: User can disable patches

- **WHEN** `brain.scaffolding.modelPatches` is `false`
- **THEN** no patches SHALL be applied regardless of registry contents

### Requirement: Audit Surface for Scaffolding

`mint audit` SHALL surface scaffolding activity per model so users can see
where the harness is intervening. High scaffolding rate on a model is a
signal that the routing or scaffolding registry warrants adjustment.

#### Scenario: Aggregate audit includes scaffold/turn column

- **WHEN** a user runs `mint audit` with at least one session that had
  scaffolding events
- **THEN** the per-model table SHALL include a `scaffold/turn` column
  showing average scaffolding events per turn for that model
- **AND** a per-type breakdown (cot_hint / validate_retry / normalize /
  model_patch counts) SHALL be available in the JSON output

#### Scenario: Per-session audit details scaffolding events

- **WHEN** a user runs `mint audit <sessionId>`
- **THEN** scaffolding events SHALL be listed inline with the turns where
  they fired, showing type and detail

### Requirement: Per-Run Scaffolding Toggle

The user SHALL be able to disable all scaffolding for a single run, for A/B
comparison or to isolate model behavior. The toggle SHALL NOT require
config changes.

#### Scenario: CLI flag disables scaffolding for one-shot

- **WHEN** a user runs `mint --no-scaffold "task"`
- **THEN** the run SHALL execute with scaffolding fully disabled
  (no CoT hints, no validation retry, no normalization, no model patches)
- **AND** no `scaffolding.applied` events SHALL fire

#### Scenario: Programmatic override via RunBrainOptions

- **WHEN** a caller invokes `runBrain({scaffolding: 'off', …})`
- **THEN** the loop SHALL skip all scaffolding interventions for that run
