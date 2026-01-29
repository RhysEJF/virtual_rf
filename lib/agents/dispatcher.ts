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

/**
 * Classify a user request
 */
export async function dispatch(input: string): Promise<DispatchResult> {
  const result = await complete({
    prompt: `${DISPATCH_PROMPT}"${input}"`,
    timeout: 30000, // 30 seconds for classification
  });

  if (!result.success) {
    return {
      type: 'clarification',
      confidence: 0.3,
      reasoning: result.error || 'Classification failed',
      clarifyingQuestions: ['Could you please rephrase your request?'],
    };
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

    return parsed;
  } catch {
    // Fallback to clarification if parsing fails
    return {
      type: 'clarification',
      confidence: 0.3,
      reasoning: 'Could not parse classification',
      clarifyingQuestions: ['Could you please rephrase your request more specifically?'],
    };
  }
}
