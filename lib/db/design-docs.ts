/**
 * Design Docs CRUD operations
 *
 * Design Docs define HOW to achieve an outcome.
 * They can change without changing the Intent (PRD).
 * Versioned for history tracking.
 */

import { getDb, now } from './index';
import { generateId } from '../utils/id';
import type { DesignDoc } from './schema';
import { touchOutcome } from './outcomes';

// ============================================================================
// Create
// ============================================================================

export interface CreateDesignDocInput {
  outcome_id: string;
  approach: string;
}

export function createDesignDoc(input: CreateDesignDocInput): DesignDoc {
  const db = getDb();
  const timestamp = now();
  const id = generateId('design');

  // Get the next version number
  const lastVersion = db.prepare(`
    SELECT MAX(version) as max_version FROM design_docs WHERE outcome_id = ?
  `).get(input.outcome_id) as { max_version: number | null };

  const version = (lastVersion.max_version ?? 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO design_docs (id, outcome_id, version, approach, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, input.outcome_id, version, input.approach, timestamp, timestamp);

  touchOutcome(input.outcome_id);

  return getDesignDocById(id)!;
}

// ============================================================================
// Read
// ============================================================================

export function getDesignDocById(id: string): DesignDoc | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM design_docs WHERE id = ?').get(id) as DesignDoc | undefined;
  return row || null;
}

export function getLatestDesignDoc(outcomeId: string): DesignDoc | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM design_docs
    WHERE outcome_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(outcomeId) as DesignDoc | undefined;
  return row || null;
}

export function getDesignDocHistory(outcomeId: string): DesignDoc[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM design_docs
    WHERE outcome_id = ?
    ORDER BY version DESC
  `).all(outcomeId) as DesignDoc[];
}

export function getDesignDocByVersion(outcomeId: string, version: number): DesignDoc | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM design_docs
    WHERE outcome_id = ? AND version = ?
  `).get(outcomeId, version) as DesignDoc | undefined;
  return row || null;
}

// ============================================================================
// Update
// ============================================================================

/**
 * Update the approach. This creates a new version.
 */
export function updateDesignDocApproach(outcomeId: string, approach: string): DesignDoc {
  // Creating a new version effectively "updates" the design doc
  return createDesignDoc({ outcome_id: outcomeId, approach });
}

// ============================================================================
// Delete
// ============================================================================

export function deleteDesignDoc(id: string): boolean {
  const db = getDb();
  const doc = getDesignDocById(id);

  const result = db.prepare('DELETE FROM design_docs WHERE id = ?').run(id);

  if (result.changes > 0 && doc) {
    touchOutcome(doc.outcome_id);
  }

  return result.changes > 0;
}

/**
 * Delete all design doc history for an outcome.
 */
export function deleteDesignDocHistory(outcomeId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM design_docs WHERE outcome_id = ?').run(outcomeId);
  return result.changes;
}
