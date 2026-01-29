/**
 * Skill Detail API Route
 *
 * GET /api/skills/[id] - Get skill content by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSkillById } from '@/lib/db/skills';
import { getSkillContent } from '@/lib/agents/skill-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const skill = getSkillById(id);
    if (!skill) {
      return NextResponse.json(
        { error: 'Skill not found' },
        { status: 404 }
      );
    }

    const content = getSkillContent(id);

    return NextResponse.json({
      skill,
      content,
    });
  } catch (error) {
    console.error('Error fetching skill:', error);
    return NextResponse.json(
      { error: 'Failed to fetch skill' },
      { status: 500 }
    );
  }
}
