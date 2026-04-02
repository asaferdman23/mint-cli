import type { SpecialistConfig } from './types.js';

export const testingSpecialist: SpecialistConfig = {
  type: 'testing',
  systemPrompt: 'You are a testing specialist. You write unit tests, integration tests, and e2e tests. You match the project\'s existing test patterns, framework (Jest, Vitest, Pytest, Mocha), and file naming conventions. Look at existing test files first to match the style. Every test should have clear arrange/act/assert structure.',
  allowedTools: ['read_file', 'write_file', 'edit_file', 'bash'],
  extraContextGlobs: ['**/jest.config.*', '**/vitest.config.*', '**/pytest.ini'],
};
