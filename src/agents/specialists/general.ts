import type { SpecialistConfig } from './types.js';
import { BUILDER_PROMPT } from '../prompts/builder.js';

export const generalSpecialist: SpecialistConfig = {
  type: 'general',
  systemPrompt: BUILDER_PROMPT,
  allowedTools: [
    'read_file', 'write_file', 'edit_file', 'bash',
    'grep_files', 'find_files', 'list_dir', 'search_replace',
    'run_tests', 'git_diff', 'web_fetch',
  ],
  extraContextGlobs: [],
};
