/**
 * Progress Entries CRUD operations
 *
 * Progress entries store the episodic memory of worker iterations.
 * Older entries get compacted into summaries to manage context size.
 */

import { getDb, now, transaction } from './index';
import type { ProgressEntry } from './schema';

// ============================================================================
// Create
// ============================================================================

export interface CreateProgressEntryInput {
  outcome_id: string;
  worker_id: string;
  iteration: number;
  content: string;
}

export function createProgressEntry(input: CreateProgressEntryInput): ProgressEntry {
  const db = getDb();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO progress_entries (outcome_id, worker_id, iteration, content, compacted, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `);

  const result = stmt.run(
    input.outcome_id,
    input.worker_id,
    input.iteration,
    input.content,
    timestamp
  );

  return getProgressEntryById(result.lastInsertRowid as number)!;
}

// ============================================================================
// Read
// ============================================================================

export function getProgressEntryById(id: number): ProgressEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM progress_entries WHERE id = ?').get(id) as ProgressEntry | undefined;
  if (!row) return null;
  return {
    ...row,
    compacted: Boolean(row.compacted),
  };
}

export function getProgressEntriesByWorker(workerId: string): ProgressEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM progress_entries
    WHERE worker_id = ?
    ORDER BY iteration ASC
  `).all(workerId) as ProgressEntry[];

  return rows.map(row => ({
    ...row,
    compacted: Boolean(row.compacted),
  }));
}

export function getUncompactedEntries(workerId: string): ProgressEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM progress_entries
    WHERE worker_id = ? AND compacted = 0
    ORDER BY iteration ASC
  `).all(workerId) as ProgressEntry[];

  return rows.map(row => ({
    ...row,
    compacted: Boolean(row.compacted),
  }));
}

export function getCompactedSummaries(workerId: string): ProgressEntry[] {
  const db = getDb();
  // Compacted summaries are entries that have compacted_into = NULL but compacted = 0
  // and that have OTHER entries pointing to them via compacted_into
  // Actually, simpler: compacted summaries are entries where iteration < 0 (we use negative iterations for summaries)
  // OR: we can identify them by finding entries that are referenced by compacted_into

  // Let's use a simpler approach: summaries are stored with a special marker
  // For now, return entries where compacted = 0 (uncompacted entries are either raw or summaries)
  // Summaries will have a specific content format or we check if they're referenced

  // Simplest: return entries that have been the target of compaction (have entries pointing to them)
  const rows = db.prepare(`
    SELECT DISTINCT pe.*
    FROM progress_entries pe
    WHERE pe.id IN (SELECT DISTINCT compacted_into FROM progress_entries WHERE compacted_into IS NOT NULL)
    ORDER BY pe.iteration ASC
  `).all() as ProgressEntry[];

  return rows.map(row => ({
    ...row,
    compacted: Boolean(row.compacted),
  }));
}

/**
 * Get the latest N uncompacted progress entries for context injection.
 * Returns most recent entries first.
 */
export function getRecentProgress(workerId: string, limit: number = 10): ProgressEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM progress_entries
    WHERE worker_id = ? AND compacted = 0
    ORDER BY iteration DESC
    LIMIT ?
  `).all(workerId, limit) as ProgressEntry[];

  return rows.map(row => ({
    ...row,
    compacted: Boolean(row.compacted),
  })).reverse(); // Return in chronological order
}

/**
 * Build the full progress context for a worker.
 * Returns: compacted summaries + recent uncompacted entries.
 */
export function buildProgressContext(workerId: string, recentLimit: number = 10): string {
  const db = getDb();

  // Get compacted summaries (entries that other entries point to)
  const summaryIds = db.prepare(`
    SELECT DISTINCT compacted_into as id FROM progress_entries
    WHERE worker_id = ? AND compacted_into IS NOT NULL
  `).all(workerId) as { id: number }[];

  const summaries: ProgressEntry[] = [];
  for (const { id } of summaryIds) {
    const entry = getProgressEntryById(id);
    if (entry) summaries.push(entry);
  }

  // Get recent uncompacted entries
  const recent = getRecentProgress(workerId, recentLimit);

  // Build context string
  const parts: string[] = [];

  if (summaries.length > 0) {
    parts.push('## Previous Progress (Compacted)\n');
    for (const s of summaries) {
      parts.push(s.content);
      parts.push('');
    }
  }

  if (recent.length > 0) {
    parts.push('## Recent Progress\n');
    for (const entry of recent) {
      parts.push(`### Iteration ${entry.iteration}`);
      parts.push(entry.content);
      parts.push('');
    }
  }

  return parts.join('\n');
}

// ============================================================================
// Compaction
// ============================================================================

const COMPACTION_THRESHOLD = 10; // Compact after this many uncompacted entries

/**
 * Check if compaction is needed for a worker.
 */
export function needsCompaction(workerId: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM progress_entries
    WHERE worker_id = ? AND compacted = 0
  `).get(workerId) as { count: number };

  return result.count >= COMPACTION_THRESHOLD;
}

/**
 * Mark entries as compacted and point them to a summary entry.
 * The actual summary content generation is done by the AI agent.
 */
export function markEntriesCompacted(entryIds: number[], summaryId: number): void {
  const db = getDb();
  const timestamp = now();

  transaction(() => {
    const stmt = db.prepare(`
      UPDATE progress_entries
      SET compacted = 1, compacted_into = ?
      WHERE id = ?
    `);

    for (const id of entryIds) {
      stmt.run(summaryId, id);
    }
  });
}

/**
 * Create a compaction summary entry.
 * Called after AI generates the summary content.
 */
export function createCompactionSummary(
  outcomeId: string,
  workerId: string,
  iterationRange: { from: number; to: number },
  summaryContent: string
): ProgressEntry {
  const db = getDb();
  const timestamp = now();

  // Use a special iteration number to mark as summary (e.g., -1 * to iteration)
  // Or we can use the 'from' iteration
  const stmt = db.prepare(`
    INSERT INTO progress_entries (outcome_id, worker_id, iteration, content, compacted, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `);

  const result = stmt.run(
    outcomeId,
    workerId,
    iterationRange.from, // Use start iteration as marker
    `[Compacted summary of iterations ${iterationRange.from}-${iterationRange.to}]\n\n${summaryContent}`,
    timestamp
  );

  return getProgressEntryById(result.lastInsertRowid as number)!;
}

/**
 * Get entries ready for compaction.
 * Returns the oldest uncompacted entries.
 */
export function getEntriesForCompaction(workerId: string, limit: number = COMPACTION_THRESHOLD): ProgressEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM progress_entries
    WHERE worker_id = ? AND compacted = 0
    ORDER BY iteration ASC
    LIMIT ?
  `).all(workerId, limit) as ProgressEntry[];

  return rows.map(row => ({
    ...row,
    compacted: Boolean(row.compacted),
  }));
}

// ============================================================================
// Delete
// ============================================================================

export function deleteProgressEntry(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM progress_entries WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteProgressEntriesByWorker(workerId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM progress_entries WHERE worker_id = ?').run(workerId);
  return result.changes;
}

// ============================================================================
// Statistics
// ============================================================================

export function getProgressStats(workerId: string): {
  total: number;
  compacted: number;
  uncompacted: number;
} {
  const db = getDb();
  const result = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN compacted = 1 THEN 1 ELSE 0 END) as compacted,
      SUM(CASE WHEN compacted = 0 THEN 1 ELSE 0 END) as uncompacted
    FROM progress_entries WHERE worker_id = ?
  `).get(workerId) as { total: number; compacted: number; uncompacted: number };

  return result;
}
