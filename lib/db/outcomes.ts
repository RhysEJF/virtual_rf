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
  GitMode,
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
  // Git configuration
  working_directory?: string;
  git_mode?: GitMode;
  base_branch?: string;
  work_branch?: string;
  auto_commit?: boolean;
  create_pr_on_complete?: boolean;
}

export function createOutcome(input: CreateOutcomeInput): Outcome {
  const db = getDb();
  const timestamp = now();
  const id = generateId('out');

  const stmt = db.prepare(`
    INSERT INTO outcomes (
      id, name, status, is_ongoing, brief, intent, timeline,
      working_directory, git_mode, base_branch, work_branch, auto_commit, create_pr_on_complete,
      created_at, updated_at, last_activity_at
    )
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.name,
    input.is_ongoing ? 1 : 0,
    input.brief || null,
    input.intent || null,
    input.timeline || null,
    input.working_directory || null,
    input.git_mode || 'none',
    input.base_branch || null,
    input.work_branch || null,
    input.auto_commit ? 1 : 0,
    input.create_pr_on_complete ? 1 : 0,
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

  return mapOutcomeRow(row);
}

/**
 * Map database row to Outcome, converting integer booleans and ensuring proper types
 */
function mapOutcomeRow(row: Outcome): Outcome {
  return {
    ...row,
    is_ongoing: Boolean(row.is_ongoing),
    auto_commit: Boolean(row.auto_commit),
    create_pr_on_complete: Boolean(row.create_pr_on_complete),
    git_mode: (row.git_mode || 'none') as GitMode,
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

  return rows.map(mapOutcomeRow);
}

export function getActiveOutcomes(): Outcome[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM outcomes
    WHERE status = 'active'
    ORDER BY last_activity_at DESC
  `).all() as Outcome[];

  return rows.map(mapOutcomeRow);
}

export function getOutcomesByStatus(status: OutcomeStatus): Outcome[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM outcomes
    WHERE status = ?
    ORDER BY last_activity_at DESC
  `).all(status) as Outcome[];

  return rows.map(mapOutcomeRow);
}

export interface OutcomeListItem extends Outcome {
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
  active_workers: number;
  is_converging: boolean;
}

export function getOutcomesWithCounts(): OutcomeListItem[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      o.*,
      (SELECT COUNT(*) FROM tasks WHERE outcome_id = o.id) as total_tasks,
      (SELECT COUNT(*) FROM tasks WHERE outcome_id = o.id AND status = 'pending') as pending_tasks,
      (SELECT COUNT(*) FROM tasks WHERE outcome_id = o.id AND status = 'completed') as completed_tasks,
      (SELECT COUNT(*) FROM workers WHERE outcome_id = o.id AND status = 'running') as active_workers,
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
    total_tasks: number;
    pending_tasks: number;
    completed_tasks: number;
    active_workers: number;
    is_converging: number;
  })[];

  return rows.map(row => ({
    ...mapOutcomeRow(row),
    total_tasks: row.total_tasks,
    pending_tasks: row.pending_tasks,
    completed_tasks: row.completed_tasks,
    active_workers: row.active_workers,
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
  infrastructure_ready?: number;
  // Git configuration
  working_directory?: string | null;
  git_mode?: GitMode;
  base_branch?: string | null;
  work_branch?: string | null;
  auto_commit?: boolean;
  create_pr_on_complete?: boolean;
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
  if (input.infrastructure_ready !== undefined) {
    updates.push('infrastructure_ready = ?');
    values.push(input.infrastructure_ready);
  }
  // Git configuration fields
  if (input.working_directory !== undefined) {
    updates.push('working_directory = ?');
    values.push(input.working_directory);
  }
  if (input.git_mode !== undefined) {
    updates.push('git_mode = ?');
    values.push(input.git_mode);
  }
  if (input.base_branch !== undefined) {
    updates.push('base_branch = ?');
    values.push(input.base_branch);
  }
  if (input.work_branch !== undefined) {
    updates.push('work_branch = ?');
    values.push(input.work_branch);
  }
  if (input.auto_commit !== undefined) {
    updates.push('auto_commit = ?');
    values.push(input.auto_commit ? 1 : 0);
  }
  if (input.create_pr_on_complete !== undefined) {
    updates.push('create_pr_on_complete = ?');
    values.push(input.create_pr_on_complete ? 1 : 0);
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
