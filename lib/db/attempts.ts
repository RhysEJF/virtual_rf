import { getDb } from './index';

export interface TaskAttempt {
  id: number;
  task_id: string;
  attempt_number: number;
  worker_id: string | null;
  approach_summary: string | null;
  failure_reason: string | null;
  files_modified: string | null;
  error_output: string | null;
  duration_seconds: number | null;
  progress_entry_id: number | null;
  created_at: string;
}

export interface RecordAttemptInput {
  taskId: string;
  attemptNumber: number;
  workerId?: string;
  approachSummary?: string;
  failureReason?: string;
  filesModified?: string[];
  errorOutput?: string;
  durationSeconds?: number;
  progressEntryId?: number;
}

export function recordAttempt(input: RecordAttemptInput): TaskAttempt {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO task_attempts (task_id, attempt_number, worker_id, approach_summary, failure_reason, files_modified, error_output, duration_seconds, progress_entry_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.taskId,
    input.attemptNumber,
    input.workerId || null,
    input.approachSummary || null,
    input.failureReason || null,
    input.filesModified ? JSON.stringify(input.filesModified) : null,
    input.errorOutput ? input.errorOutput.slice(-8000) : null,
    input.durationSeconds || null,
    input.progressEntryId || null
  );

  return db.prepare('SELECT * FROM task_attempts WHERE id = ?').get(result.lastInsertRowid) as TaskAttempt;
}

export function getAttempts(taskId: string): TaskAttempt[] {
  const db = getDb();
  return db.prepare('SELECT * FROM task_attempts WHERE task_id = ? ORDER BY attempt_number ASC').all(taskId) as TaskAttempt[];
}

export function getAttemptCount(taskId: string): number {
  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as count FROM task_attempts WHERE task_id = ?').get(taskId) as { count: number };
  return result.count;
}
