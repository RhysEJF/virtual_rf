/**
 * Cross-Outcome Memory Service
 *
 * A unified service for storing, retrieving, and searching cross-outcome knowledge.
 * This service wraps all memory functionality with a clean, high-level API.
 *
 * Features:
 * - Store memories with automatic embedding generation (if Ollama is available)
 * - Multiple search strategies: BM25, vector, hybrid, and expanded
 * - Tag-based categorization and retrieval
 * - Associations between memories and outcomes/tasks
 * - Retrieval logging for feedback loop
 * - Automatic cleanup of expired memories
 *
 * Usage:
 * ```typescript
 * import { memoryService } from '@/lib/memory';
 *
 * // Store a memory
 * const memory = await memoryService.store({
 *   content: 'Always validate input at API boundaries',
 *   type: 'lesson',
 *   importance: 'high',
 *   tags: ['api', 'validation', 'security'],
 * });
 *
 * // Search memories
 * const results = await memoryService.search('input validation');
 *
 * // Get relevant memories for a task
 * const relevant = await memoryService.getForTask(taskId);
 * ```
 */

import {
  // CRUD operations
  createMemory,
  getMemoryById,
  getParsedMemory,
  updateMemory,
  deleteMemory,
  supersedeMemory,
  recordMemoryAccess,
  // Retrieval operations
  getActiveMemories,
  getMemoriesByType,
  getMemoriesByImportance,
  getMemoriesBySourceOutcome,
  getRecentlyAccessedMemories,
  getMostAccessedMemories,
  searchMemories,
  // BM25 search
  searchMemoriesBM25,
  searchMemoriesExactPhrase,
  searchMemoriesByKeywords,
  searchMemoriesAdvanced,
  isFTS5Available,
  rebuildFTS5Index,
  getFTS5Stats,
  // Tag operations
  getOrCreateTag,
  addTagsToMemory,
  getMemoriesByTag,
  getMemoriesByTags,
  getAllTags,
  // Association operations
  createAssociation,
  getAssociationsForMemory,
  getMemoriesAssociatedWithTarget,
  getMemoriesForOutcome,
  getMemoriesForTask,
  updateAssociationStrength,
  deleteAssociation,
  // Retrieval logging
  logRetrieval,
  markRetrievalUsefulness,
  getRetrievalStatsForMemory,
  // Cleanup
  getExpiredMemories,
  cleanupExpiredMemories,
  // Stats
  getMemorySystemStats,
  parseMemory,
  // Query expansion search
  searchMemoriesExpanded,
  searchMemoriesWithExpansion,
  // Types from memory.ts
  type CreateMemoryInput,
  type CreateAssociationInput,
  type LogRetrievalInput,
  type BM25SearchResult,
  type ExpandedSearchResult,
  type ExpandedSearchOptions,
  type ExpandedSearchResponse,
  type MemorySystemStats,
  type MemoryRetrievalStats,
  type FTS5Stats,
} from '../db/memory';

import {
  // Hybrid search
  searchMemoriesHybrid,
  searchMemoriesHybridSimple,
  searchMemoriesHybridWeighted,
  searchMemoriesVector,
  searchMemoriesVectorByQuery,
  searchMemoriesBM25Only,
  searchMemoriesVectorOnly,
  isHybridSearchAvailable,
  // Types from hybrid-search
  type HybridSearchResult,
  type HybridSearchOptions,
  type HybridSearchResponse,
  type VectorSearchResult,
} from '../embedding/hybrid-search';

import {
  // Embedding generation
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  checkOllamaHealth,
  OllamaError,
  type EmbeddingOptions,
  type EmbeddingResult,
} from '../embedding/ollama';

import {
  // Query expansion
  expandQuery,
  getExpandedQueries,
  shouldExpandQuery,
  type QueryExpansionOptions,
  type QueryExpansionResult,
  type ExpandedQuery,
} from '../embedding/query-expansion';

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
} from '../db/schema';

// ============================================================================
// Service Configuration
// ============================================================================

export interface MemoryServiceConfig {
  /** Whether to automatically generate embeddings on store (default: true) */
  autoGenerateEmbeddings: boolean;
  /** Embedding options for Ollama */
  embeddingOptions: EmbeddingOptions;
  /** Default search strategy (default: 'hybrid') */
  defaultSearchStrategy: SearchStrategy;
  /** Whether to log retrievals automatically (default: true) */
  autoLogRetrievals: boolean;
  /** Minimum score for results to be returned (default: 0.3) */
  minRelevanceScore: number;
}

export type SearchStrategy = 'bm25' | 'vector' | 'hybrid' | 'expanded';

const defaultConfig: MemoryServiceConfig = {
  autoGenerateEmbeddings: true,
  embeddingOptions: {},
  defaultSearchStrategy: 'hybrid',
  autoLogRetrievals: true,
  minRelevanceScore: 0.3,
};

// ============================================================================
// Store Input Types
// ============================================================================

export interface StoreMemoryInput {
  content: string;
  type: MemoryType;
  importance?: MemoryImportance;
  source?: MemorySource;
  sourceOutcomeId?: string;
  sourceTaskId?: string;
  tags?: string[];
  confidence?: number;
  expiresAt?: number;
  /** Skip embedding generation for this memory */
  skipEmbedding?: boolean;
}

export interface StoreAndAssociateInput extends StoreMemoryInput {
  /** Associate with an outcome */
  outcomeId?: string;
  /** Associate with a task */
  taskId?: string;
  /** Association strength (0-1) */
  associationStrength?: number;
  /** Association context/reason */
  associationContext?: string;
}

// ============================================================================
// Search Input Types
// ============================================================================

export interface SearchInput {
  query: string;
  strategy?: SearchStrategy;
  limit?: number;
  /** Outcome context for logging */
  outcomeId?: string;
  /** Task context for logging */
  taskId?: string;
  /** Filter by type */
  type?: MemoryType;
  /** Filter by importance */
  importance?: MemoryImportance;
  /** Filter by tags (all must match) */
  tags?: string[];
}

export interface SearchResponse {
  memories: ParsedMemory[];
  strategy: SearchStrategy;
  totalFound: number;
  timingMs: number;
  /** Retrieval IDs for feedback */
  retrievalIds: string[];
}

// ============================================================================
// Memory Service Class
// ============================================================================

class MemoryService {
  private config: MemoryServiceConfig;

  constructor(config: Partial<MemoryServiceConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Update service configuration
   */
  configure(config: Partial<MemoryServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): MemoryServiceConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // Store Operations
  // ==========================================================================

  /**
   * Store a new memory
   *
   * Automatically generates embedding if Ollama is available
   * and autoGenerateEmbeddings is enabled.
   */
  async store(input: StoreMemoryInput): Promise<ParsedMemory> {
    let embedding: number[] | undefined;

    // Generate embedding if configured and not skipped
    if (this.config.autoGenerateEmbeddings && !input.skipEmbedding) {
      try {
        const result = await generateEmbedding(input.content, this.config.embeddingOptions);
        embedding = result.embedding;
      } catch (error) {
        // Log but don't fail - embedding is optional
        console.warn('[MemoryService] Failed to generate embedding:', error);
      }
    }

    const memory = createMemory({
      content: input.content,
      type: input.type,
      importance: input.importance,
      source: input.source || 'system',
      source_outcome_id: input.sourceOutcomeId,
      source_task_id: input.sourceTaskId,
      tags: input.tags,
      embedding,
      confidence: input.confidence,
      expires_at: input.expiresAt,
    });

    return parseMemory(memory);
  }

  /**
   * Store a memory and create associations
   */
  async storeAndAssociate(input: StoreAndAssociateInput): Promise<{
    memory: ParsedMemory;
    associations: MemoryAssociation[];
  }> {
    const memory = await this.store(input);
    const associations: MemoryAssociation[] = [];

    // Create outcome association
    if (input.outcomeId) {
      const assoc = createAssociation({
        memory_id: memory.id,
        association_type: 'relevant_to_outcome',
        target_id: input.outcomeId,
        strength: input.associationStrength ?? 0.7,
        context: input.associationContext,
      });
      associations.push(assoc);
    }

    // Create task association
    if (input.taskId) {
      const assoc = createAssociation({
        memory_id: memory.id,
        association_type: 'relevant_to_task',
        target_id: input.taskId,
        strength: input.associationStrength ?? 0.7,
        context: input.associationContext,
      });
      associations.push(assoc);
    }

    return { memory, associations };
  }

  /**
   * Store multiple memories in batch
   */
  async storeBatch(inputs: StoreMemoryInput[]): Promise<ParsedMemory[]> {
    // Generate embeddings in batch if configured
    let embeddings: number[][] | null = null;

    const textsToEmbed = inputs
      .filter((input) => this.config.autoGenerateEmbeddings && !input.skipEmbedding)
      .map((input) => input.content);

    if (textsToEmbed.length > 0) {
      try {
        const result = await generateEmbeddings(textsToEmbed, this.config.embeddingOptions);
        embeddings = result.embeddings;
      } catch (error) {
        console.warn('[MemoryService] Failed to generate batch embeddings:', error);
      }
    }

    // Create memories with embeddings
    const memories: ParsedMemory[] = [];
    let embeddingIndex = 0;

    for (const input of inputs) {
      let embedding: number[] | undefined;

      if (this.config.autoGenerateEmbeddings && !input.skipEmbedding && embeddings) {
        embedding = embeddings[embeddingIndex++];
      }

      const memory = createMemory({
        content: input.content,
        type: input.type,
        importance: input.importance,
        source: input.source || 'system',
        source_outcome_id: input.sourceOutcomeId,
        source_task_id: input.sourceTaskId,
        tags: input.tags,
        embedding,
        confidence: input.confidence,
        expires_at: input.expiresAt,
      });

      memories.push(parseMemory(memory));
    }

    return memories;
  }

  // ==========================================================================
  // Search Operations
  // ==========================================================================

  /**
   * Search memories using the configured or specified strategy
   */
  async search(input: SearchInput | string): Promise<SearchResponse> {
    const startTime = Date.now();
    const searchInput: SearchInput = typeof input === 'string' ? { query: input } : input;
    const {
      query,
      strategy = this.config.defaultSearchStrategy,
      limit = 20,
      outcomeId,
      taskId,
      type,
      importance,
      tags,
    } = searchInput;

    let memories: ParsedMemory[] = [];
    let retrievalIds: string[] = [];

    // Execute search based on strategy
    switch (strategy) {
      case 'bm25': {
        const results = searchMemoriesBM25(query, limit);
        memories = results.map((r) => parseMemory(r.memory));
        break;
      }

      case 'vector': {
        const response = await searchMemoriesVectorOnly(query, limit, this.config.embeddingOptions);
        memories = response.results
          .filter((r) => r.vectorScore !== null && r.vectorScore >= this.config.minRelevanceScore)
          .map((r) => r.parsedMemory);
        break;
      }

      case 'hybrid': {
        const response = await searchMemoriesHybrid(query, {
          limit,
          embeddingOptions: this.config.embeddingOptions,
          minVectorScore: this.config.minRelevanceScore,
        });
        memories = response.results.map((r) => r.parsedMemory);
        break;
      }

      case 'expanded': {
        const response = await searchMemoriesExpanded(query, {
          totalLimit: limit,
          outcomeId,
        });
        memories = response.results.map((r) => parseMemory(r.memory));
        break;
      }
    }

    // Apply filters
    if (type) {
      memories = memories.filter((m) => m.type === type);
    }
    if (importance) {
      memories = memories.filter((m) => m.importance === importance);
    }
    if (tags && tags.length > 0) {
      memories = memories.filter((m) => tags.every((tag) => m.tags.includes(tag.toLowerCase())));
    }

    // Log retrievals if configured
    if (this.config.autoLogRetrievals && memories.length > 0) {
      for (const memory of memories) {
        const retrieval = logRetrieval({
          memory_id: memory.id,
          outcome_id: outcomeId,
          task_id: taskId,
          retrieval_method: strategy === 'hybrid' ? 'semantic' : strategy === 'vector' ? 'semantic' : 'tag',
          query,
          relevance_score: 1.0, // Could be improved with actual scores
        });
        retrievalIds.push(retrieval.id);
      }
    }

    return {
      memories,
      strategy,
      totalFound: memories.length,
      timingMs: Date.now() - startTime,
      retrievalIds,
    };
  }

  /**
   * Simple search returning just memories
   */
  async find(query: string, limit: number = 20): Promise<ParsedMemory[]> {
    const response = await this.search({ query, limit });
    return response.memories;
  }

  /**
   * Search with exact phrase matching
   */
  async findExact(phrase: string, limit: number = 20): Promise<ParsedMemory[]> {
    const results = searchMemoriesExactPhrase(phrase, limit);
    return results.map((r) => parseMemory(r.memory));
  }

  /**
   * Search by multiple keywords (all must match)
   */
  async findByKeywords(keywords: string[], limit: number = 20): Promise<ParsedMemory[]> {
    const results = searchMemoriesByKeywords(keywords, limit);
    return results.map((r) => parseMemory(r.memory));
  }

  /**
   * Advanced search with include/exclude terms
   */
  async findAdvanced(
    mustInclude: string[],
    shouldInclude: string[] = [],
    mustExclude: string[] = [],
    limit: number = 20
  ): Promise<ParsedMemory[]> {
    const results = searchMemoriesAdvanced(mustInclude, shouldInclude, mustExclude, limit);
    return results.map((r) => parseMemory(r.memory));
  }

  // ==========================================================================
  // Context-based Retrieval
  // ==========================================================================

  /**
   * Get memories relevant to an outcome
   */
  async getForOutcome(outcomeId: string, limit: number = 20): Promise<ParsedMemory[]> {
    const memories = getMemoriesForOutcome(outcomeId, limit);
    return memories.map(parseMemory);
  }

  /**
   * Get memories relevant to a task
   */
  async getForTask(taskId: string, limit: number = 20): Promise<ParsedMemory[]> {
    const memories = getMemoriesForTask(taskId, limit);
    return memories.map(parseMemory);
  }

  /**
   * Get memories by type
   */
  async getByType(type: MemoryType, limit: number = 50): Promise<ParsedMemory[]> {
    const memories = getMemoriesByType(type, limit);
    return memories.map(parseMemory);
  }

  /**
   * Get memories by importance
   */
  async getByImportance(importance: MemoryImportance, limit: number = 50): Promise<ParsedMemory[]> {
    const memories = getMemoriesByImportance(importance, limit);
    return memories.map(parseMemory);
  }

  /**
   * Get memories by tag
   */
  async getByTag(tag: string, limit: number = 50): Promise<ParsedMemory[]> {
    const memories = getMemoriesByTag(tag, limit);
    return memories.map(parseMemory);
  }

  /**
   * Get memories by multiple tags (all must match)
   */
  async getByTags(tags: string[], limit: number = 50): Promise<ParsedMemory[]> {
    const memories = getMemoriesByTags(tags, limit);
    return memories.map(parseMemory);
  }

  /**
   * Get memories from a specific source outcome
   */
  async getFromSourceOutcome(outcomeId: string, limit: number = 50): Promise<ParsedMemory[]> {
    const memories = getMemoriesBySourceOutcome(outcomeId, limit);
    return memories.map(parseMemory);
  }

  /**
   * Get recently accessed memories
   */
  async getRecentlyAccessed(limit: number = 20): Promise<ParsedMemory[]> {
    const memories = getRecentlyAccessedMemories(limit);
    return memories.map(parseMemory);
  }

  /**
   * Get most frequently accessed memories
   */
  async getMostAccessed(limit: number = 20): Promise<ParsedMemory[]> {
    const memories = getMostAccessedMemories(limit);
    return memories.map(parseMemory);
  }

  /**
   * Get all active memories (not superseded, not expired)
   */
  async getActive(limit: number = 100): Promise<ParsedMemory[]> {
    const memories = getActiveMemories(limit);
    return memories.map(parseMemory);
  }

  // ==========================================================================
  // Read/Update/Delete Operations
  // ==========================================================================

  /**
   * Get a memory by ID
   */
  get(id: string): ParsedMemory | null {
    return getParsedMemory(id);
  }

  /**
   * Update a memory
   */
  update(
    id: string,
    updates: Partial<{
      content: string;
      type: MemoryType;
      importance: MemoryImportance;
      confidence: number;
      expiresAt: number | null;
    }>
  ): ParsedMemory | null {
    const memory = updateMemory(id, {
      content: updates.content,
      type: updates.type,
      importance: updates.importance,
      confidence: updates.confidence,
      expires_at: updates.expiresAt,
    });

    return memory ? parseMemory(memory) : null;
  }

  /**
   * Delete a memory
   */
  delete(id: string): boolean {
    return deleteMemory(id);
  }

  /**
   * Mark a memory as superseded by another
   */
  supersede(oldMemoryId: string, newMemoryId: string): ParsedMemory | null {
    const memory = supersedeMemory(oldMemoryId, newMemoryId);
    return memory ? parseMemory(memory) : null;
  }

  /**
   * Add tags to a memory
   */
  addTags(memoryId: string, tags: string[]): void {
    addTagsToMemory(memoryId, tags);
  }

  // ==========================================================================
  // Association Operations
  // ==========================================================================

  /**
   * Associate a memory with an outcome
   */
  associateWithOutcome(
    memoryId: string,
    outcomeId: string,
    strength: number = 0.7,
    context?: string
  ): MemoryAssociation {
    return createAssociation({
      memory_id: memoryId,
      association_type: 'relevant_to_outcome',
      target_id: outcomeId,
      strength,
      context,
    });
  }

  /**
   * Associate a memory with a task
   */
  associateWithTask(
    memoryId: string,
    taskId: string,
    strength: number = 0.7,
    context?: string
  ): MemoryAssociation {
    return createAssociation({
      memory_id: memoryId,
      association_type: 'relevant_to_task',
      target_id: taskId,
      strength,
      context,
    });
  }

  /**
   * Link two memories as related
   */
  linkMemories(
    memoryId1: string,
    memoryId2: string,
    strength: number = 0.5,
    context?: string
  ): MemoryAssociation {
    return createAssociation({
      memory_id: memoryId1,
      association_type: 'related_to_memory',
      target_id: memoryId2,
      strength,
      context,
    });
  }

  /**
   * Get all associations for a memory
   */
  getAssociations(memoryId: string): MemoryAssociation[] {
    return getAssociationsForMemory(memoryId);
  }

  /**
   * Update association strength
   */
  updateAssociationStrength(associationId: string, strength: number): MemoryAssociation | null {
    return updateAssociationStrength(associationId, strength);
  }

  /**
   * Remove an association
   */
  removeAssociation(associationId: string): boolean {
    return deleteAssociation(associationId);
  }

  // ==========================================================================
  // Feedback Operations
  // ==========================================================================

  /**
   * Mark a retrieval as useful
   */
  markUseful(retrievalId: string): MemoryRetrieval | null {
    return markRetrievalUsefulness(retrievalId, true);
  }

  /**
   * Mark a retrieval as not useful
   */
  markNotUseful(retrievalId: string): MemoryRetrieval | null {
    return markRetrievalUsefulness(retrievalId, false);
  }

  /**
   * Get retrieval statistics for a memory
   */
  getRetrievalStats(memoryId: string): MemoryRetrievalStats {
    return getRetrievalStatsForMemory(memoryId);
  }

  // ==========================================================================
  // Health & Stats
  // ==========================================================================

  /**
   * Check if all memory service features are available
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    features: {
      database: boolean;
      fts5: boolean;
      embeddings: boolean;
    };
    details: {
      fts5Stats: FTS5Stats;
      ollamaHealth: { available: boolean; modelReady: boolean; error?: string };
    };
  }> {
    const fts5Stats = getFTS5Stats();
    const ollamaHealth = await checkOllamaHealth(this.config.embeddingOptions);

    return {
      healthy: fts5Stats.available && (ollamaHealth.available || !this.config.autoGenerateEmbeddings),
      features: {
        database: true,
        fts5: fts5Stats.available,
        embeddings: ollamaHealth.available && ollamaHealth.modelReady,
      },
      details: {
        fts5Stats,
        ollamaHealth,
      },
    };
  }

  /**
   * Get memory system statistics
   */
  getStats(): MemorySystemStats {
    return getMemorySystemStats();
  }

  /**
   * Get all tags sorted by usage
   */
  getAllTags(): MemoryTag[] {
    return getAllTags();
  }

  /**
   * Get FTS5 index statistics
   */
  getFTS5Stats(): FTS5Stats {
    return getFTS5Stats();
  }

  // ==========================================================================
  // Maintenance Operations
  // ==========================================================================

  /**
   * Clean up expired memories
   * @returns Number of memories deleted
   */
  cleanupExpired(): number {
    return cleanupExpiredMemories();
  }

  /**
   * Rebuild the FTS5 search index
   */
  rebuildSearchIndex(): boolean {
    return rebuildFTS5Index();
  }

  /**
   * Generate missing embeddings for memories without them
   */
  async generateMissingEmbeddings(batchSize: number = 10): Promise<{
    processed: number;
    failed: number;
  }> {
    const activeMemories = getActiveMemories(1000);
    const memoriesWithoutEmbeddings = activeMemories.filter((m) => !m.embedding);

    let processed = 0;
    let failed = 0;

    // Process in batches
    for (let i = 0; i < memoriesWithoutEmbeddings.length; i += batchSize) {
      const batch = memoriesWithoutEmbeddings.slice(i, i + batchSize);
      const texts = batch.map((m) => m.content);

      try {
        const result = await generateEmbeddings(texts, this.config.embeddingOptions);

        // Update each memory with its embedding
        for (let j = 0; j < batch.length; j++) {
          const memory = batch[j];
          const embedding = result.embeddings[j];

          if (embedding) {
            // Update in database directly (no update function for embedding)
            const { getDb, now } = await import('../db/index');
            const db = getDb();
            db.prepare(`
              UPDATE memories SET embedding = ?, updated_at = ? WHERE id = ?
            `).run(JSON.stringify(embedding), now(), memory.id);

            processed++;
          }
        }
      } catch (error) {
        console.warn('[MemoryService] Failed to generate embeddings for batch:', error);
        failed += batch.length;
      }
    }

    return { processed, failed };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default memory service instance
 *
 * Use this for standard operations. Create a custom instance with
 * `new MemoryService(config)` for different configurations.
 */
export const memoryService = new MemoryService();

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { MemoryService };

// Types
export type {
  Memory,
  MemoryAssociation,
  MemoryRetrieval,
  MemoryTag,
  MemoryType,
  MemoryImportance,
  MemorySource,
  MemoryAssociationType,
  ParsedMemory,
  // Search types
  HybridSearchResult,
  HybridSearchOptions,
  HybridSearchResponse,
  VectorSearchResult,
  BM25SearchResult,
  ExpandedSearchResult,
  ExpandedSearchOptions,
  ExpandedSearchResponse,
  // Embedding types
  EmbeddingOptions,
  EmbeddingResult,
  // Query expansion types
  QueryExpansionOptions,
  QueryExpansionResult,
  ExpandedQuery,
  // Stats types
  MemorySystemStats,
  MemoryRetrievalStats,
  FTS5Stats,
};

// Errors
export { OllamaError };

// Low-level functions for advanced use cases
export {
  // Direct search functions
  searchMemoriesHybrid,
  searchMemoriesHybridSimple,
  searchMemoriesHybridWeighted,
  searchMemoriesVector,
  searchMemoriesVectorByQuery,
  searchMemoriesBM25Only,
  searchMemoriesVectorOnly,
  searchMemoriesBM25,
  searchMemoriesExpanded,
  searchMemoriesWithExpansion,
  // Embedding functions
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  checkOllamaHealth,
  isHybridSearchAvailable,
  // Query expansion
  expandQuery,
  getExpandedQueries,
  shouldExpandQuery,
  // Direct DB operations
  createMemory,
  getMemoryById,
  updateMemory,
  deleteMemory,
  createAssociation,
  logRetrieval,
  isFTS5Available,
};
