/**
 * Project CRUD operations
 */

import { getDb, now, type Project, type ProjectStatus, type PRD } from './index';
import { generateProjectId } from '../utils/id';

export interface CreateProjectInput {
  name: string;
  brief?: string;
  prd?: PRD;
}

export interface UpdateProjectInput {
  name?: string;
  status?: ProjectStatus;
  brief?: string;
  prd?: PRD;
}

/**
 * Create a new project
 */
export function createProject(input: CreateProjectInput): Project {
  const db = getDb();
  const id = generateProjectId();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO projects (id, name, status, brief, prd, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.name,
    input.brief || null,
    input.prd ? JSON.stringify(input.prd) : null,
    timestamp,
    timestamp
  );

  return getProjectById(id)!;
}

/**
 * Get a project by ID
 */
export function getProjectById(id: string): Project | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  return stmt.get(id) as Project | null;
}

/**
 * Get all projects
 */
export function getAllProjects(): Project[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
  return stmt.all() as Project[];
}

/**
 * Get projects by status
 */
export function getProjectsByStatus(status: ProjectStatus): Project[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC');
  return stmt.all(status) as Project[];
}

/**
 * Get active projects (not pending or completed)
 */
export function getActiveProjects(): Project[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM projects
    WHERE status IN ('briefing', 'active', 'paused')
    ORDER BY updated_at DESC
  `);
  return stmt.all() as Project[];
}

/**
 * Update a project
 */
export function updateProject(id: string, input: UpdateProjectInput): Project | null {
  const db = getDb();
  const existing = getProjectById(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.brief !== undefined) {
    updates.push('brief = ?');
    values.push(input.brief);
  }
  if (input.prd !== undefined) {
    updates.push('prd = ?');
    values.push(JSON.stringify(input.prd));
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);

  const stmt = db.prepare(`
    UPDATE projects SET ${updates.join(', ')} WHERE id = ?
  `);
  stmt.run(...values);

  return getProjectById(id);
}

/**
 * Delete a project (cascades to workers)
 */
export function deleteProject(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Parse project PRD from JSON string
 */
export function parseProjectPrd(project: Project): PRD | null {
  if (!project.prd) return null;
  try {
    return JSON.parse(project.prd) as PRD;
  } catch {
    return null;
  }
}
