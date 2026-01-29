/**
 * Review Cycles CRUD operations
 *
 * Review cycles track the periodic review of work quality.
 * Used for convergence tracking (fewer issues = getting close to done).
 */

import { getDb, now } from './index';
import { generateId } from '../utils/id';
import type { ReviewCycle, VerificationResult } from './schema';
import { touchOutcome } from './outcomes';

// ============================================================================
// Create
// ============================================================================

export interface CreateReviewCycleInput {
  outcome_id: string;
  worker_id?: string;
  iteration_at: number;
  issues_found: number;
  tasks_added: number;
  verification?: VerificationResult;
}

export function createReviewCycle(input: CreateReviewCycleInput): ReviewCycle {
  const db = getDb();
  const timestamp = now();
  const id = generateId('review');

  // Get next cycle number
  const lastCycle = db.prepare(`
    SELECT MAX(cycle_number) as max_cycle FROM review_cycles WHERE outcome_id = ?
  `).get(input.outcome_id) as { max_cycle: number | null };

  const cycleNumber = (lastCycle.max_cycle ?? 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO review_cycles (
      id, outcome_id, worker_id, cycle_number, iteration_at,
      issues_found, tasks_added, verification, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.outcome_id,
    input.worker_id || null,
    cycleNumber,
    input.iteration_at,
    input.issues_found,
    input.tasks_added,
    input.verification ? JSON.stringify(input.verification) : null,
    timestamp
  );

  touchOutcome(input.outcome_id);

  return getReviewCycleById(id)!;
}

// ============================================================================
// Read
// ============================================================================

export function getReviewCycleById(id: string): ReviewCycle | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM review_cycles WHERE id = ?').get(id) as ReviewCycle | undefined;
  return row || null;
}

export function getReviewCyclesByOutcome(outcomeId: string): ReviewCycle[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM review_cycles
    WHERE outcome_id = ?
    ORDER BY cycle_number DESC
  `).all(outcomeId) as ReviewCycle[];
}

export function getLatestReviewCycle(outcomeId: string): ReviewCycle | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM review_cycles
    WHERE outcome_id = ?
    ORDER BY cycle_number DESC
    LIMIT 1
  `).get(outcomeId) as ReviewCycle | undefined;
  return row || null;
}

export function getReviewCycleByNumber(outcomeId: string, cycleNumber: number): ReviewCycle | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM review_cycles
    WHERE outcome_id = ? AND cycle_number = ?
  `).get(outcomeId, cycleNumber) as ReviewCycle | undefined;
  return row || null;
}

// ============================================================================
// Convergence Detection
// ============================================================================

export interface ConvergenceStatus {
  is_converging: boolean;
  consecutive_zero_issues: number;
  trend: 'improving' | 'stable' | 'worsening' | 'unknown';
  last_issues: number;
  previous_issues: number | null;
  total_cycles: number;
}

export function getConvergenceStatus(outcomeId: string): ConvergenceStatus {
  const db = getDb();

  // Get recent cycles
  const cycles = db.prepare(`
    SELECT issues_found FROM review_cycles
    WHERE outcome_id = ?
    ORDER BY cycle_number DESC
    LIMIT 5
  `).all(outcomeId) as { issues_found: number }[];

  if (cycles.length === 0) {
    return {
      is_converging: false,
      consecutive_zero_issues: 0,
      trend: 'unknown',
      last_issues: 0,
      previous_issues: null,
      total_cycles: 0,
    };
  }

  // Count consecutive zeros
  let consecutiveZeros = 0;
  for (const cycle of cycles) {
    if (cycle.issues_found === 0) {
      consecutiveZeros++;
    } else {
      break;
    }
  }

  // Determine trend
  let trend: 'improving' | 'stable' | 'worsening' | 'unknown' = 'unknown';
  if (cycles.length >= 2) {
    const last = cycles[0].issues_found;
    const previous = cycles[1].issues_found;
    if (last < previous) {
      trend = 'improving';
    } else if (last > previous) {
      trend = 'worsening';
    } else {
      trend = 'stable';
    }
  }

  // Get total count
  const totalResult = db.prepare(`
    SELECT COUNT(*) as count FROM review_cycles WHERE outcome_id = ?
  `).get(outcomeId) as { count: number };

  return {
    is_converging: consecutiveZeros >= 2 || (trend === 'improving' && cycles[0].issues_found <= 2),
    consecutive_zero_issues: consecutiveZeros,
    trend,
    last_issues: cycles[0].issues_found,
    previous_issues: cycles.length >= 2 ? cycles[1].issues_found : null,
    total_cycles: totalResult.count,
  };
}

/**
 * Check if outcome has converged (ready to complete).
 * Convergence = 2+ consecutive review cycles with 0 issues.
 */
export function hasConverged(outcomeId: string): boolean {
  const status = getConvergenceStatus(outcomeId);
  return status.consecutive_zero_issues >= 2;
}

// ============================================================================
// Parse Verification
// ============================================================================

export function parseVerification(reviewCycle: ReviewCycle): VerificationResult | null {
  if (!reviewCycle.verification) return null;
  try {
    return JSON.parse(reviewCycle.verification) as VerificationResult;
  } catch {
    return null;
  }
}

// ============================================================================
// Delete
// ============================================================================

export function deleteReviewCycle(id: string): boolean {
  const db = getDb();
  const cycle = getReviewCycleById(id);

  const result = db.prepare('DELETE FROM review_cycles WHERE id = ?').run(id);

  if (result.changes > 0 && cycle) {
    touchOutcome(cycle.outcome_id);
  }

  return result.changes > 0;
}

export function deleteReviewCyclesByOutcome(outcomeId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM review_cycles WHERE outcome_id = ?').run(outcomeId);
  return result.changes;
}
