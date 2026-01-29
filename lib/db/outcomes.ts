/**
 * Outcomes CRUD operations
 *
 * Outcomes are the primary organizational unit - high-level goals
 * that replace the old "projects" concept.
 */

import { getDb, now } from './index';
import { generateId } from '../utils/id';
import type {
  Outcome,
  OutcomeStatus,
  OutcomeWithRelations,
  DesignDoc,
  Collaborator,
  Task,
  Worker,
  ReviewCycle,
} from './schema';

// ============================================================================
// Create
// ============================================================================

export interface CreateOutcomeInput {
  name: string;
  brief?: string;
  intent?: string;
  timeline?: string;
  is_ongoing?: boolean;
}

export function createOutcome(input: CreateOutcomeInput): Outcome {
  const db = getDb();
  const timestamp = now();
  const id = generateId('out');

  const stmt = db.prepare(`
    INSERT INTO outcomes (id, name, status, is_ongoing, brief, intent, timeline, created_at, updated_at, last_activity_at)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.name,
    input.is_ongoing ? 1 : 0,
    input.brief || null,
    input.intent || null,
    input.timeline || null,
    timestamp,
    timestamp,
    timestamp
  );

  return getOutcomeById(id)!;
}

// ============================================================================
// Read
// ============================================================================

export function getOutcomeById(id: string): Outcome | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM outcomes WHERE id = ?').get(id) as Outcome | undefined;

  if (!row) return null;

  return {
    ...row,
    is_ongoing: Boolean(row.is_ongoing),
  };
}

export function getOutcomeWithRelations(id: string): OutcomeWithRelations | null {
  const outcome = getOutcomeById(id);
  if (!outcome) return null;

  const db = getDb();

  // Get design doc (latest version)
  const designDoc = db.prepare(`
    SELECT * FROM design_docs
    WHERE outcome_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(id) as DesignDoc | undefined;

  // Get collaborators
  const collaborators = db.prepare(`
    SELECT * FROM collaborators WHERE outcome_id = ?
  `).all(id) as Collaborator[];

  // Get tasks
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE outcome_id = ?
    ORDER BY priority ASC, score DESC
  `).all(id) as Task[];

  // Get workers
  const workers = db.prepare(`
    SELECT * FROM workers WHERE outcome_id = ?
  `).all(id) as Worker[];

  // Get review cycles
  const reviewCycles = db.prepare(`
    SELECT * FROM review_cycles
    WHERE outcome_id = ?
    ORDER BY cycle_number DESC
  `).all(id) as ReviewCycle[];

  // Calculate counts
  const activeTaskCount = tasks.filter(t =>
    t.status === 'pending' || t.status === 'claimed' || t.status === 'running'
  ).length;
  const completedTaskCount = tasks.filter(t => t.status === 'completed').length;

  return {
    ...outcome,
    design_doc: designDoc || null,
    collaborators,
    tasks,
    workers,
    active_task_count: activeTaskCount,
    completed_task_count: completedTaskCount,
    review_cycles: reviewCycles,
  };
}

export function getAllOutcomes(): Outcome[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM outcomes
    ORDER BY last_activity_at DESC
  `).all() as Outcome[];

  return rows.map(row => ({
    ...row,
    is_ongoing: Boolean(row.is_ongoing),
  }));
}

export function getActiveOutcomes(): Outcome[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM outcomes
    WHERE status = 'active'
    ORDER BY last_activity_at DESC
  `).all() as Outcome[];

  return rows.map(row => ({
    ...row,
    is_ongoing: Boolean(row.is_ongoing),
  }));
}

export function getOutcomesByStatus(status: OutcomeStatus): Outcome[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM outcomes
    WHERE status = ?
    ORDER BY last_activity_at DESC
  `).all(status) as Outcome[];

  return rows.map(row => ({
    ...row,
    is_ongoing: Boolean(row.is_ongoing),
  }));
}

export interface OutcomeListItem extends Outcome {
  task_count: number;
  active_task_count: number;
  worker_count: number;
  active_worker_count: number;
  is_converging: boolean;
}

export function getOutcomesWithCounts(): OutcomeListItem[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      o.*,
      (SELECT COUNT(*) FROM tasks WHERE outcome_id = o.id) as task_count,
      (SELECT COUNT(*) FROM tasks WHERE outcome_id = o.id AND status IN ('pending', 'claimed', 'running')) as active_task_count,
      (SELECT COUNT(*) FROM workers WHERE outcome_id = o.id) as worker_count,
      (SELECT COUNT(*) FROM workers WHERE outcome_id = o.id AND status = 'running') as active_worker_count,
      (
        SELECT CASE
          WHEN COUNT(*) >= 2 AND SUM(issues_found) = 0 THEN 1
          WHEN COUNT(*) >= 2 AND
               (SELECT issues_found FROM review_cycles rc2 WHERE rc2.outcome_id = o.id ORDER BY cycle_number DESC LIMIT 1) <
               (SELECT issues_found FROM review_cycles rc3 WHERE rc3.outcome_id = o.id ORDER BY cycle_number DESC LIMIT 1 OFFSET 1) THEN 1
          ELSE 0
        END
        FROM review_cycles rc WHERE rc.outcome_id = o.id
      ) as is_converging
    FROM outcomes o
    ORDER BY o.last_activity_at DESC
  `).all() as (Outcome & {
    task_count: number;
    active_task_count: number;
    worker_count: number;
    active_worker_count: number;
    is_converging: number;
  })[];

  return rows.map(row => ({
    ...row,
    is_ongoing: Boolean(row.is_ongoing),
    is_converging: Boolean(row.is_converging),
  }));
}

// ============================================================================
// Update
// ============================================================================

export interface UpdateOutcomeInput {
  name?: string;
  status?: OutcomeStatus;
  is_ongoing?: boolean;
  brief?: string;
  intent?: string;
  timeline?: string;
}

export function updateOutcome(id: string, input: UpdateOutcomeInput): Outcome | null {
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
  if (input.is_ongoing !== undefined) {
    updates.push('is_ongoing = ?');
    values.push(input.is_ongoing ? 1 : 0);
  }
  if (input.brief !== undefined) {
    updates.push('brief = ?');
    values.push(input.brief);
  }
  if (input.intent !== undefined) {
    updates.push('intent = ?');
    values.push(input.intent);
  }
  if (input.timeline !== undefined) {
    updates.push('timeline = ?');
    values.push(input.timeline);
  }

  values.push(id);

  db.prepare(`UPDATE outcomes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return getOutcomeById(id);
}

export function touchOutcome(id: string): void {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    UPDATE outcomes SET last_activity_at = ?, updated_at = ? WHERE id = ?
  `).run(timestamp, timestamp, id);
}

// ============================================================================
// Delete
// ============================================================================

export function deleteOutcome(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM outcomes WHERE id = ?').run(id);
  return result.changes > 0;
}

// ============================================================================
// Status Transitions
// ============================================================================

export function activateOutcome(id: string): Outcome | null {
  return updateOutcome(id, { status: 'active' });
}

export function pauseOutcome(id: string): Outcome | null {
  return updateOutcome(id, { status: 'dormant' });
}

export function achieveOutcome(id: string): Outcome | null {
  return updateOutcome(id, { status: 'achieved' });
}

export function archiveOutcome(id: string): Outcome | null {
  return updateOutcome(id, { status: 'archived' });
}
