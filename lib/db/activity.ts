/**
 * Activity Log CRUD operations
 *
 * Tracks events for the activity feed (task completions, reviews, etc.)
 */

import { getDb, now } from './index';
import type { Activity, ActivityType } from './schema';

// ============================================================================
// Create
// ============================================================================

export interface CreateActivityInput {
  outcome_id: string;
  outcome_name?: string;
  type: ActivityType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export function createActivity(input: CreateActivityInput): Activity {
  const db = getDb();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO activity_log (outcome_id, outcome_name, type, title, description, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.outcome_id,
    input.outcome_name || null,
    input.type,
    input.title,
    input.description || null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    timestamp
  );

  return getActivityById(Number(result.lastInsertRowid))!;
}

// ============================================================================
// Read
// ============================================================================

export function getActivityById(id: number): Activity | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM activity_log WHERE id = ?').get(id) as Activity | undefined;
  return row || null;
}

export function getRecentActivity(limit: number = 20, offset: number = 0): Activity[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM activity_log
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Activity[];
}

export function getActivityByOutcome(outcomeId: string, limit: number = 50): Activity[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM activity_log
    WHERE outcome_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(outcomeId, limit) as Activity[];
}

export function getActivityByType(type: ActivityType, limit: number = 20): Activity[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM activity_log
    WHERE type = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(type, limit) as Activity[];
}

export function getActivitySince(sinceTimestamp: number, limit: number = 100): Activity[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM activity_log
    WHERE created_at > ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(sinceTimestamp, limit) as Activity[];
}

// ============================================================================
// Helper Functions for Logging Events
// ============================================================================

export function logTaskCompleted(
  outcomeId: string,
  outcomeName: string,
  taskTitle: string,
  workerId?: string
): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'task_completed',
    title: `Task completed: ${taskTitle}`,
    metadata: workerId ? { worker_id: workerId } : undefined,
  });
}

export function logTaskClaimed(
  outcomeId: string,
  outcomeName: string,
  taskTitle: string,
  workerName: string
): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'task_claimed',
    title: `${workerName} claimed: ${taskTitle}`,
  });
}

export function logTaskFailed(
  outcomeId: string,
  outcomeName: string,
  taskTitle: string,
  reason?: string
): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'task_failed',
    title: `Task failed: ${taskTitle}`,
    description: reason,
  });
}

export function logWorkerStarted(
  outcomeId: string,
  outcomeName: string,
  workerName: string,
  workerId: string
): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'worker_started',
    title: `${workerName} started`,
    metadata: { worker_id: workerId },
  });
}

export function logWorkerCompleted(
  outcomeId: string,
  outcomeName: string,
  workerName: string,
  tasksCompleted: number
): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'worker_completed',
    title: `${workerName} finished`,
    description: `Completed ${tasksCompleted} task${tasksCompleted !== 1 ? 's' : ''}`,
  });
}

export function logWorkerFailed(
  outcomeId: string,
  outcomeName: string,
  workerName: string,
  reason?: string
): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'worker_failed',
    title: `${workerName} failed`,
    description: reason,
  });
}

export function logReviewCompleted(
  outcomeId: string,
  outcomeName: string,
  issuesFound: number,
  tasksAdded: number
): Activity {
  const description = issuesFound === 0
    ? 'No issues found'
    : `${issuesFound} issue${issuesFound !== 1 ? 's' : ''} found, ${tasksAdded} task${tasksAdded !== 1 ? 's' : ''} added`;

  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'review_completed',
    title: 'Review cycle completed',
    description,
    metadata: { issues_found: issuesFound, tasks_added: tasksAdded },
  });
}

export function logOutcomeCreated(outcomeId: string, outcomeName: string): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'outcome_created',
    title: `Outcome created: ${outcomeName}`,
  });
}

export function logOutcomeAchieved(outcomeId: string, outcomeName: string): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'outcome_achieved',
    title: `Outcome achieved: ${outcomeName}`,
  });
}

export function logDesignUpdated(
  outcomeId: string,
  outcomeName: string,
  version: number,
  changeDescription?: string
): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'design_updated',
    title: `Design doc updated to v${version}`,
    description: changeDescription,
  });
}

export function logIntentUpdated(
  outcomeId: string,
  outcomeName: string,
  changeDescription?: string
): Activity {
  return createActivity({
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    type: 'intent_updated',
    title: 'Intent (PRD) updated',
    description: changeDescription,
  });
}

// ============================================================================
// Delete (for cleanup)
// ============================================================================

export function deleteOldActivity(olderThanDays: number = 30): number {
  const db = getDb();
  const cutoff = now() - olderThanDays * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM activity_log WHERE created_at < ?').run(cutoff);
  return result.changes;
}

export function deleteActivityByOutcome(outcomeId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM activity_log WHERE outcome_id = ?').run(outcomeId);
  return result.changes;
}
