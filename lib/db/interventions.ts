/**
 * Interventions CRUD operations
 *
 * Interventions are user commands sent to workers to redirect their work.
 * Types: add_task, redirect, pause, priority_change
 */

import { getDb, now } from './index';
import { generateId } from '../utils/id';
import type { Intervention, InterventionActionType, InterventionStatus } from './schema';

// ============================================================================
// Create
// ============================================================================

export interface CreateInterventionInput {
  outcome_id: string;
  worker_id?: string;
  type: InterventionActionType;
  message: string;
  priority?: number;
}

export function createIntervention(input: CreateInterventionInput): Intervention {
  const db = getDb();
  const timestamp = now();
  const id = generateId('int');

  const stmt = db.prepare(`
    INSERT INTO interventions (
      id, outcome_id, worker_id, type, message, priority, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  stmt.run(
    id,
    input.outcome_id,
    input.worker_id || null,
    input.type,
    input.message,
    input.priority ?? 0,
    timestamp
  );

  return getInterventionById(id)!;
}

// ============================================================================
// Read
// ============================================================================

export function getInterventionById(id: string): Intervention | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM interventions WHERE id = ?').get(id) as Intervention | undefined;
  return row || null;
}

export function getInterventionsByOutcome(outcomeId: string, status?: InterventionStatus): Intervention[] {
  const db = getDb();

  if (status) {
    return db.prepare(`
      SELECT * FROM interventions
      WHERE outcome_id = ? AND status = ?
      ORDER BY priority DESC, created_at ASC
    `).all(outcomeId, status) as Intervention[];
  }

  return db.prepare(`
    SELECT * FROM interventions
    WHERE outcome_id = ?
    ORDER BY created_at DESC
  `).all(outcomeId) as Intervention[];
}

export function getInterventionsByWorker(workerId: string, status?: InterventionStatus): Intervention[] {
  const db = getDb();

  if (status) {
    return db.prepare(`
      SELECT * FROM interventions
      WHERE (worker_id = ? OR worker_id IS NULL) AND status = ?
      ORDER BY priority DESC, created_at ASC
    `).all(workerId, status) as Intervention[];
  }

  return db.prepare(`
    SELECT * FROM interventions
    WHERE worker_id = ? OR worker_id IS NULL
    ORDER BY created_at DESC
  `).all(workerId) as Intervention[];
}

export function getPendingInterventionsForWorker(workerId: string, outcomeId: string): Intervention[] {
  const db = getDb();

  // Get interventions for this specific worker OR any worker on this outcome
  return db.prepare(`
    SELECT * FROM interventions
    WHERE outcome_id = ?
      AND (worker_id = ? OR worker_id IS NULL)
      AND status = 'pending'
    ORDER BY priority DESC, created_at ASC
  `).all(outcomeId, workerId) as Intervention[];
}

// ============================================================================
// Update
// ============================================================================

export function acknowledgeIntervention(id: string): Intervention | null {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    UPDATE interventions
    SET status = 'acknowledged', acknowledged_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(timestamp, id);

  return getInterventionById(id);
}

export function completeIntervention(id: string): Intervention | null {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    UPDATE interventions
    SET status = 'completed', completed_at = ?
    WHERE id = ? AND status IN ('pending', 'acknowledged')
  `).run(timestamp, id);

  return getInterventionById(id);
}

export function dismissIntervention(id: string): Intervention | null {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    UPDATE interventions
    SET status = 'dismissed', completed_at = ?
    WHERE id = ?
  `).run(timestamp, id);

  return getInterventionById(id);
}

// ============================================================================
// Batch Operations
// ============================================================================

export function acknowledgeAllPendingForWorker(workerId: string, outcomeId: string): number {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE interventions
    SET status = 'acknowledged', acknowledged_at = ?
    WHERE outcome_id = ?
      AND (worker_id = ? OR worker_id IS NULL)
      AND status = 'pending'
  `).run(timestamp, outcomeId, workerId);

  return result.changes;
}

// ============================================================================
// Stats
// ============================================================================

export function getInterventionStats(outcomeId: string): {
  total: number;
  pending: number;
  acknowledged: number;
  completed: number;
  dismissed: number;
} {
  const db = getDb();

  const rows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM interventions
    WHERE outcome_id = ?
    GROUP BY status
  `).all(outcomeId) as { status: InterventionStatus; count: number }[];

  const stats = {
    total: 0,
    pending: 0,
    acknowledged: 0,
    completed: 0,
    dismissed: 0,
  };

  for (const row of rows) {
    stats[row.status] = row.count;
    stats.total += row.count;
  }

  return stats;
}
