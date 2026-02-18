/**
 * Ollama Embedding Service
 *
 * Generates embeddings locally using Ollama with nomic-embed-text model.
 * Used for semantic search in the cross-outcome memory system.
 *
 * Prerequisites:
 * - Ollama must be installed: https://ollama.ai
 * - Pull the model: `ollama pull nomic-embed-text`
 */

export interface EmbeddingOptions {
  /** The model to use for embeddings (default: nomic-embed-text) */
  model?: string;
  /** Ollama API endpoint (default: http://localhost:11434) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  durationMs: number;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  model: string;
  durationMs: number;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

interface OllamaEmbeddingsResponse {
  embeddings: number[][];
}

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_TIMEOUT = 30000;

/**
 * Generate an embedding for a single text input
 */
export async function generateEmbedding(
  text: string,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult> {
  const {
    model = DEFAULT_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: text,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new OllamaError(
        `Ollama API error: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      );
    }

    const data = (await response.json()) as OllamaEmbeddingResponse;
    const durationMs = Date.now() - startTime;

    return {
      embedding: data.embedding,
      model,
      durationMs,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new OllamaError(`Embedding request timed out after ${timeout}ms`, 408);
    }

    if (error instanceof OllamaError) {
      throw error;
    }

    // Connection error - Ollama not running
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new OllamaError(
        'Cannot connect to Ollama. Is it running? Try: ollama serve',
        503
      );
    }

    throw new OllamaError(
      `Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}

/**
 * Generate embeddings for multiple texts in a single request
 * More efficient than calling generateEmbedding multiple times
 */
export async function generateEmbeddings(
  texts: string[],
  options: EmbeddingOptions = {}
): Promise<BatchEmbeddingResult> {
  const {
    model = DEFAULT_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  if (texts.length === 0) {
    return {
      embeddings: [],
      model,
      durationMs: 0,
    };
  }

  // For single text, use the simpler endpoint
  if (texts.length === 1) {
    const result = await generateEmbedding(texts[0], options);
    return {
      embeddings: [result.embedding],
      model: result.model,
      durationMs: result.durationMs,
    };
  }

  const startTime = Date.now();
  const controller = new AbortController();
  // Longer timeout for batch operations
  const batchTimeout = timeout + texts.length * 1000;
  const timeoutId = setTimeout(() => controller.abort(), batchTimeout);

  try {
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new OllamaError(
        `Ollama API error: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      );
    }

    const data = (await response.json()) as OllamaEmbeddingsResponse;
    const durationMs = Date.now() - startTime;

    return {
      embeddings: data.embeddings,
      model,
      durationMs,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new OllamaError(`Batch embedding request timed out after ${batchTimeout}ms`, 408);
    }

    if (error instanceof OllamaError) {
      throw error;
    }

    // Connection error - Ollama not running
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new OllamaError(
        'Cannot connect to Ollama. Is it running? Try: ollama serve',
        503
      );
    }

    throw new OllamaError(
      `Batch embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}

/**
 * Calculate cosine similarity between two embedding vectors
 * Returns a value between -1 and 1, where 1 means identical
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions must match: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Find the most similar embeddings from a list
 */
export function findSimilar(
  queryEmbedding: number[],
  embeddings: number[][],
  topK: number = 10
): Array<{ index: number; similarity: number }> {
  const similarities = embeddings.map((embedding, index) => ({
    index,
    similarity: cosineSimilarity(queryEmbedding, embedding),
  }));

  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

/**
 * Check if Ollama is running and the model is available
 */
export async function checkOllamaHealth(options: EmbeddingOptions = {}): Promise<{
  available: boolean;
  modelReady: boolean;
  error?: string;
}> {
  const { model = DEFAULT_MODEL, baseUrl = DEFAULT_BASE_URL } = options;

  try {
    // Check if Ollama is running
    const tagsResponse = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
    });

    if (!tagsResponse.ok) {
      return {
        available: false,
        modelReady: false,
        error: `Ollama not responding: ${tagsResponse.status}`,
      };
    }

    // Check if the model is available
    const tags = (await tagsResponse.json()) as { models: Array<{ name: string }> };
    const modelAvailable = tags.models.some(
      (m) => m.name === model || m.name.startsWith(`${model}:`)
    );

    if (!modelAvailable) {
      return {
        available: true,
        modelReady: false,
        error: `Model '${model}' not found. Run: ollama pull ${model}`,
      };
    }

    return {
      available: true,
      modelReady: true,
    };
  } catch (error) {
    return {
      available: false,
      modelReady: false,
      error: `Cannot connect to Ollama: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Custom error class for Ollama-related errors
 */
export class OllamaError extends Error {
  statusCode: number;
  details?: string;

  constructor(message: string, statusCode: number = 500, details?: string) {
    super(message);
    this.name = 'OllamaError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Get embedding dimension for a model
 * nomic-embed-text produces 768-dimensional embeddings
 */
export function getEmbeddingDimension(model: string = DEFAULT_MODEL): number {
  const dimensions: Record<string, number> = {
    'nomic-embed-text': 768,
    'mxbai-embed-large': 1024,
    'all-minilm': 384,
  };

  return dimensions[model] || 768;
}
