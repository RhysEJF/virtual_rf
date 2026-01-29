/**
 * Workers CRUD operations
 *
 * Workers are Ralph instances that claim and execute tasks.
 * They send heartbeats to indicate they're still alive.
 */

import { getDb, now } from './index';
import { generateId } from '../utils/id';
import type { Worker, WorkerStatus } from './schema';
import { touchOutcome } from './outcomes';

// ============================================================================
// Create
// ============================================================================

export interface CreateWorkerInput {
  outcome_id: string;
  name: string;
}

export function createWorker(input: CreateWorkerInput): Worker {
  const db = getDb();
  const timestamp = now();
  const id = generateId('wrk');

  const stmt = db.prepare(`
    INSERT INTO workers (id, outcome_id, name, status, iteration, updated_at)
    VALUES (?, ?, ?, 'idle', 0, ?)
  `);

  stmt.run(id, input.outcome_id, input.name, timestamp);

  touchOutcome(input.outcome_id);

  return getWorkerById(id)!;
}

// ============================================================================
// Read
// ============================================================================

export function getWorkerById(id: string): Worker | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workers WHERE id = ?').get(id) as Worker | undefined;
  return row || null;
}

export function getWorkersByOutcome(outcomeId: string): Worker[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM workers WHERE outcome_id = ?
    ORDER BY started_at DESC
  `).all(outcomeId) as Worker[];
}

export function getActiveWorkers(): Worker[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM workers WHERE status = 'running'
    ORDER BY started_at DESC
  `).all() as Worker[];
}

export function getWorkersByStatus(status: WorkerStatus): Worker[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM workers WHERE status = ?
  `).all(status) as Worker[];
}

// ============================================================================
// Update
// ============================================================================

export interface UpdateWorkerInput {
  name?: string;
  status?: WorkerStatus;
  current_task_id?: string | null;
  iteration?: number;
  progress_summary?: string | null;
  cost?: number;
}

export function updateWorker(id: string, input: UpdateWorkerInput): Worker | null {
  const db = getDb();
  const timestamp = now();

  const updates: string[] = ['updated_at = ?'];
  const values: unknown[] = [timestamp];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.current_task_id !== undefined) {
    updates.push('current_task_id = ?');
    values.push(input.current_task_id);
  }
  if (input.iteration !== undefined) {
    updates.push('iteration = ?');
    values.push(input.iteration);
  }
  if (input.progress_summary !== undefined) {
    updates.push('progress_summary = ?');
    values.push(input.progress_summary);
  }
  if (input.cost !== undefined) {
    updates.push('cost = ?');
    values.push(input.cost);
  }

  values.push(id);

  db.prepare(`UPDATE workers SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const worker = getWorkerById(id);
  if (worker) touchOutcome(worker.outcome_id);
  return worker;
}

// ============================================================================
// Lifecycle
// ============================================================================

export function startWorker(id: string): Worker | null {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE workers
    SET status = 'running', started_at = ?, last_heartbeat = ?, updated_at = ?
    WHERE id = ? AND status = 'idle'
  `).run(timestamp, timestamp, timestamp, id);

  if (result.changes === 0) return null;

  const worker = getWorkerById(id);
  if (worker) touchOutcome(worker.outcome_id);
  return worker;
}

export function pauseWorker(id: string): Worker | null {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE workers SET status = 'paused', updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(timestamp, id);

  if (result.changes === 0) return null;

  const worker = getWorkerById(id);
  if (worker) touchOutcome(worker.outcome_id);
  return worker;
}

export function resumeWorker(id: string): Worker | null {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE workers SET status = 'running', last_heartbeat = ?, updated_at = ?
    WHERE id = ? AND status = 'paused'
  `).run(timestamp, timestamp, id);

  if (result.changes === 0) return null;

  const worker = getWorkerById(id);
  if (worker) touchOutcome(worker.outcome_id);
  return worker;
}

export function completeWorker(id: string): Worker | null {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE workers SET status = 'completed', current_task_id = NULL, updated_at = ?
    WHERE id = ?
  `).run(timestamp, id);

  if (result.changes === 0) return null;

  const worker = getWorkerById(id);
  if (worker) touchOutcome(worker.outcome_id);
  return worker;
}

export function failWorker(id: string): Worker | null {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE workers SET status = 'failed', current_task_id = NULL, updated_at = ?
    WHERE id = ?
  `).run(timestamp, id);

  if (result.changes === 0) return null;

  const worker = getWorkerById(id);
  if (worker) touchOutcome(worker.outcome_id);
  return worker;
}

// ============================================================================
// Heartbeat
// ============================================================================

export function sendHeartbeat(id: string): Worker | null {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE workers SET last_heartbeat = ?, updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(timestamp, timestamp, id);

  if (result.changes === 0) return null;
  return getWorkerById(id);
}

export function incrementIteration(id: string): Worker | null {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    UPDATE workers SET iteration = iteration + 1, last_heartbeat = ?, updated_at = ?
    WHERE id = ?
  `).run(timestamp, timestamp, id);

  return getWorkerById(id);
}

// ============================================================================
// Cost Tracking
// ============================================================================

export function addWorkerCost(id: string, amount: number): Worker | null {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    UPDATE workers SET cost = cost + ?, updated_at = ? WHERE id = ?
  `).run(amount, timestamp, id);

  return getWorkerById(id);
}

export function getOutcomeTotalCost(outcomeId: string): number {
  const db = getDb();
  const result = db.prepare(`
    SELECT SUM(cost) as total FROM workers WHERE outcome_id = ?
  `).get(outcomeId) as { total: number | null };
  return result.total || 0;
}

// ============================================================================
// Delete
// ============================================================================

export function deleteWorker(id: string): boolean {
  const db = getDb();
  const worker = getWorkerById(id);

  const result = db.prepare('DELETE FROM workers WHERE id = ?').run(id);

  if (result.changes > 0 && worker) {
    touchOutcome(worker.outcome_id);
  }

  return result.changes > 0;
}

// ============================================================================
// Stale Detection
// ============================================================================

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export function getStaleWorkers(): Worker[] {
  const db = getDb();
  const threshold = now() - STALE_THRESHOLD_MS;

  return db.prepare(`
    SELECT * FROM workers
    WHERE status = 'running'
    AND (last_heartbeat < ? OR last_heartbeat IS NULL)
  `).all(threshold) as Worker[];
}

export function markStaleWorkersFailed(): number {
  const db = getDb();
  const timestamp = now();
  const threshold = timestamp - STALE_THRESHOLD_MS;

  const result = db.prepare(`
    UPDATE workers
    SET status = 'failed', updated_at = ?
    WHERE status = 'running'
    AND (last_heartbeat < ? OR last_heartbeat IS NULL)
  `).run(timestamp, threshold);

  return result.changes;
}

// ============================================================================
// Legacy Functions (for backwards compatibility)
// ============================================================================

/**
 * @deprecated Use getWorkersByOutcome instead
 */
export function getWorkersByProject(projectId: string): Worker[] {
  return getWorkersByOutcome(projectId);
}
