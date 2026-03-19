import { getDb } from './index';

export interface Experiment {
  id: number;
  task_id: string;
  outcome_id: string;
  iteration: number;
  metric_value: number | null;
  metric_command: string;
  baseline_value: number | null;
  change_summary: string | null;
  git_sha: string | null;
  kept: number;
  status: 'accepted' | 'rejected' | 'crash';
  duration_seconds: number | null;
  created_at: string;
}

export interface RecordExperimentInput {
  taskId: string;
  outcomeId: string;
  iteration: number;
  metricValue?: number;
  metricCommand: string;
  baselineValue?: number;
  changeSummary?: string;
  gitSha?: string;
  kept: boolean;
  status?: 'accepted' | 'rejected' | 'crash';
  durationSeconds?: number;
}

export function recordExperiment(input: RecordExperimentInput): Experiment {
  const db = getDb();
  const status = input.status || (input.kept ? 'accepted' : 'rejected');
  const result = db.prepare(`
    INSERT INTO experiments (task_id, outcome_id, iteration, metric_value, metric_command, baseline_value, change_summary, git_sha, kept, status, duration_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.taskId,
    input.outcomeId,
    input.iteration,
    input.metricValue ?? null,
    input.metricCommand,
    input.baselineValue ?? null,
    input.changeSummary || null,
    input.gitSha || null,
    input.kept ? 1 : 0,
    status,
    input.durationSeconds || null
  );

  return db.prepare('SELECT * FROM experiments WHERE id = ?').get(result.lastInsertRowid) as Experiment;
}

export function getExperiments(options: {
  taskId?: string;
  outcomeId?: string;
  kept?: boolean;
}): Experiment[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.taskId) {
    conditions.push('task_id = ?');
    params.push(options.taskId);
  }
  if (options.outcomeId) {
    conditions.push('outcome_id = ?');
    params.push(options.outcomeId);
  }
  if (options.kept !== undefined) {
    conditions.push('kept = ?');
    params.push(options.kept ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT * FROM experiments ${where}
    ORDER BY iteration ASC
  `).all(...params) as Experiment[];
}

export function getExperimentCount(taskId: string): number {
  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as count FROM experiments WHERE task_id = ?').get(taskId) as { count: number };
  return result.count;
}

export function getBestExperiment(taskId: string, direction: 'lower' | 'higher' = 'lower'): Experiment | null {
  const db = getDb();
  const order = direction === 'higher' ? 'DESC' : 'ASC';
  return db.prepare(`
    SELECT * FROM experiments WHERE task_id = ? AND kept = 1
    ORDER BY metric_value ${order}
    LIMIT 1
  `).get(taskId) as Experiment | null;
}
