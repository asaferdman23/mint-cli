---
name: mint-code
description: >
  Cost-efficient AI coding assistant for code fixes, refactoring, and feature implementation.
  Uses smart context engineering + DeepSeek V3.2 to deliver Claude Code-quality results at 95% lower cost.
  Use when the user asks to fix bugs, add features, refactor code, review code, or make any changes
  to a codebase. Especially useful for cost-sensitive workflows or high-volume coding tasks.
metadata:
  openclaw:
    emoji: "🍃"
    requires:
      bins: ["mint"]
    install:
      - id: npm
        kind: npm
        package: "usemint"
        bins: ["mint"]
        label: "Install Mint CLI (npm)"
---

# Mint Code — Cost-Efficient AI Coding

## When to Use
- User asks to fix a bug, add a feature, or refactor code
- User wants cost-efficient coding (compared to Claude Code / Codex)
- High-volume coding tasks where cost matters
- Background coding tasks that run autonomously

## Setup
Mint needs a DEEPSEEK_API_KEY environment variable. Check if it exists:
```bash
echo $DEEPSEEK_API_KEY
```
If empty, tell the user: "Mint needs a DeepSeek API key. Get one free at platform.deepseek.com and set it: `export DEEPSEEK_API_KEY=sk-...`"

## Initialize Project
Before first use in a project directory, build the index:
```bash
cd /path/to/project && mint init
```
This creates `.mint/project.json` with the codebase index. Only needed once per project.

## Usage

### One-shot coding task (recommended for agents):
```bash
mint exec --apply "description of what to fix or build"
```
This runs headless, applies changes automatically, and returns JSON with results.

### Complex tasks that need reasoning:
```bash
mint exec --apply --think "description of complex refactoring"
```

### Read-only analysis (no changes applied):
```bash
mint exec "explain how the auth system works"
```

## Parsing Results
The exec command outputs JSON to stdout:
```json
{
  "success": true,
  "diffs": [{"file": "src/auth.ts", "hunks": "...", "additions": 5, "deletions": 2}],
  "applied": true,
  "stats": {"cost": 0.008, "durationMs": 2100, "inputTokens": 1840}
}
```

Check `success` field. If `false`, check `error` field for details.
If the model asks a question instead of making changes, `success` is true but `diffs` is empty and `message` contains the question — relay it to the user.

## Cost Awareness
Mint is extremely cheap. Typical costs:
- Simple fix: $0.005-0.01
- Moderate feature: $0.01-0.03
- Complex refactor: $0.03-0.08

Always report the cost to the user from `stats.cost` in the response.

## Limitations
- Mint works best on projects with < 1000 files
- It does NOT run tests automatically (suggest test commands in response)
- For very large refactors spanning 20+ files, break into smaller tasks
