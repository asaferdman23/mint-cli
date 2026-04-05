/**
 * Examples system — finds well-written files from the user's project
 * and injects relevant ones as style examples when generating code.
 *
 * On `mint init`, scans for the 3 largest well-structured files per category
 * (component, route, test, model) and stores references in .mint/examples.json.
 *
 * When write_code is called, the relevant example is attached to the prompt.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';

export interface ExampleEntry {
  path: string;
  category: ExampleCategory;
  lines: number;
  /** Stored snippet — first 80 lines to keep token budget tight */
  snippet: string;
}

export type ExampleCategory = 'component' | 'route' | 'test' | 'model' | 'utility';

export interface ExamplesIndex {
  generatedAt: string;
  examples: ExampleEntry[];
}

const EXAMPLES_PATH = '.mint/examples.json';
const MAX_SNIPPET_LINES = 80;
const MAX_EXAMPLES_PER_CATEGORY = 3;

// ─── Load / Save ─────────────────────────────────────────────────────────────

export function loadExamples(cwd: string): ExamplesIndex | null {
  try {
    const content = readFileSync(join(cwd, EXAMPLES_PATH), 'utf-8');
    return JSON.parse(content) as ExamplesIndex;
  } catch {
    return null;
  }
}

function saveExamples(cwd: string, index: ExamplesIndex): void {
  const fullPath = join(cwd, EXAMPLES_PATH);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(index, null, 2), 'utf-8');
}

// ─── Category detection ──────────────────────────────────────────────────────

function detectCategory(filePath: string, content: string): ExampleCategory | null {
  const name = basename(filePath).toLowerCase();
  const ext = extname(filePath).toLowerCase();

  // Test files
  if (name.includes('.test.') || name.includes('.spec.') || name.includes('__tests__')) {
    return 'test';
  }

  // Route/API files
  if (
    filePath.includes('/routes/') || filePath.includes('/api/') ||
    filePath.includes('/controllers/') || filePath.includes('/handlers/') ||
    (content.includes('router.') && (content.includes('get(') || content.includes('post('))) ||
    (content.includes('app.') && (content.includes('get(') || content.includes('post(')))
  ) {
    return 'route';
  }

  // React/Vue/Svelte components
  if (
    (ext === '.tsx' || ext === '.jsx') &&
    (content.includes('export default') || content.includes('export function')) &&
    (content.includes('return (') || content.includes('return(') || content.includes('<'))
  ) {
    return 'component';
  }
  if (ext === '.vue' || ext === '.svelte') {
    return 'component';
  }

  // Model/Schema files
  if (
    filePath.includes('/models/') || filePath.includes('/schemas/') ||
    filePath.includes('/entities/') || filePath.includes('/types/') ||
    content.includes('interface ') || content.includes('type ') ||
    content.includes('Schema(') || content.includes('model(')
  ) {
    return 'model';
  }

  // Utility files
  if (
    filePath.includes('/utils/') || filePath.includes('/helpers/') ||
    filePath.includes('/lib/')
  ) {
    return 'utility';
  }

  return null;
}

// ─── Quality scoring ─────────────────────────────────────────────────────────

function scoreFileQuality(content: string, lines: number): number {
  let score = 0;

  // Prefer files that are substantial but not too large
  if (lines >= 30 && lines <= 300) score += 3;
  else if (lines >= 15 && lines <= 500) score += 1;
  else if (lines > 500) score -= 2;

  // Has exports (public API — more useful as example)
  if (content.includes('export ')) score += 2;

  // Has type annotations (TypeScript quality)
  if (content.includes(': string') || content.includes(': number') || content.includes('interface ')) score += 1;

  // Has JSDoc or comments explaining logic
  if (content.includes('/**') || content.includes('// ')) score += 1;

  // Has proper error handling
  if (content.includes('try {') || content.includes('catch')) score += 1;

  // Penalize files with lots of TODOs or hacks
  const todoCount = (content.match(/TODO|FIXME|HACK|XXX/gi) ?? []).length;
  score -= todoCount;

  // Penalize files that are mostly imports
  const importLines = (content.match(/^import /gm) ?? []).length;
  if (importLines > lines * 0.3) score -= 2;

  return score;
}

// ─── Scan project for golden examples ────────────────────────────────────────

export async function generateExamples(cwd: string): Promise<ExamplesIndex> {
  const candidates: Array<{ path: string; category: ExampleCategory; lines: number; score: number; content: string }> = [];

  // Collect source files using simple recursive scan
  const sourceFiles = collectSourceFiles(cwd, cwd);

  for (const relPath of sourceFiles) {
    try {
      const content = readFileSync(join(cwd, relPath), 'utf-8');
      const lines = content.split('\n').length;
      const category = detectCategory(relPath, content);
      if (!category) continue;

      const score = scoreFileQuality(content, lines);
      if (score < 2) continue; // Skip low-quality files

      candidates.push({ path: relPath, category, lines, score, content });
    } catch {
      continue;
    }
  }

  // Pick top 3 per category
  const examples: ExampleEntry[] = [];
  const categories: ExampleCategory[] = ['component', 'route', 'test', 'model', 'utility'];

  for (const cat of categories) {
    const catCandidates = candidates
      .filter(c => c.category === cat)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_EXAMPLES_PER_CATEGORY);

    for (const c of catCandidates) {
      const snippetLines = c.content.split('\n').slice(0, MAX_SNIPPET_LINES);
      examples.push({
        path: c.path,
        category: c.category,
        lines: c.lines,
        snippet: snippetLines.join('\n'),
      });
    }
  }

  const index: ExamplesIndex = {
    generatedAt: new Date().toISOString(),
    examples,
  };

  saveExamples(cwd, index);
  return index;
}

// ─── Get relevant example for a write_code call ─────────────────────────────

/**
 * Given a write_code task description and file paths, find the most relevant
 * example from the project to attach as a style reference.
 */
export function getRelevantExample(
  task: string,
  filePaths: string[],
  cwd: string,
): string | null {
  const index = loadExamples(cwd);
  if (!index || index.examples.length === 0) return null;

  // Determine what category the task is about
  const taskLower = task.toLowerCase();
  const pathsLower = filePaths.map(p => p.toLowerCase()).join(' ');
  const combined = taskLower + ' ' + pathsLower;

  let targetCategory: ExampleCategory | null = null;

  if (combined.includes('test') || combined.includes('spec')) {
    targetCategory = 'test';
  } else if (
    combined.includes('route') || combined.includes('api') ||
    combined.includes('endpoint') || combined.includes('controller') ||
    combined.includes('handler')
  ) {
    targetCategory = 'route';
  } else if (
    combined.includes('component') || combined.includes('.tsx') ||
    combined.includes('.jsx') || combined.includes('react') ||
    combined.includes('page') || combined.includes('widget')
  ) {
    targetCategory = 'component';
  } else if (
    combined.includes('model') || combined.includes('schema') ||
    combined.includes('type') || combined.includes('interface')
  ) {
    targetCategory = 'model';
  }

  // Find matching example — prefer exact category match, fall back to any
  let example: ExampleEntry | undefined;

  if (targetCategory) {
    example = index.examples.find(e => e.category === targetCategory);
  }

  // If no category match, pick the first available example as a general style ref
  if (!example && index.examples.length > 0) {
    example = index.examples[0];
  }

  if (!example) return null;

  // Don't return an example that's one of the files being edited
  if (filePaths.includes(example.path)) {
    const alt = index.examples.find(e => e.category === targetCategory && !filePaths.includes(e.path));
    if (alt) example = alt;
    else return null;
  }

  return `Follow the style and patterns from this project example (${example.path}):\n\`\`\`\n${example.snippet}\n\`\`\``;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '.mint', '.cache', 'coverage', '.turbo', '.vercel', '__pycache__',
  'vendor', '.venv', 'venv', 'target',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.vue', '.svelte',
]);

function collectSourceFiles(baseDir: string, cwd: string, maxFiles = 200): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    if (files.length >= maxFiles) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= maxFiles) return;
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(join(dir, entry.name));
        } else if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          const relPath = join(dir, entry.name).slice(cwd.length + 1);
          files.push(relPath);
        }
      }
    } catch {
      // Permission errors, etc.
    }
  }

  walk(baseDir);
  return files;
}
