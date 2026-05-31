> **🚧 DRAFT — planned (Wave 2). Not ready to execute.**
> Full spec + tasks land when prioritized. Order in ROADMAP.

## Why

Cursor's diff apply is the gold standard: multi-file preview, accept-by-hunk,
undo last apply, conflict resolution. Mint's `ApprovalDialog` works but is
basic — single-file flow, no undo, no partial accept. For a developer
evaluating CLI vs Cursor on UX, we lose this comparison.

Closing this gap doesn't make us better than Cursor (they own the IDE), but
it removes a visible reason to pick Cursor over us when the user is already
on the CLI.

## What Changes

- Multi-file diff preview: show all proposed edits in one approval pass with
  per-file accept/reject (`[a]ll`, `[n]one`, `[s]elective`).
- Hunk-level accept within a file: cursor through hunks, toggle each.
- `mint undo` command + `/undo` slash: reverts the last applied diff
  (idempotent, safe against subsequent unrelated edits via git stash patch).
- Conflict detection: if a target file changed on disk between proposal and
  apply, surface the conflict instead of silently overwriting.

## Capabilities

### New Capabilities
- `diff-apply-polish`: Multi-file preview, hunk-level selection, undo,
  conflict detection.

## Impact

- Affected: `src/tui/components/ApprovalDialog.tsx`, `src/tui/components/DiffView.tsx`,
  new `src/brain/undo.ts`, `src/cli/commands/undo.ts`.
- Risk: undo over a partial git state is hairy — limit to "last apply only"
  in v1; document explicitly.

## Dependencies / order

- Independent — can ship any time after Wave 1.
