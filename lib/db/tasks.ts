/**
 * Tasks CRUD operations with atomic claiming
 *
 * Tasks are executable work items generated from PRD + Design Doc.
 * Atomic claiming uses SQLite IMMEDIATE transactions to prevent
 * race conditions when multiple workers try to claim tasks.
 */

import { getDb, now, transaction } from './index';
import { generateId } from '../utils/id';
import type { Task, TaskStatus } from './schema';
import { touchOutcome } from './outcomes';

// ============================================================================
// Create
// ============================================================================

export interface CreateTaskInput {
  outcome_id: string;
  title: string;
  description?: string;
  prd_context?: string;
  design_context?: string;
  priority?: number;
  from_review?: boolean;
  review_cycle?: number;
}

export function createTask(input: CreateTaskInput): Task {
  const db = getDb();
  const timestamp = now();
  const id = generateId('task');

  const stmt = db.prepare(`
    INSERT INTO tasks (
      id, outcome_id, title, description, prd_context, design_context,
      status, priority, score, attempts, max_attempts,
      from_review, review_cycle, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, 0, 3, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.outcome_id,
    input.title,
    input.description || null,
    input.prd_context || null,
    input.design_context || null,
    input.priority ?? 100,
    input.from_review ? 1 : 0,
    input.review_cycle ?? null,
    timestamp,
    timestamp
  );

  // Touch the outcome to update last_activity_at
  touchOutcome(input.outcome_id);

  return getTaskById(id)!;
}

export function createTasksBatch(inputs: CreateTaskInput[]): Task[] {
  return transaction(() => {
    return inputs.map(input => createTask(input));
  });
}

// ============================================================================
// Read
// ============================================================================

export function getTaskById(id: string): Task | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;

  if (!row) return null;

  return {
    ...row,
    from_review: Boolean(row.from_review),
  };
}

export function getTasksByOutcome(outcomeId: string): Task[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE outcome_id = ?
    ORDER BY priority ASC, score DESC
  `).all(outcomeId) as Task[];

  return rows.map(row => ({
    ...row,
    from_review: Boolean(row.from_review),
  }));
}

export function getPendingTasks(outcomeId: string): Task[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE outcome_id = ? AND status = 'pending'
    ORDER BY priority ASC, score DESC
  `).all(outcomeId) as Task[];

  return rows.map(row => ({
    ...row,
    from_review: Boolean(row.from_review),
  }));
}

export function getTasksByWorker(workerId: string): Task[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE claimed_by = ?
    ORDER BY claimed_at DESC
  `).all(workerId) as Task[];

  return rows.map(row => ({
    ...row,
    from_review: Boolean(row.from_review),
  }));
}

export function getActiveTaskForWorker(workerId: string): Task | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM tasks
    WHERE claimed_by = ? AND status IN ('claimed', 'running')
    ORDER BY claimed_at DESC
    LIMIT 1
  `).get(workerId) as Task | undefined;

  if (!row) return null;

  return {
    ...row,
    from_review: Boolean(row.from_review),
  };
}

// ============================================================================
// Atomic Task Claiming (Critical Section)
// ============================================================================

export interface ClaimResult {
  success: boolean;
  task: Task | null;
  reason?: string;
}

/**
 * Atomically claim a specific task for a worker.
 * Uses IMMEDIATE transaction to prevent race conditions.
 */
export function claimTask(taskId: string, workerId: string): ClaimResult {
  const db = getDb();
  const timestamp = now();

  try {
    // Use IMMEDIATE to acquire write lock immediately
    db.exec('BEGIN IMMEDIATE');

    // Check if task is still available
    const task = db.prepare(`
      SELECT * FROM tasks WHERE id = ? AND status = 'pending'
    `).get(taskId) as Task | undefined;

    if (!task) {
      db.exec('ROLLBACK');
      return {
        success: false,
        task: null,
        reason: 'Task not available (already claimed or does not exist)',
      };
    }

    // Claim the task
    db.prepare(`
      UPDATE tasks
      SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(workerId, timestamp, timestamp, taskId);

    // Update worker's current task
    db.prepare(`
      UPDATE workers
      SET current_task_id = ?, updated_at = ?
      WHERE id = ?
    `).run(taskId, timestamp, workerId);

    db.exec('COMMIT');

    // Touch outcome
    touchOutcome(task.outcome_id);

    return {
      success: true,
      task: getTaskById(taskId),
    };
  } catch (error) {
    db.exec('ROLLBACK');
    return {
      success: false,
      task: null,
      reason: `Database error: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}

/**
 * Atomically claim the next available task for a worker.
 * Finds the highest priority pending task and claims it.
 */
export function claimNextTask(outcomeId: string, workerId: string): ClaimResult {
  const db = getDb();
  const timestamp = now();

  try {
    db.exec('BEGIN IMMEDIATE');

    // Find the highest priority pending task
    const task = db.prepare(`
      SELECT * FROM tasks
      WHERE outcome_id = ? AND status = 'pending'
      ORDER BY priority ASC, score DESC
      LIMIT 1
    `).get(outcomeId) as Task | undefined;

    if (!task) {
      db.exec('ROLLBACK');
      return {
        success: false,
        task: null,
        reason: 'No pending tasks available',
      };
    }

    // Claim it
    db.prepare(`
      UPDATE tasks
      SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(workerId, timestamp, timestamp, task.id);

    // Update worker
    db.prepare(`
      UPDATE workers
      SET current_task_id = ?, updated_at = ?
      WHERE id = ?
    `).run(task.id, timestamp, workerId);

    db.exec('COMMIT');

    touchOutcome(outcomeId);

    return {
      success: true,
      task: getTaskById(task.id),
    };
  } catch (error) {
    db.exec('ROLLBACK');
    return {
      success: false,
      task: null,
      reason: `Database error: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}

// ============================================================================
// Task Status Transitions
// ============================================================================

export function startTask(taskId: string): Task | null {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE tasks
    SET status = 'running', attempts = attempts + 1, updated_at = ?
    WHERE id = ? AND status = 'claimed'
  `).run(timestamp, taskId);

  if (result.changes === 0) return null;

  const task = getTaskById(taskId);
  if (task) touchOutcome(task.outcome_id);
  return task;
}

export function completeTask(taskId: string): Task | null {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE tasks
    SET status = 'completed', completed_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(timestamp, timestamp, taskId);

  if (result.changes === 0) return null;

  const task = getTaskById(taskId);
  if (task) {
    // Clear worker's current task
    db.prepare(`
      UPDATE workers SET current_task_id = NULL, updated_at = ?
      WHERE current_task_id = ?
    `).run(timestamp, taskId);

    touchOutcome(task.outcome_id);
  }
  return task;
}

export function failTask(taskId: string): Task | null {
  const db = getDb();
  const timestamp = now();

  // Check if max attempts reached
  const task = getTaskById(taskId);
  if (!task) return null;

  if (task.attempts >= task.max_attempts) {
    // Mark as permanently failed
    db.prepare(`
      UPDATE tasks
      SET status = 'failed', updated_at = ?
      WHERE id = ?
    `).run(timestamp, taskId);
  } else {
    // Reset to pending for retry
    db.prepare(`
      UPDATE tasks
      SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(timestamp, taskId);
  }

  // Clear worker's current task
  db.prepare(`
    UPDATE workers SET current_task_id = NULL, updated_at = ?
    WHERE current_task_id = ?
  `).run(timestamp, taskId);

  touchOutcome(task.outcome_id);
  return getTaskById(taskId);
}

export function releaseTask(taskId: string): Task | null {
  const db = getDb();
  const timestamp = now();

  const task = getTaskById(taskId);
  if (!task) return null;

  db.prepare(`
    UPDATE tasks
    SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(timestamp, taskId);

  // Clear worker's current task
  db.prepare(`
    UPDATE workers SET current_task_id = NULL, updated_at = ?
    WHERE current_task_id = ?
  `).run(timestamp, taskId);

  touchOutcome(task.outcome_id);
  return getTaskById(taskId);
}

// ============================================================================
// Stale Claim Cleanup (Heartbeat-based)
// ============================================================================

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Release tasks claimed by workers that haven't sent a heartbeat recently.
 * Call this periodically (e.g., every 60 seconds).
 */
export function cleanupStaleClaims(): number {
  const db = getDb();
  const threshold = now() - STALE_THRESHOLD_MS;
  const timestamp = now();

  // Find tasks claimed by stale workers
  const result = db.prepare(`
    UPDATE tasks
    SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = ?
    WHERE status IN ('claimed', 'running')
    AND claimed_by IN (
      SELECT id FROM workers WHERE last_heartbeat < ? OR last_heartbeat IS NULL
    )
  `).run(timestamp, threshold);

  return result.changes;
}

// ============================================================================
// Update
// ============================================================================

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  prd_context?: string;
  design_context?: string;
  priority?: number;
  score?: number;
  max_attempts?: number;
}

export function updateTask(id: string, input: UpdateTaskInput): Task | null {
  const db = getDb();
  const timestamp = now();

  const updates: string[] = ['updated_at = ?'];
  const values: unknown[] = [timestamp];

  if (input.title !== undefined) {
    updates.push('title = ?');
    values.push(input.title);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description);
  }
  if (input.prd_context !== undefined) {
    updates.push('prd_context = ?');
    values.push(input.prd_context);
  }
  if (input.design_context !== undefined) {
    updates.push('design_context = ?');
    values.push(input.design_context);
  }
  if (input.priority !== undefined) {
    updates.push('priority = ?');
    values.push(input.priority);
  }
  if (input.score !== undefined) {
    updates.push('score = ?');
    values.push(input.score);
  }
  if (input.max_attempts !== undefined) {
    updates.push('max_attempts = ?');
    values.push(input.max_attempts);
  }

  values.push(id);

  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return getTaskById(id);
}

/**
 * Reprioritize tasks based on scores.
 * Called by the prioritizer agent to reorder the queue.
 */
export function reprioritizeTasks(
  outcomeId: string,
  priorities: { taskId: string; priority: number; score: number }[]
): void {
  const db = getDb();
  const timestamp = now();

  transaction(() => {
    const stmt = db.prepare(`
      UPDATE tasks SET priority = ?, score = ?, updated_at = ?
      WHERE id = ? AND outcome_id = ?
    `);

    for (const p of priorities) {
      stmt.run(p.priority, p.score, timestamp, p.taskId, outcomeId);
    }
  });

  touchOutcome(outcomeId);
}

// ============================================================================
// Delete
// ============================================================================

export function deleteTask(id: string): boolean {
  const db = getDb();
  const task = getTaskById(id);

  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);

  if (result.changes > 0 && task) {
    touchOutcome(task.outcome_id);
  }

  return result.changes > 0;
}

// ============================================================================
// Statistics
// ============================================================================

export interface TaskStats {
  total: number;
  pending: number;
  claimed: number;
  running: number;
  completed: number;
  failed: number;
  from_review: number;
}

export function getTaskStats(outcomeId: string): TaskStats {
  const db = getDb();

  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) as claimed,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN from_review = 1 THEN 1 ELSE 0 END) as from_review
    FROM tasks WHERE outcome_id = ?
  `).get(outcomeId) as TaskStats;

  return row;
}
