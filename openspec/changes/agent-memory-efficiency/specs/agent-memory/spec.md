## ADDED Requirements

### Requirement: Memory Cost Telemetry

Every memory extractor LLM call SHALL emit a structured `memory.extract`
event with model, input/output tokens, cost, and outcome (memories produced
or skipped). The `done` event's `BrainResult` SHALL include a `memorySection`
with per-session aggregates so `mint audit` can surface them.

#### Scenario: Extractor call emits cost event

- **WHEN** the loop's post-turn memory extractor fires (`memory.extract.enabled`
  is true)
- **THEN** a `memory.extract` event SHALL be emitted with: `model`,
  `inputTokens`, `outputTokens`, `usd`, `memoriesProduced` (count by kind)
- **AND** the event SHALL be written to the session trace JSONL

#### Scenario: Done event aggregates memory cost

- **WHEN** a session completes
- **THEN** `BrainResult.memorySection` SHALL contain: `extractionCallCount`,
  `extractionTotalCostUsd`, `injectedMemoriesPerTurn` (avg), `injectedMemoryTokens`
  (avg per turn), `recallPrecision` (referenced / injected)

#### Scenario: Audit renders memory section

- **WHEN** a user runs `mint audit` (with or without a session id)
- **THEN** the output SHALL include a memory section with per-model
  extraction cost, total memory cost as a share of session cost, avg
  injected memories per turn, and recall precision
- **AND** sessions without memory data (legacy traces) SHALL render `—`
  for memory columns

### Requirement: Memory Injection Token Budget

The retriever SHALL stop including memories once the cumulative injected
token count for the turn reaches `memory.injectionBudgetTokens` (default
1500). Memories are added in score order so the highest-relevance memories
always make the cut.

#### Scenario: Budget caps injection

- **WHEN** retrieving memories for a turn
- **AND** the cumulative token count of selected memories would exceed
  `memory.injectionBudgetTokens`
- **THEN** retrieval SHALL stop adding memories at the budget
- **AND** the `context.retrieved` event SHALL report
  `memoriesSelectedCount`, `memoriesAvailableCount`, `memoryTokens`

#### Scenario: Disabled budget allows all top-K

- **WHEN** `memory.injectionBudgetTokens` is 0 or unset
- **THEN** retrieval SHALL fall back to the top-K behavior
  (`memory.retrieval.k` default 10) with no token cap

### Requirement: Per-Session Memory Mode

The user SHALL be able to set memory behavior for a single session without
editing global config. Three modes:

- `on` (default) — extraction and injection both active
- `pause` — injection active, extraction off (use existing memories, don't
  create new ones)
- `off` — extraction off, injection off (session is invisible to L3/L4)

#### Scenario: CLI flag sets per-session mode

- **WHEN** a user runs `mint --no-memory "<task>"`
- **THEN** the session SHALL run with `memoryMode: 'off'`
- **AND** no `memory.extract` event SHALL fire
- **AND** no memories SHALL be injected into any prompt tier

#### Scenario: TUI slash command sets per-session mode

- **WHEN** a user types `/memory off` in the TUI
- **THEN** subsequent turns in the same TUI session SHALL run with
  `memoryMode: 'off'` until `/memory on` or session end
- **AND** `/memory status` SHALL show both the current per-session mode
  and the persistent global config

#### Scenario: Pause keeps retrieval but stops extraction

- **WHEN** `memoryMode: 'pause'` is set
- **THEN** retrieval SHALL continue to inject existing memories
- **AND** the post-turn extractor SHALL NOT fire

### Requirement: Memory Pruning Policy

`mint memory prune` SHALL apply a documented pruning policy with a
`--dry-run` default. Automatic pruning SHALL NOT run; the user must
trigger it. The policy combines confidence, age, and usage signals.

#### Scenario: Dry-run is the default

- **WHEN** a user runs `mint memory prune` with no flags
- **THEN** the command SHALL print the prune candidates without deleting
  anything
- **AND** the output SHALL group candidates by reason (low confidence,
  stale, unused, contradicted) and show counts per store

#### Scenario: Apply removes matched memories

- **WHEN** a user runs `mint memory prune --apply`
- **THEN** matched memories SHALL be deleted from the relevant SQLite store
- **AND** the command SHALL print a summary of what was removed and from
  which store
- **AND** the operation SHALL be logged so `mint memory list` can show
  recent prunes

#### Scenario: Pruning policy is documented

- **WHEN** a user runs `mint memory prune --help`
- **THEN** the help SHALL describe each rule, its default threshold, and
  the config key to override it (e.g. `memory.prune.confidenceMin: 0.4`,
  `memory.prune.maxAgeDays: 90`, `memory.prune.minUsageCount: 0` over
  `memory.prune.usageWindowDays: 30`)

### Requirement: Recall Feedback Loop

The loop SHALL track which injected memories the model actually referenced
in its assistant output (heuristic: case-insensitive substring match ≥ 20
chars). Referenced memories SHALL have their `usage_count` incremented and
`last_used` timestamp updated. The pruner uses these signals to identify
dead-weight memories.

#### Scenario: Referenced memory increments usage

- **WHEN** an injected memory's text appears (case-insensitive substring,
  ≥ 20 chars matched) in the same turn's assistant output
- **THEN** the memory's `usage_count` SHALL increment by 1
- **AND** `last_used` SHALL update to the current timestamp

#### Scenario: Unreferenced memory accrues no usage

- **WHEN** memories were injected but no substring match occurs in the
  assistant output
- **THEN** no `usage_count` field changes
- **AND** the `context.retrieved` event SHALL still record the injection
  for audit purposes

### Requirement: Per-Memory Inspection

`mint memory show <id>` SHALL print a single memory's full record so the
user can inspect before deciding to forget or override it.

#### Scenario: Show prints structured detail

- **WHEN** a user runs `mint memory show <id>`
- **THEN** the output SHALL show: kind, text, confidence, created_at,
  last_used, usage_count, source (extracted or `/remember`), and the
  store it lives in (user or project)
- **AND** an unknown id SHALL print a clear error and exit non-zero
