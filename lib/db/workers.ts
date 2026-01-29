/**
 * Worker CRUD operations
 */

import { getDb, now, type Worker, type WorkerStatus, type PRDFeature, type WorkerProgress } from './index';
import { generateWorkerId } from '../utils/id';

export interface CreateWorkerInput {
  project_id: string;
  name: string;
  prd_slice?: PRDFeature[];
}

export interface UpdateWorkerInput {
  name?: string;
  status?: WorkerStatus;
  prd_slice?: PRDFeature[];
  progress?: WorkerProgress;
  cost?: number;
  started_at?: number;
}

/**
 * Create a new worker
 */
export function createWorker(input: CreateWorkerInput): Worker {
  const db = getDb();
  const id = generateWorkerId();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO workers (id, project_id, name, status, prd_slice, progress, cost, started_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, 0, NULL, ?)
  `);

  stmt.run(
    id,
    input.project_id,
    input.name,
    input.prd_slice ? JSON.stringify(input.prd_slice) : null,
    JSON.stringify({ completed: 0, total: input.prd_slice?.length || 0 }),
    timestamp
  );

  return getWorkerById(id)!;
}

/**
 * Get a worker by ID
 */
export function getWorkerById(id: string): Worker | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM workers WHERE id = ?');
  return stmt.get(id) as Worker | null;
}

/**
 * Get all workers for a project
 */
export function getWorkersByProject(projectId: string): Worker[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM workers WHERE project_id = ? ORDER BY updated_at DESC');
  return stmt.all(projectId) as Worker[];
}

/**
 * Get all active workers (running or paused)
 */
export function getActiveWorkers(): Worker[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM workers
    WHERE status IN ('running', 'paused')
    ORDER BY updated_at DESC
  `);
  return stmt.all() as Worker[];
}

/**
 * Get running workers
 */
export function getRunningWorkers(): Worker[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM workers WHERE status = ? ORDER BY updated_at DESC');
  return stmt.all('running') as Worker[];
}

/**
 * Update a worker
 */
export function updateWorker(id: string, input: UpdateWorkerInput): Worker | null {
  const db = getDb();
  const existing = getWorkerById(id);
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

    // If starting, set started_at
    if (input.status === 'running' && !existing.started_at) {
      updates.push('started_at = ?');
      values.push(now());
    }
  }
  if (input.prd_slice !== undefined) {
    updates.push('prd_slice = ?');
    values.push(JSON.stringify(input.prd_slice));
  }
  if (input.progress !== undefined) {
    updates.push('progress = ?');
    values.push(JSON.stringify(input.progress));
  }
  if (input.cost !== undefined) {
    updates.push('cost = ?');
    values.push(input.cost);
  }
  if (input.started_at !== undefined) {
    updates.push('started_at = ?');
    values.push(input.started_at);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);

  const stmt = db.prepare(`
    UPDATE workers SET ${updates.join(', ')} WHERE id = ?
  `);
  stmt.run(...values);

  return getWorkerById(id);
}

/**
 * Add cost to a worker
 */
export function addWorkerCost(id: string, amount: number): Worker | null {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE workers SET cost = cost + ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(amount, now(), id);
  return getWorkerById(id);
}

/**
 * Delete a worker
 */
export function deleteWorker(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM workers WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Parse worker progress from JSON string
 */
export function parseWorkerProgress(worker: Worker): WorkerProgress {
  if (!worker.progress) return { completed: 0, total: 0 };
  try {
    return JSON.parse(worker.progress) as WorkerProgress;
  } catch {
    return { completed: 0, total: 0 };
  }
}

/**
 * Parse worker PRD slice from JSON string
 */
export function parseWorkerPrdSlice(worker: Worker): PRDFeature[] {
  if (!worker.prd_slice) return [];
  try {
    return JSON.parse(worker.prd_slice) as PRDFeature[];
  } catch {
    return [];
  }
}

/**
 * Get total cost across all workers for a project
 */
export function getProjectTotalCost(projectId: string): number {
  const db = getDb();
  const stmt = db.prepare('SELECT SUM(cost) as total FROM workers WHERE project_id = ?');
  const result = stmt.get(projectId) as { total: number | null };
  return result.total || 0;
}
