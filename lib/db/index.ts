/**
 * Database initialization and connection management
 */

import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA_SQL } from './schema';

/**
 * Check if a process with the given PID is still running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH = process not found, EPERM = exists but no permission (still running)
    return false;
  }
}

// Database file path
const DB_PATH = path.join(process.cwd(), 'data', 'twin.db');

// Singleton database instance
let db: Database.Database | null = null;

/**
 * Get the database instance, initializing if needed
 */
export function getDb(): Database.Database {
  if (db) return db;

  // Create database with WAL mode for better concurrency
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Initialize schema
  db.exec(SCHEMA_SQL);

  // Run migrations for existing tables
  runMigrations(db);

  // Clean up orphaned tasks/workers from crashed processes
  cleanupOrphanedState(db);

  return db;
}

/**
 * Run database migrations to add new columns to existing tables
 */
function runMigrations(database: Database.Database): void {
  // Add raw_response column to review_cycles if it doesn't exist
  const reviewCyclesColumns = database.prepare(`PRAGMA table_info(review_cycles)`).all() as { name: string }[];
  const hasRawResponse = reviewCyclesColumns.some(col => col.name === 'raw_response');
  if (!hasRawResponse) {
    database.exec(`ALTER TABLE review_cycles ADD COLUMN raw_response TEXT`);
    console.log('[DB Migration] Added raw_response column to review_cycles');
  }

  // Add infrastructure_ready column to outcomes if it doesn't exist
  const outcomesColumns = database.prepare(`PRAGMA table_info(outcomes)`).all() as { name: string }[];
  const hasInfraReady = outcomesColumns.some(col => col.name === 'infrastructure_ready');
  if (!hasInfraReady) {
    database.exec(`ALTER TABLE outcomes ADD COLUMN infrastructure_ready INTEGER NOT NULL DEFAULT 0`);
    console.log('[DB Migration] Added infrastructure_ready column to outcomes');
  }

  // Add phase and infra_type columns to tasks if they don't exist
  const tasksColumns = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const hasPhase = tasksColumns.some(col => col.name === 'phase');
  if (!hasPhase) {
    database.exec(`ALTER TABLE tasks ADD COLUMN phase TEXT NOT NULL DEFAULT 'execution'`);
    console.log('[DB Migration] Added phase column to tasks');
  }
  const hasInfraType = tasksColumns.some(col => col.name === 'infra_type');
  if (!hasInfraType) {
    database.exec(`ALTER TABLE tasks ADD COLUMN infra_type TEXT`);
    console.log('[DB Migration] Added infra_type column to tasks');
  }

  // Add git configuration columns to outcomes
  const outcomesColumnsRefresh = database.prepare(`PRAGMA table_info(outcomes)`).all() as { name: string }[];
  const gitColumns = [
    { name: 'working_directory', sql: 'ALTER TABLE outcomes ADD COLUMN working_directory TEXT' },
    { name: 'git_mode', sql: `ALTER TABLE outcomes ADD COLUMN git_mode TEXT NOT NULL DEFAULT 'none'` },
    { name: 'base_branch', sql: 'ALTER TABLE outcomes ADD COLUMN base_branch TEXT' },
    { name: 'work_branch', sql: 'ALTER TABLE outcomes ADD COLUMN work_branch TEXT' },
    { name: 'auto_commit', sql: 'ALTER TABLE outcomes ADD COLUMN auto_commit INTEGER NOT NULL DEFAULT 0' },
    { name: 'create_pr_on_complete', sql: 'ALTER TABLE outcomes ADD COLUMN create_pr_on_complete INTEGER NOT NULL DEFAULT 0' },
  ];
  for (const col of gitColumns) {
    const exists = outcomesColumnsRefresh.some(c => c.name === col.name);
    if (!exists) {
      database.exec(col.sql);
      console.log(`[DB Migration] Added ${col.name} column to outcomes`);
    }
  }

  // Add full_output column to progress_entries for storing complete Claude output
  const progressColumns = database.prepare(`PRAGMA table_info(progress_entries)`).all() as { name: string }[];
  const hasFullOutput = progressColumns.some(col => col.name === 'full_output');
  if (!hasFullOutput) {
    database.exec(`ALTER TABLE progress_entries ADD COLUMN full_output TEXT`);
    console.log('[DB Migration] Added full_output column to progress_entries');
  }

  // Add pid column to workers for process tracking (proper pause/stop)
  const workersColumns = database.prepare(`PRAGMA table_info(workers)`).all() as { name: string }[];
  const hasPid = workersColumns.some(col => col.name === 'pid');
  if (!hasPid) {
    database.exec(`ALTER TABLE workers ADD COLUMN pid INTEGER`);
    console.log('[DB Migration] Added pid column to workers');
  }

  // Add supervisor settings columns to outcomes
  const supervisorColumns = [
    { name: 'supervisor_enabled', sql: 'ALTER TABLE outcomes ADD COLUMN supervisor_enabled INTEGER NOT NULL DEFAULT 1' },
    { name: 'pause_sensitivity', sql: `ALTER TABLE outcomes ADD COLUMN pause_sensitivity TEXT NOT NULL DEFAULT 'medium'` },
    { name: 'cot_review_frequency', sql: `ALTER TABLE outcomes ADD COLUMN cot_review_frequency TEXT NOT NULL DEFAULT 'every_task'` },
  ];
  const outcomeColsFinal = database.prepare(`PRAGMA table_info(outcomes)`).all() as { name: string }[];
  for (const col of supervisorColumns) {
    const exists = outcomeColsFinal.some(c => c.name === col.name);
    if (!exists) {
      database.exec(col.sql);
      console.log(`[DB Migration] Added ${col.name} column to outcomes`);
    }
  }

  // Add requires column to skills for API key requirements
  const skillsColumns = database.prepare(`PRAGMA table_info(skills)`).all() as { name: string }[];
  const hasRequires = skillsColumns.some(col => col.name === 'requires');
  if (!hasRequires) {
    database.exec(`ALTER TABLE skills ADD COLUMN requires TEXT`);
    console.log('[DB Migration] Added requires column to skills');
  }

  // Add required_skills column to tasks for skill dependency enforcement
  const tasksColumnsFinal = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const hasRequiredSkills = tasksColumnsFinal.some(col => col.name === 'required_skills');
  if (!hasRequiredSkills) {
    database.exec(`ALTER TABLE tasks ADD COLUMN required_skills TEXT`);
    console.log('[DB Migration] Added required_skills column to tasks');
  }
}

/**
 * Clean up orphaned tasks and workers from previous crashes/restarts
 * This runs on every startup to ensure stale state is reset
 */
function cleanupOrphanedState(database: Database.Database): void {
  // Find workers that are marked as 'running' but have a PID that's no longer alive
  const runningWorkers = database.prepare(`
    SELECT id, pid, outcome_id FROM workers WHERE status = 'running'
  `).all() as { id: string; pid: number | null; outcome_id: string }[];

  let orphanedWorkerIds: string[] = [];

  for (const worker of runningWorkers) {
    // If worker has no PID or PID is dead, it's orphaned
    const isOrphaned = !worker.pid || !isProcessRunning(worker.pid);

    if (isOrphaned) {
      orphanedWorkerIds.push(worker.id);

      // Mark worker as paused and clear PID
      database.prepare(`
        UPDATE workers SET status = 'paused', pid = NULL WHERE id = ?
      `).run(worker.id);

      console.log(`[DB Cleanup] Marked orphaned worker ${worker.id} as paused (PID ${worker.pid} not running)`);
    }
  }

  // Reset tasks that are 'running' or 'claimed' by orphaned workers (or any dead worker)
  const stuckTasks = database.prepare(`
    SELECT t.id, t.title, t.claimed_by, w.pid
    FROM tasks t
    LEFT JOIN workers w ON t.claimed_by = w.id
    WHERE t.status IN ('running', 'claimed')
  `).all() as { id: string; title: string; claimed_by: string | null; pid: number | null }[];

  let resetCount = 0;
  for (const task of stuckTasks) {
    // Reset if: no claimed_by, or claimed worker's PID is dead
    const shouldReset = !task.claimed_by ||
                        !task.pid ||
                        !isProcessRunning(task.pid) ||
                        orphanedWorkerIds.includes(task.claimed_by);

    if (shouldReset) {
      database.prepare(`
        UPDATE tasks SET status = 'pending', claimed_by = NULL, claimed_at = NULL
        WHERE id = ?
      `).run(task.id);
      resetCount++;
    }
  }

  if (resetCount > 0) {
    console.log(`[DB Cleanup] Reset ${resetCount} orphaned tasks to 'pending'`);
  }

  // Also clean up any workers that have stale PIDs (process died but status wasn't updated)
  const workersWithStalePids = database.prepare(`
    SELECT id, pid FROM workers WHERE pid IS NOT NULL AND status != 'running'
  `).all() as { id: string; pid: number }[];

  for (const worker of workersWithStalePids) {
    if (!isProcessRunning(worker.pid)) {
      database.prepare(`UPDATE workers SET pid = NULL WHERE id = ?`).run(worker.id);
    }
  }

  // Sync infrastructure_ready status for all active outcomes based on actual task state
  // This is imported lazily to avoid circular dependencies
  try {
    const { syncAllInfrastructureStatus } = require('./outcomes');
    const syncedCount = syncAllInfrastructureStatus();
    if (syncedCount > 0) {
      console.log(`[DB Cleanup] Synced infrastructure status for ${syncedCount} outcomes`);
    }
  } catch (err) {
    console.error('[DB Cleanup] Failed to sync infrastructure status:', err);
  }
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run a transaction with automatic rollback on error
 */
export function transaction<T>(fn: () => T): T {
  const database = getDb();
  return database.transaction(fn)();
}

/**
 * Get current timestamp in milliseconds
 */
export function now(): number {
  return Date.now();
}

// Re-export schema types
export * from './schema';
