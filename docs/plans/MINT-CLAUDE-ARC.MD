# Mint Orchestration Upgrade From Claude Code Patterns

## Summary
Implement Claude-style orchestration in Mint in three ordered milestones, with Milestone 1 as the first execution target.

Milestone 1 keeps Mint’s current `Scout → Architect → Builder → Reviewer` surface but replaces the internal parallel-builder logic with a real worker runtime: task objects, DAG scheduling, worker-scoped context and tools, background progress events, persistent run logs, and TUI task panels. Approval mode will be **mixed**: research/read-only workers run automatically, but any worker that can write or run destructive tools still goes through the existing approval flow.

Milestone 2 adds Claude’s concurrency-safe streamed tool execution inside a single worker. Milestone 3 adds advanced efficiency features from Claude’s source: context compaction, budget-aware continuation, and optional fork-style subagents for cache-friendly follow-up work.

## Key Changes

### 1. Introduce a first-class worker runtime under the existing pipeline
- Add an internal runtime module that owns `runId`, `taskId`, `parentTaskId`, `role`, `status`, `progress`, `result`, `allowedTools`, `cwd`, and transcript/output paths.
- Keep [src/agents/index.ts](/Users/user/Desktop/mint-cli/src/agents/index.ts#L36) as the top-level orchestrator entrypoint, but make it delegate builder/reviewer fanout to the new runtime instead of raw `Promise.all`.
- Persist run state under `.mint/runs/<runId>/` with:
  - `parent.jsonl`
  - `tasks/<taskId>.jsonl`
  - `tasks/<taskId>.meta.json`
  - optional `tasks/<taskId>.output.md`
- Emit runtime events that the parent pipeline can forward without changing the CLI contract.

### 2. Replace raw parallel subtasks with a DAG scheduler
- Extend `Subtask` in [src/agents/types.ts](/Users/user/Desktop/mint-cli/src/agents/types.ts#L30) with:
  - `dependsOn?: string[]`
  - `writeTargets?: string[]`
  - `verificationTargets?: string[]`
- Architect output stays `single | split`, but split subtasks become dependency-aware instead of “all parallel.”
- Scheduler rules:
  - A task is runnable only when all `dependsOn` tasks are done successfully.
  - Two runnable tasks may execute together only if their `writeTargets` do not overlap.
  - Default max concurrent workers: `min(4, logicalCpuCount)` with a hard cap of `6`.
  - Failed tasks block dependents unless the task is marked verification-only.
- Reviewer retries are rescheduled through the same DAG system rather than a second ad hoc `Promise.all`.

### 3. Add worker-scoped context and role-scoped tool pools
- Keep the coordinator lightweight. It should synthesize, spawn, and evaluate workers, not do large implementation work itself.
- Worker context defaults:
  - Scout: repo summaries, file graph, search results, project rules
  - Architect: scout summary plus top relevant file slices, not full raw history
  - Builder: only assigned files, task spec, reviewer feedback for that task, project rules
  - Reviewer: diffs, touched-file context, test output, and subtask metadata; no write tools by default
- Tool pool defaults:
  - Scout/Architect: read/search only
  - Builder: read/search/edit/search-replace/git-diff/run-tests/bash
  - Reviewer: read/search/git-diff/run-tests/web-fetch
- Approval defaults for mixed mode:
  - `run-tests`, `git-diff`, `read/search`, `web-fetch` run without approval
  - `edit_file`, `write_file`, `search_replace`, and destructive bash commands require approval
  - A worker that contains any write-capable tool call is surfaced as approval-gated in the TUI

### 4. Extend pipeline events and the TUI to render real child-task activity
- Extend `PipelineChunk` in [src/pipeline/types.ts](/Users/user/Desktop/mint-cli/src/pipeline/types.ts#L18) with task-level events:
  - `task-start`
  - `task-progress`
  - `task-log`
  - `task-done`
  - `task-failed`
  - `task-notification`
- Add a task payload shape with:
  - `taskId`
  - `parentTaskId`
  - `role`
  - `title`
  - `status`
  - `progressSummary`
  - `isBackground`
  - `model`
  - `duration`
  - `cost`
- Keep existing phase events for backward compatibility, but make phase summaries derive from task state.
- Update the TUI phase/task state so the Builder phase can show:
  - queued tasks
  - running tasks
  - blocked tasks waiting on dependencies
  - verification tasks
  - approval-required tasks
  - completed/failed tasks with summary lines
- Live output should show task progress summaries and notifications inline instead of only dumping combined text after all workers finish.

### 5. Add Claude-style streamed safe-tool execution inside a worker
- After the task runtime is in place, update the single-worker tool loop in [src/agent/loop.ts](/Users/user/Desktop/mint-cli/src/agent/loop.ts#L35) to classify tools as concurrency-safe vs exclusive.
- Safe tools may run concurrently while the model is still streaming, but their results must be applied back to context in original tool-call order.
- Exclusive tools must execute alone and pause further tool dispatch until completion.
- If one tool in a concurrent safe batch fails, cancel sibling tool executions for that batch and report the failure to the worker.

### 6. Add second-wave efficiency features from Claude
- Implement context-budget tracking and auto-compaction only after the new runtime is stable.
- Add compacted history boundaries and post-compact summaries for long coordinator or worker sessions.
- Add optional fork-mode workers later for cache-friendly follow-ups on the same context, but do not use fork mode in Milestone 1 because it adds complexity and tighter prompt-caching requirements.
- Add explicit continuation vs fresh-worker policy:
  - continue same worker for correction after its own failed test/build
  - spawn fresh worker for independent verification or low-context-overlap tasks

## Public / Interface Changes
- `Subtask` gains `dependsOn?`, `writeTargets?`, and `verificationTargets?`.
- `PipelineChunk` gains task-event variants and task payload fields.
- TUI task state gains blocked/background/approval-required task status support.
- Internal runtime adds a worker task abstraction and persisted run-log layout under `.mint/runs/`.
- Existing top-level CLI and current phase names remain unchanged.

## Test Plan
- Unit tests for DAG scheduling:
  - dependency ordering
  - overlapping `writeTargets` serialization
  - retry rescheduling
  - failure propagation to dependents
- Runtime tests for worker event emission:
  - task lifecycle
  - background notification delivery
  - transcript/meta persistence
- Tool-policy tests:
  - read-only worker bypasses approval
  - write-capable worker still triggers approval
  - reviewer tool pool excludes write tools
- TUI tests:
  - blocked/running/done task rendering
  - approval-required task rendering
  - live task-progress updates keep the viewport pinned to current output
- Integration tests for:
  - split architect plan with dependencies
  - builder + reviewer retry loop through the scheduler
  - mixed-mode approval behavior in multi-worker runs
- Follow-up tests for streamed tool execution:
  - concurrent safe tool batch ordering
  - exclusive tool isolation
  - sibling cancellation on failure

## Assumptions And Defaults
- First implementation milestone is **Runtime + TUI**, not a broad all-at-once Claude clone.
- Mint keeps its current top-level pipeline API and visible phase naming.
- Approval policy is **mixed mode** by default.
- Architect is responsible for emitting dependency-aware subtasks; if no dependencies are provided, the scheduler treats them as parallel candidates subject to `writeTargets` conflict checks.
- Worktree isolation is deferred unless a task explicitly needs filesystem isolation; the first slice runs workers in the same repo with scoped tools and approval.
- Context compaction, fork-mode workers, and advanced cache strategies are follow-up milestones, not part of the first shipping slice.


Mostly yes for Milestone 1, but not exactly in the literal shape you pasted.

Task runtime: yes. The runtime exists in runtime.ts (line 67) and runtime.ts (line 157). It tracks task state, dependencies, progress, results, timestamps, allowed tools, and persisted output. The task type is named WorkerTaskState / WorkerTaskDefinition, not AgentTask.
DAG scheduler: yes. It is built into runtime.ts (line 157), not split into a separate scheduler.ts. It unlocks tasks from dependsOn and serializes overlapping writeTargets in runtime.ts (line 307). Difference: cycle detection is implicit right now via “no runnable tasks remain” in runtime.ts (line 245), not a dedicated graph-cycle error, and it does not log a warning when write conflicts force serialization.
Task events to parent stream: yes. PipelineChunk now has task-level events in types.ts (line 22), and the pipeline emits them through the runtime. The TUI consumes them in App.tsx (line 292), stores them in useAgentEvents.ts (line 102), and renders task states in PipelinePhase.tsx (line 124). Difference: event names are task-start, task-progress, task-done, etc., not task:started.
Architect dependency metadata: yes. Subtask now supports dependsOn, writeTargets, and verificationTargets in types.ts (line 35), and the architect parser/prompt both support them in architect.ts (line 39) and architect.ts (line 17).
Pipeline integration: yes. Split builders, reviewer runs, and retries now go through the runtime in index.ts (line 43), index.ts (line 126), and index.ts (line 253).
What is only partial:

Role-scoped tool pools: partial. The allowlists exist in tools/index.ts (line 110), and the generic agent loop can restrict tool definitions in loop.ts (line 54). But the multi-agent pipeline workers are still direct runBuilder / runReviewer calls, not spawned tool-using child agents, so the runtime is not yet fully enforcing “builder cannot call grep_files” for pipeline workers.
Persistent run layout: partial. We do persist runs, but the layout is .mint/runs/run-.../parent.jsonl plus tasks/<taskId>.jsonl, tasks/<taskId>.meta.json, and tasks/<taskId>.output.md in runtime.ts (line 82) and runtime.ts (line 103). That is not yet the exact meta.json + scout.jsonl + architect.jsonl + ... layout you pasted.
“Exact order” separation: partial. We already took a small step into Milestone 2 by batching concurrency-safe tools in loop.ts (line 182), so it is not strictly runtime-only anymore.
Verification:

npm run build passed.
node src/agents/__tests__/runtime-smoke.test.mjs passed.
node src/tools/__tests__/smoke.test.mjs passed.
Remaining gaps if you want it to match that spec more exactly:

split the scheduler into its own scheduler.ts (line 157)-style module
add explicit cycle detection + write-conflict warning logging
change run persistence to named per-role transcripts at run root
move pipeline workers onto a true child-agent runtime so role tool scopes are actually enforced, not just recorded

so coninue executing 



Worked for 9m 5s
Continued the orchestration work.

The DAG logic is now split into scheduler.ts (line 39), with explicit graph validation, cycle detection, dependency unlocking, and write-conflict serialization/warning generation in scheduler.ts (line 121). The runtime now consumes that scheduler in runtime.ts (line 207), creates timestamp-style run IDs and root meta.json in runtime.ts (line 98), and writes readable flat task transcripts like builder-1.jsonl / reviewer.jsonl alongside the legacy tasks/ copies via runtime.ts (line 135) and runtime.ts (line 530). The pipeline now names builder/reviewer transcripts and persists final run status/cost in index.ts (line 222), index.ts (line 383), and index.ts (line 476).

I also extended the task contract slightly so transcript paths propagate through pipeline events and TUI state in types.ts (line 32) and useAgentEvents.ts (line 102). The orchestration smoke now verifies write-conflict warning events, root transcript files, and cycle detection in runtime-smoke.test.mjs (line 129).

Verification:

npm run build passed.
node src/agents/__tests__/runtime-smoke.test.mjs passed.
node src/tools/__tests__/smoke.test.mjs passed.
npm run typecheck still fails on older repo issues outside this slice, in compare.ts, run.ts, anthropic.ts, gemini.ts, index.ts, and openai-compatible.ts. The remaining large gap is still the same one: pipeline builders/reviewers are not yet true spawned tool-using child agents, so role tool scopes are enforced on the generic agent loop path but not yet on the direct runBuilder / runReviewer path.


7 files changed
+407
-52
Undo
src/agents/__tests__/runtime-smoke.test.mjs
src/agents/index.ts
src/agents/runtime.ts
src/agents/scheduler.ts
src/pipeline/types.ts
src/tui/hooks/useAgentEvents.ts
src/tui/types.ts
whats next?


Next is the biggest missing piece: make Builder and Reviewer real spawned child agents instead of direct model calls.

Right now the scheduler/runtime is real, but the worker bodies in index.ts (line 126) and index.ts (line 253) still call runBuilder / runReviewer directly. That means Mint has task orchestration, but not true worker autonomy yet.

I’d do this next, in order:

Replace direct builder/reviewer executions with child-agent sessions.
Use the existing agent loop in loop.ts (line 48) and pass role-scoped tools from tools/index.ts (line 110). This is what will make tool scoping and mixed approvals actually real for pipeline workers.

Wire child-agent chunks into task progress.
Map tool_call, tool_result, and streamed text into task-progress / task-log events so the TUI shows what each worker is doing live, not just phase-level summaries.

Enforce mixed approval at runtime level.
If a worker has write-capable tools, pause it in waiting_approval and surface that in the TUI before file changes. Read-only workers should continue automatically.

Add run-history commands.
You already persist runs under .mint/runs/. Add something like mint runs and mint runs show <id> so the history becomes usable.

Clean up repo-wide typecheck debt.
Current typecheck failures are still outside this orchestration slice, mostly in provider and older CLI files.

After that, then do context compaction and fork-style workers. Not before.

The next implementation slice I’d take is: “spawn real child agents for builder/reviewer with scoped tools + live task logs + mixed approval.”


