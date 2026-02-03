/**
 * Optimize Approach API Route
 *
 * POST /api/outcomes/[id]/optimize-approach
 * Takes user ramble and creates/updates the design doc (approach)
 * Also detects new capability needs after optimization
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getLatestDesignDoc, createDesignDoc } from '@/lib/db/design-docs';
import { claudeComplete } from '@/lib/claude/client';
import { logDesignUpdated } from '@/lib/db/activity';
import { detectNewCapabilityNeeds, type CapabilityNeed, type ExistingCapability } from '@/lib/agents/capability-planner';
import { getTasksByPhase } from '@/lib/db/tasks';

interface OptimizeApproachRequest {
  ramble: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = (await request.json()) as OptimizeApproachRequest;
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

    // Get existing design doc
    const existingDoc = getLatestDesignDoc(id);

    // Build prompt for Claude
    const prompt = `You are helping create or update a design document (approach) for an outcome.

OUTCOME: ${outcome.name}
BRIEF: ${outcome.brief || 'None'}
INTENT (PRD): ${outcome.intent || 'None'}

EXISTING DESIGN DOC:
${existingDoc ? existingDoc.approach : 'None yet'}

USER'S NEW THOUGHTS ON APPROACH:
"${ramble}"

Based on the user's thoughts, create or update the design document. This should describe HOW to build/achieve the outcome (technologies, architecture, key decisions).

Respond with ONLY the design doc content as plain text (no JSON, no markdown code blocks). Use a clear structure like:

## Technologies
- Technology 1: reason
- Technology 2: reason

## Architecture
Brief description of the architecture approach.

## Key Decisions
1. Decision 1: rationale
2. Decision 2: rationale

## Implementation Notes
Any important notes for implementation.

Rules:
- Be concise but specific
- Merge with existing approach if present
- Focus on practical, actionable decisions
- Consider the intent/PRD when suggesting technologies`;

    // Call Claude
    const result = await claudeComplete({
      prompt,
      timeout: 60000,
      maxTurns: 1,
    });

    if (!result.success || !result.text) {
      return NextResponse.json(
        { error: result.error || 'Failed to optimize approach' },
        { status: 500 }
      );
    }

    // Clean up the response (remove any markdown code blocks if present)
    let approachText = result.text.trim();
    if (approachText.startsWith('```')) {
      approachText = approachText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }

    // Create new design doc (automatically versions if one exists)
    const newDoc = createDesignDoc({
      outcome_id: id,
      approach: approachText,
    });
    const newVersion = newDoc.version;

    // Log activity
    logDesignUpdated(id, outcome.name, newVersion, 'Design doc updated from user ramble');

    // Detect new capability needs from the updated approach
    // Get existing capability tasks to compare against
    const capabilityTasks = getTasksByPhase(id, 'capability');
    const existingCapabilities: ExistingCapability[] = capabilityTasks.map(task => {
      // Parse prd_context to extract capability type and path
      let capType: 'skill' | 'tool' = 'skill';
      let capPath = '';
      if (task.prd_context) {
        try {
          const ctx = JSON.parse(task.prd_context);
          capType = ctx.capability_type || 'skill';
          capPath = ctx.path || '';
        } catch {
          // If parsing fails, try to infer from title
          capType = task.title.toLowerCase().includes('tool') ? 'tool' : 'skill';
        }
      }
      // Extract name from task title (format: "[Capability] Build skill: Name")
      const nameMatch = task.title.match(/Build (?:skill|tool): (.+)$/);
      const capName = nameMatch ? nameMatch[1] : task.title;

      return {
        type: capType,
        name: capName,
        path: capPath,
      };
    });

    // Detect new capabilities that aren't already known
    const detectedCapabilities: CapabilityNeed[] = detectNewCapabilityNeeds(
      approachText,
      existingCapabilities
    );

    return NextResponse.json({
      success: true,
      approach: approachText,
      version: newVersion,
      detectedCapabilities,
    });
  } catch (error) {
    console.error('Error optimizing approach:', error);
    return NextResponse.json(
      { error: 'Failed to optimize approach' },
      { status: 500 }
    );
  }
}
