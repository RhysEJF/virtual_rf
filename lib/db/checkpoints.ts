import { getDb } from './index';

export interface TaskCheckpoint {
  id: number;
  task_id: string;
  worker_id: string | null;
  progress_summary: string | null;
  remaining_work: string | null;
  files_modified: string | null;
  git_sha: string | null;
  created_at: string;
}

export interface SaveCheckpointInput {
  taskId: string;
  workerId?: string;
  progressSummary?: string;
  remainingWork?: string;
  filesModified?: string[];
  gitSha?: string;
}

export function saveCheckpoint(input: SaveCheckpointInput): TaskCheckpoint {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO task_checkpoints (task_id, worker_id, progress_summary, remaining_work, files_modified, git_sha)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.taskId,
    input.workerId || null,
    input.progressSummary || null,
    input.remainingWork || null,
    input.filesModified ? JSON.stringify(input.filesModified) : null,
    input.gitSha || null
  );

  return db.prepare('SELECT * FROM task_checkpoints WHERE id = ?').get(result.lastInsertRowid) as TaskCheckpoint;
}

export function getLatestCheckpoint(taskId: string): TaskCheckpoint | null {
  const db = getDb();
  return db.prepare('SELECT * FROM task_checkpoints WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId) as TaskCheckpoint | null;
}

export function getCheckpoints(taskId: string): TaskCheckpoint[] {
  const db = getDb();
  return db.prepare('SELECT * FROM task_checkpoints WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as TaskCheckpoint[];
}
