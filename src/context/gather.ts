import { readFile, readdir, stat } from 'fs/promises';
import { join, relative, extname } from 'path';
import { glob } from 'glob';
import ignore from 'ignore';

export interface ContextFile {
  path: string;
  content: string;
  language: string;
  tokens: number; // estimated
}

export interface Context {
  files: ContextFile[];
  totalTokens: number;
  summary: string;
}

// Language detection by extension
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

// Patterns to always ignore
const DEFAULT_IGNORES = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  '.nuxt/**',
  'coverage/**',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.env*',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.d.ts',
  '__pycache__/**',
  '*.pyc',
  '.venv/**',
  'venv/**',
  'target/**',
  '*.exe',
  '*.dll',
  '*.so',
  '*.dylib',
];

// Rough estimate: ~4 chars per token for code
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

async function loadGitignore(dir: string): Promise<ReturnType<typeof ignore>> {
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);

  try {
    const gitignorePath = join(dir, '.gitignore');
    const content = await readFile(gitignorePath, 'utf-8');
    ig.add(content.split('\n').filter(line => line.trim() && !line.startsWith('#')));
  } catch {
    // No .gitignore, use defaults only
  }

  return ig;
}

export async function gatherContext(
  cwd: string,
  options: {
    maxTokens?: number;
    patterns?: string[];
    relevantTo?: string; // prompt to use for relevance scoring
  } = {}
): Promise<Context> {
  const { maxTokens = 100000, patterns = ['**/*.{ts,tsx,js,jsx,py,go,rs,java,rb}'] } = options;

  const ig = await loadGitignore(cwd);
  const files: ContextFile[] = [];
  let totalTokens = 0;

  // Find all matching files
  const matches = await glob(patterns, {
    cwd,
    nodir: true,
    absolute: false,
  });

  // Filter out ignored files
  const validFiles = matches.filter(f => !ig.ignores(f));

  // Sort by likely relevance (shorter paths first, common entry points priority)
  const priorityFiles = ['index', 'main', 'app', 'server', 'lib', 'src'];
  validFiles.sort((a, b) => {
    const aHasPriority = priorityFiles.some(p => a.toLowerCase().includes(p));
    const bHasPriority = priorityFiles.some(p => b.toLowerCase().includes(p));
    if (aHasPriority && !bHasPriority) return -1;
    if (!aHasPriority && bHasPriority) return 1;
    return a.split('/').length - b.split('/').length;
  });

  // Read files until we hit token limit
  for (const filePath of validFiles) {
    if (totalTokens >= maxTokens) break;

    try {
      const fullPath = join(cwd, filePath);
      const content = await readFile(fullPath, 'utf-8');
      const tokens = estimateTokens(content);

      // Skip if adding this file would exceed limit
      if (totalTokens + tokens > maxTokens) {
        continue;
      }

      const ext = extname(filePath);
      const language = LANGUAGE_MAP[ext] || 'text';

      files.push({
        path: filePath,
        content,
        language,
        tokens,
      });

      totalTokens += tokens;
    } catch {
      // Skip unreadable files
    }
  }

  return {
    files,
    totalTokens,
    summary: `Gathered ${files.length} files (${totalTokens.toLocaleString()} tokens)`,
  };
}

export function formatContextForPrompt(context: Context): string {
  if (context.files.length === 0) {
    return '';
  }

  let formatted = '<context>\n';

  for (const file of context.files) {
    formatted += `<file path="${file.path}" language="${file.language}">\n`;
    formatted += file.content;
    formatted += '\n</file>\n\n';
  }

  formatted += '</context>';
  return formatted;
}

export function getContextSummary(context: Context): string {
  const byLanguage = new Map<string, number>();
  
  for (const file of context.files) {
    byLanguage.set(file.language, (byLanguage.get(file.language) || 0) + 1);
  }

  const langSummary = Array.from(byLanguage.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => `${lang}: ${count}`)
    .join(', ');

  return `${context.files.length} files | ${context.totalTokens.toLocaleString()} tokens | ${langSummary}`;
}
