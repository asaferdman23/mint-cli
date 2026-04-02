import type { SpecialistType, SpecialistConfig } from './types.js';
import { frontendSpecialist } from './frontend.js';
import { backendSpecialist } from './backend.js';
import { databaseSpecialist } from './database.js';
import { testingSpecialist } from './testing.js';
import { devopsSpecialist } from './devops.js';
import { docsSpecialist } from './docs.js';
import { generalSpecialist } from './general.js';

export type { SpecialistType, SpecialistConfig };

const specialists: Record<SpecialistType, SpecialistConfig> = {
  frontend: frontendSpecialist,
  backend: backendSpecialist,
  database: databaseSpecialist,
  testing: testingSpecialist,
  devops: devopsSpecialist,
  docs: docsSpecialist,
  general: generalSpecialist,
};

/**
 * Get the specialist config for a given type.
 */
export function getSpecialist(type: SpecialistType): SpecialistConfig {
  return specialists[type] ?? specialists.general;
}

/**
 * Detect the most appropriate specialist based on file paths.
 * Uses first-match priority: frontend > backend > database > testing > devops > docs > general.
 */
export function detectSpecialist(files: string[]): SpecialistType {
  if (files.length === 0) return 'general';

  // Count matches per specialist
  let frontend = 0;
  let backend = 0;
  let database = 0;
  let testing = 0;
  let devops = 0;
  let docs = 0;

  for (const file of files) {
    const lower = file.toLowerCase();
    const parts = lower.split('/');

    // Frontend patterns
    if (
      lower.endsWith('.tsx') || lower.endsWith('.jsx') ||
      lower.endsWith('.vue') || lower.endsWith('.svelte') ||
      lower.endsWith('.css') || lower.endsWith('.scss') ||
      parts.some(p => p === 'components')
    ) {
      frontend++;
      continue;
    }

    // Backend patterns
    if (
      parts.some(p => ['routes', 'controllers', 'middleware', 'api'].includes(p)) ||
      lower.match(/^server\.\w+$/)
    ) {
      backend++;
      continue;
    }

    // Database patterns
    if (
      parts.some(p => ['migrations', 'drizzle'].includes(p)) ||
      lower.endsWith('.sql') ||
      lower.includes('schema.prisma')
    ) {
      database++;
      continue;
    }

    // Testing patterns
    if (
      lower.match(/\.test\.\w+$/) || lower.match(/\.spec\.\w+$/) ||
      parts.some(p => p === '__tests__')
    ) {
      testing++;
      continue;
    }

    // DevOps patterns
    if (
      lower.includes('dockerfile') ||
      parts.some(p => p === '.github') ||
      lower.match(/^docker-compose\./)
    ) {
      devops++;
      continue;
    }

    // Docs patterns
    if (
      lower.match(/^readme/i) || lower.match(/^changelog/i) ||
      parts.some(p => p === 'docs')
    ) {
      docs++;
      continue;
    }
  }

  // Return the type with highest count
  const counts: Array<[SpecialistType, number]> = [
    ['frontend', frontend],
    ['backend', backend],
    ['database', database],
    ['testing', testing],
    ['devops', devops],
    ['docs', docs],
  ];

  const best = counts.reduce((a, b) => a[1] >= b[1] ? a : b);
  return best[1] > 0 ? best[0] : 'general';
}
