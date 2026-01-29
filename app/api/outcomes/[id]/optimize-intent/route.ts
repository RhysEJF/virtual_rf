/**
 * Optimize Intent API Route
 *
 * POST /api/outcomes/[id]/optimize-intent
 * Takes user ramble and optimizes it into structured PRD/Intent
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById, updateOutcome } from '@/lib/db/outcomes';
import { claudeComplete } from '@/lib/claude/client';
import { logIntentUpdated } from '@/lib/db/activity';

interface OptimizeIntentRequest {
  ramble: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = (await request.json()) as OptimizeIntentRequest;
    const { ramble } = body;

    if (!ramble || typeof ramble !== 'string') {
      return NextResponse.json(
        { error: 'Ramble text is required' },
        { status: 400 }
      );
    }

    // Get current outcome
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Parse existing intent
    let existingIntent: { summary?: string; items?: unknown[]; success_criteria?: string[] } = {};
    if (outcome.intent) {
      try {
        existingIntent = JSON.parse(outcome.intent);
      } catch {
        // Invalid JSON, start fresh
      }
    }

    // Build prompt for Claude
    const prompt = `You are helping optimize a user's rambled thoughts into a structured PRD (Product Requirements Document) for an outcome.

OUTCOME: ${outcome.name}
ORIGINAL BRIEF: ${outcome.brief || 'None'}

EXISTING INTENT:
${outcome.intent ? JSON.stringify(existingIntent, null, 2) : 'None yet'}

USER'S NEW RAMBLE:
"${ramble}"

Based on the user's ramble, update or create a structured intent. Respond with ONLY a valid JSON object (no markdown, no explanation) in this exact format:

{
  "summary": "A clear 1-2 sentence summary of what this outcome achieves",
  "items": [
    {
      "id": "1",
      "title": "Short title of requirement",
      "description": "Detailed description",
      "acceptance_criteria": ["Criterion 1", "Criterion 2"],
      "priority": "high|medium|low",
      "status": "pending"
    }
  ],
  "success_criteria": [
    "Clear success criterion 1",
    "Clear success criterion 2"
  ]
}

Rules:
- Merge user's new thoughts with existing intent if present
- Keep items focused and actionable
- Generate 3-7 items typically
- Success criteria should be measurable when possible
- Preserve existing items that are still relevant, update if user mentioned changes`;

    // Call Claude
    const result = await claudeComplete({
      prompt,
      timeout: 60000,
      maxTurns: 1,
    });

    if (!result.success || !result.text) {
      return NextResponse.json(
        { error: result.error || 'Failed to optimize intent' },
        { status: 500 }
      );
    }

    // Parse Claude's response
    let newIntent;
    try {
      // Try to extract JSON from the response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      newIntent = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', result.text);
      return NextResponse.json(
        { error: 'Failed to parse optimized intent' },
        { status: 500 }
      );
    }

    // Update outcome with new intent
    updateOutcome(id, {
      intent: JSON.stringify(newIntent),
    });

    // Log activity
    logIntentUpdated(id, outcome.name, 'Intent optimized from user ramble');

    return NextResponse.json({
      success: true,
      intent: newIntent,
    });
  } catch (error) {
    console.error('Error optimizing intent:', error);
    return NextResponse.json(
      { error: 'Failed to optimize intent' },
      { status: 500 }
    );
  }
}
