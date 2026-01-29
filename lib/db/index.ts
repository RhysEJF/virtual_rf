/**
 * Database initialization and connection management
 */

import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA_SQL } from './schema';

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
