/**
 * Repository Configuration CRUD operations
 *
 * Manages configured repositories for storing outcomes' skills, tools, files, and outputs.
 * Supports inheritance: child outcomes inherit repository settings from parents.
 */

import { getDb, now } from './index';
import type {
  Repository,
  OutcomeItem,
  OutcomeItemType,
  SaveTarget,
  Outcome,
  ItemRepoSync,
  SyncStatus,
} from './schema';
import { generateId } from '../utils/id';

// ============================================================================
// Repository CRUD
// ============================================================================

export interface CreateRepositoryInput {
  name: string;
  local_path: string;
  remote_url?: string;
  auto_push?: boolean;
}

export interface UpdateRepositoryInput {
  name?: string;
  local_path?: string;
  remote_url?: string;
  auto_push?: boolean;
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
      id, name, local_path, remote_url, auto_push, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.name,
    input.local_path,
    input.remote_url || null,
    input.auto_push !== false ? 1 : 0,
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
  const stmt = db.prepare('SELECT * FROM repositories ORDER BY name');
  const rows = stmt.all() as Record<string, unknown>[];
  return rows.map(mapRowToRepository);
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
  if (input.local_path !== undefined) {
    updates.push('local_path = ?');
    values.push(input.local_path);
  }
  if (input.remote_url !== undefined) {
    updates.push('remote_url = ?');
    values.push(input.remote_url);
  }
  if (input.auto_push !== undefined) {
    updates.push('auto_push = ?');
    values.push(input.auto_push ? 1 : 0);
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

/**
 * Check if a repository is in use by any outcome
 */
export function isRepositoryInUse(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM outcomes WHERE repository_id = ?');
  const row = stmt.get(id) as { count: number };
  return row.count > 0;
}

/**
 * Get outcomes using a repository
 */
export function getOutcomesUsingRepository(id: string): { id: string; name: string }[] {
  const db = getDb();
  const stmt = db.prepare('SELECT id, name FROM outcomes WHERE repository_id = ?');
  return stmt.all(id) as { id: string; name: string }[];
}

// ============================================================================
// Inheritance Resolution
// ============================================================================

/**
 * Get the effective repository for an outcome, walking up the hierarchy
 */
export function getEffectiveRepository(outcomeId: string): Repository | null {
  const db = getDb();

  // Get the outcome
  const outcomeStmt = db.prepare('SELECT id, repository_id, parent_id FROM outcomes WHERE id = ?');
  const outcome = outcomeStmt.get(outcomeId) as { id: string; repository_id: string | null; parent_id: string | null } | undefined;

  if (!outcome) return null;

  // If this outcome has a repository, use it
  if (outcome.repository_id) {
    return getRepositoryById(outcome.repository_id);
  }

  // Otherwise, walk up to parent
  if (outcome.parent_id) {
    return getEffectiveRepository(outcome.parent_id);
  }

  // No repository found in hierarchy
  return null;
}

/**
 * Get the effective save target for a content type, resolving inheritance
 */
export function getEffectiveTarget(
  outcomeId: string,
  targetType: 'output_target' | 'skill_target' | 'tool_target' | 'file_target'
): 'local' | 'repo' {
  const db = getDb();

  const outcomeStmt = db.prepare(`SELECT id, ${targetType}, parent_id FROM outcomes WHERE id = ?`);
  const outcome = outcomeStmt.get(outcomeId) as { id: string; [key: string]: unknown } | undefined;

  if (!outcome) return 'local';

  const target = outcome[targetType] as SaveTarget;

  // If target is explicit (not inherit), return it
  if (target === 'local' || target === 'repo') {
    return target;
  }

  // If inherit, walk up to parent
  if (target === 'inherit' && outcome.parent_id) {
    return getEffectiveTarget(outcome.parent_id as string, targetType);
  }

  // Default to local
  return 'local';
}

/**
 * Get the effective auto_save setting, resolving inheritance
 */
export function getEffectiveAutoSave(outcomeId: string): boolean {
  const db = getDb();

  const outcomeStmt = db.prepare('SELECT id, auto_save, parent_id FROM outcomes WHERE id = ?');
  const outcome = outcomeStmt.get(outcomeId) as { id: string; auto_save: string; parent_id: string | null } | undefined;

  if (!outcome) return false;

  // If explicit value (not 'inherit'), return it
  if (outcome.auto_save === '1' || outcome.auto_save === 'true') return true;
  if (outcome.auto_save === '0' || outcome.auto_save === 'false') return false;

  // If inherit, walk up to parent
  if (outcome.auto_save === 'inherit' && outcome.parent_id) {
    return getEffectiveAutoSave(outcome.parent_id);
  }

  // Default to false
  return false;
}

/**
 * Get all effective settings for an outcome (resolved through inheritance)
 */
export function getEffectiveRepoSettings(outcomeId: string): {
  repository: Repository | null;
  output_target: 'local' | 'repo';
  skill_target: 'local' | 'repo';
  tool_target: 'local' | 'repo';
  file_target: 'local' | 'repo';
  auto_save: boolean;
} {
  return {
    repository: getEffectiveRepository(outcomeId),
    output_target: getEffectiveTarget(outcomeId, 'output_target'),
    skill_target: getEffectiveTarget(outcomeId, 'skill_target'),
    tool_target: getEffectiveTarget(outcomeId, 'tool_target'),
    file_target: getEffectiveTarget(outcomeId, 'file_target'),
    auto_save: getEffectiveAutoSave(outcomeId),
  };
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
  synced_to?: string | null;
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
      synced_to, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
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
 * Get items that need syncing (not yet synced to the outcome's repo)
 */
export function getUnsyncedItems(outcomeId: string): OutcomeItem[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM outcome_items
    WHERE outcome_id = ? AND synced_to IS NULL
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
  if (input.synced_to !== undefined) {
    updates.push('synced_to = ?');
    values.push(input.synced_to);
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
 * Mark an item as synced to a repository
 */
export function markItemSynced(id: string, repositoryId: string): OutcomeItem | null {
  return updateOutcomeItem(id, {
    synced_to: repositoryId,
    last_synced_at: now(),
  });
}

/**
 * Mark an item as unsynced (local only)
 */
export function markItemUnsynced(id: string): OutcomeItem | null {
  return updateOutcomeItem(id, {
    synced_to: null,
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapRowToRepository(row: Record<string, unknown>): Repository {
  return {
    id: row.id as string,
    name: row.name as string,
    local_path: row.local_path as string,
    remote_url: row.remote_url as string | null,
    auto_push: row.auto_push === 1,
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
    synced_to: row.synced_to as string | null,
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
 * Returns the item's override if set, otherwise resolves through outcome inheritance
 */
export function getEffectiveSaveTarget(
  item: OutcomeItem,
  outcomeId: string
): 'local' | 'repo' {
  // If item has explicit override
  if (item.target_override === 'local') return 'local';
  if (item.target_override === 'repo') return 'repo';

  // Otherwise, get from outcome (with inheritance)
  const targetType = {
    output: 'output_target',
    skill: 'skill_target',
    tool: 'tool_target',
    file: 'file_target',
  }[item.item_type] as 'output_target' | 'skill_target' | 'tool_target' | 'file_target';

  return getEffectiveTarget(outcomeId, targetType);
}

// ============================================================================
// Item-Repository Sync Junction Table CRUD
// ============================================================================

export interface CreateItemRepoSyncInput {
  item_id: string;
  repo_id: string;
  synced_at?: number;
  commit_hash?: string;
  sync_status?: SyncStatus;
  error_message?: string;
}

export interface UpdateItemRepoSyncInput {
  synced_at?: number;
  commit_hash?: string;
  sync_status?: SyncStatus;
  error_message?: string;
}

/**
 * Create a new item-to-repo sync record
 */
export function createItemRepoSync(input: CreateItemRepoSyncInput): ItemRepoSync {
  const db = getDb();
  const id = generateId('irs');
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO item_repo_syncs (
      id, item_id, repo_id, synced_at, commit_hash, sync_status, error_message, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.item_id,
    input.repo_id,
    input.synced_at ?? timestamp,
    input.commit_hash ?? null,
    input.sync_status ?? 'synced',
    input.error_message ?? null,
    timestamp,
    timestamp
  );

  return getItemRepoSyncById(id)!;
}

/**
 * Get an item-repo sync by ID
 */
export function getItemRepoSyncById(id: string): ItemRepoSync | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM item_repo_syncs WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRowToItemRepoSync(row);
}

/**
 * Get all syncs for an item (which repos is this item synced to?)
 */
export function getItemRepoSyncs(itemId: string): ItemRepoSync[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM item_repo_syncs
    WHERE item_id = ?
    ORDER BY synced_at DESC
  `);
  const rows = stmt.all(itemId) as Record<string, unknown>[];
  return rows.map(mapRowToItemRepoSync);
}

/**
 * Get all syncs for an item with repository details
 */
export function getItemRepoSyncsWithDetails(itemId: string): (ItemRepoSync & { repo_name: string })[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT irs.*, r.name as repo_name
    FROM item_repo_syncs irs
    JOIN repositories r ON irs.repo_id = r.id
    WHERE irs.item_id = ?
    ORDER BY irs.synced_at DESC
  `);
  const rows = stmt.all(itemId) as Record<string, unknown>[];
  return rows.map(row => ({
    ...mapRowToItemRepoSync(row),
    repo_name: row.repo_name as string,
  }));
}

/**
 * Get all syncs for a repository (which items are synced to this repo?)
 */
export function getSyncsByRepo(repoId: string): ItemRepoSync[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM item_repo_syncs
    WHERE repo_id = ?
    ORDER BY synced_at DESC
  `);
  const rows = stmt.all(repoId) as Record<string, unknown>[];
  return rows.map(mapRowToItemRepoSync);
}

/**
 * Get a specific item-repo sync by composite key
 */
export function getItemRepoSyncByKey(itemId: string, repoId: string): ItemRepoSync | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM item_repo_syncs
    WHERE item_id = ? AND repo_id = ?
  `);
  const row = stmt.get(itemId, repoId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRowToItemRepoSync(row);
}

/**
 * Check if an item is synced to a specific repository
 */
export function isItemSyncedToRepo(itemId: string, repoId: string): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT 1 FROM item_repo_syncs
    WHERE item_id = ? AND repo_id = ? AND sync_status = 'synced'
    LIMIT 1
  `);
  const row = stmt.get(itemId, repoId);
  return !!row;
}

/**
 * Update an item-repo sync record
 */
export function updateItemRepoSync(id: string, input: UpdateItemRepoSyncInput): ItemRepoSync | null {
  const db = getDb();
  const existing = getItemRepoSyncById(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.synced_at !== undefined) {
    updates.push('synced_at = ?');
    values.push(input.synced_at);
  }
  if (input.commit_hash !== undefined) {
    updates.push('commit_hash = ?');
    values.push(input.commit_hash);
  }
  if (input.sync_status !== undefined) {
    updates.push('sync_status = ?');
    values.push(input.sync_status);
  }
  if (input.error_message !== undefined) {
    updates.push('error_message = ?');
    values.push(input.error_message);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);

  const stmt = db.prepare(`UPDATE item_repo_syncs SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getItemRepoSyncById(id);
}

/**
 * Upsert an item-repo sync (create or update)
 */
export function upsertItemRepoSync(input: CreateItemRepoSyncInput): ItemRepoSync {
  const existing = getItemRepoSyncByKey(input.item_id, input.repo_id);
  if (existing) {
    return updateItemRepoSync(existing.id, {
      synced_at: input.synced_at,
      commit_hash: input.commit_hash,
      sync_status: input.sync_status,
      error_message: input.error_message,
    }) || existing;
  }
  return createItemRepoSync(input);
}

/**
 * Delete an item-repo sync record
 */
export function deleteItemRepoSync(itemId: string, repoId: string): boolean {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM item_repo_syncs WHERE item_id = ? AND repo_id = ?');
  const result = stmt.run(itemId, repoId);
  return result.changes > 0;
}

/**
 * Delete all syncs for an item
 */
export function deleteAllItemSyncs(itemId: string): number {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM item_repo_syncs WHERE item_id = ?');
  const result = stmt.run(itemId);
  return result.changes;
}

/**
 * Mark an item as stale in a specific repo (file modified since sync)
 */
export function markItemStale(itemId: string, repoId: string): boolean {
  const sync = getItemRepoSyncByKey(itemId, repoId);
  if (!sync) return false;
  updateItemRepoSync(sync.id, { sync_status: 'stale' });
  return true;
}

/**
 * Mark an item sync as failed
 */
export function markItemSyncFailed(itemId: string, repoId: string, errorMessage: string): boolean {
  const sync = getItemRepoSyncByKey(itemId, repoId);
  if (!sync) return false;
  updateItemRepoSync(sync.id, {
    sync_status: 'failed',
    error_message: errorMessage,
  });
  return true;
}

/**
 * Get all repos that an item is synced to (just IDs)
 */
export function getItemSyncedRepoIds(itemId: string): string[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT repo_id FROM item_repo_syncs
    WHERE item_id = ? AND sync_status = 'synced'
  `);
  const rows = stmt.all(itemId) as { repo_id: string }[];
  return rows.map(r => r.repo_id);
}

/**
 * Get item sync status summary (for UI)
 */
export function getItemSyncStatus(itemId: string): {
  syncs: (ItemRepoSync & { repo_name: string })[];
  available_repos: Repository[];
} {
  const syncs = getItemRepoSyncsWithDetails(itemId);
  const syncedRepoIds = new Set(syncs.map(s => s.repo_id));
  const allRepos = getAllRepositories();
  const available_repos = allRepos.filter(r => !syncedRepoIds.has(r.id));

  return { syncs, available_repos };
}

// ============================================================================
// Helper: Map row to ItemRepoSync
// ============================================================================

function mapRowToItemRepoSync(row: Record<string, unknown>): ItemRepoSync {
  return {
    id: row.id as string,
    item_id: row.item_id as string,
    repo_id: row.repo_id as string,
    synced_at: row.synced_at as number,
    commit_hash: row.commit_hash as string | null,
    sync_status: row.sync_status as SyncStatus,
    error_message: row.error_message as string | null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}
