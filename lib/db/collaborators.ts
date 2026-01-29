/**
 * Collaborators CRUD operations
 *
 * Collaborators are people with access to specific outcomes.
 * They can be owners, collaborators, or viewers.
 */

import { getDb, now } from './index';
import { generateId } from '../utils/id';
import type { Collaborator } from './schema';

// ============================================================================
// Create
// ============================================================================

export interface InviteCollaboratorInput {
  outcome_id: string;
  email: string;
  name?: string;
  role?: 'owner' | 'collaborator' | 'viewer';
}

export function inviteCollaborator(input: InviteCollaboratorInput): Collaborator {
  const db = getDb();
  const timestamp = now();
  const id = generateId('collab');

  const stmt = db.prepare(`
    INSERT INTO collaborators (id, outcome_id, email, name, role, invited_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(outcome_id, email) DO UPDATE SET
      name = COALESCE(excluded.name, name),
      role = excluded.role,
      invited_at = excluded.invited_at
  `);

  stmt.run(
    id,
    input.outcome_id,
    input.email.toLowerCase(),
    input.name || null,
    input.role || 'collaborator',
    timestamp
  );

  return getCollaboratorByEmail(input.outcome_id, input.email)!;
}

// ============================================================================
// Read
// ============================================================================

export function getCollaboratorById(id: string): Collaborator | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM collaborators WHERE id = ?').get(id) as Collaborator | undefined;
  return row || null;
}

export function getCollaboratorByEmail(outcomeId: string, email: string): Collaborator | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM collaborators WHERE outcome_id = ? AND email = ?
  `).get(outcomeId, email.toLowerCase()) as Collaborator | undefined;
  return row || null;
}

export function getCollaboratorsByOutcome(outcomeId: string): Collaborator[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM collaborators WHERE outcome_id = ?
    ORDER BY role ASC, invited_at ASC
  `).all(outcomeId) as Collaborator[];
}

export function getOutcomesByCollaborator(email: string): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT outcome_id FROM collaborators WHERE email = ?
  `).all(email.toLowerCase()) as { outcome_id: string }[];
  return rows.map(r => r.outcome_id);
}

// ============================================================================
// Update
// ============================================================================

export function acceptInvitation(id: string): Collaborator | null {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    UPDATE collaborators SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL
  `).run(timestamp, id);

  if (result.changes === 0) return null;
  return getCollaboratorById(id);
}

export function updateCollaboratorRole(
  id: string,
  role: 'owner' | 'collaborator' | 'viewer'
): Collaborator | null {
  const db = getDb();

  const result = db.prepare(`
    UPDATE collaborators SET role = ? WHERE id = ?
  `).run(role, id);

  if (result.changes === 0) return null;
  return getCollaboratorById(id);
}

// ============================================================================
// Delete
// ============================================================================

export function removeCollaborator(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM collaborators WHERE id = ?').run(id);
  return result.changes > 0;
}

export function removeCollaboratorByEmail(outcomeId: string, email: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM collaborators WHERE outcome_id = ? AND email = ?
  `).run(outcomeId, email.toLowerCase());
  return result.changes > 0;
}
