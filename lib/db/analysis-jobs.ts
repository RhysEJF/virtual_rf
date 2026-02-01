/**
 * Analysis Jobs CRUD operations
 *
 * Tracks background analysis jobs for improvement analysis
 */

import { getDb, now } from './index';
import type { AnalysisJob, AnalysisJobStatus, AnalysisJobType } from './schema';
import { randomUUID } from 'crypto';

// ============================================================================
// Create
// ============================================================================

export interface CreateAnalysisJobInput {
  outcome_id?: string | null;
  job_type: AnalysisJobType;
  progress_message?: string;
}

export function createAnalysisJob(input: CreateAnalysisJobInput): AnalysisJob {
  const db = getDb();
  const id = randomUUID();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO analysis_jobs (id, outcome_id, job_type, status, progress_message, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `);

  stmt.run(
    id,
    input.outcome_id || null,
    input.job_type,
    input.progress_message || 'Initializing...',
    timestamp
  );

  return getAnalysisJobById(id)!;
}

// ============================================================================
// Read
// ============================================================================

export function getAnalysisJobById(id: string): AnalysisJob | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(id) as AnalysisJob | undefined;
  return row || null;
}

export function getActiveJobs(): AnalysisJob[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM analysis_jobs
    WHERE status IN ('pending', 'running')
    ORDER BY created_at DESC
  `).all() as AnalysisJob[];
}

export function getRecentJobs(limit: number = 10): AnalysisJob[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM analysis_jobs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as AnalysisJob[];
}

export function getJobsByOutcome(outcomeId: string | null, limit: number = 10): AnalysisJob[] {
  const db = getDb();
  if (outcomeId === null) {
    return db.prepare(`
      SELECT * FROM analysis_jobs
      WHERE outcome_id IS NULL
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as AnalysisJob[];
  }
  return db.prepare(`
    SELECT * FROM analysis_jobs
    WHERE outcome_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(outcomeId, limit) as AnalysisJob[];
}

// ============================================================================
// Update
// ============================================================================

export interface UpdateAnalysisJobInput {
  status?: AnalysisJobStatus;
  progress_message?: string;
  result?: string | null;
  error?: string | null;
}

export function updateAnalysisJob(id: string, input: UpdateAnalysisJobInput): AnalysisJob | null {
  const db = getDb();
  const timestamp = now();

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);

    // Set started_at when transitioning to running
    if (input.status === 'running') {
      updates.push('started_at = ?');
      values.push(timestamp);
    }

    // Set completed_at when transitioning to completed or failed
    if (input.status === 'completed' || input.status === 'failed') {
      updates.push('completed_at = ?');
      values.push(timestamp);
    }
  }

  if (input.progress_message !== undefined) {
    updates.push('progress_message = ?');
    values.push(input.progress_message);
  }

  if (input.result !== undefined) {
    updates.push('result = ?');
    values.push(input.result);
  }

  if (input.error !== undefined) {
    updates.push('error = ?');
    values.push(input.error);
  }

  if (updates.length === 0) {
    return getAnalysisJobById(id);
  }

  values.push(id);

  db.prepare(`
    UPDATE analysis_jobs SET ${updates.join(', ')} WHERE id = ?
  `).run(...values);

  return getAnalysisJobById(id);
}

/**
 * Mark a job as running with a progress message
 */
export function startAnalysisJob(id: string, progressMessage?: string): AnalysisJob | null {
  return updateAnalysisJob(id, {
    status: 'running',
    progress_message: progressMessage || 'Running analysis...',
  });
}

/**
 * Update progress message without changing status
 */
export function updateJobProgress(id: string, message: string): AnalysisJob | null {
  return updateAnalysisJob(id, { progress_message: message });
}

/**
 * Mark a job as completed with results
 */
export function completeAnalysisJob(id: string, result: string): AnalysisJob | null {
  return updateAnalysisJob(id, {
    status: 'completed',
    progress_message: 'Analysis complete',
    result,
  });
}

/**
 * Mark a job as failed with error message
 */
export function failAnalysisJob(id: string, error: string): AnalysisJob | null {
  return updateAnalysisJob(id, {
    status: 'failed',
    progress_message: 'Analysis failed',
    error,
  });
}

// ============================================================================
// Delete
// ============================================================================

export function deleteAnalysisJob(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM analysis_jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Clean up old completed/failed jobs (older than specified days)
 */
export function cleanupOldJobs(olderThanDays: number = 7): number {
  const db = getDb();
  const cutoff = now() - olderThanDays * 24 * 60 * 60 * 1000;
  const result = db.prepare(`
    DELETE FROM analysis_jobs
    WHERE status IN ('completed', 'failed')
    AND created_at < ?
  `).run(cutoff);
  return result.changes;
}
