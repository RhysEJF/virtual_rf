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
  SaveTarget,
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
  // Hierarchy
  parent_id?: string;
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

  // Compute depth based on parent
  let depth = 0;
  if (input.parent_id) {
    const parent = getOutcomeById(input.parent_id);
    if (parent) {
      depth = parent.depth + 1;
    }
  }

  const stmt = db.prepare(`
    INSERT INTO outcomes (
      id, name, status, is_ongoing, brief, intent, timeline,
      parent_id, depth,
      working_directory, git_mode, base_branch, work_branch, auto_commit, create_pr_on_complete,
      created_at, updated_at, last_activity_at
    )
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.name,
    input.is_ongoing ? 1 : 0,
    input.brief || null,
    input.intent || null,
    input.timeline || null,
    input.parent_id || null,
    depth,
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
    parent_id: row.parent_id || null,
    depth: row.depth ?? 0,
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
  capability_ready?: number;
  // Hierarchy
  parent_id?: string | null;  // Set to null to make root, or ID to re-parent
  // Git configuration
  working_directory?: string | null;
  git_mode?: GitMode;
  base_branch?: string | null;
  work_branch?: string | null;
  auto_commit?: boolean;
  create_pr_on_complete?: boolean;
  // Save targets
  output_target?: SaveTarget;
  skill_target?: SaveTarget;
  tool_target?: SaveTarget;
  file_target?: SaveTarget;
  auto_save?: boolean;
  // Auto-resolve settings
  auto_resolve_mode?: 'manual' | 'semi-auto' | 'full-auto';
  auto_resolve_threshold?: number;
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
  if (input.capability_ready !== undefined) {
    updates.push('capability_ready = ?');
    values.push(input.capability_ready);
  }
  // Hierarchy - handle parent_id changes
  if (input.parent_id !== undefined) {
    updates.push('parent_id = ?');
    values.push(input.parent_id);
    // Compute new depth
    let newDepth = 0;
    if (input.parent_id) {
      const parent = getOutcomeById(input.parent_id);
      if (parent) {
        newDepth = parent.depth + 1;
      }
    }
    updates.push('depth = ?');
    values.push(newDepth);
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
  // Save target fields
  if (input.output_target !== undefined) {
    updates.push('output_target = ?');
    values.push(input.output_target);
  }
  if (input.skill_target !== undefined) {
    updates.push('skill_target = ?');
    values.push(input.skill_target);
  }
  if (input.tool_target !== undefined) {
    updates.push('tool_target = ?');
    values.push(input.tool_target);
  }
  if (input.file_target !== undefined) {
    updates.push('file_target = ?');
    values.push(input.file_target);
  }
  if (input.auto_save !== undefined) {
    updates.push('auto_save = ?');
    values.push(input.auto_save ? 1 : 0);
  }
  // Auto-resolve settings
  if (input.auto_resolve_mode !== undefined) {
    updates.push('auto_resolve_mode = ?');
    values.push(input.auto_resolve_mode);
  }
  if (input.auto_resolve_threshold !== undefined) {
    updates.push('auto_resolve_threshold = ?');
    values.push(input.auto_resolve_threshold);
  }

  values.push(id);

  db.prepare(`UPDATE outcomes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // If parent changed, update depths of all descendants
  if (input.parent_id !== undefined) {
    updateDescendantDepths(id);
  }

  return getOutcomeById(id);
}

/**
 * Recursively update depths of all descendants after a parent change
 */
function updateDescendantDepths(outcomeId: string): void {
  const db = getDb();
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) return;

  const children = getChildOutcomes(outcomeId);
  for (const child of children) {
    const newDepth = outcome.depth + 1;
    db.prepare('UPDATE outcomes SET depth = ? WHERE id = ?').run(newDepth, child.id);
    updateDescendantDepths(child.id);
  }
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

// ============================================================================
// Capability Status (Computed)
// ============================================================================

/**
 * Evaluate what capability_ready should be based on actual task state.
 * Returns:
 *   0 = Capability phase needed but not started (pending capability tasks, none completed)
 *   1 = Capability phase in progress (some completed, some pending)
 *   2 = Capability phase complete (all capability tasks completed, or no capability tasks)
 */
export function evaluateCapabilityStatus(outcomeId: string): 0 | 1 | 2 {
  const db = getDb();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status IN ('claimed', 'running') THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM tasks
    WHERE outcome_id = ? AND phase = 'capability'
  `).get(outcomeId) as {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
  };

  // No capability tasks = capability phase is ready
  if (stats.total === 0) {
    return 2;
  }

  // All capability tasks completed (or failed but none pending)
  if (stats.pending === 0 && stats.in_progress === 0) {
    return 2;
  }

  // Some completed or in progress = building
  if (stats.completed > 0 || stats.in_progress > 0) {
    return 1;
  }

  // All pending, none started = not started
  return 0;
}

/**
 * Sync outcome's capability_ready with actual task state.
 * Call this after startup cleanup or when resuming work.
 * Returns true if the status was changed.
 */
export function syncCapabilityStatus(outcomeId: string): boolean {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) return false;

  const computed = evaluateCapabilityStatus(outcomeId);

  if (outcome.capability_ready !== computed) {
    updateOutcome(outcomeId, { capability_ready: computed });
    console.log(`[DB Sync] Updated capability_ready for ${outcomeId}: ${outcome.capability_ready} → ${computed}`);
    return true;
  }

  return false;
}

/**
 * Sync capability status for all active outcomes.
 * Call this during startup cleanup.
 */
export function syncAllCapabilityStatus(): number {
  const activeOutcomes = getActiveOutcomes();
  let updated = 0;

  for (const outcome of activeOutcomes) {
    if (syncCapabilityStatus(outcome.id)) {
      updated++;
    }
  }

  return updated;
}

/** @deprecated Use evaluateCapabilityStatus instead */
export const evaluateInfrastructureStatus = evaluateCapabilityStatus;
/** @deprecated Use syncCapabilityStatus instead */
export const syncInfrastructureStatus = syncCapabilityStatus;
/** @deprecated Use syncAllCapabilityStatus instead */
export const syncAllInfrastructureStatus = syncAllCapabilityStatus;

// Design Doc helpers
export function getDesignDoc(outcomeId: string): DesignDoc | null {
  const db = getDb();
  const doc = db.prepare(`
    SELECT * FROM design_docs
    WHERE outcome_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(outcomeId) as DesignDoc | undefined;
  return doc || null;
}

export function upsertDesignDoc(outcomeId: string, approach: string, version?: number): DesignDoc {
  const db = getDb();
  const now = Date.now();
  const existing = getDesignDoc(outcomeId);

  if (existing) {
    // Update existing
    const newVersion = version ?? (existing.version + 1);
    db.prepare(`
      UPDATE design_docs
      SET approach = ?, version = ?, updated_at = ?
      WHERE outcome_id = ?
    `).run(approach, newVersion, now, outcomeId);

    return {
      ...existing,
      approach,
      version: newVersion,
      updated_at: now,
    };
  } else {
    // Insert new
    const id = `dd_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    const newVersion = version ?? 1;

    db.prepare(`
      INSERT INTO design_docs (id, outcome_id, version, approach, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, outcomeId, newVersion, approach, now, now);

    return {
      id,
      outcome_id: outcomeId,
      version: newVersion,
      approach,
      created_at: now,
      updated_at: now,
    };
  }
}

// ============================================================================
// Hierarchy / Tree Operations
// ============================================================================

/**
 * Get all direct children of an outcome
 */
export function getChildOutcomes(parentId: string): Outcome[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM outcomes
    WHERE parent_id = ?
    ORDER BY last_activity_at DESC
  `).all(parentId) as Outcome[];

  return rows.map(mapOutcomeRow);
}

/**
 * Get all root outcomes (those without a parent)
 */
export function getRootOutcomes(): Outcome[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM outcomes
    WHERE parent_id IS NULL
    ORDER BY last_activity_at DESC
  `).all() as Outcome[];

  return rows.map(mapOutcomeRow);
}

/**
 * Check if an outcome has any children
 */
export function hasChildren(outcomeId: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM outcomes WHERE parent_id = ?
  `).get(outcomeId) as { count: number };
  return result.count > 0;
}

/**
 * Get the count of direct children for an outcome
 */
export function getChildCount(outcomeId: string): number {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM outcomes WHERE parent_id = ?
  `).get(outcomeId) as { count: number };
  return result.count;
}

/**
 * Get all descendants of an outcome (recursive)
 */
export function getAllDescendants(outcomeId: string): Outcome[] {
  const db = getDb();

  // Use recursive CTE to get all descendants
  const rows = db.prepare(`
    WITH RECURSIVE descendants AS (
      SELECT * FROM outcomes WHERE parent_id = ?
      UNION ALL
      SELECT o.* FROM outcomes o
      INNER JOIN descendants d ON o.parent_id = d.id
    )
    SELECT * FROM descendants
    ORDER BY depth ASC, last_activity_at DESC
  `).all(outcomeId) as Outcome[];

  return rows.map(mapOutcomeRow);
}

/**
 * Get the breadcrumb path from root to the given outcome
 * Returns array from root to the outcome (inclusive)
 */
export function getBreadcrumbs(outcomeId: string): { id: string; name: string }[] {
  const db = getDb();

  // Use recursive CTE to get ancestors
  const rows = db.prepare(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id, depth FROM outcomes WHERE id = ?
      UNION ALL
      SELECT o.id, o.name, o.parent_id, o.depth FROM outcomes o
      INNER JOIN ancestors a ON o.id = a.parent_id
    )
    SELECT id, name FROM ancestors
    ORDER BY depth ASC
  `).all(outcomeId) as { id: string; name: string }[];

  return rows;
}

/**
 * Aggregated stats for an outcome and all its descendants
 */
export interface AggregatedStats {
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  active_workers: number;
  total_descendants: number;
}

/**
 * Get aggregated statistics across an outcome and all its descendants
 */
export function getAggregatedStats(outcomeId: string): AggregatedStats {
  const db = getDb();

  // Get all outcome IDs (self + descendants)
  const outcomeIds = db.prepare(`
    WITH RECURSIVE tree AS (
      SELECT id FROM outcomes WHERE id = ?
      UNION ALL
      SELECT o.id FROM outcomes o
      INNER JOIN tree t ON o.parent_id = t.id
    )
    SELECT id FROM tree
  `).all(outcomeId) as { id: string }[];

  if (outcomeIds.length === 0) {
    return {
      total_tasks: 0,
      pending_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      active_workers: 0,
      total_descendants: 0,
    };
  }

  const ids = outcomeIds.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');

  // Get task stats
  const taskStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM tasks
    WHERE outcome_id IN (${placeholders})
  `).get(...ids) as {
    total: number;
    pending: number;
    completed: number;
    failed: number;
  };

  // Get worker stats
  const workerStats = db.prepare(`
    SELECT COUNT(*) as active
    FROM workers
    WHERE outcome_id IN (${placeholders}) AND status = 'running'
  `).get(...ids) as { active: number };

  return {
    total_tasks: taskStats.total || 0,
    pending_tasks: taskStats.pending || 0,
    completed_tasks: taskStats.completed || 0,
    failed_tasks: taskStats.failed || 0,
    active_workers: workerStats.active || 0,
    total_descendants: ids.length - 1, // Exclude self
  };
}

/**
 * Tree node for hierarchical display
 */
export interface OutcomeTreeNode extends OutcomeListItem {
  children: OutcomeTreeNode[];
  child_count: number;
}

/**
 * Build a tree structure from all outcomes
 */
export function getOutcomeTree(): OutcomeTreeNode[] {
  const outcomes = getOutcomesWithCounts();

  // Create a map for quick lookup
  const outcomeMap = new Map<string, OutcomeTreeNode>();
  for (const o of outcomes) {
    outcomeMap.set(o.id, { ...o, children: [], child_count: 0 });
  }

  // Build tree structure
  const roots: OutcomeTreeNode[] = [];
  outcomeMap.forEach((node) => {
    if (node.parent_id && outcomeMap.has(node.parent_id)) {
      const parent = outcomeMap.get(node.parent_id)!;
      parent.children.push(node);
      parent.child_count++;
    } else {
      roots.push(node);
    }
  });

  // Sort children by last_activity_at descending
  const sortChildren = (nodes: OutcomeTreeNode[]): void => {
    nodes.sort((a, b) => b.last_activity_at - a.last_activity_at);
    for (const node of nodes) {
      sortChildren(node.children);
    }
  };
  sortChildren(roots);

  return roots;
}

/**
 * Child outcome info for parent detail page
 */
export interface ChildOutcomeInfo {
  id: string;
  name: string;
  status: OutcomeStatus;
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
  active_workers: number;
}

/**
 * Get children with task/worker counts for displaying in parent outcome detail
 */
export function getChildrenWithCounts(parentId: string): ChildOutcomeInfo[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      o.id,
      o.name,
      o.status,
      (SELECT COUNT(*) FROM tasks WHERE outcome_id = o.id) as total_tasks,
      (SELECT COUNT(*) FROM tasks WHERE outcome_id = o.id AND status = 'pending') as pending_tasks,
      (SELECT COUNT(*) FROM tasks WHERE outcome_id = o.id AND status = 'completed') as completed_tasks,
      (SELECT COUNT(*) FROM workers WHERE outcome_id = o.id AND status = 'running') as active_workers
    FROM outcomes o
    WHERE o.parent_id = ?
    ORDER BY o.last_activity_at DESC
  `).all(parentId) as ChildOutcomeInfo[];

  return rows;
}

// ============================================================================
// Re-parenting / Hierarchy Management
// ============================================================================

/**
 * Check if setting outcomeId's parent to newParentId would create a cycle.
 * Returns true if it would create a cycle (invalid), false if safe.
 */
export function wouldCreateCycle(outcomeId: string, newParentId: string): boolean {
  if (outcomeId === newParentId) return true;

  // Check if newParentId is a descendant of outcomeId
  const descendants = getAllDescendants(outcomeId);
  return descendants.some(d => d.id === newParentId);
}

/**
 * Get all outcomes that could be valid parents for the given outcome.
 * Excludes: the outcome itself, its descendants (would create cycle)
 */
export function getValidParentOptions(outcomeId: string): Outcome[] {
  const allOutcomes = getAllOutcomes();
  const descendants = getAllDescendants(outcomeId);
  const descendantIds = new Set(descendants.map(d => d.id));

  return allOutcomes.filter(o =>
    o.id !== outcomeId && !descendantIds.has(o.id)
  );
}

/**
 * Get all outcomes that could be valid children for the given outcome.
 * Excludes: the outcome itself, its ancestors (would create cycle), outcomes that already have this as ancestor
 */
export function getValidChildOptions(outcomeId: string): Outcome[] {
  const allOutcomes = getAllOutcomes();
  const breadcrumbs = getBreadcrumbs(outcomeId);
  const ancestorIds = new Set(breadcrumbs.map(b => b.id));

  // Also exclude outcomes that are already children
  const currentChildren = getChildOutcomes(outcomeId);
  const childIds = new Set(currentChildren.map(c => c.id));

  return allOutcomes.filter(o =>
    o.id !== outcomeId && !ancestorIds.has(o.id) && !childIds.has(o.id)
  );
}

/**
 * Simple outcome info for dropdowns
 */
export interface OutcomeOption {
  id: string;
  name: string;
  depth: number;
  status: OutcomeStatus;
}
