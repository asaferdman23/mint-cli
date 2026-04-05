/**
 * Skills system — loads project-specific conventions from .mint/skills/*.md
 *
 * Skills are markdown files with optional YAML frontmatter that specify
 * which specialist types they apply to. Skills without frontmatter apply to all.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { SpecialistType } from '../agents/specialists/types.js';

export interface Skill {
  name: string;
  content: string;
  appliesTo: SpecialistType[] | 'all';
}

/**
 * Load all .md skill files from {projectRoot}/.mint/skills/
 */
export function loadSkills(projectRoot: string): Skill[] {
  const skillsDir = join(projectRoot, '.mint', 'skills');

  let files: string[];
  try {
    files = readdirSync(skillsDir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }

  const skills: Skill[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(skillsDir, file), 'utf-8');
      const name = basename(file, '.md');
      const { frontmatter, content } = parseFrontmatter(raw);

      let appliesTo: SpecialistType[] | 'all' = 'all';
      if (frontmatter.applies_to && Array.isArray(frontmatter.applies_to)) {
        appliesTo = frontmatter.applies_to as SpecialistType[];
      }

      skills.push({ name, content, appliesTo });
    } catch {
      // Skip unreadable files
    }
  }

  return skills;
}

/**
 * Filter skills for a specific specialist type.
 * Returns skills where appliesTo is 'all' or includes the specialist type.
 * Caps total content at ~2000 tokens (8000 chars).
 */
export function getSkillsForSpecialist(skills: Skill[], specialist: SpecialistType): Skill[] {
  const matching = skills.filter(s =>
    s.appliesTo === 'all' || s.appliesTo.includes(specialist)
  );

  // Cap at ~4000 tokens (4 chars per token = 16000 chars)
  const maxChars = 16000;
  let totalChars = 0;
  const capped: Skill[] = [];

  for (const skill of matching) {
    if (totalChars + skill.content.length > maxChars) break;
    capped.push(skill);
    totalChars += skill.content.length;
  }

  return capped;
}

/**
 * Format all loaded skills into a prompt block for the orchestrator.
 * Caps total content at ~6000 tokens (24K chars). Skills contain production-quality
 * reference code that the reviewer uses as the quality bar, so we need enough budget
 * for 3-4 rich skills. Grok 4.1 has 131K context — this is ~5% of it.
 */
export function formatSkillsForPrompt(projectRoot: string): string {
  const skills = loadSkills(projectRoot);
  if (skills.length === 0) return '';

  const maxChars = 24_000; // ~6000 tokens
  let totalChars = 0;
  const parts: string[] = [];

  for (const skill of skills) {
    const block = `## ${skill.name}\n${skill.content}`;
    if (totalChars + block.length > maxChars) break;
    parts.push(block);
    totalChars += block.length;
  }

  if (parts.length === 0) return '';
  return `\n\n<project_conventions>\nProject conventions (follow these when writing code):\n\n${parts.join('\n\n')}\n</project_conventions>`;
}

/**
 * Parse simple YAML frontmatter from a markdown file.
 * Handles the `---` delimited block at the top.
 */
function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; content: string } {
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, content: raw };
  }

  const endIndex = raw.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, content: raw };
  }

  const yamlBlock = raw.slice(3, endIndex).trim();
  const content = raw.slice(endIndex + 3).trim();

  // Simple YAML parser for our use case: `key: value` and `key: [a, b]`
  const frontmatter: Record<string, unknown> = {};
  for (const line of yamlBlock.split('\n')) {
    const match = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    let value: unknown = match[2].trim();

    // Parse array: [a, b, c]
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, content };
}
