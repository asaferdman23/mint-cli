## ADDED Requirements

### Requirement: Multi-Axis Audit Report

`mint audit` SHALL surface per-model aggregates across six measurable axes,
not just cache hit rate. Each axis SHALL be derivable from data already
emitted on the agent event stream so existing traces (back-filled) are
reportable without re-running.

#### Scenario: Aggregate report includes all six axes

- **WHEN** a user runs `mint audit` with at least one prior session in
  `~/.mint/traces/`
- **THEN** the output table SHALL include columns for: model, turns,
  avg input tokens per turn, cache hit %, avg tools array tokens per turn,
  avg retrieval precision (files-read / files-retrieved), compaction count,
  avg output tokens per turn, total cost
- **AND** missing axes for legacy traces SHALL render as `—` (not 0)

#### Scenario: Per-session breakdown

- **WHEN** a user runs `mint audit <sessionId>`
- **THEN** the per-turn table SHALL include columns for input tokens, output
  tokens, cacheRead, cacheWrite, tools array tokens, retrieved files,
  files-read, and cost
- **AND** a session that triggered compaction SHALL show a `compact` event row
  between the relevant turns

#### Scenario: JSON output for machine consumption

- **WHEN** a user runs `mint audit --json` (with or without a session id)
- **THEN** the command SHALL emit a single JSON object to stdout with the
  same aggregates and per-turn data as the formatted output
- **AND** stderr SHALL remain empty on success so the JSON can be piped

### Requirement: Tools-Array Pruning by Task Kind

The loop SHALL ship only the subset of tool definitions relevant to the
classified task `kind`, reducing static input tokens on read-only and
non-shell tasks. Read tools (`read_file`, `grep`, `list_files`) SHALL be
available across all kinds. Write/exec tools SHALL be conditionally
included.

#### Scenario: Question task gets read-only tools

- **WHEN** the classifier resolves `kind: 'question'` or `kind: 'explain'`
- **THEN** the tools array sent to the model SHALL exclude `write_file`,
  `edit_file`, `search_replace`, and `bash`
- **AND** the `tools_array_tokens` recorded on the cost.delta event SHALL
  reflect the reduced array

#### Scenario: Edit task without shell hint gets no bash

- **WHEN** the classified kind is `edit_small` or `edit_multi`
- **AND** the task text contains no shell-intent keyword
  (`run`, `test`, `install`, `bash`, `npm`, etc. — match list documented in
  code)
- **THEN** the tools array SHALL exclude `bash`

#### Scenario: Override forces full tool set

- **WHEN** a user passes `--all-tools` or sets `brain.toolPruning: false`
- **THEN** the tools array SHALL include every registered tool regardless
  of kind

### Requirement: Per-Session Retrieval Pinning

Retrieved file context SHALL be computed once on the first turn of a
session and reused across subsequent turns of the same session, so that
the dynamic prompt tier is byte-stable across turns and the Anthropic
prefix cache actually hits.

#### Scenario: Subsequent turns reuse turn-1 retrieval

- **WHEN** a session has run at least one turn that produced a retrieved-file
  set
- **AND** the next turn fires
- **THEN** the retriever SHALL return the cached set from turn 1 instead of
  re-running BM25 + embeddings
- **AND** the dynamic prompt tier bytes SHALL be identical to the prior turn

#### Scenario: Task explicitly broadens scope

- **WHEN** the new turn's task contains a broadening keyword
  (`also look at`, `additionally`, `the whole`, `everywhere`, etc. — match
  list documented in code)
- **THEN** retrieval SHALL re-run and the new set SHALL replace the pin

#### Scenario: User can disable pinning

- **WHEN** `brain.retrievalPinning: false` is set
- **THEN** every turn SHALL retrieve fresh (current pre-change behavior)

### Requirement: System Prompt Tier-1 Slim Variant

The base (tier-1) system prompt SHALL ship a slim variant (~1.5k tokens)
in addition to the existing full variant (~3k tokens). Variant selection
SHALL be config-gated so the slim version can ship behind opt-in until
bench data validates behavior parity.

#### Scenario: Default uses full variant

- **WHEN** `brain.systemPromptVariant` is unset or `'full'`
- **THEN** `buildPromptTiers` SHALL produce the existing tier-1 base prompt
  unchanged

#### Scenario: Slim variant trims to essentials

- **WHEN** `brain.systemPromptVariant` is `'slim'`
- **THEN** tier-1 SHALL contain at most 1800 tokens (measured via tiktoken
  cl100k_base)
- **AND** the slim variant SHALL preserve the cwd, platform, core_behavior
  chitchat-vs-work rule, and tool-use guidance
- **AND** the slim variant SHALL omit the verbose Forbidden Response
  Patterns block and the duplicate chitchat examples

### Requirement: Mid-Stream Spend Cap Enforcement

The spend cap SHALL fire during a streaming LLM call when the projected
total session cost (including the partial in-flight turn) would exceed
the configured cap, by invoking the already-wired AbortSignal. The
worst-case overshoot SHALL be the tokens streamed before the abort is
acknowledged by the provider (a small window, not a full turn).

#### Scenario: Cap fires mid-stream when projected total breaches

- **WHEN** a streaming turn is in progress
- **AND** `session.totals.costUsd + projected_remaining_turn_cost >= spendCap`
- **AND** the session has not yet approved an over-cap continuation
- **THEN** the abort signal SHALL fire
- **AND** the loop SHALL emit a `warn` event explaining mid-stream halt
- **AND** the final `cost.delta` for the aborted turn SHALL reflect only
  tokens actually billed by the provider

#### Scenario: Projection avoids false positives

- **WHEN** no `usage` chunk has arrived yet (early stream)
- **THEN** the cap watcher SHALL NOT abort; it waits until at least one
  `usage` snapshot is observed before projecting
