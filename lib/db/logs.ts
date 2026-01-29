/**
 * Logging operations for costs, bottlenecks, and improvement suggestions
 */

import {
  getDb,
  now,
  type CostLogEntry,
  type BottleneckLogEntry,
  type ImprovementSuggestion,
  type InterventionType,
  type SuggestionType,
  type SuggestionStatus,
} from './index';

// ============================================================================
// Cost Logging
// ============================================================================

export interface LogCostInput {
  project_id?: string;
  worker_id?: string;
  amount: number;
  description?: string;
}

/**
 * Log a cost entry
 */
export function logCost(input: LogCostInput): CostLogEntry {
  const db = getDb();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO cost_log (project_id, worker_id, amount, description, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.project_id || null,
    input.worker_id || null,
    input.amount,
    input.description || null,
    timestamp
  );

  return getCostLogEntry(result.lastInsertRowid as number)!;
}

/**
 * Get a cost log entry by ID
 */
export function getCostLogEntry(id: number): CostLogEntry | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM cost_log WHERE id = ?');
  return stmt.get(id) as CostLogEntry | null;
}

/**
 * Get cost log entries for a project
 */
export function getCostLogByProject(projectId: string): CostLogEntry[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM cost_log WHERE project_id = ? ORDER BY created_at DESC');
  return stmt.all(projectId) as CostLogEntry[];
}

/**
 * Get today's total cost
 */
export function getTodayCost(): number {
  const db = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const stmt = db.prepare('SELECT SUM(amount) as total FROM cost_log WHERE created_at >= ?');
  const result = stmt.get(startOfDay.getTime()) as { total: number | null };
  return result.total || 0;
}

/**
 * Get total cost for a time range
 */
export function getCostForRange(startTime: number, endTime: number): number {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT SUM(amount) as total FROM cost_log
    WHERE created_at >= ? AND created_at <= ?
  `);
  const result = stmt.get(startTime, endTime) as { total: number | null };
  return result.total || 0;
}

// ============================================================================
// Bottleneck Logging
// ============================================================================

export interface LogBottleneckInput {
  project_id?: string;
  intervention_type: InterventionType;
  description: string;
  resolution?: string;
}

/**
 * Log a bottleneck/intervention
 */
export function logBottleneck(input: LogBottleneckInput): BottleneckLogEntry {
  const db = getDb();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO bottleneck_log (project_id, intervention_type, description, resolution, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.project_id || null,
    input.intervention_type,
    input.description,
    input.resolution || null,
    timestamp
  );

  return getBottleneckLogEntry(result.lastInsertRowid as number)!;
}

/**
 * Get a bottleneck log entry by ID
 */
export function getBottleneckLogEntry(id: number): BottleneckLogEntry | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM bottleneck_log WHERE id = ?');
  return stmt.get(id) as BottleneckLogEntry | null;
}

/**
 * Get bottleneck log entries for a project
 */
export function getBottleneckLogByProject(projectId: string): BottleneckLogEntry[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM bottleneck_log WHERE project_id = ? ORDER BY created_at DESC');
  return stmt.all(projectId) as BottleneckLogEntry[];
}

/**
 * Get recent bottleneck entries
 */
export function getRecentBottlenecks(limit: number = 10): BottleneckLogEntry[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM bottleneck_log ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit) as BottleneckLogEntry[];
}

/**
 * Get bottleneck count by type
 */
export function getBottleneckCountByType(): Record<InterventionType, number> {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT intervention_type, COUNT(*) as count
    FROM bottleneck_log
    GROUP BY intervention_type
  `);
  const results = stmt.all() as { intervention_type: InterventionType; count: number }[];

  const counts: Record<InterventionType, number> = {
    clarification: 0,
    redirect: 0,
    skill_gap: 0,
    error: 0,
  };

  for (const row of results) {
    counts[row.intervention_type] = row.count;
  }

  return counts;
}

// ============================================================================
// Improvement Suggestions
// ============================================================================

export interface CreateSuggestionInput {
  type: SuggestionType;
  title: string;
  description: string;
  priority?: number;
}

/**
 * Create an improvement suggestion
 */
export function createSuggestion(input: CreateSuggestionInput): ImprovementSuggestion {
  const db = getDb();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO improvement_suggestions (type, title, description, priority, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);

  const result = stmt.run(
    input.type,
    input.title,
    input.description,
    input.priority || 0,
    timestamp
  );

  return getSuggestion(result.lastInsertRowid as number)!;
}

/**
 * Get a suggestion by ID
 */
export function getSuggestion(id: number): ImprovementSuggestion | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM improvement_suggestions WHERE id = ?');
  return stmt.get(id) as ImprovementSuggestion | null;
}

/**
 * Get pending suggestions
 */
export function getPendingSuggestions(): ImprovementSuggestion[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM improvement_suggestions
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at DESC
  `);
  return stmt.all() as ImprovementSuggestion[];
}

/**
 * Get suggestions by type
 */
export function getSuggestionsByType(type: SuggestionType): ImprovementSuggestion[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM improvement_suggestions
    WHERE type = ?
    ORDER BY priority DESC, created_at DESC
  `);
  return stmt.all(type) as ImprovementSuggestion[];
}

/**
 * Update suggestion status
 */
export function updateSuggestionStatus(id: number, status: SuggestionStatus): ImprovementSuggestion | null {
  const db = getDb();
  const stmt = db.prepare('UPDATE improvement_suggestions SET status = ? WHERE id = ?');
  stmt.run(status, id);
  return getSuggestion(id);
}

/**
 * Get suggestion count by status
 */
export function getSuggestionCountByStatus(): Record<SuggestionStatus, number> {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM improvement_suggestions
    GROUP BY status
  `);
  const results = stmt.all() as { status: SuggestionStatus; count: number }[];

  const counts: Record<SuggestionStatus, number> = {
    pending: 0,
    accepted: 0,
    dismissed: 0,
  };

  for (const row of results) {
    counts[row.status] = row.count;
  }

  return counts;
}
