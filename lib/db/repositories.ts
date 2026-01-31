/**
 * Repository Configuration CRUD operations
 *
 * Manages configured repositories for storing outputs, skills, tools, and files.
 */

import { getDb, now } from './index';
import type {
  Repository,
  RepositoryType,
  ContentType,
  OutcomeItem,
  OutcomeItemType,
  SaveTarget,
} from './schema';
import { generateId } from '../utils/id';

// ============================================================================
// Repository CRUD
// ============================================================================

export interface CreateRepositoryInput {
  name: string;
  type: RepositoryType;
  content_type: ContentType;
  repo_url?: string;
  local_path: string;
  branch?: string;
  auto_push?: boolean;
  require_pr?: boolean;
}

export interface UpdateRepositoryInput {
  name?: string;
  repo_url?: string;
  local_path?: string;
  branch?: string;
  auto_push?: boolean;
  require_pr?: boolean;
  last_synced_at?: number;
}

/**
 * Create a new repository configuration
 */
export function createRepository(input: CreateRepositoryInput): Repository {
  const db = getDb();
  const id = generateId('repo');
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO repositories (
      id, name, type, content_type, repo_url, local_path, branch,
      auto_push, require_pr, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.name,
    input.type,
    input.content_type,
    input.repo_url || null,
    input.local_path,
    input.branch || 'main',
    input.auto_push !== false ? 1 : 0,
    input.require_pr ? 1 : 0,
    timestamp,
    timestamp
  );

  return getRepositoryById(id)!;
}

/**
 * Get a repository by ID
 */
export function getRepositoryById(id: string): Repository | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM repositories WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRowToRepository(row);
}

/**
 * Get all repositories
 */
export function getAllRepositories(): Repository[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM repositories ORDER BY type, name');
  const rows = stmt.all() as Record<string, unknown>[];
  return rows.map(mapRowToRepository);
}

/**
 * Get repositories by type
 */
export function getRepositoriesByType(type: RepositoryType): Repository[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM repositories WHERE type = ? ORDER BY name');
  const rows = stmt.all(type) as Record<string, unknown>[];
  return rows.map(mapRowToRepository);
}

/**
 * Get repository for a specific content type and repo type
 */
export function getRepositoryFor(
  contentType: ContentType,
  repoType: RepositoryType
): Repository | null {
  const db = getDb();
  // First try exact match, then fall back to 'all' type
  const stmt = db.prepare(`
    SELECT * FROM repositories
    WHERE type = ? AND (content_type = ? OR content_type = 'all')
    ORDER BY CASE WHEN content_type = ? THEN 0 ELSE 1 END
    LIMIT 1
  `);
  const row = stmt.get(repoType, contentType, contentType) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRowToRepository(row);
}

/**
 * Update a repository
 */
export function updateRepository(id: string, input: UpdateRepositoryInput): Repository | null {
  const db = getDb();
  const existing = getRepositoryById(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.repo_url !== undefined) {
    updates.push('repo_url = ?');
    values.push(input.repo_url);
  }
  if (input.local_path !== undefined) {
    updates.push('local_path = ?');
    values.push(input.local_path);
  }
  if (input.branch !== undefined) {
    updates.push('branch = ?');
    values.push(input.branch);
  }
  if (input.auto_push !== undefined) {
    updates.push('auto_push = ?');
    values.push(input.auto_push ? 1 : 0);
  }
  if (input.require_pr !== undefined) {
    updates.push('require_pr = ?');
    values.push(input.require_pr ? 1 : 0);
  }
  if (input.last_synced_at !== undefined) {
    updates.push('last_synced_at = ?');
    values.push(input.last_synced_at);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);

  const stmt = db.prepare(`UPDATE repositories SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getRepositoryById(id);
}

/**
 * Delete a repository
 */
export function deleteRepository(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM repositories WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============================================================================
// Outcome Item CRUD
// ============================================================================

export interface CreateOutcomeItemInput {
  outcome_id: string;
  item_type: OutcomeItemType;
  filename: string;
  file_path: string;
  target_override?: SaveTarget;
}

export interface UpdateOutcomeItemInput {
  target_override?: SaveTarget | null;
  synced_to_private?: boolean;
  synced_to_team?: boolean;
  last_synced_at?: number;
}

/**
 * Create or update an outcome item (upsert)
 */
export function upsertOutcomeItem(input: CreateOutcomeItemInput): OutcomeItem {
  const db = getDb();
  const existing = getOutcomeItem(input.outcome_id, input.item_type, input.filename);

  if (existing) {
    return updateOutcomeItem(existing.id, {
      target_override: input.target_override,
    }) || existing;
  }

  const id = generateId('item');
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO outcome_items (
      id, outcome_id, item_type, filename, file_path, target_override,
      synced_to_private, synced_to_team, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `);

  stmt.run(
    id,
    input.outcome_id,
    input.item_type,
    input.filename,
    input.file_path,
    input.target_override || null,
    timestamp,
    timestamp
  );

  return getOutcomeItemById(id)!;
}

/**
 * Get an outcome item by ID
 */
export function getOutcomeItemById(id: string): OutcomeItem | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM outcome_items WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRowToOutcomeItem(row);
}

/**
 * Get an outcome item by composite key
 */
export function getOutcomeItem(
  outcomeId: string,
  itemType: OutcomeItemType,
  filename: string
): OutcomeItem | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM outcome_items
    WHERE outcome_id = ? AND item_type = ? AND filename = ?
  `);
  const row = stmt.get(outcomeId, itemType, filename) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRowToOutcomeItem(row);
}

/**
 * Get all items for an outcome
 */
export function getOutcomeItems(outcomeId: string): OutcomeItem[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM outcome_items
    WHERE outcome_id = ?
    ORDER BY item_type, filename
  `);
  const rows = stmt.all(outcomeId) as Record<string, unknown>[];
  return rows.map(mapRowToOutcomeItem);
}

/**
 * Get items by type for an outcome
 */
export function getOutcomeItemsByType(
  outcomeId: string,
  itemType: OutcomeItemType
): OutcomeItem[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM outcome_items
    WHERE outcome_id = ? AND item_type = ?
    ORDER BY filename
  `);
  const rows = stmt.all(outcomeId, itemType) as Record<string, unknown>[];
  return rows.map(mapRowToOutcomeItem);
}

/**
 * Get items that need syncing
 */
export function getUnsyncedItems(
  outcomeId: string,
  target: 'private' | 'team'
): OutcomeItem[] {
  const db = getDb();
  const column = target === 'private' ? 'synced_to_private' : 'synced_to_team';
  const stmt = db.prepare(`
    SELECT * FROM outcome_items
    WHERE outcome_id = ? AND ${column} = 0
    ORDER BY item_type, filename
  `);
  const rows = stmt.all(outcomeId) as Record<string, unknown>[];
  return rows.map(mapRowToOutcomeItem);
}

/**
 * Update an outcome item
 */
export function updateOutcomeItem(id: string, input: UpdateOutcomeItemInput): OutcomeItem | null {
  const db = getDb();
  const existing = getOutcomeItemById(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.target_override !== undefined) {
    updates.push('target_override = ?');
    values.push(input.target_override);
  }
  if (input.synced_to_private !== undefined) {
    updates.push('synced_to_private = ?');
    values.push(input.synced_to_private ? 1 : 0);
  }
  if (input.synced_to_team !== undefined) {
    updates.push('synced_to_team = ?');
    values.push(input.synced_to_team ? 1 : 0);
  }
  if (input.last_synced_at !== undefined) {
    updates.push('last_synced_at = ?');
    values.push(input.last_synced_at);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);

  const stmt = db.prepare(`UPDATE outcome_items SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getOutcomeItemById(id);
}

/**
 * Delete an outcome item
 */
export function deleteOutcomeItem(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM outcome_items WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Mark an item as synced
 */
export function markItemSynced(
  id: string,
  target: 'private' | 'team'
): OutcomeItem | null {
  return updateOutcomeItem(id, {
    [target === 'private' ? 'synced_to_private' : 'synced_to_team']: true,
    last_synced_at: now(),
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapRowToRepository(row: Record<string, unknown>): Repository {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as RepositoryType,
    content_type: row.content_type as ContentType,
    repo_url: row.repo_url as string | null,
    local_path: row.local_path as string,
    branch: row.branch as string,
    auto_push: row.auto_push === 1,
    require_pr: row.require_pr === 1,
    last_synced_at: row.last_synced_at as number | null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

function mapRowToOutcomeItem(row: Record<string, unknown>): OutcomeItem {
  return {
    id: row.id as string,
    outcome_id: row.outcome_id as string,
    item_type: row.item_type as OutcomeItemType,
    filename: row.filename as string,
    file_path: row.file_path as string,
    target_override: row.target_override as SaveTarget | null,
    synced_to_private: row.synced_to_private === 1,
    synced_to_team: row.synced_to_team === 1,
    last_synced_at: row.last_synced_at as number | null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

// ============================================================================
// Outcome Save Target Helpers
// ============================================================================

/**
 * Get the effective save target for an item
 * Returns the item's override if set, otherwise the outcome's default
 */
export function getEffectiveSaveTarget(
  item: OutcomeItem,
  outcomeDefaults: {
    output_target: SaveTarget;
    skill_target: SaveTarget;
    tool_target: SaveTarget;
    file_target: SaveTarget;
  }
): SaveTarget {
  if (item.target_override) {
    return item.target_override;
  }

  switch (item.item_type) {
    case 'output':
      return outcomeDefaults.output_target;
    case 'skill':
      return outcomeDefaults.skill_target;
    case 'tool':
      return outcomeDefaults.tool_target;
    case 'file':
      return outcomeDefaults.file_target;
    default:
      return 'local';
  }
}
