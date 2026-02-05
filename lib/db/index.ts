/**
 * Database initialization and connection management
 */

import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA_SQL } from './schema';
import { loadVSSExtension, type VSSLoadResult } from './vss-loader';

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

// Track VSS extension status for the session
let vssLoadResult: VSSLoadResult | null = null;

/**
 * Get the database instance, initializing if needed
 */
export function getDb(): Database.Database {
  if (db) return db;

  // Create database with WAL mode for better concurrency
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Set busy timeout to wait for locks (5 seconds)
  // This helps prevent "database is locked" errors during concurrent access
  db.pragma('busy_timeout = 5000');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Load VSS extension early, before schema initialization
  // This makes VSS functions available for creating virtual tables
  // VSS is optional - the system falls back to brute-force search if unavailable
  vssLoadResult = loadVSSExtension(db);
  if (vssLoadResult.available) {
    console.log(`[DB] VSS extension loaded from: ${vssLoadResult.loadedFrom}`);
  } else {
    // Only log debug info if it's not a simple "not found" case
    const errorMsg = vssLoadResult.error || '';
    if (!errorMsg.includes('not found') && errorMsg.length > 0) {
      console.log(`[DB] VSS extension unavailable: ${errorMsg}`);
    }
  }

  // Initialize schema
  db.exec(SCHEMA_SQL);

  // Run migrations for existing tables (will create VSS virtual table if extension loaded)
  runMigrations(db);

  // Clean up orphaned tasks/workers from crashed processes
  cleanupOrphanedState(db);

  return db;
}

/**
 * Get the VSS extension load status
 * Returns null if database hasn't been initialized yet
 */
export function getVSSStatus(): VSSLoadResult | null {
  return vssLoadResult;
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

  // Add capability_ready column to outcomes if it doesn't exist
  // Also migrate from old infrastructure_ready column if it exists
  const outcomesColumns = database.prepare(`PRAGMA table_info(outcomes)`).all() as { name: string }[];
  const hasCapabilityReady = outcomesColumns.some(col => col.name === 'capability_ready');
  const hasOldInfraReady = outcomesColumns.some(col => col.name === 'infrastructure_ready');

  if (!hasCapabilityReady) {
    database.exec(`ALTER TABLE outcomes ADD COLUMN capability_ready INTEGER NOT NULL DEFAULT 0`);
    console.log('[DB Migration] Added capability_ready column to outcomes');

    // Migrate data from old column if it exists
    if (hasOldInfraReady) {
      database.exec(`UPDATE outcomes SET capability_ready = infrastructure_ready`);
      console.log('[DB Migration] Migrated infrastructure_ready data to capability_ready');
    }
  }

  // Add phase and infra_type columns to tasks if they don't exist
  const tasksColumns = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const hasPhase = tasksColumns.some(col => col.name === 'phase');
  if (!hasPhase) {
    database.exec(`ALTER TABLE tasks ADD COLUMN phase TEXT NOT NULL DEFAULT 'execution'`);
    console.log('[DB Migration] Added phase column to tasks');
  }
  // Add capability_type column (replaces old infra_type)
  const hasCapabilityType = tasksColumns.some(col => col.name === 'capability_type');
  const hasOldInfraType = tasksColumns.some(col => col.name === 'infra_type');

  if (!hasCapabilityType) {
    database.exec(`ALTER TABLE tasks ADD COLUMN capability_type TEXT`);
    console.log('[DB Migration] Added capability_type column to tasks');

    // Migrate data from old column if it exists
    if (hasOldInfraType) {
      database.exec(`UPDATE tasks SET capability_type = infra_type`);
      console.log('[DB Migration] Migrated infra_type data to capability_type');
    }
  }

  // Migrate phase values from 'infrastructure' to 'capability'
  database.exec(`UPDATE tasks SET phase = 'capability' WHERE phase = 'infrastructure'`);

  // Keep old infra_type check for backwards compatibility during transition
  if (!hasOldInfraType && !hasCapabilityType) {
    // Neither column exists - this shouldn't happen but handle gracefully
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

  // Add branch_name and worktree_path columns to workers for git branch tracking
  const hasBranchName = workersColumns.some(col => col.name === 'branch_name');
  if (!hasBranchName) {
    database.exec(`ALTER TABLE workers ADD COLUMN branch_name TEXT`);
    console.log('[DB Migration] Added branch_name column to workers');
  }
  const hasWorktreePath = workersColumns.some(col => col.name === 'worktree_path');
  if (!hasWorktreePath) {
    database.exec(`ALTER TABLE workers ADD COLUMN worktree_path TEXT`);
    console.log('[DB Migration] Added worktree_path column to workers');
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

  // Add hierarchy columns to outcomes for nested outcomes
  const hierarchyColumns = [
    { name: 'parent_id', sql: 'ALTER TABLE outcomes ADD COLUMN parent_id TEXT REFERENCES outcomes(id) ON DELETE CASCADE' },
    { name: 'depth', sql: 'ALTER TABLE outcomes ADD COLUMN depth INTEGER NOT NULL DEFAULT 0' },
  ];
  const outcomesColsHierarchy = database.prepare(`PRAGMA table_info(outcomes)`).all() as { name: string }[];
  for (const col of hierarchyColumns) {
    const exists = outcomesColsHierarchy.some(c => c.name === col.name);
    if (!exists) {
      database.exec(col.sql);
      console.log(`[DB Migration] Added ${col.name} column to outcomes`);
    }
  }

  // Add hierarchy indexes if they don't exist
  database.exec(`CREATE INDEX IF NOT EXISTS idx_outcomes_parent ON outcomes(parent_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_outcomes_depth ON outcomes(depth)`);

  // Add enriched task columns (task_intent, task_approach) for per-task PRD/approach
  const enrichedTaskColumns = [
    { name: 'task_intent', sql: 'ALTER TABLE tasks ADD COLUMN task_intent TEXT' },
    { name: 'task_approach', sql: 'ALTER TABLE tasks ADD COLUMN task_approach TEXT' },
  ];
  const tasksColsEnriched = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  for (const col of enrichedTaskColumns) {
    const exists = tasksColsEnriched.some(c => c.name === col.name);
    if (!exists) {
      database.exec(col.sql);
      console.log(`[DB Migration] Added ${col.name} column to tasks`);
    }
  }

  // Add depends_on column for task dependency graph
  const tasksDependsCols = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const hasDependsOn = tasksDependsCols.some(c => c.name === 'depends_on');
  if (!hasDependsOn) {
    database.exec(`ALTER TABLE tasks ADD COLUMN depends_on TEXT DEFAULT '[]'`);
    database.exec(`UPDATE tasks SET depends_on = '[]' WHERE depends_on IS NULL`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_depends ON tasks(depends_on)`);
    console.log(`[DB Migration] Added depends_on column to tasks for dependency graph`);
  }

  // Add complexity estimation columns for worker resilience feedback loop
  const tasksComplexityCols = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const hasComplexityScore = tasksComplexityCols.some(c => c.name === 'complexity_score');
  if (!hasComplexityScore) {
    database.exec(`ALTER TABLE tasks ADD COLUMN complexity_score INTEGER`);
    console.log(`[DB Migration] Added complexity_score column to tasks`);
  }
  const hasEstimatedTurns = tasksComplexityCols.some(c => c.name === 'estimated_turns');
  if (!hasEstimatedTurns) {
    database.exec(`ALTER TABLE tasks ADD COLUMN estimated_turns INTEGER`);
    console.log(`[DB Migration] Added estimated_turns column to tasks`);
  }

  // HOMЯ Protocol tables are created via SCHEMA_SQL
  // Just log that they're available
  const homrTables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name LIKE 'homr_%'
  `).all() as { name: string }[];

  if (homrTables.length === 4) {
    // All HOMЯ tables exist
  } else if (homrTables.length > 0) {
    console.log(`[DB Migration] HOMЯ Protocol tables: ${homrTables.map(t => t.name).join(', ')}`);
  }

  // Add repository configuration columns to outcomes (with inheritance support)
  const repoTargetColumns = [
    { name: 'repository_id', sql: 'ALTER TABLE outcomes ADD COLUMN repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL' },
    { name: 'output_target', sql: `ALTER TABLE outcomes ADD COLUMN output_target TEXT NOT NULL DEFAULT 'local'` },
    { name: 'skill_target', sql: `ALTER TABLE outcomes ADD COLUMN skill_target TEXT NOT NULL DEFAULT 'local'` },
    { name: 'tool_target', sql: `ALTER TABLE outcomes ADD COLUMN tool_target TEXT NOT NULL DEFAULT 'local'` },
    { name: 'file_target', sql: `ALTER TABLE outcomes ADD COLUMN file_target TEXT NOT NULL DEFAULT 'local'` },
    { name: 'auto_save', sql: `ALTER TABLE outcomes ADD COLUMN auto_save TEXT NOT NULL DEFAULT '0'` },
  ];
  const outcomesColsRepo = database.prepare(`PRAGMA table_info(outcomes)`).all() as { name: string }[];
  for (const col of repoTargetColumns) {
    const exists = outcomesColsRepo.some(c => c.name === col.name);
    if (!exists) {
      database.exec(col.sql);
      console.log(`[DB Migration] Added ${col.name} column to outcomes`);
    }
  }

  // Migrate old target values ('private'/'team') to new model ('repo')
  // This handles upgrades from the old schema
  database.exec(`UPDATE outcomes SET output_target = 'repo' WHERE output_target IN ('private', 'team')`);
  database.exec(`UPDATE outcomes SET skill_target = 'repo' WHERE skill_target IN ('private', 'team')`);
  database.exec(`UPDATE outcomes SET tool_target = 'repo' WHERE tool_target IN ('private', 'team')`);
  database.exec(`UPDATE outcomes SET file_target = 'repo' WHERE file_target IN ('private', 'team')`);
  database.exec(`UPDATE outcome_items SET target_override = 'repo' WHERE target_override IN ('private', 'team')`);

  // Create outcome_items indexes if they don't exist
  database.exec(`CREATE INDEX IF NOT EXISTS idx_outcome_items_outcome ON outcome_items(outcome_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_outcome_items_type ON outcome_items(item_type)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_outcome_items_synced ON outcome_items(synced_to)`);

  // Create guard_blocks table and indexes if they don't exist
  // (table is created via SCHEMA_SQL, indexes are created here for existing DBs)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_guard_blocks_worker ON guard_blocks(worker_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_guard_blocks_outcome ON guard_blocks(outcome_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_guard_blocks_time ON guard_blocks(blocked_at DESC)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_guard_blocks_pattern ON guard_blocks(pattern_matched)`);

  // Add escalation incorporation tracking columns for self-improvement loop
  const escalationCols = database.prepare(`PRAGMA table_info(homr_escalations)`).all() as { name: string }[];
  const hasIncorporatedInto = escalationCols.some(c => c.name === 'incorporated_into_outcome_id');
  if (!hasIncorporatedInto) {
    database.exec(`ALTER TABLE homr_escalations ADD COLUMN incorporated_into_outcome_id TEXT REFERENCES outcomes(id) ON DELETE SET NULL`);
    database.exec(`ALTER TABLE homr_escalations ADD COLUMN incorporated_at INTEGER`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_escalations_incorporated ON homr_escalations(incorporated_into_outcome_id)`);
    console.log(`[DB Migration] Added escalation incorporation tracking columns`);
  }

  // Add isolation_mode column to outcomes for workspace isolation
  const outcomesColsIsolation = database.prepare(`PRAGMA table_info(outcomes)`).all() as { name: string }[];
  const hasIsolationMode = outcomesColsIsolation.some(c => c.name === 'isolation_mode');
  if (!hasIsolationMode) {
    database.exec(`ALTER TABLE outcomes ADD COLUMN isolation_mode TEXT NOT NULL DEFAULT 'workspace'`);
    console.log(`[DB Migration] Added isolation_mode column to outcomes`);
  }

  // Create system_config table for system-wide settings
  database.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Add required_capabilities column to tasks for capability dependency tracking
  const tasksReqCapCols = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const hasRequiredCapabilities = tasksReqCapCols.some(c => c.name === 'required_capabilities');
  if (!hasRequiredCapabilities) {
    database.exec(`ALTER TABLE tasks ADD COLUMN required_capabilities TEXT DEFAULT '[]'`);
    database.exec(`UPDATE tasks SET required_capabilities = '[]' WHERE required_capabilities IS NULL`);
    console.log(`[DB Migration] Added required_capabilities column to tasks`);
  }

  // Create item_repo_syncs junction table indexes if they don't exist
  database.exec(`CREATE INDEX IF NOT EXISTS idx_item_repo_syncs_item ON item_repo_syncs(item_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_item_repo_syncs_repo ON item_repo_syncs(repo_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_item_repo_syncs_status ON item_repo_syncs(sync_status)`);

  // Migrate existing synced_to data to item_repo_syncs junction table
  // This is a one-time migration for existing data
  const itemsWithSyncedTo = database.prepare(`
    SELECT id, synced_to, last_synced_at FROM outcome_items
    WHERE synced_to IS NOT NULL
  `).all() as { id: string; synced_to: string; last_synced_at: number | null }[];

  if (itemsWithSyncedTo.length > 0) {
    // Check if we've already migrated (junction table has entries for these items)
    const existingMigrated = database.prepare(`
      SELECT COUNT(*) as count FROM item_repo_syncs
      WHERE item_id IN (${itemsWithSyncedTo.map(() => '?').join(',')})
    `).get(...itemsWithSyncedTo.map(i => i.id)) as { count: number };

    if (existingMigrated.count === 0) {
      // Migrate each item's synced_to to the junction table
      const insertStmt = database.prepare(`
        INSERT OR IGNORE INTO item_repo_syncs (id, item_id, repo_id, synced_at, sync_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'synced', ?, ?)
      `);

      let migratedCount = 0;
      for (const item of itemsWithSyncedTo) {
        const now = Date.now();
        const syncedAt = item.last_synced_at || now;
        const id = `irs_${item.id.slice(-8)}_${item.synced_to.slice(-8)}`;
        try {
          insertStmt.run(id, item.id, item.synced_to, syncedAt, now, now);
          migratedCount++;
        } catch {
          // Ignore errors (repo might not exist anymore)
        }
      }
      if (migratedCount > 0) {
        console.log(`[DB Migration] Migrated ${migratedCount} items to item_repo_syncs junction table`);
      }
    }
  }

  // Create cross-outcome memory system tables and indexes if they don't exist
  const memoryTables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name LIKE 'memor%'
  `).all() as { name: string }[];

  if (memoryTables.length < 4) {
    // Memory tables are created via SCHEMA_SQL, just ensure indexes exist
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memories_source_outcome ON memories(source_outcome_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(last_accessed_at DESC)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence DESC)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memory_assoc_memory ON memory_associations(memory_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memory_assoc_target ON memory_associations(target_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memory_assoc_type ON memory_associations(association_type)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memory_retrieval_memory ON memory_retrievals(memory_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memory_retrieval_outcome ON memory_retrievals(outcome_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag)`);
    console.log(`[DB Migration] Ensured cross-outcome memory system indexes exist`);
  }

  // Create FTS5 virtual table for full-text search with BM25 ranking
  // Check if FTS5 table exists and populate it if needed
  try {
    const ftsTableExists = database.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'
    `).get();

    if (!ftsTableExists) {
      // Create FTS5 virtual table
      database.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          content,
          tags,
          content='memories',
          content_rowid='rowid',
          tokenize='porter unicode61 remove_diacritics 1'
        )
      `);

      // Create triggers for sync
      database.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, content, tags)
          VALUES (NEW.rowid, NEW.content, NEW.tags);
        END
      `);

      database.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, tags)
          VALUES ('delete', OLD.rowid, OLD.content, OLD.tags);
        END
      `);

      database.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, tags)
          VALUES ('delete', OLD.rowid, OLD.content, OLD.tags);
          INSERT INTO memories_fts(rowid, content, tags)
          VALUES (NEW.rowid, NEW.content, NEW.tags);
        END
      `);

      console.log(`[DB Migration] Created FTS5 virtual table for memory search`);
    }

    // Populate FTS5 index with existing memories (one-time migration)
    const ftsCount = database.prepare(`SELECT COUNT(*) as count FROM memories_fts`).get() as { count: number };
    const memoryCount = database.prepare(`SELECT COUNT(*) as count FROM memories`).get() as { count: number };

    if (memoryCount.count > 0 && ftsCount.count === 0) {
      // Rebuild FTS5 index from memories table
      database.exec(`INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`);
      console.log(`[DB Migration] Populated FTS5 index with ${memoryCount.count} existing memories`);
    }
  } catch (err) {
    // FTS5 might not be available in all SQLite builds
    console.warn(`[DB Migration] FTS5 setup skipped:`, err instanceof Error ? err.message : err);
  }

  // Initialize VSS (Vector Similarity Search) for memory embeddings
  // VSS extension is loaded early in getDb() - here we just create the virtual table
  // This is optional - falls back to brute-force search if unavailable
  if (vssLoadResult?.available) {
    try {
      const { createMemoryVSSSchema, getMemoryVSSStats, populateMemoryVSSIndex } = require('./memory-vss');

      // Check if VSS table already exists and is in sync
      const stats = getMemoryVSSStats(database);

      if (!stats.available) {
        // Create the VSS virtual table (extension is already loaded)
        const schemaResult = createMemoryVSSSchema(database, { recreate: false });

        if (schemaResult.created) {
          console.log(
            `[DB Migration] Memory VSS table created: ${schemaResult.dimensions}-dimensional vectors`
          );

          // Populate with existing embeddings if any
          if (stats.memoriesWithEmbeddings > 0) {
            const popResult = populateMemoryVSSIndex(database, { clear: false });
            if (popResult.inserted > 0) {
              console.log(
                `[DB Migration] Populated VSS index with ${popResult.inserted} vectors`
              );
            }
          }
        } else if (schemaResult.notes) {
          console.log(`[DB Migration] Memory VSS: ${schemaResult.notes}`);
        }
      } else if (!stats.inSync) {
        // VSS exists but is out of sync - repopulate
        const popResult = populateMemoryVSSIndex(database, { clear: true });
        console.log(
          `[DB Migration] Re-synced VSS index: ${popResult.inserted} vectors (${popResult.skipped} skipped)`
        );
      }
    } catch (err) {
      // VSS table creation failed - log but don't fail initialization
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[DB Migration] VSS table setup failed:`, errorMsg);
    }
  }

  // Ensure conversation tables and indexes exist (created via SCHEMA_SQL)
  const convTables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name LIKE 'conversation_%'
  `).all() as { name: string }[];

  if (convTables.length < 2) {
    // Tables will be created by SCHEMA_SQL on next restart
    // Just log for awareness
    console.log(`[DB Migration] Conversation tables pending creation`);
  } else {
    // Ensure indexes exist
    database.exec(`CREATE INDEX IF NOT EXISTS idx_conv_sessions_user ON conversation_sessions(user_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_conv_sessions_outcome ON conversation_sessions(current_outcome_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_conv_sessions_activity ON conversation_sessions(last_activity_at DESC)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_conv_sessions_expires ON conversation_sessions(expires_at) WHERE expires_at IS NOT NULL`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_conv_messages_session ON conversation_messages(session_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_conv_messages_created ON conversation_messages(session_id, created_at)`);
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

  // Sync capability_ready status for all active outcomes based on actual task state
  // This is imported lazily to avoid circular dependencies
  try {
    const { syncAllCapabilityStatus } = require('./outcomes');
    const syncedCount = syncAllCapabilityStatus();
    if (syncedCount > 0) {
      console.log(`[DB Cleanup] Synced capability status for ${syncedCount} outcomes`);
    }
  } catch (err) {
    console.error('[DB Cleanup] Failed to sync capability status:', err);
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
