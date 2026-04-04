/**
 * mint --simple: The minimum viable product.
 *
 * find files → one LLM call → diffs → apply
 *
 * No Scout. No Architect. No Builder. No Reviewer.
 * No DAG scheduler. No parallel execution. No specialists.
 */
import chalk from 'chalk';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { complete } from '../../providers/index.js';
import { loadIndex, indexProject, searchRelevantFiles, extractKeywords } from '../../context/index.js';
import { parseDiffs } from '../../pipeline/diff-parser.js';
import { applyDiffsToProject } from '../../pipeline/diff-apply.js';
import type { SearchResult } from '../../context/search.js';
import type { ModelId } from '../../providers/types.js';

const MODEL: ModelId = 'deepseek-v3';
const MAX_FILES = 8;
const MAX_CONTEXT_TOKENS = 32000;

const SYSTEM_PROMPT = `You are a code editor. You receive a task and file contents. Output ONLY unified diffs.

Rules:
- Output ONLY \`\`\`diff blocks. No explanations. No commentary.
- Use --- a/path and +++ b/path with repo-relative paths
- For new files use --- /dev/null
- Include 3 context lines around each change
- One diff block per file
- If the project is empty, create the files from scratch

Example:
\`\`\`diff
--- a/src/index.ts
+++ b/src/index.ts
@@ -5,3 +5,5 @@
 import { foo } from './foo';
+import { bar } from './bar';

 export function main() {
+  bar();
 }
\`\`\``;

export async function runSimple(task: string): Promise<void> {
  const cwd = process.cwd();
  const startTime = Date.now();

  // ── Step 1: Find relevant files ──────────────────────────────────────────
  console.log(chalk.dim('  Finding files...'));

  let files: SearchResult[] = [];

  // First: check for literal file paths in the task
  const literalPaths = extractLiteralPaths(task, cwd);
  if (literalPaths.length > 0) {
    files = literalPaths.map((p) => ({
      path: p,
      content: readFileSync(join(cwd, p), 'utf-8'),
      language: p.split('.').pop() ?? 'text',
      score: 100,
      reason: 'explicit path',
    }));
  }

  // Then: search the index for more
  if (files.length < MAX_FILES) {
    try {
      let index = await loadIndex(cwd);
      if (!index || index.totalFiles === 0) {
        index = await indexProject(cwd);
      }
      if (index && index.totalFiles > 0) {
        const found = await searchRelevantFiles(cwd, task, index, {
          maxFiles: MAX_FILES - files.length,
        });
        // Don't duplicate literal paths
        const existing = new Set(files.map((f) => f.path));
        for (const f of found) {
          if (!existing.has(f.path)) files.push(f);
        }
      }
    } catch {
      // No index — proceed with literal paths only
    }
  }

  // If still no files, list the directory so the LLM knows what's available
  let dirListing = '';
  if (files.length === 0) {
    try {
      const { execSync } = await import('node:child_process');
      dirListing = execSync('find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/.mint/*" | head -50', {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch {
      dirListing = '(empty project)';
    }
  }

  console.log(chalk.dim(`  ${files.length} files found${files.length > 0 ? ': ' + files.map((f) => f.path).join(', ') : ''}`));

  // ── Step 2: Build the prompt ─────────────────────────────────────────────
  let fileContext = '';
  let tokenCount = 0;

  for (const file of files) {
    const block = `<file path="${file.path}">\n${file.content}\n</file>\n\n`;
    const tokens = Math.ceil(block.length / 4);
    if (tokenCount + tokens > MAX_CONTEXT_TOKENS) break;
    fileContext += block;
    tokenCount += tokens;
  }

  const userMessage = [
    `Task: ${task}`,
    fileContext ? `\nRelevant files:\n${fileContext}` : null,
    dirListing ? `\nProject files:\n${dirListing}` : null,
  ].filter(Boolean).join('\n');

  console.log(chalk.dim(`  ~${tokenCount} tokens of context`));
  console.log(chalk.dim(`  Calling ${MODEL}...`));

  // ── Step 3: One LLM call ─────────────────────────────────────────────────
  const response = await complete({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    maxTokens: 8192,
    temperature: 0,
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const cost = response.cost.total;
  console.log(chalk.dim(`  Done in ${duration}s · $${cost.toFixed(4)}`));

  // ── Step 4: Parse diffs ──────────────────────────────────────────────────
  const diffs = parseDiffs(response.content);

  if (diffs.length === 0) {
    console.log(chalk.yellow('\n  No diffs in response. Raw output:\n'));
    console.log(chalk.dim(response.content.slice(0, 500)));
    return;
  }

  // ── Step 5: Show diffs ───────────────────────────────────────────────────
  console.log('');
  for (const diff of diffs) {
    const isNew = diff.oldContent === '';
    const added = diff.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add'));
    const removed = diff.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'remove'));
    const header = isNew
      ? chalk.green(`  + ${diff.filePath} (new · ${added.length} lines)`)
      : chalk.cyan(`  ~ ${diff.filePath} (+${added.length} -${removed.length})`);
    console.log(header);

    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') console.log(chalk.green(`    + ${line.content}`));
        else if (line.type === 'remove') console.log(chalk.red(`    - ${line.content}`));
      }
    }
    console.log('');
  }

  console.log(chalk.dim(`  ${diffs.length} file(s) · ${duration}s · $${cost.toFixed(4)}`));

  // ── Step 6: Apply if confirmed ───────────────────────────────────────────
  const answer = await ask('  Apply changes? [Y/n] ');

  if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
    console.log(chalk.dim('  Discarded.'));
    return;
  }

  const results = applyDiffsToProject(diffs, cwd);
  for (const res of results) {
    if (res.ok) {
      console.log(chalk.green(`  ✓ ${res.action === 'created' ? 'Created' : 'Modified'}: ${res.file}`));
    } else {
      console.log(chalk.red(`  ✗ ${res.file}: ${res.error}`));
    }
  }
}

function extractLiteralPaths(task: string, cwd: string): string[] {
  const tokens = task.split(/\s+/);
  const found: string[] = [];
  for (const token of tokens) {
    const cleaned = token.replace(/['"`,;:!?()[\]{}]+/g, '');
    if (!cleaned.includes('/') && !cleaned.includes('.')) continue;
    if (cleaned.length < 3 || cleaned.length > 200) continue;
    try {
      if (existsSync(join(cwd, cleaned))) found.push(cleaned);
    } catch { /* ignore */ }
  }
  return found;
}

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
