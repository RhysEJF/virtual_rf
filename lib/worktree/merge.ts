/**
 * Git Merge Operations
 *
 * Handles merging worker branches back to the main branch.
 * Includes conflict detection and resolution tracking.
 */

import { execSync } from 'child_process';
import { getDb, now } from '../db';
import { getRepoRoot, getCurrentBranch } from './manager';
import type { MergeQueueEntry, MergeQueueStatus } from '../db/schema';

// ============================================================================
// Utilities
// ============================================================================

/**
 * Execute a git command
 */
function git(command: string, cwd?: string): string {
  try {
    return execSync(`git ${command}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const err = error as { stderr?: Buffer; stdout?: Buffer; message: string };
    throw new Error(err.stderr?.toString() || err.stdout?.toString() || err.message);
  }
}

/**
 * Check if there are uncommitted changes
 */
function hasUncommittedChanges(path?: string): boolean {
  try {
    const status = git('status --porcelain', path);
    return status.length > 0;
  } catch {
    return false;
  }
}

// ============================================================================
// Merge Queue CRUD
// ============================================================================

export function createMergeQueueEntry(
  outcomeId: string,
  workerId: string
): MergeQueueEntry {
  const db = getDb();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO merge_queue (outcome_id, source_worker_id, status, created_at)
    VALUES (?, ?, 'pending', ?)
  `);

  const result = stmt.run(outcomeId, workerId, timestamp);
  return getMergeQueueEntry(result.lastInsertRowid as number)!;
}

export function getMergeQueueEntry(id: number): MergeQueueEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM merge_queue WHERE id = ?').get(id) as MergeQueueEntry | undefined;
  return row || null;
}

export function getPendingMerges(outcomeId: string): MergeQueueEntry[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM merge_queue
    WHERE outcome_id = ? AND status = 'pending'
    ORDER BY created_at ASC
  `).all(outcomeId) as MergeQueueEntry[];
}

export function getMergesByOutcome(outcomeId: string): MergeQueueEntry[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM merge_queue
    WHERE outcome_id = ?
    ORDER BY created_at DESC
  `).all(outcomeId) as MergeQueueEntry[];
}

export function updateMergeQueueEntry(
  id: number,
  updates: Partial<Pick<MergeQueueEntry, 'status' | 'conflict_files' | 'error_message' | 'completed_at'>>
): MergeQueueEntry | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.conflict_files !== undefined) {
    fields.push('conflict_files = ?');
    values.push(updates.conflict_files);
  }
  if (updates.error_message !== undefined) {
    fields.push('error_message = ?');
    values.push(updates.error_message);
  }
  if (updates.completed_at !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completed_at);
  }

  if (fields.length === 0) return getMergeQueueEntry(id);

  values.push(id);
  db.prepare(`UPDATE merge_queue SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getMergeQueueEntry(id);
}

// ============================================================================
// Merge Operations
// ============================================================================

export interface MergeResult {
  success: boolean;
  merged: boolean;
  conflicts?: string[];
  error?: string;
}

/**
 * Check if a branch can be merged without conflicts
 */
export function canMergeCleanly(branchName: string, targetBranch?: string): { clean: boolean; conflicts: string[] } {
  const repoRoot = getRepoRoot();
  const target = targetBranch || getCurrentBranch(repoRoot);

  try {
    // Do a dry-run merge to check for conflicts
    git(`merge --no-commit --no-ff ${branchName}`, repoRoot);

    // Check if there are conflicts
    const status = git('status --porcelain', repoRoot);
    const conflicts: string[] = [];

    for (const line of status.split('\n')) {
      if (line.startsWith('UU ') || line.startsWith('AA ') || line.startsWith('DD ')) {
        conflicts.push(line.slice(3));
      }
    }

    // Abort the merge
    try {
      git('merge --abort', repoRoot);
    } catch {
      // May fail if merge succeeded, that's ok
      git('reset --hard HEAD', repoRoot);
    }

    return { clean: conflicts.length === 0, conflicts };
  } catch (error) {
    // Abort any partial merge
    try {
      git('merge --abort', repoRoot);
    } catch {
      git('reset --hard HEAD', repoRoot);
    }

    return { clean: false, conflicts: ['Merge check failed'] };
  }
}

/**
 * Merge a worker's branch into the target branch
 */
export function mergeWorkerBranch(
  workerId: string,
  branchName: string,
  targetBranch?: string,
  commitMessage?: string
): MergeResult {
  const repoRoot = getRepoRoot();
  const target = targetBranch || 'main';
  const message = commitMessage || `Merge worker ${workerId} branch ${branchName}`;

  try {
    // Ensure we're on the target branch
    git(`checkout ${target}`, repoRoot);

    // Pull latest (in case there are remote changes)
    try {
      git('pull --ff-only', repoRoot);
    } catch {
      // Ignore if no remote
    }

    // Check for conflicts first
    const { clean, conflicts } = canMergeCleanly(branchName, target);

    if (!clean) {
      return {
        success: false,
        merged: false,
        conflicts,
        error: `Merge would have conflicts in: ${conflicts.join(', ')}`,
      };
    }

    // Perform the actual merge
    git(`merge --no-ff -m "${message}" ${branchName}`, repoRoot);

    return { success: true, merged: true };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      merged: false,
      error: err.message,
    };
  }
}

/**
 * Queue and process a merge request
 */
export async function queueMerge(
  outcomeId: string,
  workerId: string,
  branchName: string
): Promise<MergeQueueEntry> {
  // Create queue entry
  const entry = createMergeQueueEntry(outcomeId, workerId);

  // Update to in_progress
  updateMergeQueueEntry(entry.id, { status: 'in_progress' });

  // Attempt merge
  const result = mergeWorkerBranch(workerId, branchName);

  if (result.success) {
    updateMergeQueueEntry(entry.id, {
      status: 'completed',
      completed_at: now(),
    });
  } else if (result.conflicts && result.conflicts.length > 0) {
    updateMergeQueueEntry(entry.id, {
      status: 'conflicted',
      conflict_files: JSON.stringify(result.conflicts),
      error_message: result.error,
    });
  } else {
    updateMergeQueueEntry(entry.id, {
      status: 'failed',
      error_message: result.error,
    });
  }

  return getMergeQueueEntry(entry.id)!;
}

/**
 * Get merge statistics for an outcome
 */
export function getMergeStats(outcomeId: string): {
  total: number;
  pending: number;
  completed: number;
  failed: number;
  conflicted: number;
} {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM merge_queue
    WHERE outcome_id = ?
    GROUP BY status
  `).all(outcomeId) as { status: MergeQueueStatus; count: number }[];

  const stats = {
    total: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    conflicted: 0,
    in_progress: 0,
  };

  for (const row of rows) {
    stats.total += row.count;
    if (row.status in stats) {
      stats[row.status as keyof typeof stats] = row.count;
    }
  }

  return {
    total: stats.total,
    pending: stats.pending + stats.in_progress,
    completed: stats.completed,
    failed: stats.failed,
    conflicted: stats.conflicted,
  };
}
