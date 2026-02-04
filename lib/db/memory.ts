/**
 * Cross-Outcome Memory System Database Operations
 *
 * Handles all database operations for the memory system:
 * - Memories: Cross-outcome knowledge entries
 * - Associations: Links between memories and entities
 * - Retrievals: Usage tracking for feedback loop
 * - Tags: Efficient tag-based categorization
 */

import { getDb, now } from './index';
import { generateId } from '../utils/id';
import type {
  Memory,
  MemoryAssociation,
  MemoryRetrieval,
  MemoryTag,
  MemoryType,
  MemoryImportance,
  MemorySource,
  MemoryAssociationType,
  ParsedMemory,
} from './schema';

// ============================================================================
// Memory CRUD Operations
// ============================================================================

export interface CreateMemoryInput {
  content: string;
  type: MemoryType;
  importance?: MemoryImportance;
  source: MemorySource;
  source_outcome_id?: string;
  source_task_id?: string;
  tags?: string[];
  embedding?: number[];
  confidence?: number;
  expires_at?: number;
}

/**
 * Create a new memory
 */
export function createMemory(input: CreateMemoryInput): Memory {
  const db = getDb();
  const id = generateId('mem');
  const timestamp = now();

  db.prepare(`
    INSERT INTO memories (
      id, content, type, importance, source,
      source_outcome_id, source_task_id, tags, embedding,
      confidence, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.content,
    input.type,
    input.importance || 'medium',
    input.source,
    input.source_outcome_id || null,
    input.source_task_id || null,
    JSON.stringify(input.tags || []),
    input.embedding ? JSON.stringify(input.embedding) : null,
    input.confidence ?? 1.0,
    input.expires_at || null,
    timestamp,
    timestamp
  );

  // Add tags to tag table and create links
  if (input.tags && input.tags.length > 0) {
    addTagsToMemory(id, input.tags);
  }

  return getMemoryById(id)!;
}

/**
 * Get a memory by ID
 */
export function getMemoryById(id: string): Memory | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM memories WHERE id = ?
  `).get(id) as Memory | undefined;

  return row || null;
}

/**
 * Get a memory by ID with parsed arrays
 */
export function getParsedMemory(id: string): ParsedMemory | null {
  const memory = getMemoryById(id);
  if (!memory) return null;
  return parseMemory(memory);
}

/**
 * Update a memory
 */
export function updateMemory(
  id: string,
  updates: Partial<{
    content: string;
    type: MemoryType;
    importance: MemoryImportance;
    confidence: number;
    expires_at: number | null;
    superseded_by: string;
  }>
): Memory | null {
  const memory = getMemoryById(id);
  if (!memory) return null;

  const db = getDb();
  const setClauses: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now()];

  if (updates.content !== undefined) {
    setClauses.push('content = ?');
    values.push(updates.content);
  }
  if (updates.type !== undefined) {
    setClauses.push('type = ?');
    values.push(updates.type);
  }
  if (updates.importance !== undefined) {
    setClauses.push('importance = ?');
    values.push(updates.importance);
  }
  if (updates.confidence !== undefined) {
    setClauses.push('confidence = ?');
    values.push(updates.confidence);
  }
  if (updates.expires_at !== undefined) {
    setClauses.push('expires_at = ?');
    values.push(updates.expires_at);
  }
  if (updates.superseded_by !== undefined) {
    setClauses.push('superseded_by = ?');
    values.push(updates.superseded_by);
  }

  values.push(id);

  db.prepare(`
    UPDATE memories SET ${setClauses.join(', ')} WHERE id = ?
  `).run(...values);

  return getMemoryById(id);
}

/**
 * Delete a memory
 */
export function deleteMemory(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * Mark a memory as superseded by another
 */
export function supersedeMemory(oldMemoryId: string, newMemoryId: string): Memory | null {
  return updateMemory(oldMemoryId, { superseded_by: newMemoryId });
}

/**
 * Increment access count and update last accessed timestamp
 */
export function recordMemoryAccess(id: string): void {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    UPDATE memories
    SET access_count = access_count + 1, last_accessed_at = ?
    WHERE id = ?
  `).run(timestamp, id);
}

// ============================================================================
// Memory Retrieval Operations
// ============================================================================

/**
 * Get all active memories (not superseded, not expired)
 */
export function getActiveMemories(limit: number = 100): Memory[] {
  const db = getDb();
  const timestamp = now();

  return db.prepare(`
    SELECT * FROM memories
    WHERE superseded_by IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY importance DESC, confidence DESC, created_at DESC
    LIMIT ?
  `).all(timestamp, limit) as Memory[];
}

/**
 * Get memories by type
 */
export function getMemoriesByType(type: MemoryType, limit: number = 50): Memory[] {
  const db = getDb();
  const timestamp = now();

  return db.prepare(`
    SELECT * FROM memories
    WHERE type = ?
      AND superseded_by IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY importance DESC, confidence DESC, created_at DESC
    LIMIT ?
  `).all(type, timestamp, limit) as Memory[];
}

/**
 * Get memories by importance level
 */
export function getMemoriesByImportance(importance: MemoryImportance, limit: number = 50): Memory[] {
  const db = getDb();
  const timestamp = now();

  return db.prepare(`
    SELECT * FROM memories
    WHERE importance = ?
      AND superseded_by IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY confidence DESC, created_at DESC
    LIMIT ?
  `).all(importance, timestamp, limit) as Memory[];
}

/**
 * Get memories from a specific source outcome
 */
export function getMemoriesBySourceOutcome(outcomeId: string, limit: number = 50): Memory[] {
  const db = getDb();

  return db.prepare(`
    SELECT * FROM memories
    WHERE source_outcome_id = ?
      AND superseded_by IS NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(outcomeId, limit) as Memory[];
}

/**
 * Get recently accessed memories
 */
export function getRecentlyAccessedMemories(limit: number = 20): Memory[] {
  const db = getDb();

  return db.prepare(`
    SELECT * FROM memories
    WHERE last_accessed_at IS NOT NULL
      AND superseded_by IS NULL
    ORDER BY last_accessed_at DESC
    LIMIT ?
  `).all(limit) as Memory[];
}

/**
 * Get most frequently accessed memories
 */
export function getMostAccessedMemories(limit: number = 20): Memory[] {
  const db = getDb();

  return db.prepare(`
    SELECT * FROM memories
    WHERE superseded_by IS NULL
    ORDER BY access_count DESC
    LIMIT ?
  `).all(limit) as Memory[];
}

/**
 * Search memories by content (simple text search)
 */
export function searchMemories(query: string, limit: number = 20): Memory[] {
  const db = getDb();
  const timestamp = now();
  const searchPattern = `%${query.toLowerCase()}%`;

  return db.prepare(`
    SELECT * FROM memories
    WHERE LOWER(content) LIKE ?
      AND superseded_by IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY importance DESC, confidence DESC, created_at DESC
    LIMIT ?
  `).all(searchPattern, timestamp, limit) as Memory[];
}

// ============================================================================
// BM25 Full-Text Search Operations (FTS5)
// ============================================================================

/**
 * Search result with BM25 relevance score
 */
export interface BM25SearchResult {
  memory: Memory;
  bm25Score: number;          // BM25 relevance score (lower is better)
  matchedSnippet: string;     // Highlighted snippet of matched content
}

/**
 * Check if FTS5 is available for searching
 */
export function isFTS5Available(): boolean {
  const db = getDb();
  try {
    const result = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'
    `).get();
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Search memories using FTS5 BM25 ranking
 *
 * Supports:
 * - Simple word search: "authentication" finds memories containing "authentication"
 * - Phrase search: '"exact phrase"' finds exact phrase matches
 * - Boolean OR: "auth OR login" finds memories with either term
 * - Boolean NOT: "auth NOT oauth" excludes certain terms
 * - Prefix search: "auth*" finds "authentication", "authorize", etc.
 * - Column-specific: "content:password" searches only content column
 *
 * @param query FTS5 query string
 * @param limit Maximum number of results
 * @returns Memories ranked by BM25 relevance (most relevant first)
 */
export function searchMemoriesBM25(query: string, limit: number = 20): BM25SearchResult[] {
  const db = getDb();
  const timestamp = now();

  // Check if FTS5 is available
  if (!isFTS5Available()) {
    // Fall back to LIKE-based search
    const fallbackResults = searchMemories(query, limit);
    return fallbackResults.map(memory => ({
      memory,
      bm25Score: 0,
      matchedSnippet: memory.content.substring(0, 200),
    }));
  }

  try {
    // Use FTS5 MATCH with BM25 ranking
    // bm25() returns negative scores where more negative = more relevant
    // We negate it so higher scores = more relevant
    const results = db.prepare(`
      SELECT
        m.*,
        -bm25(memories_fts, 1.0, 0.5) as bm25_score,
        snippet(memories_fts, 0, '<b>', '</b>', '...', 32) as matched_snippet
      FROM memories_fts fts
      JOIN memories m ON fts.rowid = m.rowid
      WHERE memories_fts MATCH ?
        AND m.superseded_by IS NULL
        AND (m.expires_at IS NULL OR m.expires_at > ?)
      ORDER BY bm25_score DESC
      LIMIT ?
    `).all(query, timestamp, limit) as (Memory & { bm25_score: number; matched_snippet: string })[];

    return results.map(row => ({
      memory: {
        id: row.id,
        content: row.content,
        type: row.type,
        importance: row.importance,
        source: row.source,
        source_outcome_id: row.source_outcome_id,
        source_task_id: row.source_task_id,
        tags: row.tags,
        embedding: row.embedding,
        access_count: row.access_count,
        last_accessed_at: row.last_accessed_at,
        confidence: row.confidence,
        expires_at: row.expires_at,
        superseded_by: row.superseded_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      bm25Score: row.bm25_score,
      matchedSnippet: row.matched_snippet,
    }));
  } catch (err) {
    console.warn('[Memory Search] FTS5 search failed, falling back to LIKE:', err);
    const fallbackResults = searchMemories(query, limit);
    return fallbackResults.map(memory => ({
      memory,
      bm25Score: 0,
      matchedSnippet: memory.content.substring(0, 200),
    }));
  }
}

/**
 * Search memories using exact phrase matching with BM25 ranking
 *
 * This wraps the query in quotes to ensure exact phrase matching.
 * Use this when you want to find memories containing the exact phrase.
 *
 * @param phrase The exact phrase to search for
 * @param limit Maximum number of results
 */
export function searchMemoriesExactPhrase(phrase: string, limit: number = 20): BM25SearchResult[] {
  // Escape any existing quotes in the phrase and wrap in quotes
  const escapedPhrase = phrase.replace(/"/g, '""');
  return searchMemoriesBM25(`"${escapedPhrase}"`, limit);
}

/**
 * Search memories by multiple keywords (all must match)
 *
 * @param keywords Array of keywords that must all appear in the memory
 * @param limit Maximum number of results
 */
export function searchMemoriesByKeywords(keywords: string[], limit: number = 20): BM25SearchResult[] {
  if (keywords.length === 0) return [];

  // Join keywords with spaces (FTS5 treats space-separated terms as AND by default)
  const query = keywords.join(' ');
  return searchMemoriesBM25(query, limit);
}

/**
 * Search memories with complex boolean query
 *
 * @param mustInclude Keywords that must be present
 * @param shouldInclude Keywords where at least one should be present (OR)
 * @param mustExclude Keywords that must not be present
 * @param limit Maximum number of results
 */
export function searchMemoriesAdvanced(
  mustInclude: string[] = [],
  shouldInclude: string[] = [],
  mustExclude: string[] = [],
  limit: number = 20
): BM25SearchResult[] {
  const parts: string[] = [];

  // Add required terms
  for (const term of mustInclude) {
    parts.push(term);
  }

  // Add optional terms with OR
  if (shouldInclude.length > 0) {
    parts.push(`(${shouldInclude.join(' OR ')})`);
  }

  // Add excluded terms with NOT
  for (const term of mustExclude) {
    parts.push(`NOT ${term}`);
  }

  if (parts.length === 0) return [];

  return searchMemoriesBM25(parts.join(' '), limit);
}

/**
 * Search memories by tag using FTS5
 * Tags are stored as JSON arrays, so this searches within the tags text
 *
 * @param tag Tag to search for
 * @param limit Maximum number of results
 */
export function searchMemoriesByTagFTS(tag: string, limit: number = 20): BM25SearchResult[] {
  // Search specifically in the tags column
  return searchMemoriesBM25(`tags:${tag}`, limit);
}

/**
 * Rebuild the FTS5 index from the memories table
 * Use this if the index gets out of sync
 */
export function rebuildFTS5Index(): boolean {
  const db = getDb();

  if (!isFTS5Available()) {
    console.warn('[Memory Search] FTS5 is not available, cannot rebuild index');
    return false;
  }

  try {
    db.exec(`INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`);
    console.log('[Memory Search] FTS5 index rebuilt successfully');
    return true;
  } catch (err) {
    console.error('[Memory Search] Failed to rebuild FTS5 index:', err);
    return false;
  }
}

/**
 * Get FTS5 index statistics
 */
export interface FTS5Stats {
  available: boolean;
  indexedMemories: number;
  totalMemories: number;
  inSync: boolean;
}

export function getFTS5Stats(): FTS5Stats {
  const db = getDb();

  if (!isFTS5Available()) {
    return {
      available: false,
      indexedMemories: 0,
      totalMemories: 0,
      inSync: false,
    };
  }

  try {
    const ftsCount = db.prepare(`SELECT COUNT(*) as count FROM memories_fts`).get() as { count: number };
    const memoryCount = db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as { count: number };

    return {
      available: true,
      indexedMemories: ftsCount.count,
      totalMemories: memoryCount.count,
      inSync: ftsCount.count === memoryCount.count,
    };
  } catch {
    return {
      available: false,
      indexedMemories: 0,
      totalMemories: 0,
      inSync: false,
    };
  }
}

/**
 * Get expired memories for cleanup
 */
export function getExpiredMemories(): Memory[] {
  const db = getDb();
  const timestamp = now();

  return db.prepare(`
    SELECT * FROM memories
    WHERE expires_at IS NOT NULL AND expires_at <= ?
  `).all(timestamp) as Memory[];
}

/**
 * Delete expired memories
 */
export function cleanupExpiredMemories(): number {
  const db = getDb();
  const timestamp = now();

  const result = db.prepare(`
    DELETE FROM memories
    WHERE expires_at IS NOT NULL AND expires_at <= ?
  `).run(timestamp);

  return result.changes;
}

// ============================================================================
// Tag Operations
// ============================================================================

/**
 * Get or create a tag
 */
export function getOrCreateTag(tag: string): MemoryTag {
  const normalizedTag = tag.toLowerCase().trim();
  const db = getDb();

  const existing = db.prepare(`
    SELECT * FROM memory_tags WHERE tag = ?
  `).get(normalizedTag) as MemoryTag | undefined;

  if (existing) return existing;

  const id = generateId('mtag');
  const timestamp = now();

  db.prepare(`
    INSERT INTO memory_tags (id, tag, memory_count, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?)
  `).run(id, normalizedTag, timestamp, timestamp);

  return db.prepare(`SELECT * FROM memory_tags WHERE id = ?`).get(id) as MemoryTag;
}

/**
 * Add tags to a memory
 */
export function addTagsToMemory(memoryId: string, tags: string[]): void {
  const db = getDb();
  const timestamp = now();

  for (const tag of tags) {
    const tagRecord = getOrCreateTag(tag);

    // Create link
    try {
      db.prepare(`
        INSERT INTO memory_tag_links (memory_id, tag_id, created_at)
        VALUES (?, ?, ?)
      `).run(memoryId, tagRecord.id, timestamp);

      // Increment tag count
      db.prepare(`
        UPDATE memory_tags SET memory_count = memory_count + 1, updated_at = ?
        WHERE id = ?
      `).run(timestamp, tagRecord.id);
    } catch {
      // Link already exists, ignore
    }
  }

  // Update memory's tags JSON
  const memory = getMemoryById(memoryId);
  if (memory) {
    const existingTags: string[] = JSON.parse(memory.tags);
    const newTags = Array.from(new Set([...existingTags, ...tags.map(t => t.toLowerCase().trim())]));
    db.prepare(`UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(newTags), timestamp, memoryId);
  }
}

/**
 * Get memories by tag
 */
export function getMemoriesByTag(tag: string, limit: number = 50): Memory[] {
  const normalizedTag = tag.toLowerCase().trim();
  const db = getDb();
  const timestamp = now();

  return db.prepare(`
    SELECT m.* FROM memories m
    JOIN memory_tag_links mtl ON m.id = mtl.memory_id
    JOIN memory_tags mt ON mtl.tag_id = mt.id
    WHERE mt.tag = ?
      AND m.superseded_by IS NULL
      AND (m.expires_at IS NULL OR m.expires_at > ?)
    ORDER BY m.importance DESC, m.confidence DESC, m.created_at DESC
    LIMIT ?
  `).all(normalizedTag, timestamp, limit) as Memory[];
}

/**
 * Get memories by multiple tags (AND)
 */
export function getMemoriesByTags(tags: string[], limit: number = 50): Memory[] {
  if (tags.length === 0) return [];

  const normalizedTags = tags.map(t => t.toLowerCase().trim());
  const db = getDb();
  const timestamp = now();

  const placeholders = normalizedTags.map(() => '?').join(', ');

  return db.prepare(`
    SELECT m.* FROM memories m
    JOIN memory_tag_links mtl ON m.id = mtl.memory_id
    JOIN memory_tags mt ON mtl.tag_id = mt.id
    WHERE mt.tag IN (${placeholders})
      AND m.superseded_by IS NULL
      AND (m.expires_at IS NULL OR m.expires_at > ?)
    GROUP BY m.id
    HAVING COUNT(DISTINCT mt.tag) = ?
    ORDER BY m.importance DESC, m.confidence DESC, m.created_at DESC
    LIMIT ?
  `).all(...normalizedTags, timestamp, normalizedTags.length, limit) as Memory[];
}

/**
 * Get all tags sorted by usage
 */
export function getAllTags(): MemoryTag[] {
  const db = getDb();

  return db.prepare(`
    SELECT * FROM memory_tags
    ORDER BY memory_count DESC
  `).all() as MemoryTag[];
}

// ============================================================================
// Association Operations
// ============================================================================

export interface CreateAssociationInput {
  memory_id: string;
  association_type: MemoryAssociationType;
  target_id: string;
  strength?: number;
  context?: string;
}

/**
 * Create a memory association
 */
export function createAssociation(input: CreateAssociationInput): MemoryAssociation {
  const db = getDb();
  const id = generateId('massoc');
  const timestamp = now();

  db.prepare(`
    INSERT INTO memory_associations (id, memory_id, association_type, target_id, strength, context, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.memory_id,
    input.association_type,
    input.target_id,
    input.strength ?? 0.5,
    input.context || null,
    timestamp
  );

  return getAssociationById(id)!;
}

/**
 * Get an association by ID
 */
export function getAssociationById(id: string): MemoryAssociation | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM memory_associations WHERE id = ?`).get(id) as MemoryAssociation | undefined;
  return row || null;
}

/**
 * Get associations for a memory
 */
export function getAssociationsForMemory(memoryId: string): MemoryAssociation[] {
  const db = getDb();

  return db.prepare(`
    SELECT * FROM memory_associations
    WHERE memory_id = ?
    ORDER BY strength DESC
  `).all(memoryId) as MemoryAssociation[];
}

/**
 * Get memories associated with a target (outcome, task, or memory)
 */
export function getMemoriesAssociatedWithTarget(
  targetId: string,
  associationType?: MemoryAssociationType,
  limit: number = 50
): Memory[] {
  const db = getDb();
  const timestamp = now();

  let query = `
    SELECT m.* FROM memories m
    JOIN memory_associations ma ON m.id = ma.memory_id
    WHERE ma.target_id = ?
      AND m.superseded_by IS NULL
      AND (m.expires_at IS NULL OR m.expires_at > ?)
  `;
  const params: (string | number)[] = [targetId, timestamp];

  if (associationType) {
    query += ` AND ma.association_type = ?`;
    params.push(associationType);
  }

  query += ` ORDER BY ma.strength DESC, m.importance DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(query).all(...params) as Memory[];
}

/**
 * Get memories relevant to an outcome
 */
export function getMemoriesForOutcome(outcomeId: string, limit: number = 50): Memory[] {
  return getMemoriesAssociatedWithTarget(outcomeId, 'relevant_to_outcome', limit);
}

/**
 * Get memories relevant to a task
 */
export function getMemoriesForTask(taskId: string, limit: number = 50): Memory[] {
  return getMemoriesAssociatedWithTarget(taskId, 'relevant_to_task', limit);
}

/**
 * Update association strength
 */
export function updateAssociationStrength(id: string, strength: number): MemoryAssociation | null {
  const db = getDb();
  db.prepare(`UPDATE memory_associations SET strength = ? WHERE id = ?`).run(Math.max(0, Math.min(1, strength)), id);
  return getAssociationById(id);
}

/**
 * Delete an association
 */
export function deleteAssociation(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM memory_associations WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ============================================================================
// Retrieval Logging Operations
// ============================================================================

export interface LogRetrievalInput {
  memory_id: string;
  outcome_id?: string;
  task_id?: string;
  retrieval_method: 'semantic' | 'tag' | 'association' | 'recency' | 'explicit';
  query?: string;
  relevance_score?: number;
}

/**
 * Log a memory retrieval event
 */
export function logRetrieval(input: LogRetrievalInput): MemoryRetrieval {
  const db = getDb();
  const id = generateId('mret');
  const timestamp = now();

  db.prepare(`
    INSERT INTO memory_retrievals (
      id, memory_id, outcome_id, task_id, retrieval_method, query, relevance_score, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.memory_id,
    input.outcome_id || null,
    input.task_id || null,
    input.retrieval_method,
    input.query || null,
    input.relevance_score ?? 1.0,
    timestamp
  );

  // Also record access on the memory
  recordMemoryAccess(input.memory_id);

  return getRetrievalById(id)!;
}

/**
 * Get a retrieval by ID
 */
export function getRetrievalById(id: string): MemoryRetrieval | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM memory_retrievals WHERE id = ?`).get(id) as MemoryRetrieval | undefined;
  return row || null;
}

/**
 * Mark a retrieval as useful or not useful
 */
export function markRetrievalUsefulness(id: string, wasUseful: boolean): MemoryRetrieval | null {
  const db = getDb();
  db.prepare(`UPDATE memory_retrievals SET was_useful = ? WHERE id = ?`).run(wasUseful ? 1 : 0, id);
  return getRetrievalById(id);
}

/**
 * Get retrieval statistics for a memory
 */
export interface MemoryRetrievalStats {
  totalRetrievals: number;
  usefulRetrievals: number;
  notUsefulRetrievals: number;
  unknownUsefulness: number;
  usefulnessRatio: number;
}

export function getRetrievalStatsForMemory(memoryId: string): MemoryRetrievalStats {
  const db = getDb();

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM memory_retrievals WHERE memory_id = ?
  `).get(memoryId) as { count: number };

  const useful = db.prepare(`
    SELECT COUNT(*) as count FROM memory_retrievals WHERE memory_id = ? AND was_useful = 1
  `).get(memoryId) as { count: number };

  const notUseful = db.prepare(`
    SELECT COUNT(*) as count FROM memory_retrievals WHERE memory_id = ? AND was_useful = 0
  `).get(memoryId) as { count: number };

  const totalRetrievals = total.count;
  const usefulRetrievals = useful.count;
  const notUsefulRetrievals = notUseful.count;
  const unknownUsefulness = totalRetrievals - usefulRetrievals - notUsefulRetrievals;
  const usefulnessRatio = (usefulRetrievals + notUsefulRetrievals) > 0
    ? usefulRetrievals / (usefulRetrievals + notUsefulRetrievals)
    : 0;

  return {
    totalRetrievals,
    usefulRetrievals,
    notUsefulRetrievals,
    unknownUsefulness,
    usefulnessRatio,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a Memory from database format to structured format with typed arrays
 */
export function parseMemory(memory: Memory): ParsedMemory {
  return {
    ...memory,
    tags: safeJsonParse(memory.tags, []),
    embedding: memory.embedding ? safeJsonParse(memory.embedding, null) : null,
  };
}

/**
 * Safely parse JSON with a fallback value
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json || json === '') return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    console.error('[Memory DB] Failed to parse JSON:', json?.substring(0, 100));
    return fallback;
  }
}

/**
 * Get memory system statistics
 */
export interface MemorySystemStats {
  totalMemories: number;
  activeMemories: number;
  supersededMemories: number;
  expiredMemories: number;
  totalTags: number;
  totalAssociations: number;
  totalRetrievals: number;
  byType: Record<MemoryType, number>;
  byImportance: Record<MemoryImportance, number>;
}

export function getMemorySystemStats(): MemorySystemStats {
  const db = getDb();
  const timestamp = now();

  const total = db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as { count: number };
  const superseded = db.prepare(`SELECT COUNT(*) as count FROM memories WHERE superseded_by IS NOT NULL`).get() as { count: number };
  const expired = db.prepare(`SELECT COUNT(*) as count FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?`).get(timestamp) as { count: number };
  const active = total.count - superseded.count - expired.count;
  const tags = db.prepare(`SELECT COUNT(*) as count FROM memory_tags`).get() as { count: number };
  const associations = db.prepare(`SELECT COUNT(*) as count FROM memory_associations`).get() as { count: number };
  const retrievals = db.prepare(`SELECT COUNT(*) as count FROM memory_retrievals`).get() as { count: number };

  // Count by type
  const typeRows = db.prepare(`SELECT type, COUNT(*) as count FROM memories GROUP BY type`).all() as { type: MemoryType; count: number }[];
  const byType: Record<MemoryType, number> = {
    fact: 0, pattern: 0, preference: 0, decision: 0, lesson: 0, context: 0,
  };
  for (const row of typeRows) {
    byType[row.type] = row.count;
  }

  // Count by importance
  const importanceRows = db.prepare(`SELECT importance, COUNT(*) as count FROM memories GROUP BY importance`).all() as { importance: MemoryImportance; count: number }[];
  const byImportance: Record<MemoryImportance, number> = {
    low: 0, medium: 0, high: 0, critical: 0,
  };
  for (const row of importanceRows) {
    byImportance[row.importance] = row.count;
  }

  return {
    totalMemories: total.count,
    activeMemories: active,
    supersededMemories: superseded.count,
    expiredMemories: expired.count,
    totalTags: tags.count,
    totalAssociations: associations.count,
    totalRetrievals: retrievals.count,
    byType,
    byImportance,
  };
}

// ============================================================================
// Query Expansion Search
// ============================================================================

import {
  expandQuery,
  getExpandedQueries,
  combineQueryResults,
  shouldExpandQuery,
  type QueryExpansionOptions,
  type QueryExpansionResult,
  type ExpandedQuery,
} from '../embedding/query-expansion';

export {
  expandQuery,
  getExpandedQueries,
  shouldExpandQuery,
  type QueryExpansionOptions,
  type QueryExpansionResult,
  type ExpandedQuery,
};

/**
 * Search result with expansion metadata
 */
export interface ExpandedSearchResult extends BM25SearchResult {
  /** Which expanded query found this result */
  matchedQuery: string;
  /** Type of expansion that found this result */
  expansionType: 'synonym' | 'related' | 'rephrase' | 'technical' | 'original';
}

/**
 * Result from expanded search operation
 */
export interface ExpandedSearchResponse {
  /** All results from expanded search, deduplicated */
  results: ExpandedSearchResult[];
  /** The original query */
  originalQuery: string;
  /** All queries used in the search */
  expandedQueries: ExpandedQuery[];
  /** Whether query expansion was used */
  expansionUsed: boolean;
  /** Total time for search including expansion */
  totalDurationMs: number;
  /** Time for query expansion alone */
  expansionDurationMs: number;
}

/**
 * Options for expanded memory search
 */
export interface ExpandedSearchOptions {
  /** Maximum results per query (default: 10) */
  limitPerQuery?: number;
  /** Total maximum results (default: 20) */
  totalLimit?: number;
  /** Search context hint for expansion */
  searchContext?: 'technical' | 'general' | 'pattern' | 'decision';
  /** Number of query expansions (default: 5) */
  expansionCount?: number;
  /** Whether to force expansion even for complex queries (default: false) */
  forceExpansion?: boolean;
  /** Outcome ID for cost tracking */
  outcomeId?: string;
  /** Timeout for expansion in ms (default: 30000) */
  expansionTimeout?: number;
}

/**
 * Search memories using query expansion for improved recall
 *
 * This function:
 * 1. Expands the query into 5+ related queries using Claude
 * 2. Runs each expanded query against the BM25 FTS5 index
 * 3. Combines and deduplicates results
 * 4. Returns results ordered by relevance
 *
 * @param query The search query to expand and search
 * @param options Search options
 * @returns Search results with expansion metadata
 */
export async function searchMemoriesExpanded(
  query: string,
  options: ExpandedSearchOptions = {}
): Promise<ExpandedSearchResponse> {
  const {
    limitPerQuery = 10,
    totalLimit = 20,
    searchContext = 'general',
    expansionCount = 5,
    forceExpansion = false,
    outcomeId,
    expansionTimeout = 30000,
  } = options;

  const startTime = Date.now();

  // Check if we should expand this query
  const shouldExpand = forceExpansion || shouldExpandQuery(query);

  if (!shouldExpand) {
    // Just do a regular BM25 search
    const results = searchMemoriesBM25(query, totalLimit);
    return {
      results: results.map(r => ({
        ...r,
        matchedQuery: query,
        expansionType: 'original' as const,
      })),
      originalQuery: query,
      expandedQueries: [{ query, expansionType: 'original' }],
      expansionUsed: false,
      totalDurationMs: Date.now() - startTime,
      expansionDurationMs: 0,
    };
  }

  // Expand the query
  const expansionResult = await expandQuery(query, {
    expansionCount,
    timeout: expansionTimeout,
    searchContext,
    outcomeId,
  });

  const expansionDurationMs = expansionResult.durationMs;

  // Run searches for each expanded query
  const allResults: ExpandedSearchResult[] = [];
  const seenMemoryIds = new Set<string>();

  for (const expandedQuery of expansionResult.expandedQueries) {
    try {
      const queryResults = searchMemoriesBM25(expandedQuery.query, limitPerQuery);

      for (const result of queryResults) {
        // Deduplicate by memory ID
        if (!seenMemoryIds.has(result.memory.id)) {
          seenMemoryIds.add(result.memory.id);
          allResults.push({
            ...result,
            matchedQuery: expandedQuery.query,
            expansionType: expandedQuery.expansionType,
          });
        }
      }
    } catch (searchError) {
      // Log and continue with other queries
      console.warn(`[Expanded Search] Query "${expandedQuery.query}" failed:`, searchError);
    }
  }

  // Sort by BM25 score (higher is better)
  allResults.sort((a, b) => b.bm25Score - a.bm25Score);

  // Limit total results
  const limitedResults = allResults.slice(0, totalLimit);

  return {
    results: limitedResults,
    originalQuery: query,
    expandedQueries: expansionResult.expandedQueries,
    expansionUsed: true,
    totalDurationMs: Date.now() - startTime,
    expansionDurationMs,
  };
}

/**
 * Simple expanded search that returns just memories
 *
 * @param query The search query
 * @param limit Maximum results (default: 20)
 * @param outcomeId Optional outcome ID for cost tracking
 * @returns Array of memories found via expanded search
 */
export async function searchMemoriesWithExpansion(
  query: string,
  limit: number = 20,
  outcomeId?: string
): Promise<Memory[]> {
  const response = await searchMemoriesExpanded(query, {
    totalLimit: limit,
    outcomeId,
  });

  return response.results.map(r => r.memory);
}

// ============================================================================
// Hybrid Search (Re-export from embedding module)
// ============================================================================

export {
  searchMemoriesHybrid,
  searchMemoriesHybridSimple,
  searchMemoriesHybridWeighted,
  searchMemoriesVector,
  searchMemoriesVectorByQuery,
  searchMemoriesBM25Only,
  searchMemoriesVectorOnly,
  isHybridSearchAvailable,
  type HybridSearchResult,
  type HybridSearchOptions,
  type HybridSearchResponse,
  type VectorSearchResult,
} from '../embedding/hybrid-search';
