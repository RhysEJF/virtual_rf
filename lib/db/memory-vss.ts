/**
 * Memory VSS (Vector Similarity Search) Schema
 *
 * Creates and manages the sqlite-vss virtual table for efficient vector
 * similarity search on memory embeddings. This enables fast approximate
 * nearest neighbor (ANN) search instead of brute-force linear scans.
 *
 * ## Architecture
 *
 * The memory_vss virtual table is a shadow table that indexes vectors from
 * the memories table. It uses SQLite's rowid for joining:
 *
 * ```
 * +---------------+     JOIN ON rowid     +---------------+
 * |   memories    | <-------------------> |  memory_vss   |
 * +---------------+                       +---------------+
 * | rowid (auto)  |                       | rowid         |
 * | id (text pk)  |                       | embedding     |
 * | content       |                       +---------------+
 * | embedding     |
 * +---------------+
 * ```
 *
 * ## Usage Pattern
 *
 * To search for similar memories:
 *
 * ```sql
 * -- Find 10 most similar memories to a query vector
 * SELECT m.*, v.distance
 * FROM memory_vss v
 * JOIN memories m ON m.rowid = v.rowid
 * WHERE vss_search(v.embedding, :query_vector)
 * LIMIT 10;
 * ```
 *
 * ## Prerequisites
 *
 * - sqlite-vss extension must be loaded (see vss-loader.ts)
 * - vector0 extension must be loaded (dependency of vss0)
 * - Embeddings must be stored as JSON arrays in memories.embedding
 *
 * ## Dimensions
 *
 * The virtual table is configured for 768-dimensional vectors by default
 * (matching nomic-embed-text from Ollama). This can be configured via
 * the MEMORY_VSS_DIMENSIONS environment variable.
 */

import Database from 'better-sqlite3';
import { loadVSSExtension, getCachedVSSStatus, type VSSLoadResult } from './vss-loader';
import { getEmbeddingDimension } from '../embedding/ollama';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default vector dimensions (matches nomic-embed-text)
 */
const DEFAULT_DIMENSIONS = 768;

/**
 * Get the configured vector dimensions for the VSS table
 */
export function getVSSDimensions(): number {
  const envDimensions = process.env.MEMORY_VSS_DIMENSIONS;
  if (envDimensions) {
    const parsed = parseInt(envDimensions, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return getEmbeddingDimension();
}

// ============================================================================
// Schema Creation
// ============================================================================

/**
 * Result of VSS schema creation attempt
 */
export interface VSSSchemaResult {
  /** Whether the VSS virtual table was created successfully */
  created: boolean;
  /** Whether VSS extension is available */
  extensionAvailable: boolean;
  /** Vector dimensions configured for the table */
  dimensions: number;
  /** Error message if creation failed */
  error?: string;
  /** Additional notes about the setup */
  notes?: string;
}

/**
 * Create the memory_vss virtual table for vector similarity search
 *
 * This function:
 * 1. Checks if the VSS extension is loaded/available
 * 2. Creates the memory_vss virtual table using the vss0 module
 * 3. Handles graceful fallback if VSS is not available
 *
 * The virtual table is designed to be joined with the memories table
 * using SQLite's implicit rowid column.
 *
 * @param db - The better-sqlite3 database instance
 * @param options - Optional configuration
 * @returns Result indicating success/failure and details
 *
 * @example
 * ```typescript
 * import { createMemoryVSSSchema } from './memory-vss';
 * import { getDb } from './index';
 *
 * const db = getDb();
 * const result = createMemoryVSSSchema(db);
 *
 * if (result.created) {
 *   console.log(`VSS table created with ${result.dimensions} dimensions`);
 * } else {
 *   console.log(`VSS unavailable: ${result.error}`);
 *   // Fall back to brute-force vector search
 * }
 * ```
 */
export function createMemoryVSSSchema(
  db: Database.Database,
  options: {
    /** Force recreation of the table if it exists */
    recreate?: boolean;
    /** Custom dimensions (overrides default/env) */
    dimensions?: number;
  } = {}
): VSSSchemaResult {
  const dimensions = options.dimensions ?? getVSSDimensions();

  // Check if VSS extension is available
  const vssStatus = getCachedVSSStatus(db);

  if (!vssStatus || !vssStatus.available) {
    return {
      created: false,
      extensionAvailable: false,
      dimensions,
      error: vssStatus?.error || 'sqlite-vss extension not available',
      notes: 'Vector search will fall back to brute-force linear scan. ' +
        'Install sqlite-vss for faster similarity search: https://github.com/asg017/sqlite-vss',
    };
  }

  // Check if table already exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='memory_vss'
  `).get();

  if (tableExists && !options.recreate) {
    // Verify the existing table has correct dimensions
    const verified = verifyVSSTableDimensions(db, dimensions);
    return {
      created: true,
      extensionAvailable: true,
      dimensions,
      notes: verified
        ? 'Using existing memory_vss table'
        : `Warning: Existing table may have different dimensions. Consider recreating.`,
    };
  }

  try {
    // Drop existing table if recreating
    if (tableExists && options.recreate) {
      db.exec(`DROP TABLE IF EXISTS memory_vss`);
    }

    // Create the VSS virtual table
    // Using vss0 module with vector column specification
    //
    // The syntax is: CREATE VIRTUAL TABLE name USING vss0(column_name(dimensions))
    // - rowid is implicit and matches the memories table's rowid
    // - embedding is the vector column with specified dimensions
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vss USING vss0(
        embedding(${dimensions})
      )
    `);

    // Create an index to speed up rowid lookups when joining
    // Note: VSS tables may handle indexing internally, but this helps with joins
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_rowid_embedding
      ON memories(rowid) WHERE embedding IS NOT NULL
    `);

    return {
      created: true,
      extensionAvailable: true,
      dimensions,
      notes: `memory_vss virtual table created with ${dimensions}-dimensional vectors`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful error messages
    let notes = '';
    if (errorMessage.includes('no such module')) {
      notes = 'VSS extension may not be properly loaded. Check loadVSSExtension() was called.';
    } else if (errorMessage.includes('dimension')) {
      notes = 'Vector dimensions may be incompatible. Try different dimensions or check embedding model.';
    }

    return {
      created: false,
      extensionAvailable: true,
      dimensions,
      error: errorMessage,
      notes,
    };
  }
}

/**
 * Verify the existing VSS table has the expected dimensions
 *
 * SQLite-VSS stores dimension info in the table metadata,
 * but accessing it varies by version. This does a basic check.
 */
function verifyVSSTableDimensions(db: Database.Database, expectedDimensions: number): boolean {
  try {
    // Try to query the table structure
    // This is a heuristic check - actual verification depends on VSS version
    const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'memory_vss'`);
    const result = sql.get() as { sql: string } | undefined;

    if (!result?.sql) return false;

    // Check if the dimensions match in the CREATE statement
    const dimensionMatch = result.sql.match(/embedding\((\d+)\)/);
    if (dimensionMatch) {
      return parseInt(dimensionMatch[1], 10) === expectedDimensions;
    }

    return true; // Can't verify, assume it's fine
  } catch {
    return true; // Can't verify, assume it's fine
  }
}

// ============================================================================
// VSS Status & Utilities
// ============================================================================

/**
 * Check if the memory_vss virtual table exists and is ready
 */
export function isMemoryVSSReady(db: Database.Database): boolean {
  try {
    const result = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='memory_vss'
    `).get();
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Get statistics about the memory_vss table
 */
export interface VSSStats {
  /** Whether VSS is available and table exists */
  available: boolean;
  /** Number of vectors in the index */
  vectorCount: number;
  /** Number of memories with embeddings */
  memoriesWithEmbeddings: number;
  /** Whether the index is in sync with memories table */
  inSync: boolean;
  /** Vector dimensions */
  dimensions: number;
}

export function getMemoryVSSStats(db: Database.Database): VSSStats {
  const dimensions = getVSSDimensions();

  if (!isMemoryVSSReady(db)) {
    // Count memories with embeddings even if VSS is not available
    try {
      const count = db.prepare(`
        SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL
      `).get() as { count: number };

      return {
        available: false,
        vectorCount: 0,
        memoriesWithEmbeddings: count.count,
        inSync: false,
        dimensions,
      };
    } catch {
      return {
        available: false,
        vectorCount: 0,
        memoriesWithEmbeddings: 0,
        inSync: false,
        dimensions,
      };
    }
  }

  try {
    // Count vectors in VSS table
    const vssCount = db.prepare(`SELECT COUNT(*) as count FROM memory_vss`).get() as { count: number };

    // Count memories with embeddings
    const memoryCount = db.prepare(`
      SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL
    `).get() as { count: number };

    return {
      available: true,
      vectorCount: vssCount.count,
      memoriesWithEmbeddings: memoryCount.count,
      inSync: vssCount.count === memoryCount.count,
      dimensions,
    };
  } catch (error) {
    return {
      available: false,
      vectorCount: 0,
      memoriesWithEmbeddings: 0,
      inSync: false,
      dimensions,
    };
  }
}

// ============================================================================
// VSS Index Population
// ============================================================================

/**
 * Populate the memory_vss index from existing memory embeddings
 *
 * This should be called after creating the VSS table or when
 * the index gets out of sync with the memories table.
 *
 * @param db - The database instance
 * @param options - Optional configuration
 * @returns Number of vectors inserted
 */
export function populateMemoryVSSIndex(
  db: Database.Database,
  options: {
    /** Clear existing index before populating */
    clear?: boolean;
    /** Batch size for inserts */
    batchSize?: number;
  } = {}
): { inserted: number; skipped: number; errors: number } {
  const { clear = false, batchSize = 100 } = options;

  if (!isMemoryVSSReady(db)) {
    return { inserted: 0, skipped: 0, errors: 0 };
  }

  const dimensions = getVSSDimensions();

  // Clear existing index if requested
  if (clear) {
    try {
      db.exec(`DELETE FROM memory_vss`);
    } catch {
      // Table might be empty or not exist
    }
  }

  // Get all memories with embeddings
  const memories = db.prepare(`
    SELECT rowid, id, embedding FROM memories
    WHERE embedding IS NOT NULL
  `).all() as { rowid: number; id: string; embedding: string }[];

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  // Prepare insert statement
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO memory_vss (rowid, embedding)
    VALUES (?, ?)
  `);

  // Process in batches
  const insertBatch = db.transaction((batch: typeof memories) => {
    for (const memory of batch) {
      try {
        // Parse embedding from JSON
        const embedding: number[] = JSON.parse(memory.embedding);

        // Skip if wrong dimensions
        if (embedding.length !== dimensions) {
          skipped++;
          continue;
        }

        // Convert to the format VSS expects
        // sqlite-vss expects a JSON array or binary blob
        const vectorJson = JSON.stringify(embedding);

        insertStmt.run(memory.rowid, vectorJson);
        inserted++;
      } catch {
        errors++;
      }
    }
  });

  // Process all memories in batches
  for (let i = 0; i < memories.length; i += batchSize) {
    const batch = memories.slice(i, i + batchSize);
    insertBatch(batch);
  }

  return { inserted, skipped, errors };
}

// ============================================================================
// Initialization Helper
// ============================================================================

/**
 * Initialize VSS for the memory system
 *
 * This is the main entry point for setting up VSS. It:
 * 1. Loads the VSS extension
 * 2. Creates the virtual table
 * 3. Optionally populates the index
 *
 * @param db - The database instance
 * @param options - Configuration options
 * @returns Combined result of all operations
 */
export function initializeMemoryVSS(
  db: Database.Database,
  options: {
    /** Populate index with existing embeddings */
    populate?: boolean;
    /** Force recreation of the table */
    recreate?: boolean;
  } = {}
): {
  extensionLoaded: boolean;
  schemaCreated: boolean;
  indexPopulated: boolean;
  details: {
    extension: VSSLoadResult;
    schema: VSSSchemaResult;
    population?: { inserted: number; skipped: number; errors: number };
  };
} {
  // Step 1: Load VSS extension
  const extensionResult = loadVSSExtension(db);

  // Step 2: Create schema
  const schemaResult = createMemoryVSSSchema(db, {
    recreate: options.recreate,
  });

  // Step 3: Optionally populate index
  let populationResult: { inserted: number; skipped: number; errors: number } | undefined;
  if (options.populate && schemaResult.created) {
    populationResult = populateMemoryVSSIndex(db, { clear: options.recreate });
  }

  return {
    extensionLoaded: extensionResult.available,
    schemaCreated: schemaResult.created,
    indexPopulated: populationResult ? populationResult.inserted > 0 : false,
    details: {
      extension: extensionResult,
      schema: schemaResult,
      population: populationResult,
    },
  };
}
