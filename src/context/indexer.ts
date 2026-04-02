/**
 * Project indexer — scans a codebase and builds a structured index.
 *
 * Runs on `mint init`. For each source file:
 * 1. Extract imports/requires
 * 2. Extract exported symbols (regex-based, not AST)
 * 3. Count lines of code
 * 4. Build the dependency graph
 *
 * Saves result to `.mint/context.json`.
 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, relative, extname, dirname, resolve } from 'node:path';
import { glob } from 'glob';
import ignore from 'ignore';
import { DependencyGraph } from './graph.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FileIndex {
  imports: string[];
  exports: string[];
  summary: string;
  loc: number;
  language: string;
}

export interface ProjectIndex {
  projectRoot: string;
  totalFiles: number;
  totalLOC: number;
  language: string;          // dominant language
  files: Record<string, FileIndex>;
  graph: Record<string, { imports: string[]; importedBy: string[] }>;
  indexedAt: string;
}

// ─── Source file patterns ────────────────────────────────────────────────────

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.scala',
  '.vue', '.svelte',
  '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.yaml', '.yml', '.toml', '.md',
]);

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.rb': 'ruby', '.php': 'php', '.c': 'c', '.cpp': 'cpp',
  '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp', '.swift': 'swift',
  '.kt': 'kotlin', '.scala': 'scala', '.vue': 'vue', '.svelte': 'svelte',
  '.html': 'html', '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.md': 'markdown',
};

const DEFAULT_IGNORES = [
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '__pycache__', '.venv', 'venv', 'target',
  '.mint', '.axon', '.claude',
  // Common vendored / reference directories
  'vendor', 'third_party', 'external',
];

// ─── Public API ──────────────────────────────────────────────────────────────

export interface IndexOptions {
  /** Called with progress updates. */
  onProgress?: (message: string) => void;
}

/**
 * Scan a project directory and build the full index.
 * Returns the index object and also saves it to `.mint/context.json`.
 */
export async function indexProject(cwd: string, options: IndexOptions = {}): Promise<ProjectIndex> {
  const { onProgress } = options;
  const ig = await loadIgnoreFilter(cwd);

  onProgress?.('Scanning files...');

  // Prefer git-tracked files (avoids indexing untracked reference dirs, vendor, etc.)
  // Fall back to glob if not a git repo.
  let allFiles: string[];
  try {
    const { execSync } = await import('node:child_process');
    // --cached: tracked files. --others --exclude-standard: untracked but not gitignored.
    // This catches both committed files and new files the user is working on.
    const gitOutput = execSync('git ls-files --cached --others --exclude-standard', {
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024, // 10MB — large repos
      stdio: ['pipe', 'pipe', 'pipe'], // suppress git's "fatal: not a git repository" stderr
    });
    allFiles = gitOutput.split('\n').filter(Boolean);
  } catch {
    allFiles = await glob('**/*', { cwd, nodir: true, absolute: false });
  }

  let sourceFiles = allFiles
    .filter(f => SOURCE_EXTENSIONS.has(extname(f)))
    .filter(f => !ig.ignores(f));

  // Auto-exclude top-level directories that dominate the file count
  // (likely vendored, reference, or generated code).
  if (sourceFiles.length > 200) {
    const dirCounts = new Map<string, number>();
    for (const f of sourceFiles) {
      const topDir = f.split('/')[0];
      dirCounts.set(topDir, (dirCounts.get(topDir) ?? 0) + 1);
    }
    const threshold = sourceFiles.length * 0.4;
    const excludeDirs = new Set<string>();
    for (const [dir, count] of dirCounts) {
      // Exclude dirs that aren't the main source (src/, lib/, app/) and are huge
      if (count > threshold && !['src', 'lib', 'app', 'packages'].includes(dir)) {
        excludeDirs.add(dir);
        onProgress?.(`Skipping ${dir}/ (${count} files — likely vendored/reference)`);
      }
    }
    if (excludeDirs.size > 0) {
      sourceFiles = sourceFiles.filter(f => !excludeDirs.has(f.split('/')[0]));
    }
  }

  onProgress?.(`Found ${sourceFiles.length} source files`);

  // Process each file
  const files: Record<string, FileIndex> = {};
  const graph = new DependencyGraph();
  const langCounts: Record<string, number> = {};
  let totalLOC = 0;

  for (let i = 0; i < sourceFiles.length; i++) {
    const filePath = sourceFiles[i];
    const ext = extname(filePath);
    const language = LANGUAGE_MAP[ext] ?? 'text';

    try {
      const content = await readFile(join(cwd, filePath), 'utf-8');
      const lines = content.split('\n');
      const loc = lines.filter(l => l.trim().length > 0).length;

      const imports = extractImports(content, filePath, language);
      const exports = extractExports(content, language);
      const summary = generateSummary(filePath, exports, loc, language);

      // Resolve import paths to actual files in the project
      const resolvedImports = imports
        .map(imp => resolveImportPath(imp, filePath, cwd, sourceFiles))
        .filter((p): p is string => p !== null);

      files[filePath] = { imports: resolvedImports, exports, summary, loc, language };
      graph.addFile(filePath, resolvedImports);

      totalLOC += loc;
      langCounts[language] = (langCounts[language] ?? 0) + loc;
    } catch {
      // Skip unreadable files
    }

    // Progress every 50 files
    if ((i + 1) % 50 === 0) {
      onProgress?.(`Indexed ${i + 1}/${sourceFiles.length} files`);
    }
  }

  // Determine dominant language
  const dominantLanguage = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  const index: ProjectIndex = {
    projectRoot: cwd,
    totalFiles: sourceFiles.length,
    totalLOC: totalLOC,
    language: dominantLanguage,
    files,
    graph: graph.toJSON(),
    indexedAt: new Date().toISOString(),
  };

  // Save to .mint/context.json
  const mintDir = join(cwd, '.mint');
  await mkdir(mintDir, { recursive: true });
  await writeFile(join(mintDir, 'context.json'), JSON.stringify(index, null, 2), 'utf-8');

  onProgress?.(`Done: ${sourceFiles.length} files, ${totalLOC.toLocaleString()} LOC, primary language: ${dominantLanguage}`);

  return index;
}

/**
 * Load a previously saved index from `.mint/context.json`.
 * Returns null if no index exists or it's stale.
 */
export async function loadIndex(cwd: string): Promise<ProjectIndex | null> {
  try {
    const content = await readFile(join(cwd, '.mint', 'context.json'), 'utf-8');
    return JSON.parse(content) as ProjectIndex;
  } catch {
    return null;
  }
}

/**
 * Check if the index is stale (older than the newest file modification).
 */
export async function isIndexStale(cwd: string): Promise<boolean> {
  const index = await loadIndex(cwd);
  if (!index) return true;

  const indexTime = new Date(index.indexedAt).getTime();
  const now = Date.now();

  // Consider stale if older than 1 hour
  if (now - indexTime > 3600_000) return true;

  // Spot-check: pick 5 random files and see if any are newer
  const paths = Object.keys(index.files);
  const sample = paths.sort(() => Math.random() - 0.5).slice(0, 5);

  for (const filePath of sample) {
    try {
      const s = await stat(join(cwd, filePath));
      if (s.mtimeMs > indexTime) return true;
    } catch {
      // File deleted — stale
      return true;
    }
  }

  return false;
}

// ─── Import extraction ──────────────────────────────────────────────────────

function extractImports(content: string, filePath: string, language: string): string[] {
  const imports: string[] = [];

  if (['typescript', 'javascript'].includes(language)) {
    // ES imports: import ... from 'path'
    const esImportRe = /(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = esImportRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
    // Dynamic imports: import('path')
    const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = dynamicRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
    // require()
    const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = requireRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
  } else if (language === 'python') {
    // from X import Y / import X
    const pyImportRe = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
    let m: RegExpExecArray | null;
    while ((m = pyImportRe.exec(content)) !== null) {
      imports.push(m[1] ?? m[2]);
    }
  } else if (language === 'go') {
    // import "path" or import ( "path" )
    const goImportRe = /import\s+(?:\(\s*([\s\S]*?)\s*\)|"([^"]+)")/g;
    let m: RegExpExecArray | null;
    while ((m = goImportRe.exec(content)) !== null) {
      if (m[2]) {
        imports.push(m[2]);
      } else if (m[1]) {
        const blockRe = /"([^"]+)"/g;
        let bm: RegExpExecArray | null;
        while ((bm = blockRe.exec(m[1])) !== null) {
          imports.push(bm[1]);
        }
      }
    }
  } else if (language === 'rust') {
    // use crate::path or use path
    const rustUseRe = /use\s+([\w:]+)/g;
    let m: RegExpExecArray | null;
    while ((m = rustUseRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
  } else if (language === 'java' || language === 'kotlin' || language === 'scala') {
    const javaImportRe = /import\s+([\w.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = javaImportRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
  }

  return imports;
}

// ─── Export extraction ──────────────────────────────────────────────────────

function extractExports(content: string, language: string): string[] {
  const exports: string[] = [];

  if (['typescript', 'javascript'].includes(language)) {
    // export function/const/class/type/interface/enum NAME
    const exportRe = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = exportRe.exec(content)) !== null) {
      exports.push(m[1]);
    }
    // export { name1, name2 }
    const namedExportRe = /export\s*\{([^}]+)\}/g;
    while ((m = namedExportRe.exec(content)) !== null) {
      const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim());
      exports.push(...names.filter(Boolean));
    }
    // export default (anonymous)
    if (/export\s+default\s+/.test(content) && !exports.includes('default')) {
      exports.push('default');
    }
  } else if (language === 'python') {
    // def name / class name / NAME = (module-level)
    const pyDefRe = /^(?:def|class)\s+(\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = pyDefRe.exec(content)) !== null) {
      exports.push(m[1]);
    }
    // __all__ = [...]
    const allRe = /__all__\s*=\s*\[([^\]]+)\]/;
    const allMatch = allRe.exec(content);
    if (allMatch) {
      const names = allMatch[1].match(/['"](\w+)['"]/g);
      if (names) {
        exports.push(...names.map(n => n.replace(/['"]/g, '')));
      }
    }
  } else if (language === 'go') {
    // Exported = starts with uppercase: func Name / type Name
    const goExportRe = /^(?:func|type|var|const)\s+([A-Z]\w*)/gm;
    let m: RegExpExecArray | null;
    while ((m = goExportRe.exec(content)) !== null) {
      exports.push(m[1]);
    }
  }

  return [...new Set(exports)];
}

// ─── Summary generation ─────────────────────────────────────────────────────

function generateSummary(filePath: string, exports: string[], loc: number, language: string): string {
  const fileName = filePath.split('/').pop() ?? filePath;
  const dir = dirname(filePath);

  // Infer purpose from path segments
  const pathParts = filePath.toLowerCase().split('/');
  const hints: string[] = [];

  if (pathParts.some(p => ['test', 'tests', '__tests__', 'spec'].includes(p))) hints.push('test');
  if (pathParts.some(p => ['util', 'utils', 'helpers', 'lib'].includes(p))) hints.push('utility');
  if (pathParts.some(p => ['api', 'routes', 'controllers', 'handlers'].includes(p))) hints.push('API');
  if (pathParts.some(p => ['components', 'views', 'pages'].includes(p))) hints.push('UI');
  if (pathParts.some(p => ['models', 'entities', 'schemas'].includes(p))) hints.push('data model');
  if (pathParts.some(p => ['services', 'providers'].includes(p))) hints.push('service');
  if (pathParts.some(p => ['config', 'settings'].includes(p))) hints.push('configuration');
  if (pathParts.some(p => ['middleware'].includes(p))) hints.push('middleware');
  if (pathParts.some(p => ['hooks'].includes(p))) hints.push('hook');
  if (pathParts.some(p => ['context'].includes(p))) hints.push('context');
  if (pathParts.some(p => ['agent', 'agents'].includes(p))) hints.push('agent');
  if (pathParts.some(p => ['tools'].includes(p))) hints.push('tool');
  if (fileName === 'index.ts' || fileName === 'index.js') hints.push('entry point');

  const typeHint = hints.length > 0 ? hints.join('/') + ' ' : '';
  const exportList = exports.slice(0, 5).join(', ');
  const moreExports = exports.length > 5 ? ` +${exports.length - 5} more` : '';

  return `${typeHint}${language} (${loc} LOC)${exportList ? ` — exports: ${exportList}${moreExports}` : ''}`;
}

// ─── Import resolution ──────────────────────────────────────────────────────

/**
 * Try to resolve a raw import string to an actual file in the project.
 * Returns null for external packages (node_modules, stdlib).
 */
function resolveImportPath(
  rawImport: string,
  fromFile: string,
  cwd: string,
  knownFiles: string[],
): string | null {
  // Skip external packages
  if (!rawImport.startsWith('.') && !rawImport.startsWith('/')) {
    return null;
  }

  const fromDir = dirname(fromFile);
  let resolved = join(fromDir, rawImport).replace(/\\/g, '/');

  // Strip .js/.ts extension variants for matching
  const stripped = resolved.replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, '');

  // Try exact match, then with extensions
  const candidates = [
    resolved,
    stripped + '.ts',
    stripped + '.tsx',
    stripped + '.js',
    stripped + '.jsx',
    stripped + '/index.ts',
    stripped + '/index.tsx',
    stripped + '/index.js',
  ];

  for (const candidate of candidates) {
    // Normalize: remove leading ./
    const normalized = candidate.replace(/^\.\//, '');
    if (knownFiles.includes(normalized)) {
      return normalized;
    }
  }

  return null;
}

// ─── Ignore filter ──────────────────────────────────────────────────────────

async function loadIgnoreFilter(cwd: string) {
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);
  try {
    const content = await readFile(join(cwd, '.gitignore'), 'utf-8');
    ig.add(content.split('\n').filter(l => l.trim() && !l.startsWith('#')));
  } catch { /* no .gitignore */ }
  return ig;
}
