/**
 * Skills API Route
 *
 * GET /api/skills - List all skills
 * POST /api/skills/sync - Sync skills from filesystem
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllSkills, getSkillCategories, getSkillCount } from '@/lib/db/skills';
import { syncSkillsToDatabase, getSkillStats, getSkillsByCategory } from '@/lib/agents/skill-manager';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const groupBy = searchParams.get('groupBy');

    if (groupBy === 'category') {
      const grouped = getSkillsByCategory();
      return NextResponse.json({
        skills: grouped,
        categories: Object.keys(grouped),
        total: Object.values(grouped).flat().length,
      });
    }

    const skills = getAllSkills();
    const categories = getSkillCategories();
    const count = getSkillCount();
    const stats = getSkillStats();

    return NextResponse.json({
      skills,
      categories,
      total: count,
      stats,
    });
  } catch (error) {
    console.error('Error fetching skills:', error);
    return NextResponse.json(
      { error: 'Failed to fetch skills' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'sync') {
      const result = syncSkillsToDatabase();
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    return NextResponse.json(
      { error: 'Unknown action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error in skills action:', error);
    return NextResponse.json(
      { error: 'Failed to perform action' },
      { status: 500 }
    );
  }
}
