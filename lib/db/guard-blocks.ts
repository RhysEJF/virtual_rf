/**
 * Guard Blocks CRUD operations
 *
 * Guard blocks track when destructive commands are intercepted and blocked
 * before Ralph workers can execute them. This provides an audit trail
 * of prevented dangerous operations.
 */

import { getDb, now } from './index';
import type { GuardBlock } from './schema';
import { randomUUID } from 'crypto';

// ============================================================================
// Create
// ============================================================================

export interface CreateGuardBlockInput {
  worker_id: string;
  outcome_id: string;
  command: string;
  pattern_matched: string;
  context?: Record<string, unknown>;
}

export function createGuardBlock(input: CreateGuardBlockInput): GuardBlock {
  const db = getDb();
  const id = randomUUID();
  const timestamp = now();
  const contextJson = input.context ? JSON.stringify(input.context) : null;

  db.prepare(`
    INSERT INTO guard_blocks (
      id, worker_id, outcome_id, command, pattern_matched, blocked_at, context
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.worker_id,
    input.outcome_id,
    input.command,
    input.pattern_matched,
    timestamp,
    contextJson
  );

  return getGuardBlockById(id)!;
}

// ============================================================================
// Read
// ============================================================================

export function getGuardBlockById(id: string): GuardBlock | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM guard_blocks WHERE id = ?').get(id) as GuardBlock | undefined;
  return row || null;
}

export function getGuardBlocksByWorker(workerId: string, limit?: number): GuardBlock[] {
  const db = getDb();

  if (limit) {
    return db.prepare(`
      SELECT * FROM guard_blocks
      WHERE worker_id = ?
      ORDER BY blocked_at DESC
      LIMIT ?
    `).all(workerId, limit) as GuardBlock[];
  }

  return db.prepare(`
    SELECT * FROM guard_blocks
    WHERE worker_id = ?
    ORDER BY blocked_at DESC
  `).all(workerId) as GuardBlock[];
}

export function getGuardBlocksByOutcome(outcomeId: string, limit?: number): GuardBlock[] {
  const db = getDb();

  if (limit) {
    return db.prepare(`
      SELECT * FROM guard_blocks
      WHERE outcome_id = ?
      ORDER BY blocked_at DESC
      LIMIT ?
    `).all(outcomeId, limit) as GuardBlock[];
  }

  return db.prepare(`
    SELECT * FROM guard_blocks
    WHERE outcome_id = ?
    ORDER BY blocked_at DESC
  `).all(outcomeId) as GuardBlock[];
}

export function getRecentGuardBlocks(limit: number = 20): GuardBlock[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM guard_blocks
    ORDER BY blocked_at DESC
    LIMIT ?
  `).all(limit) as GuardBlock[];
}

export function getGuardBlocksByPattern(patternMatched: string, limit?: number): GuardBlock[] {
  const db = getDb();

  if (limit) {
    return db.prepare(`
      SELECT * FROM guard_blocks
      WHERE pattern_matched = ?
      ORDER BY blocked_at DESC
      LIMIT ?
    `).all(patternMatched, limit) as GuardBlock[];
  }

  return db.prepare(`
    SELECT * FROM guard_blocks
    WHERE pattern_matched = ?
    ORDER BY blocked_at DESC
  `).all(patternMatched) as GuardBlock[];
}

// ============================================================================
// Stats
// ============================================================================

export interface GuardBlockStats {
  total: number;
  by_pattern: Record<string, number>;
  recent_24h: number;
}

export function getGuardBlockStats(): GuardBlockStats {
  const db = getDb();

  // Total count
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM guard_blocks').get() as { count: number };

  // Count by pattern
  const patternRows = db.prepare(`
    SELECT pattern_matched, COUNT(*) as count
    FROM guard_blocks
    GROUP BY pattern_matched
    ORDER BY count DESC
  `).all() as { pattern_matched: string; count: number }[];

  const by_pattern: Record<string, number> = {};
  for (const row of patternRows) {
    by_pattern[row.pattern_matched] = row.count;
  }

  // Recent 24h
  const oneDayAgo = now() - (24 * 60 * 60 * 1000);
  const recentRow = db.prepare(`
    SELECT COUNT(*) as count FROM guard_blocks
    WHERE blocked_at > ?
  `).get(oneDayAgo) as { count: number };

  return {
    total: totalRow.count,
    by_pattern,
    recent_24h: recentRow.count,
  };
}

/**
 * Get count of blocks for a specific worker in a time window.
 * Useful for detecting patterns of repeated dangerous command attempts.
 */
export function getBlockCountForWorker(workerId: string, windowMs: number): number {
  const db = getDb();
  const cutoff = now() - windowMs;

  const row = db.prepare(`
    SELECT COUNT(*) as count FROM guard_blocks
    WHERE worker_id = ? AND blocked_at > ?
  `).get(workerId, cutoff) as { count: number };

  return row.count;
}
