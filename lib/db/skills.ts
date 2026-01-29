/**
 * Skills CRUD operations
 */

import { getDb, now, type Skill } from './index';
import { generateSkillId } from '../utils/id';

export interface CreateSkillInput {
  name: string;
  category: string;
  description?: string;
  path: string;
}

export interface UpdateSkillInput {
  name?: string;
  category?: string;
  description?: string;
  path?: string;
  usage_count?: number;
  avg_cost?: number;
}

/**
 * Create or update a skill (upsert by path)
 */
export function upsertSkill(input: CreateSkillInput): Skill {
  const db = getDb();
  const existing = getSkillByPath(input.path);

  if (existing) {
    return updateSkill(existing.id, input) || existing;
  }

  const id = generateSkillId();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO skills (id, name, category, description, path, usage_count, avg_cost, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
  `);

  stmt.run(
    id,
    input.name,
    input.category,
    input.description || null,
    input.path,
    timestamp,
    timestamp
  );

  return getSkillById(id)!;
}

/**
 * Get a skill by ID
 */
export function getSkillById(id: string): Skill | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM skills WHERE id = ?');
  return stmt.get(id) as Skill | null;
}

/**
 * Get a skill by path
 */
export function getSkillByPath(path: string): Skill | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM skills WHERE path = ?');
  return stmt.get(path) as Skill | null;
}

/**
 * Get all skills
 */
export function getAllSkills(): Skill[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM skills ORDER BY category, name');
  return stmt.all() as Skill[];
}

/**
 * Get skills by category
 */
export function getSkillsByCategory(category: string): Skill[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM skills WHERE category = ? ORDER BY name');
  return stmt.all(category) as Skill[];
}

/**
 * Search skills by name or description
 */
export function searchSkills(query: string): Skill[] {
  const db = getDb();
  const pattern = `%${query}%`;
  const stmt = db.prepare(`
    SELECT * FROM skills
    WHERE name LIKE ? OR description LIKE ? OR category LIKE ?
    ORDER BY usage_count DESC, name
  `);
  return stmt.all(pattern, pattern, pattern) as Skill[];
}

/**
 * Update a skill
 */
export function updateSkill(id: string, input: UpdateSkillInput): Skill | null {
  const db = getDb();
  const existing = getSkillById(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.category !== undefined) {
    updates.push('category = ?');
    values.push(input.category);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description);
  }
  if (input.path !== undefined) {
    updates.push('path = ?');
    values.push(input.path);
  }
  if (input.usage_count !== undefined) {
    updates.push('usage_count = ?');
    values.push(input.usage_count);
  }
  if (input.avg_cost !== undefined) {
    updates.push('avg_cost = ?');
    values.push(input.avg_cost);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);

  const stmt = db.prepare(`
    UPDATE skills SET ${updates.join(', ')} WHERE id = ?
  `);
  stmt.run(...values);

  return getSkillById(id);
}

/**
 * Increment skill usage count
 */
export function incrementSkillUsage(id: string): Skill | null {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE skills SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?
  `);
  stmt.run(now(), id);
  return getSkillById(id);
}

/**
 * Delete a skill
 */
export function deleteSkill(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM skills WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Get skill categories
 */
export function getSkillCategories(): string[] {
  const db = getDb();
  const stmt = db.prepare('SELECT DISTINCT category FROM skills ORDER BY category');
  const results = stmt.all() as { category: string }[];
  return results.map((r) => r.category);
}

/**
 * Get skill count
 */
export function getSkillCount(): number {
  const db = getDb();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM skills');
  const result = stmt.get() as { count: number };
  return result.count;
}
