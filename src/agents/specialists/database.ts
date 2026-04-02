import type { SpecialistConfig } from './types.js';

export const databaseSpecialist: SpecialistConfig = {
  type: 'database',
  systemPrompt: 'You are a database specialist. You write migrations, schema changes, queries, ORM code (Prisma, Drizzle, TypeORM, Sequelize, Knex). You understand relations, indexes, and data integrity. You NEVER write destructive migrations without explicit instruction. Always create new migration files, never edit existing ones.',
  allowedTools: ['read_file', 'write_file', 'edit_file', 'bash'],
  extraContextGlobs: ['**/prisma/schema.prisma', '**/drizzle.config.*', '**/knexfile.*'],
};
