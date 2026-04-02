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

  // Cap at ~2000 tokens (4 chars per token = 8000 chars)
  const maxChars = 8000;
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
