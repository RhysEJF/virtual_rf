/**
 * Skills API Route
 *
 * GET /api/skills - List all skills
 * POST /api/skills/sync - Sync skills from filesystem
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllSkills, getSkillCategories, getSkillCount, getAllSkillsWithKeyStatus } from '@/lib/db/skills';
import { syncSkillsToDatabase, getSkillStats, getSkillsByCategory } from '@/lib/agents/skill-manager';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const groupBy = searchParams.get('groupBy');
    const includeKeyStatus = searchParams.get('includeKeyStatus') === 'true';

    if (groupBy === 'category') {
      if (includeKeyStatus) {
        // Get skills with key status and group by category
        const skillsWithStatus = getAllSkillsWithKeyStatus();
        const grouped: Record<string, typeof skillsWithStatus> = {};
        for (const skill of skillsWithStatus) {
          if (!grouped[skill.category]) {
            grouped[skill.category] = [];
          }
          grouped[skill.category].push(skill);
        }
        return NextResponse.json({
          skills: grouped,
          categories: Object.keys(grouped),
          total: skillsWithStatus.length,
        });
      } else {
        const grouped = getSkillsByCategory();
        return NextResponse.json({
          skills: grouped,
          categories: Object.keys(grouped),
          total: Object.values(grouped).flat().length,
        });
      }
    }

    if (includeKeyStatus) {
      const skillsWithStatus = getAllSkillsWithKeyStatus();
      const categories = getSkillCategories();
      const stats = getSkillStats();
      return NextResponse.json({
        skills: skillsWithStatus,
        categories,
        total: skillsWithStatus.length,
        stats,
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
