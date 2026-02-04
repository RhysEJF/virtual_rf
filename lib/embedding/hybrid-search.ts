/**
 * Hybrid Search Module
 *
 * Combines multiple search methods for improved recall and precision:
 * - Vector similarity search using embeddings
 * - BM25 text search using FTS5
 * - Deduplication of results
 * - Reciprocal Rank Fusion (RRF) re-ranking
 *
 * This implements a hybrid approach that leverages the strengths of both:
 * - Semantic search (captures meaning/context)
 * - Lexical search (captures exact terms/keywords)
 */

import { getDb, now } from '../db/index';
import {
  generateEmbedding,
  cosineSimilarity,
  checkOllamaHealth,
  type EmbeddingOptions,
} from './ollama';
import {
  searchMemoriesBM25,
  isFTS5Available,
  parseMemory,
  type BM25SearchResult,
} from '../db/memory';
import type { Memory, ParsedMemory } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * A single search result from hybrid search
 */
export interface HybridSearchResult {
  memory: Memory;
  parsedMemory: ParsedMemory;
  /** Combined score from re-ranking (higher is better) */
  hybridScore: number;
  /** Vector similarity score (0-1, higher is better) */
  vectorScore: number | null;
  /** BM25 relevance score (normalized, higher is better) */
  bm25Score: number | null;
  /** Which methods found this result */
  foundBy: ('vector' | 'bm25')[];
  /** Snippet from BM25 match if available */
  matchedSnippet: string | null;
}

/**
 * Options for hybrid search
 */
export interface HybridSearchOptions {
  /** Maximum results to return (default: 20) */
  limit?: number;
  /** Weight for vector search in RRF (default: 0.5) */
  vectorWeight?: number;
  /** Weight for BM25 search in RRF (default: 0.5) */
  bm25Weight?: number;
  /** RRF constant k (default: 60) */
  rrfK?: number;
  /** Whether to include memories without embeddings in vector search (default: false) */
  includeUnembedded?: boolean;
  /** Minimum vector similarity threshold (default: 0.3) */
  minVectorScore?: number;
  /** Embedding model options */
  embeddingOptions?: EmbeddingOptions;
  /** Whether to fall back to BM25-only if vector search fails (default: true) */
  fallbackToBM25?: boolean;
}

/**
 * Response from hybrid search operation
 */
export interface HybridSearchResponse {
  results: HybridSearchResult[];
  query: string;
  /** Whether vector search was used */
  vectorSearchUsed: boolean;
  /** Whether BM25 search was used */
  bm25SearchUsed: boolean;
  /** Total unique results before limiting */
  totalCandidates: number;
  /** Search timing information */
  timing: {
    totalMs: number;
    vectorSearchMs: number | null;
    bm25SearchMs: number | null;
    rerankingMs: number;
  };
  /** Any warnings or issues encountered */
  warnings: string[];
}

// ============================================================================
// Vector Search Implementation
// ============================================================================

/**
 * Result from vector similarity search
 */
export interface VectorSearchResult {
  memory: Memory;
  similarity: number;
}

/**
 * Search memories by vector similarity using embeddings
 *
 * @param queryEmbedding The query embedding vector
 * @param limit Maximum results to return
 * @param minScore Minimum similarity score threshold
 * @returns Memories sorted by similarity (highest first)
 */
export function searchMemoriesVector(
  queryEmbedding: number[],
  limit: number = 20,
  minScore: number = 0.3
): VectorSearchResult[] {
  const db = getDb();
  const timestamp = now();

  // Get all memories with embeddings that are active
  const memories = db.prepare(`
    SELECT * FROM memories
    WHERE embedding IS NOT NULL
      AND superseded_by IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
  `).all(timestamp) as Memory[];

  // Calculate similarity for each memory
  const results: VectorSearchResult[] = [];

  for (const memory of memories) {
    if (!memory.embedding) continue;

    let embedding: number[];
    try {
      embedding = JSON.parse(memory.embedding);
    } catch {
      // Skip memories with invalid embeddings
      continue;
    }

    // Only compare if dimensions match
    if (embedding.length !== queryEmbedding.length) {
      continue;
    }

    const similarity = cosineSimilarity(queryEmbedding, embedding);

    if (similarity >= minScore) {
      results.push({
        memory,
        similarity,
      });
    }
  }

  // Sort by similarity descending and limit
  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Search memories by vector similarity using a text query
 * Generates an embedding for the query first
 *
 * @param query Text query to search for
 * @param limit Maximum results
 * @param options Embedding options
 * @returns Memories sorted by similarity
 */
export async function searchMemoriesVectorByQuery(
  query: string,
  limit: number = 20,
  options: EmbeddingOptions = {}
): Promise<{
  results: VectorSearchResult[];
  queryEmbedding: number[];
  durationMs: number;
}> {
  const startTime = Date.now();

  // Generate embedding for the query
  const embeddingResult = await generateEmbedding(query, options);

  // Search by vector
  const results = searchMemoriesVector(embeddingResult.embedding, limit);

  return {
    results,
    queryEmbedding: embeddingResult.embedding,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// Reciprocal Rank Fusion (RRF) Implementation
// ============================================================================

/**
 * Calculate RRF score for a result
 *
 * RRF formula: score = Σ (1 / (k + rank))
 * where k is a constant (typically 60) that controls the impact of lower-ranked results
 *
 * @param rank The rank of the result (1-indexed)
 * @param k RRF constant
 * @returns RRF score contribution
 */
function rrfScore(rank: number, k: number = 60): number {
  return 1 / (k + rank);
}

/**
 * Combined search result for RRF processing
 */
interface RRFCandidate {
  memoryId: string;
  memory: Memory;
  vectorRank: number | null;
  bm25Rank: number | null;
  vectorScore: number | null;
  bm25Score: number | null;
  matchedSnippet: string | null;
}

/**
 * Apply Reciprocal Rank Fusion to combine search results
 *
 * @param vectorResults Results from vector search
 * @param bm25Results Results from BM25 search
 * @param options Search options
 * @returns Combined and re-ranked results
 */
function applyRRF(
  vectorResults: VectorSearchResult[],
  bm25Results: BM25SearchResult[],
  options: HybridSearchOptions
): HybridSearchResult[] {
  const {
    vectorWeight = 0.5,
    bm25Weight = 0.5,
    rrfK = 60,
    limit = 20,
  } = options;

  // Build candidate map
  const candidates = new Map<string, RRFCandidate>();

  // Add vector results
  vectorResults.forEach((result, index) => {
    const rank = index + 1; // 1-indexed
    candidates.set(result.memory.id, {
      memoryId: result.memory.id,
      memory: result.memory,
      vectorRank: rank,
      bm25Rank: null,
      vectorScore: result.similarity,
      bm25Score: null,
      matchedSnippet: null,
    });
  });

  // Add/merge BM25 results
  bm25Results.forEach((result, index) => {
    const rank = index + 1; // 1-indexed
    const existing = candidates.get(result.memory.id);

    if (existing) {
      // Merge with existing vector result
      existing.bm25Rank = rank;
      existing.bm25Score = result.bm25Score;
      existing.matchedSnippet = result.matchedSnippet;
    } else {
      // New result from BM25 only
      candidates.set(result.memory.id, {
        memoryId: result.memory.id,
        memory: result.memory,
        vectorRank: null,
        bm25Rank: rank,
        vectorScore: null,
        bm25Score: result.bm25Score,
        matchedSnippet: result.matchedSnippet,
      });
    }
  });

  // Calculate RRF scores and build final results
  const scoredResults: HybridSearchResult[] = [];

  for (const candidate of Array.from(candidates.values())) {
    let hybridScore = 0;
    const foundBy: ('vector' | 'bm25')[] = [];

    // Add vector RRF contribution
    if (candidate.vectorRank !== null) {
      hybridScore += vectorWeight * rrfScore(candidate.vectorRank, rrfK);
      foundBy.push('vector');
    }

    // Add BM25 RRF contribution
    if (candidate.bm25Rank !== null) {
      hybridScore += bm25Weight * rrfScore(candidate.bm25Rank, rrfK);
      foundBy.push('bm25');
    }

    scoredResults.push({
      memory: candidate.memory,
      parsedMemory: parseMemory(candidate.memory),
      hybridScore,
      vectorScore: candidate.vectorScore,
      bm25Score: candidate.bm25Score,
      foundBy,
      matchedSnippet: candidate.matchedSnippet,
    });
  }

  // Sort by hybrid score descending and limit
  return scoredResults
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, limit);
}

// ============================================================================
// Hybrid Search Main Function
// ============================================================================

/**
 * Perform hybrid search combining vector and BM25 search
 *
 * This function:
 * 1. Runs vector similarity search (if Ollama is available)
 * 2. Runs BM25 FTS5 search
 * 3. Deduplicates results by memory ID
 * 4. Re-ranks using Reciprocal Rank Fusion (RRF)
 *
 * @param query The search query
 * @param options Search options
 * @returns Combined search results with metadata
 */
export async function searchMemoriesHybrid(
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResponse> {
  const {
    limit = 20,
    embeddingOptions = {},
    fallbackToBM25 = true,
    minVectorScore = 0.3,
  } = options;

  const startTime = Date.now();
  const warnings: string[] = [];

  let vectorResults: VectorSearchResult[] = [];
  let bm25Results: BM25SearchResult[] = [];
  let vectorSearchMs: number | null = null;
  let bm25SearchMs: number | null = null;
  let vectorSearchUsed = false;
  let bm25SearchUsed = false;

  // Fetch more results from each source to allow for better RRF fusion
  const fetchLimit = Math.max(limit * 2, 40);

  // Run vector search
  const vectorStartTime = Date.now();
  try {
    const health = await checkOllamaHealth(embeddingOptions);

    if (health.available && health.modelReady) {
      const vectorResponse = await searchMemoriesVectorByQuery(
        query,
        fetchLimit,
        embeddingOptions
      );

      // Filter by minimum score
      vectorResults = vectorResponse.results.filter(
        (r) => r.similarity >= minVectorScore
      );
      vectorSearchUsed = true;
      vectorSearchMs = Date.now() - vectorStartTime;
    } else {
      warnings.push(`Vector search unavailable: ${health.error}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    warnings.push(`Vector search failed: ${errorMsg}`);

    if (!fallbackToBM25) {
      throw error;
    }
  }

  // Run BM25 search
  const bm25StartTime = Date.now();
  try {
    if (isFTS5Available()) {
      bm25Results = searchMemoriesBM25(query, fetchLimit);
      bm25SearchUsed = true;
      bm25SearchMs = Date.now() - bm25StartTime;
    } else {
      warnings.push('BM25/FTS5 not available, using basic text search');
      // searchMemoriesBM25 already falls back to LIKE-based search
      bm25Results = searchMemoriesBM25(query, fetchLimit);
      bm25SearchUsed = true;
      bm25SearchMs = Date.now() - bm25StartTime;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    warnings.push(`BM25 search failed: ${errorMsg}`);
  }

  // Apply RRF re-ranking
  const rerankStartTime = Date.now();
  const totalCandidates = new Set([
    ...vectorResults.map((r) => r.memory.id),
    ...bm25Results.map((r) => r.memory.id),
  ]).size;

  const results = applyRRF(vectorResults, bm25Results, options);
  const rerankingMs = Date.now() - rerankStartTime;

  return {
    results,
    query,
    vectorSearchUsed,
    bm25SearchUsed,
    totalCandidates,
    timing: {
      totalMs: Date.now() - startTime,
      vectorSearchMs,
      bm25SearchMs,
      rerankingMs,
    },
    warnings,
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Simple hybrid search returning just memories
 *
 * @param query The search query
 * @param limit Maximum results
 * @returns Array of memories sorted by hybrid relevance
 */
export async function searchMemoriesHybridSimple(
  query: string,
  limit: number = 20
): Promise<Memory[]> {
  const response = await searchMemoriesHybrid(query, { limit });
  return response.results.map((r) => r.memory);
}

/**
 * Hybrid search with custom weights
 *
 * @param query The search query
 * @param vectorWeight Weight for vector search (0-1)
 * @param bm25Weight Weight for BM25 search (0-1)
 * @param limit Maximum results
 * @returns Hybrid search response
 */
export async function searchMemoriesHybridWeighted(
  query: string,
  vectorWeight: number,
  bm25Weight: number,
  limit: number = 20
): Promise<HybridSearchResponse> {
  return searchMemoriesHybrid(query, {
    limit,
    vectorWeight,
    bm25Weight,
  });
}

/**
 * BM25-only search (useful when vector search is unavailable)
 *
 * @param query The search query
 * @param limit Maximum results
 * @returns Search results in hybrid format
 */
export function searchMemoriesBM25Only(
  query: string,
  limit: number = 20
): HybridSearchResponse {
  const startTime = Date.now();
  const bm25Results = searchMemoriesBM25(query, limit);

  const results: HybridSearchResult[] = bm25Results.map((r, index) => ({
    memory: r.memory,
    parsedMemory: parseMemory(r.memory),
    hybridScore: rrfScore(index + 1, 60), // Use RRF score for consistency
    vectorScore: null,
    bm25Score: r.bm25Score,
    foundBy: ['bm25'] as ('vector' | 'bm25')[],
    matchedSnippet: r.matchedSnippet,
  }));

  return {
    results,
    query,
    vectorSearchUsed: false,
    bm25SearchUsed: true,
    totalCandidates: results.length,
    timing: {
      totalMs: Date.now() - startTime,
      vectorSearchMs: null,
      bm25SearchMs: Date.now() - startTime,
      rerankingMs: 0,
    },
    warnings: [],
  };
}

/**
 * Vector-only search (useful for semantic similarity without keyword matching)
 *
 * @param query The search query
 * @param limit Maximum results
 * @param options Embedding options
 * @returns Search results in hybrid format
 */
export async function searchMemoriesVectorOnly(
  query: string,
  limit: number = 20,
  options: EmbeddingOptions = {}
): Promise<HybridSearchResponse> {
  const startTime = Date.now();

  const vectorResponse = await searchMemoriesVectorByQuery(query, limit, options);

  const results: HybridSearchResult[] = vectorResponse.results.map((r, index) => ({
    memory: r.memory,
    parsedMemory: parseMemory(r.memory),
    hybridScore: rrfScore(index + 1, 60), // Use RRF score for consistency
    vectorScore: r.similarity,
    bm25Score: null,
    foundBy: ['vector'] as ('vector' | 'bm25')[],
    matchedSnippet: null,
  }));

  return {
    results,
    query,
    vectorSearchUsed: true,
    bm25SearchUsed: false,
    totalCandidates: results.length,
    timing: {
      totalMs: Date.now() - startTime,
      vectorSearchMs: vectorResponse.durationMs,
      bm25SearchMs: null,
      rerankingMs: 0,
    },
    warnings: [],
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if hybrid search is fully available (both vector and BM25)
 */
export async function isHybridSearchAvailable(
  options: EmbeddingOptions = {}
): Promise<{
  vectorAvailable: boolean;
  bm25Available: boolean;
  fullyAvailable: boolean;
  warnings: string[];
}> {
  const warnings: string[] = [];

  // Check vector search
  const health = await checkOllamaHealth(options);
  const vectorAvailable = health.available && health.modelReady;
  if (!vectorAvailable) {
    warnings.push(health.error || 'Vector search unavailable');
  }

  // Check BM25 search
  const bm25Available = isFTS5Available();
  if (!bm25Available) {
    warnings.push('FTS5 not available for BM25 search');
  }

  return {
    vectorAvailable,
    bm25Available,
    fullyAvailable: vectorAvailable && bm25Available,
    warnings,
  };
}
