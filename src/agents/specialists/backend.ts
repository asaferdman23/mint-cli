import type { SpecialistConfig } from './types.js';

export const backendSpecialist: SpecialistConfig = {
  type: 'backend',
  systemPrompt: 'You are a backend specialist. You write Node.js, Express, Fastify, NestJS, API routes, middleware, authentication, validation. You understand REST and GraphQL patterns, error handling, request validation. Never modify frontend components or CSS.',
  allowedTools: ['read_file', 'write_file', 'edit_file', 'grep_files', 'bash'],
  extraContextGlobs: ['**/package.json', '**/.env.example'],
};
