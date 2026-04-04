import type { SpecialistType, SpecialistConfig } from './types.js';
import { frontendSpecialist } from './frontend.js';
import { backendSpecialist } from './backend.js';
import { databaseSpecialist } from './database.js';
import { testingSpecialist } from './testing.js';
import { devopsSpecialist } from './devops.js';
import { docsSpecialist } from './docs.js';
import { generalSpecialist } from './general.js';
import { mobileSpecialist } from './mobile.js';
import { aiSpecialist } from './ai.js';
import { fullstackSpecialist } from './fullstack.js';
import { debuggingSpecialist } from './debugging.js';

export type { SpecialistType, SpecialistConfig };

const specialists: Record<SpecialistType, SpecialistConfig> = {
  frontend: frontendSpecialist,
  backend: backendSpecialist,
  database: databaseSpecialist,
  testing: testingSpecialist,
  devops: devopsSpecialist,
  docs: docsSpecialist,
  general: generalSpecialist,
  mobile: mobileSpecialist,
  ai: aiSpecialist,
  fullstack: fullstackSpecialist,
  debugging: debuggingSpecialist,
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

  const counts: Record<string, number> = {
    frontend: 0, backend: 0, database: 0, testing: 0,
    devops: 0, docs: 0, mobile: 0, ai: 0,
  };

  for (const file of files) {
    const lower = file.toLowerCase();
    const parts = lower.split('/');

    // Mobile patterns
    if (
      lower.endsWith('.swift') || lower.endsWith('.kt') || lower.endsWith('.dart') ||
      lower.includes('android') || lower.includes('ios') ||
      parts.some(p => ['screens', 'navigation'].includes(p)) ||
      lower.includes('app.json') || lower.includes('pubspec.yaml')
    ) {
      counts.mobile++;
      continue;
    }

    // AI/ML patterns
    if (
      parts.some(p => ['agents', 'prompts', 'embeddings', 'rag', 'llm', 'ai', 'ml'].includes(p)) ||
      lower.includes('openai') || lower.includes('anthropic') || lower.includes('langchain') ||
      lower.endsWith('.ipynb')
    ) {
      counts.ai++;
      continue;
    }

    // Frontend patterns
    if (
      lower.endsWith('.tsx') || lower.endsWith('.jsx') ||
      lower.endsWith('.vue') || lower.endsWith('.svelte') ||
      lower.endsWith('.css') || lower.endsWith('.scss') ||
      parts.some(p => p === 'components')
    ) {
      counts.frontend++;
      continue;
    }

    // Backend patterns
    if (
      parts.some(p => ['routes', 'controllers', 'middleware', 'api'].includes(p)) ||
      lower.match(/^server\.\w+$/)
    ) {
      counts.backend++;
      continue;
    }

    // Database patterns
    if (
      parts.some(p => ['migrations', 'drizzle'].includes(p)) ||
      lower.endsWith('.sql') ||
      lower.includes('schema.prisma')
    ) {
      counts.database++;
      continue;
    }

    // Testing patterns
    if (
      lower.match(/\.test\.\w+$/) || lower.match(/\.spec\.\w+$/) ||
      parts.some(p => p === '__tests__')
    ) {
      counts.testing++;
      continue;
    }

    // DevOps patterns
    if (
      lower.includes('dockerfile') ||
      parts.some(p => p === '.github') ||
      lower.match(/^docker-compose\./)
    ) {
      counts.devops++;
      continue;
    }

    // Docs patterns
    if (
      lower.match(/^readme/i) || lower.match(/^changelog/i) ||
      parts.some(p => p === 'docs')
    ) {
      counts.docs++;
      continue;
    }
  }

  // Return the type with highest count
  const ranked: Array<[SpecialistType, number]> = [
    ['mobile', counts.mobile],
    ['ai', counts.ai],
    ['frontend', counts.frontend],
    ['backend', counts.backend],
    ['database', counts.database],
    ['testing', counts.testing],
    ['devops', counts.devops],
    ['docs', counts.docs],
  ];

  const best = ranked.reduce((a, b) => a[1] >= b[1] ? a : b);
  return best[1] > 0 ? best[0] : 'general';
}

/**
 * Detect specialist from the TASK DESCRIPTION when no files are available.
 * Used for empty/new projects where file-based detection returns 'general'.
 */
export function detectSpecialistFromTask(task: string): SpecialistType {
  const lower = task.toLowerCase();

  // Frontend signals
  if (/\b(landing\s*page|website|homepage|web\s*app|frontend|react|next\.?js|vue|svelte|tailwind|css|ui|ux|dashboard|portfolio)\b/.test(lower)) {
    return 'frontend';
  }

  // Mobile signals
  if (/\b(mobile\s*app|android|ios|react\s*native|expo|flutter|swift|kotlin)\b/.test(lower)) {
    return 'mobile';
  }

  // AI signals — require multi-word context to avoid false positives from "AI" in content text
  if (/\b(ml\s+model|llm|gpt|claude|openai|anthropic|embedding|rag\s+pipeline|ai\s+agent|prompt\s+engineer|chatbot|fine.?tun)\b/.test(lower)
    || (/\bai\b/.test(lower) && /\b(model|train|inference|pipeline|vector|token)\b/.test(lower))) {
    return 'ai';
  }

  // Backend signals
  if (/\b(api|endpoint|server|backend|express|fastify|rest|graphql|middleware|auth|database|crud)\b/.test(lower)) {
    return 'backend';
  }

  // DevOps signals
  if (/\b(docker|ci.?cd|deploy|pipeline|kubernetes|k8s|github\s*action|nginx|terraform)\b/.test(lower)) {
    return 'devops';
  }

  // Debug signals
  if (/\b(fix|bug|debug|broken|crash|error|not\s*working|fails|issue)\b/.test(lower)) {
    return 'debugging';
  }

  return 'general';
}
