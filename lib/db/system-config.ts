/**
 * System Configuration CRUD operations
 *
 * Manages system-wide configuration settings stored in a key/value store.
 * Used for global defaults like default_isolation_mode.
 */

import { getDb, now } from './index';
import type { IsolationMode } from './schema';

// ============================================================================
// Types
// ============================================================================

export interface SystemConfig {
  key: string;
  value: string;
  updated_at: number;
}

export interface SystemConfigMap {
  default_isolation_mode?: IsolationMode;
  [key: string]: string | undefined;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Get a single config value by key
 */
export function getConfig(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Set a config value (insert or update)
 */
export function setConfig(key: string, value: string): void {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, timestamp);
}

/**
 * Delete a config value
 */
export function deleteConfig(key: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM system_config WHERE key = ?').run(key);
  return result.changes > 0;
}

/**
 * Get all config values as a map
 */
export function getAllConfig(): SystemConfigMap {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM system_config').all() as SystemConfig[];

  const config: SystemConfigMap = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  return config;
}

// ============================================================================
// Typed Helpers
// ============================================================================

/**
 * Get the default isolation mode for new outcomes
 * Returns 'workspace' if not configured (safe by default)
 */
export function getDefaultIsolationMode(): IsolationMode {
  const value = getConfig('default_isolation_mode');
  if (value === 'workspace' || value === 'codebase') {
    return value;
  }
  return 'workspace'; // Safe default
}

/**
 * Set the default isolation mode for new outcomes
 */
export function setDefaultIsolationMode(mode: IsolationMode): void {
  setConfig('default_isolation_mode', mode);
}
