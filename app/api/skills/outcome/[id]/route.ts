/**
 * Outcome Skill Detail API Route
 *
 * GET /api/skills/outcome/[id] - Get skill content
 * id format: outcomeId:skill-name
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSkillContent } from '@/lib/agents/skill-builder';
import { getOutcomeById } from '@/lib/db/outcomes';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Parse id format: outcomeId:skill-name
    const [outcomeId, skillName] = id.split(':');

    if (!outcomeId || !skillName) {
      return NextResponse.json(
        { error: 'Invalid skill ID format. Expected: outcomeId:skill-name' },
        { status: 400 }
      );
    }

    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    const content = getSkillContent(outcomeId, skillName);
    if (!content) {
      return NextResponse.json(
        { error: 'Skill not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id,
      outcomeId,
      outcomeName: outcome.name,
      skillName,
      content,
    });
  } catch (error) {
    console.error('Error fetching outcome skill:', error);
    return NextResponse.json(
      { error: 'Failed to fetch skill' },
      { status: 500 }
    );
  }
}
