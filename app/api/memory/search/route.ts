/**
 * Memory Search API Route
 *
 * Exposes vector similarity search functionality via HTTP POST.
 * Supports searching by either text query or pre-computed embedding.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  searchMemoriesVector,
  type VectorSearchResult,
} from '@/lib/embedding/hybrid-search';
import { generateEmbedding } from '@/lib/embedding/ollama';

/**
 * Request body for memory search
 */
interface SearchRequest {
  /** Text query to search for (will be converted to embedding) */
  query?: string;
  /** Pre-computed embedding vector to search with */
  embedding?: number[];
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Minimum similarity score threshold (default: 0.3) */
  minScore?: number;
}

/**
 * Response from memory search
 */
interface SearchResponse {
  results: {
    memoryId: string;
    content: string;
    type: string;
    importance: string;
    similarity: number;
    tags: string[];
  }[];
  timing: {
    totalMs: number;
    embeddingMs: number | null;
    searchMs: number;
  };
  query?: string;
  embeddingDimensions?: number;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<SearchResponse | ErrorResponse>> {
  const startTime = Date.now();

  try {
    const body = (await request.json()) as SearchRequest;
    const { query, embedding, limit = 10, minScore = 0.3 } = body;

    // Validate input: must have either query or embedding
    if (!query && !embedding) {
      return NextResponse.json(
        {
          error: 'Missing required parameter',
          details: 'Either "query" (string) or "embedding" (number[]) is required',
        },
        { status: 400 }
      );
    }

    // Validate embedding if provided
    if (embedding) {
      if (!Array.isArray(embedding)) {
        return NextResponse.json(
          {
            error: 'Invalid embedding format',
            details: 'Embedding must be an array of numbers',
          },
          { status: 400 }
        );
      }

      if (embedding.length === 0) {
        return NextResponse.json(
          {
            error: 'Invalid embedding',
            details: 'Embedding array cannot be empty',
          },
          { status: 400 }
        );
      }

      if (!embedding.every((v) => typeof v === 'number' && !isNaN(v))) {
        return NextResponse.json(
          {
            error: 'Invalid embedding values',
            details: 'All embedding values must be valid numbers',
          },
          { status: 400 }
        );
      }
    }

    // Validate limit
    if (typeof limit !== 'number' || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error: 'Invalid limit',
          details: 'Limit must be a number between 1 and 100',
        },
        { status: 400 }
      );
    }

    // Validate minScore
    if (typeof minScore !== 'number' || minScore < 0 || minScore > 1) {
      return NextResponse.json(
        {
          error: 'Invalid minScore',
          details: 'minScore must be a number between 0 and 1',
        },
        { status: 400 }
      );
    }

    let searchEmbedding: number[];
    let embeddingMs: number | null = null;

    if (embedding) {
      // Use provided embedding directly
      searchEmbedding = embedding;
    } else {
      // Generate embedding from query
      const embeddingStartTime = Date.now();
      try {
        const result = await generateEmbedding(query!);
        searchEmbedding = result.embedding;
        embeddingMs = Date.now() - embeddingStartTime;
      } catch (embeddingError) {
        const errorMessage =
          embeddingError instanceof Error
            ? embeddingError.message
            : 'Unknown embedding error';
        return NextResponse.json(
          {
            error: 'Failed to generate embedding',
            details: errorMessage,
          },
          { status: 500 }
        );
      }
    }

    // Perform vector search
    const searchStartTime = Date.now();
    const searchResults: VectorSearchResult[] = searchMemoriesVector(
      searchEmbedding,
      limit,
      minScore
    );
    const searchMs = Date.now() - searchStartTime;

    // Format results
    const results = searchResults.map((r) => {
      let tags: string[] = [];
      try {
        tags = JSON.parse(r.memory.tags);
      } catch {
        // Keep empty array on parse error
      }

      return {
        memoryId: r.memory.id,
        content: r.memory.content,
        type: r.memory.type,
        importance: r.memory.importance,
        similarity: r.similarity,
        tags,
      };
    });

    const response: SearchResponse = {
      results,
      timing: {
        totalMs: Date.now() - startTime,
        embeddingMs,
        searchMs,
      },
    };

    // Include query in response if provided
    if (query) {
      response.query = query;
    }

    // Include embedding dimensions for debugging
    response.embeddingDimensions = searchEmbedding.length;

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Memory Search API] Error:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred';

    return NextResponse.json(
      {
        error: 'Search failed',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
