/**
 * Query Expansion Module
 *
 * Uses Claude to expand a search query into multiple related queries
 * to improve recall when searching the cross-outcome memory system.
 *
 * Expansion strategies:
 * - Synonyms: Alternative words with similar meanings
 * - Related concepts: Broader or narrower terms
 * - Rephrasing: Different ways to express the same idea
 * - Technical variants: Abbreviations, acronyms, jargon
 */

import { complete } from '../claude/client';

export interface QueryExpansionOptions {
  /** Number of expanded queries to generate (default: 5) */
  expansionCount?: number;
  /** Timeout for Claude call in milliseconds (default: 30000) */
  timeout?: number;
  /** Context about what kind of memories we're searching */
  searchContext?: 'technical' | 'general' | 'pattern' | 'decision';
  /** Optional outcome ID for cost tracking */
  outcomeId?: string;
}

export interface ExpandedQuery {
  /** The expanded query string */
  query: string;
  /** Type of expansion applied */
  expansionType: 'synonym' | 'related' | 'rephrase' | 'technical' | 'original';
  /** Brief explanation of the expansion */
  reasoning?: string;
}

export interface QueryExpansionResult {
  /** The original query */
  originalQuery: string;
  /** All expanded queries including the original */
  expandedQueries: ExpandedQuery[];
  /** Whether expansion succeeded */
  success: boolean;
  /** Error message if expansion failed */
  error?: string;
  /** Time taken for expansion in ms */
  durationMs: number;
}

/**
 * Expand a search query into multiple related queries using Claude
 *
 * @param query The original search query
 * @param options Expansion options
 * @returns Expanded queries including the original
 */
export async function expandQuery(
  query: string,
  options: QueryExpansionOptions = {}
): Promise<QueryExpansionResult> {
  const {
    expansionCount = 5,
    timeout = 30000,
    searchContext = 'general',
    outcomeId,
  } = options;

  const startTime = Date.now();

  // Always include the original query
  const originalExpanded: ExpandedQuery = {
    query: query.trim(),
    expansionType: 'original',
  };

  // If query is very short, we still try to expand it
  if (!query.trim()) {
    return {
      originalQuery: query,
      expandedQueries: [],
      success: false,
      error: 'Empty query provided',
      durationMs: Date.now() - startTime,
    };
  }

  const contextHints: Record<string, string> = {
    technical: 'Focus on technical terms, code patterns, APIs, and implementation details.',
    general: 'Consider general concepts, user intents, and everyday language.',
    pattern: 'Focus on patterns, best practices, common approaches, and antipatterns.',
    decision: 'Focus on trade-offs, choices, rationale, and decision criteria.',
  };

  const prompt = `You are a search query expansion expert. Given a search query, generate ${expansionCount} alternative queries that would help find relevant information in a knowledge base.

The knowledge base contains:
- Technical learnings from software development projects
- Patterns and best practices discovered during work
- Decisions and their rationale
- Facts and preferences

Original query: "${query}"

Context hint: ${contextHints[searchContext]}

Generate exactly ${expansionCount} expanded queries. For each, provide:
1. The alternative query
2. The expansion type (synonym, related, rephrase, or technical)
3. Brief reasoning

Respond in this exact JSON format:
{
  "expansions": [
    {
      "query": "alternative query here",
      "expansionType": "synonym|related|rephrase|technical",
      "reasoning": "brief explanation"
    }
  ]
}

Important:
- Keep queries concise (1-6 words)
- Make them distinct from each other
- Focus on finding relevant information, not exact matches
- Include both broader and narrower variations
- Consider synonyms, abbreviations, and technical jargon`;

  try {
    const response = await complete({
      prompt,
      system: 'You are a search query expansion assistant. Respond only with valid JSON.',
      timeout,
      maxTurns: 1,
      outcomeId,
      description: 'Query expansion for memory search',
    });

    if (!response.success) {
      // Return original query on failure
      return {
        originalQuery: query,
        expandedQueries: [originalExpanded],
        success: false,
        error: response.error || 'Claude call failed',
        durationMs: Date.now() - startTime,
      };
    }

    // Parse the response
    const expandedQueries = parseExpansionResponse(response.text, originalExpanded);

    return {
      originalQuery: query,
      expandedQueries,
      success: true,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    // On any error, return just the original query
    return {
      originalQuery: query,
      expandedQueries: [originalExpanded],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Parse Claude's expansion response and extract queries
 */
function parseExpansionResponse(text: string, originalExpanded: ExpandedQuery): ExpandedQuery[] {
  const expandedQueries: ExpandedQuery[] = [originalExpanded];

  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Query Expansion] No JSON found in response');
      return expandedQueries;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      expansions?: Array<{
        query?: string;
        expansionType?: string;
        reasoning?: string;
      }>;
    };

    if (!parsed.expansions || !Array.isArray(parsed.expansions)) {
      console.warn('[Query Expansion] No expansions array in response');
      return expandedQueries;
    }

    for (const expansion of parsed.expansions) {
      if (expansion.query && typeof expansion.query === 'string') {
        const cleanQuery = expansion.query.trim();
        // Avoid duplicates
        if (cleanQuery && !expandedQueries.some(eq => eq.query.toLowerCase() === cleanQuery.toLowerCase())) {
          expandedQueries.push({
            query: cleanQuery,
            expansionType: validateExpansionType(expansion.expansionType),
            reasoning: expansion.reasoning,
          });
        }
      }
    }
  } catch (parseError) {
    console.warn('[Query Expansion] Failed to parse response:', parseError);
  }

  return expandedQueries;
}

/**
 * Validate and normalize expansion type
 */
function validateExpansionType(
  type?: string
): 'synonym' | 'related' | 'rephrase' | 'technical' | 'original' {
  const validTypes = ['synonym', 'related', 'rephrase', 'technical'] as const;
  if (type && validTypes.includes(type as typeof validTypes[number])) {
    return type as typeof validTypes[number];
  }
  return 'related'; // Default fallback
}

/**
 * Expand query and return just the query strings for simple use cases
 *
 * @param query The original search query
 * @param options Expansion options
 * @returns Array of query strings including the original
 */
export async function getExpandedQueries(
  query: string,
  options: QueryExpansionOptions = {}
): Promise<string[]> {
  const result = await expandQuery(query, options);
  return result.expandedQueries.map(eq => eq.query);
}

/**
 * Combine multiple query results using a simple deduplication strategy
 * Used when running multiple expanded queries and combining results
 *
 * @param results Array of result sets from different queries
 * @param idExtractor Function to extract unique ID from each result
 * @returns Deduplicated results preserving order of first occurrence
 */
export function combineQueryResults<T>(
  results: T[][],
  idExtractor: (item: T) => string
): T[] {
  const seen = new Set<string>();
  const combined: T[] = [];

  for (const resultSet of results) {
    for (const item of resultSet) {
      const id = idExtractor(item);
      if (!seen.has(id)) {
        seen.add(id);
        combined.push(item);
      }
    }
  }

  return combined;
}

/**
 * Check if query expansion should be used based on query characteristics
 * Short queries benefit more from expansion than long, specific ones
 *
 * @param query The search query to analyze
 * @returns Whether expansion is recommended
 */
export function shouldExpandQuery(query: string): boolean {
  const trimmed = query.trim();

  // Very short queries always benefit from expansion
  if (trimmed.length < 20) return true;

  // Single word queries always benefit
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 2) return true;

  // Queries without special operators might benefit
  // FTS5 operators suggest the user knows what they're looking for
  const hasOperators = /\bOR\b|\bNOT\b|\bAND\b|"[^"]+"|[*]/.test(trimmed);
  if (hasOperators) return false;

  // Medium length queries probably benefit
  if (wordCount <= 5) return true;

  // Long, specific queries probably don't need expansion
  return false;
}
