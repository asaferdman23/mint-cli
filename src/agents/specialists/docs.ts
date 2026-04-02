import type { SpecialistConfig } from './types.js';

export const docsSpecialist: SpecialistConfig = {
  type: 'docs',
  systemPrompt: 'You are a documentation specialist. You write README files, API documentation, JSDoc/TSDoc comments, changelog entries, and inline code comments. You match the project\'s existing documentation style and tone.',
  allowedTools: ['read_file', 'write_file', 'edit_file'],
  extraContextGlobs: ['**/README.md', '**/CHANGELOG.md', '**/docs/**'],
};
