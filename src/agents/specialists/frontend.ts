import type { SpecialistConfig } from './types.js';

export const frontendSpecialist: SpecialistConfig = {
  type: 'frontend',
  systemPrompt: 'You are a frontend specialist. You write React, Next.js, Vue, Svelte, CSS, Tailwind. You understand component patterns, hooks, state management, client-side routing. You output clean JSX/TSX diffs. Never modify backend files.',
  allowedTools: ['read_file', 'write_file', 'edit_file', 'grep_files'],
  extraContextGlobs: ['**/package.json', '**/tsconfig.json', '**/tailwind.config.*'],
};
