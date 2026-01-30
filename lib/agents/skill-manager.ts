/**
 * Skill Manager
 *
 * Manages the skill library - skills are reusable instruction files (SKILL.md)
 * that can be loaded into Ralph's context for specific tasks.
 *
 * Skills are stored in the `skills/` directory with this structure:
 * skills/
 *   category/
 *     skill-name/
 *       SKILL.md
 *
 * SKILL.md format:
 * ---
 * name: Skill Name
 * description: What this skill does
 * triggers: [keywords that suggest this skill is needed]
 * ---
 *
 * # Skill Instructions
 * (The actual instructions to inject into context)
 */

import * as fs from 'fs';
import * as path from 'path';
import { upsertSkill, getAllSkills, searchSkills, incrementSkillUsage, getSkillById } from '../db/skills';
import type { Skill } from '../db/schema';

interface SkillMetadata {
  name: string;
  description: string;
  triggers: string[];
  requires: string[];
  category: string;
  path: string;
  content: string;
}

interface ParsedSkillFile {
  metadata: {
    name?: string;
    description?: string;
    triggers?: string[];
    requires?: string[];
  };
  content: string;
}

const SKILLS_DIR = path.join(process.cwd(), 'skills');

/**
 * Parse a SKILL.md file
 */
function parseSkillFile(filePath: string): ParsedSkillFile | null {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    // Check for YAML frontmatter
    const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (frontmatterMatch) {
      const [, frontmatter, content] = frontmatterMatch;

      // Parse simple YAML frontmatter
      const metadata: ParsedSkillFile['metadata'] = {};

      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) metadata.name = nameMatch[1].trim();

      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch) metadata.description = descMatch[1].trim();

      const triggersMatch = frontmatter.match(/^triggers:\s*\[(.*)\]$/m);
      if (triggersMatch) {
        metadata.triggers = triggersMatch[1]
          .split(',')
          .map(t => t.trim().replace(/['"]/g, ''))
          .filter(t => t.length > 0);
      }

      const requiresMatch = frontmatter.match(/^requires:\s*\[(.*)\]$/m);
      if (requiresMatch) {
        metadata.requires = requiresMatch[1]
          .split(',')
          .map(t => t.trim().replace(/['"]/g, ''))
          .filter(t => t.length > 0);
      }

      return { metadata, content: content.trim() };
    }

    // No frontmatter - use full content
    return { metadata: {}, content: fileContent.trim() };
  } catch (error) {
    console.error(`[SkillManager] Failed to parse skill file ${filePath}:`, error);
    return null;
  }
}

/**
 * Scan the skills directory and load all skills
 */
export function loadSkills(): SkillMetadata[] {
  const skills: SkillMetadata[] = [];

  if (!fs.existsSync(SKILLS_DIR)) {
    console.log('[SkillManager] Skills directory not found, creating...');
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    return skills;
  }

  // Scan category directories
  const categories = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const category of categories) {
    const categoryPath = path.join(SKILLS_DIR, category);

    // Scan skill directories within category
    const skillDirs = fs.readdirSync(categoryPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const skillDir of skillDirs) {
      const skillFilePath = path.join(categoryPath, skillDir, 'SKILL.md');

      if (!fs.existsSync(skillFilePath)) {
        continue;
      }

      const parsed = parseSkillFile(skillFilePath);
      if (!parsed) continue;

      const skill: SkillMetadata = {
        name: parsed.metadata.name || skillDir.replace(/-/g, ' '),
        description: parsed.metadata.description || '',
        triggers: parsed.metadata.triggers || [],
        requires: parsed.metadata.requires || [],
        category,
        path: skillFilePath,
        content: parsed.content,
      };

      skills.push(skill);
    }
  }

  return skills;
}

/**
 * Sync skills from filesystem to database
 */
export function syncSkillsToDatabase(): { loaded: number; updated: number } {
  const skills = loadSkills();
  let loaded = 0;
  let updated = 0;

  for (const skill of skills) {
    const existing = searchSkills(skill.name).find(s => s.path === skill.path);

    upsertSkill({
      name: skill.name,
      category: skill.category,
      description: skill.description,
      path: skill.path,
      requires: skill.requires,
    });

    if (existing) {
      updated++;
    } else {
      loaded++;
    }
  }

  console.log(`[SkillManager] Synced skills: ${loaded} loaded, ${updated} updated`);
  return { loaded, updated };
}

/**
 * Find skills relevant to a task or query
 */
export function findRelevantSkills(query: string, limit: number = 3): Skill[] {
  // First, search the database
  const dbResults = searchSkills(query);

  // Also check against loaded skill triggers
  const loaded = loadSkills();
  const queryLower = query.toLowerCase();

  const triggerMatches = loaded.filter(skill =>
    skill.triggers.some(trigger =>
      queryLower.includes(trigger.toLowerCase())
    )
  );

  // Combine and deduplicate
  const combined = new Map<string, Skill>();

  // Add trigger matches first (higher priority)
  for (const skill of triggerMatches) {
    const dbSkill = dbResults.find(s => s.path === skill.path);
    if (dbSkill) {
      combined.set(dbSkill.id, dbSkill);
    }
  }

  // Add remaining DB results
  for (const skill of dbResults) {
    if (!combined.has(skill.id)) {
      combined.set(skill.id, skill);
    }
  }

  return Array.from(combined.values()).slice(0, limit);
}

/**
 * Get the content of a skill by ID
 */
export function getSkillContent(skillId: string): string | null {
  const skill = getSkillById(skillId);
  if (!skill) return null;

  const parsed = parseSkillFile(skill.path);
  return parsed?.content || null;
}

/**
 * Build context string from relevant skills
 */
export function buildSkillContext(query: string, maxSkills: number = 3): string {
  const skills = findRelevantSkills(query, maxSkills);

  if (skills.length === 0) {
    return '';
  }

  const parts: string[] = ['## Relevant Skills\n'];

  for (const skill of skills) {
    const content = getSkillContent(skill.id);
    if (content) {
      parts.push(`### ${skill.name}`);
      parts.push(`Category: ${skill.category}`);
      if (skill.description) parts.push(`Description: ${skill.description}`);
      parts.push('');
      parts.push(content);
      parts.push('');

      // Track usage
      incrementSkillUsage(skill.id);
    }
  }

  return parts.join('\n');
}

/**
 * Get all available skills grouped by category
 */
export function getSkillsByCategory(): Record<string, Skill[]> {
  const skills = getAllSkills();
  const grouped: Record<string, Skill[]> = {};

  for (const skill of skills) {
    if (!grouped[skill.category]) {
      grouped[skill.category] = [];
    }
    grouped[skill.category].push(skill);
  }

  return grouped;
}

/**
 * Detect skill gaps - what skills might be needed but don't exist
 */
export function detectSkillGaps(requirements: string[]): string[] {
  const allSkills = getAllSkills();
  const gaps: string[] = [];

  for (const req of requirements) {
    const reqLower = req.toLowerCase();
    const hasMatch = allSkills.some(skill =>
      skill.name.toLowerCase().includes(reqLower) ||
      skill.description?.toLowerCase().includes(reqLower) ||
      skill.category.toLowerCase().includes(reqLower)
    );

    if (!hasMatch) {
      gaps.push(req);
    }
  }

  return gaps;
}

/**
 * Create a new skill from a template
 */
export function createSkillTemplate(
  category: string,
  name: string,
  description: string
): string {
  const skillDir = path.join(SKILLS_DIR, category, name.toLowerCase().replace(/\s+/g, '-'));

  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  const skillFile = path.join(skillDir, 'SKILL.md');

  const content = `---
name: ${name}
description: ${description}
triggers: []
---

# ${name}

## Purpose
${description}

## Instructions
Add instructions here for how to use this skill.

## Example
Add examples of using this skill.
`;

  fs.writeFileSync(skillFile, content, 'utf-8');
  return skillFile;
}

/**
 * Get skill statistics
 */
export function getSkillStats(): {
  totalSkills: number;
  categories: number;
  topUsed: Skill[];
} {
  const skills = getAllSkills();
  const categories = new Set(skills.map(s => s.category));

  const topUsed = [...skills]
    .sort((a, b) => b.usage_count - a.usage_count)
    .slice(0, 5);

  return {
    totalSkills: skills.length,
    categories: categories.size,
    topUsed,
  };
}
