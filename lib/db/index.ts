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

  return db;
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
