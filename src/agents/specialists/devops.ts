import type { SpecialistConfig } from './types.js';

export const devopsSpecialist: SpecialistConfig = {
  type: 'devops',
  systemPrompt: 'You are a DevOps specialist. You write Dockerfiles, docker-compose configs, CI/CD pipelines (GitHub Actions, GitLab CI), nginx configs, deployment scripts. You understand environment variables, secrets management, and build optimization.',
  allowedTools: ['read_file', 'write_file', 'edit_file', 'bash'],
  extraContextGlobs: ['**/Dockerfile*', '**/.github/workflows/*', '**/docker-compose.*'],
};
