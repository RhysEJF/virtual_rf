/**
 * Dispatcher Agent
 *
 * Parses messy human input and routes to appropriate handler.
 * Uses Claude Code CLI (your existing subscription).
 */

import { complete } from '../claude/client';

export type DispatchType =
  | 'quick'        // Simple, one-shot response
  | 'research'     // Information gathering and analysis
  | 'deep'         // Complex work requiring briefing and execution
  | 'clarification'; // Need more information from user

export interface DispatchResult {
  type: DispatchType;
  confidence: number;
  reasoning: string;
  clarifyingQuestions?: string[];
  summary?: string; // Cleaned up version of the request
}

const DISPATCH_PROMPT = `You are a request classifier. Analyze this request and classify it.

Categories:
1. "quick" - Simple questions or tasks (e.g., "What time is it in Tokyo?", "Explain X")
2. "research" - Information gathering (e.g., "Research competitors", "Find trends in...")
3. "deep" - Complex building/creating work (e.g., "Build a landing page", "Create a strategy")
4. "clarification" - Too vague to act on (e.g., "Help me with my project")

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "type": "quick|research|deep|clarification",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "clarifyingQuestions": ["only if type is clarification"],
  "summary": "cleaned up version of request"
}

Request to classify:
`;

// ============================================================================
// Heuristic Fallback
// ============================================================================

/**
 * Fallback heuristic dispatch when Claude CLI is unavailable.
 * Uses keyword matching and pattern recognition to classify requests.
 */
function dispatchHeuristically(input: string): DispatchResult {
  const lower = input.toLowerCase().trim();

  // Genuinely too short to act on
  if (lower.length < 3) {
    return {
      type: 'clarification',
      confidence: 0.8,
      reasoning: 'Input too short to classify',
      clarifyingQuestions: ['Could you provide more detail about what you need?'],
      summary: input,
    };
  }

  // Research keywords
  const researchKeywords = [
    'research', 'investigate', 'analyze', 'compare',
    'find about', 'survey', 'trends', 'market analysis',
  ];
  for (const keyword of researchKeywords) {
    if (lower.includes(keyword)) {
      return {
        type: 'research',
        confidence: 0.7,
        reasoning: `Heuristic fallback: matched research keyword "${keyword}"`,
        summary: input,
      };
    }
  }

  // Short questions: starts with question word and under 15 words
  const questionPrefixes = [
    'what', 'how', 'why', 'when', 'where', 'who', 'is', 'explain',
  ];
  const wordCount = input.trim().split(/\s+/).length;
  const firstWord = lower.split(/\s+/)[0];
  if (questionPrefixes.includes(firstWord) && wordCount < 15) {
    return {
      type: 'quick',
      confidence: 0.7,
      reasoning: `Heuristic fallback: short question starting with "${firstWord}"`,
      summary: input,
    };
  }

  // Default: user ran `flow new`, they want to create something
  return {
    type: 'deep',
    confidence: 0.6,
    reasoning: 'Heuristic fallback: defaulting to deep work (user invoked flow new)',
    summary: input,
  };
}

/**
 * Classify a user request
 */
export async function dispatch(input: string): Promise<DispatchResult> {
  console.log(`[Dispatcher] Classifying input: "${input.substring(0, 80)}${input.length > 80 ? '...' : ''}"`);

  const result = await complete({
    prompt: `${DISPATCH_PROMPT}"${input}"`,
    timeout: 120000, // 2 minutes - CLI can be slow to start
  });

  if (!result.success) {
    console.error('[Dispatcher] Claude CLI failed:', result.error);
    return dispatchHeuristically(input);
  }

  try {
    // Parse JSON from response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as DispatchResult;

    // Validate type
    if (!['quick', 'research', 'deep', 'clarification'].includes(parsed.type)) {
      parsed.type = 'clarification';
    }

    // Ensure confidence is in range
    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence || 0.5));

    console.log(`[Dispatcher] Classification result: type=${parsed.type}, confidence=${parsed.confidence}`);

    return parsed;
  } catch {
    console.error('[Dispatcher] Parse failed, raw response:', result.text.substring(0, 200));
    return dispatchHeuristically(input);
  }
}
