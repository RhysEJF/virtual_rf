/**
 * Embedding Service
 *
 * Provides embedding generation for the cross-outcome memory system.
 * Currently supports Ollama for local embedding generation.
 *
 * Also provides query expansion via Claude for improved search recall.
 */

export {
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  findSimilar,
  checkOllamaHealth,
  getEmbeddingDimension,
  OllamaError,
  type EmbeddingOptions,
  type EmbeddingResult,
  type BatchEmbeddingResult,
} from './ollama';

// Query Expansion exports
export {
  expandQuery,
  getExpandedQueries,
  combineQueryResults,
  shouldExpandQuery,
  type QueryExpansionOptions,
  type QueryExpansionResult,
  type ExpandedQuery,
} from './query-expansion';

// Hybrid Search exports
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
} from './hybrid-search';
