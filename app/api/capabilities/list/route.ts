/**
 * Capability Listing API
 *
 * GET /api/capabilities/list - List all capabilities
 */

import { NextRequest, NextResponse } from 'next/server';
import { listCapabilities } from '@/lib/capabilities';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const outcomeId = searchParams.get('outcome_id') || undefined;

    const result = listCapabilities(outcomeId);

    return NextResponse.json({
      success: true,
      globalSkills: result.globalSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        category: skill.category,
        description: skill.description,
        path: skill.path,
        usageCount: skill.usage_count,
      })),
      outcomeSkills: result.outcomeSkills,
      outcomeTools: result.outcomeTools,
      summary: {
        globalSkillsCount: result.globalSkills.length,
        outcomeSkillsCount: result.outcomeSkills.length,
        outcomeToolsCount: result.outcomeTools.length,
        totalCount:
          result.globalSkills.length +
          result.outcomeSkills.length +
          result.outcomeTools.length,
      },
    });
  } catch (error) {
    console.error('[API] Capability listing error:', error);
    return NextResponse.json(
      { error: 'Failed to list capabilities' },
      { status: 500 }
    );
  }
}
