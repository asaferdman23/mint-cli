# Phase 3 Spec — Tools, Permissions, Memory, Skills

All features are $0 LLM cost unless noted. The orchestrator (Grok) already runs — these extend what it can do without extra LLM calls.

---

## 1. More Tools (13 → 25)

### New tools to add:

**Git tools:**
- `git_log` — `git log --oneline -20`. Shows recent commits. $0.
- `git_blame` — `git blame <file>`. Shows who changed each line. $0.
- `git_branch` — `git checkout -b <name>`. Creates a branch. Needs approval. $0.
- `git_stash` — `git stash` / `git stash pop`. Save/restore work. $0.

**Search tools:**
- `find_definition` — grep for `function <name>`, `class <name>`, `export.*<name>`, `const <name>` across the project. Returns file + line. $0.
- `find_references` — grep for all usages of a symbol across the project. $0.
- `regex_replace` — find/replace with regex across one file. Like edit_file but with pattern matching. $0.

**Web tools:**
- `web_fetch` — fetch a URL, return plain text (strip HTML tags). For reading docs, API specs, READMEs. $0.

**File tools:**
- `read_lines` — read specific line range from a file (e.g., lines 100-150). For large files without truncation. $0.
- `count_lines` — return line count of a file. Helps orchestrator decide if it needs grep_file. $0.
- `file_diff` — show diff between current file and last git commit. $0.

**Project tools:**
- `package_info` — read package.json and return name, version, scripts, deps. $0.

### Implementation:
- Add to `ORCHESTRATOR_TOOL_DEFINITIONS` array in `src/orchestrator/tools.ts`
- Add executor functions (all pure code, no LLM)
- Add to orchestrator system prompt tool list
- Safety: git_branch needs approval, everything else is safe (read-only)

### Cost impact: $0. All tools are pure code.

---

## 2. Permission System

### How it works:

Three permission levels, configured in MINT.md or `.mint/config.json`:

```
# MINT.md

## Permissions
- allow: edit_file, write_file, run_command("npm *"), git_commit
- ask: git_branch, git_stash, run_command("*")
- block: run_command("rm *"), run_command("sudo *"), run_command("curl -X POST *")
```

### Rules engine (no LLM):

```typescript
interface PermissionRule {
  tool: string;
  pattern?: string;  // glob pattern for arguments
  action: 'allow' | 'ask' | 'block';
}
```

The executor checks rules before running any tool:
1. Check BLOCK rules first — if matched, return "Blocked by project rules"
2. Check ALLOW rules — if matched, auto-execute
3. Check ASK rules — if matched, trigger onApprovalNeeded callback
4. Default: safe tools auto-execute, write tools ask (current behavior)

### Default rules (no config needed):
- ALLOW: search_files, read_file, grep_file, list_files, read_lines, count_lines, git_diff, git_log, git_blame, find_definition, find_references, package_info, file_diff
- ASK: edit_file, write_file, git_commit, git_branch, git_stash, regex_replace
- BLOCK: run_command("rm -rf *"), run_command("sudo *"), run_command("kill *"), run_command("shutdown *")

### Implementation:
- New file: `src/orchestrator/permissions.ts`
- Load rules from MINT.md `## Permissions` section + `.mint/config.json`
- Check rules in `executeOrchestratorTool` before running
- Update `isToolSafe()` to use rules engine

### Cost impact: $0. Pure string matching.

---

## 3. Memory Upgrade

### Current state:
- `.mint/memory.json` — flat file with recent files, session summaries
- Loaded into system prompt every session
- No selection — everything gets injected

### Upgrade to structured memory:

**Memory types:**

```typescript
interface MemoryEntry {
  id: string;
  type: 'file_edit' | 'convention' | 'preference' | 'project_info' | 'error_fix';
  content: string;
  relevance: string[];  // keywords for matching
  createdAt: string;
  lastUsedAt: string;
  useCount: number;
}
```

**Selection without LLM:**

When the orchestrator starts, match task keywords against memory `relevance` fields:
1. Extract keywords from the user's task (reuse existing `extractKeywords`)
2. Score each memory entry by keyword overlap
3. Inject top 5 relevant memories into system prompt
4. Skip memories with 0 relevance score

Example:
- User says "fix the auth bug"
- Memory has: `{ type: 'file_edit', content: 'auth.ts was refactored last session', relevance: ['auth', 'login', 'token'] }`
- Keywords match → inject this memory
- Memory about CSS changes → no match → skip

**Auto-save rules (no LLM):**
- After `edit_file`: save `{ type: 'file_edit', content: "edited {path}: {old→new summary}", relevance: [path segments] }`
- After error + fix: save `{ type: 'error_fix', content: "error X fixed by Y", relevance: [error keywords] }`
- After `git_commit`: save `{ type: 'convention', content: commit message, relevance: [file paths] }`

**Memory file:** `.mint/memories/` directory, one JSON file per entry. Max 100 entries, oldest pruned.

### Implementation:
- New file: `src/orchestrator/memory-v2.ts`
- Replace `loadMemory`/`updateMemory` with keyword-scored selection
- Save memories after tool calls in the orchestrator loop
- Inject selected memories into system prompt

### Cost impact: $0. Keyword matching, no LLM. Claude Code uses Sonnet for selection ($3/M) — we do it for free.

---

## 4. Skills System

### What are skills?

Markdown files in `.mint/skills/` that get injected into the orchestrator prompt when relevant. They teach the orchestrator project-specific conventions.

Example `.mint/skills/react.md`:
```markdown
---
name: React conventions
match: ["*.tsx", "*.jsx", "components/"]
---

- Use functional components with hooks, not class components
- Use Tailwind CSS for styling, not CSS modules
- State management: useContext for global, useState for local
- File naming: PascalCase for components, camelCase for hooks
- Always add prop types with TypeScript interfaces
```

Example `.mint/skills/api.md`:
```markdown
---
name: API conventions
match: ["routes/", "api/", "*.controller.ts"]
---

- Use Hono framework
- All endpoints return JSON with { data, error } shape
- Validate input with Zod schemas
- Log errors with structured JSON to stdout
- Use try/catch on every route handler
```

### How it works (no LLM):

1. On session start, scan `.mint/skills/*.md`
2. Parse YAML frontmatter for `name` and `match` globs
3. When the orchestrator reads or edits a file, check if the file path matches any skill's globs
4. Inject matching skills into the system prompt as `<skill name="...">content</skill>`
5. Max 3 skills injected at once (to save context tokens)

### Selection logic:

```typescript
function selectSkills(activePaths: string[], skills: Skill[]): Skill[] {
  return skills
    .filter(skill => skill.match.some(glob => activePaths.some(path => minimatch(path, glob))))
    .slice(0, 3);
}
```

When the orchestrator calls `read_file("src/components/Hero.tsx")`:
- Checks skills: `react.md` matches `*.tsx` → inject
- `api.md` matches `routes/` → no match → skip

### Auto-generation:

`mint init` detects the project and generates starter skills:
- React/Next project → generate `.mint/skills/react.md`
- Express/Hono project → generate `.mint/skills/api.md`
- TypeScript project → generate `.mint/skills/typescript.md`
- Tailwind detected → generate `.mint/skills/tailwind.md`

### Implementation:
- New file: `src/orchestrator/skills.ts`
- Scan `.mint/skills/*.md` on session start
- Parse frontmatter (match globs)
- Track active file paths from tool calls
- Inject matching skills into system prompt dynamically
- Add starter skill generation to `mint init`

### Cost impact: $0. File reading + glob matching. Skills are injected into the existing orchestrator prompt — no extra LLM call.

---

## Summary

| Feature | Files to create/modify | LLM cost | Priority |
|---------|----------------------|----------|----------|
| Tools (13→25) | `tools.ts`, `prompts.ts` | $0 | High — more capable |
| Permissions | `permissions.ts`, `tools.ts` | $0 | High — safety |
| Memory v2 | `memory-v2.ts`, `loop.ts` | $0 | Medium — better context |
| Skills | `skills.ts`, `loop.ts`, `cli/index.ts` | $0 | Medium — project conventions |

**Total new LLM cost: $0.** Everything is pure code, keyword matching, and file I/O.

Build order: Tools → Permissions → Skills → Memory v2
(Skills before Memory because skills are simpler and more visible to users)
