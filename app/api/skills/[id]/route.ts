/**
 * Skill Detail API Route
 *
 * GET /api/skills/[id] - Get skill content by ID
 * PUT /api/skills/[id] - Update skill content
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSkillById, checkSkillRequirements } from '@/lib/db/skills';
import { getSkillContent } from '@/lib/agents/skill-manager';
import fs from 'fs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeKeyStatus = searchParams.get('includeKeyStatus') === 'true';

    const skill = getSkillById(id);
    if (!skill) {
      return NextResponse.json(
        { error: 'Skill not found' },
        { status: 404 }
      );
    }

    const content = getSkillContent(id);

    // Parse requires field to get required keys
    let requiredKeys: string[] = [];
    if (skill.requires) {
      try {
        requiredKeys = JSON.parse(skill.requires);
      } catch {
        // Invalid JSON
      }
    }

    // Optionally include key status
    let keyStatus = null;
    if (includeKeyStatus) {
      const requirements = checkSkillRequirements(id);
      keyStatus = {
        allMet: requirements.allMet,
        missing: requirements.missing,
        configured: requirements.configured,
        requiredKeys,
      };
    }

    return NextResponse.json({
      skill: keyStatus ? { ...skill, keyStatus } : skill,
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { content } = await request.json();

    if (typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content must be a string' },
        { status: 400 }
      );
    }

    const skill = getSkillById(id);
    if (!skill) {
      return NextResponse.json(
        { error: 'Skill not found' },
        { status: 404 }
      );
    }

    // Write the updated content to the file
    fs.writeFileSync(skill.path, content, 'utf-8');

    return NextResponse.json({
      success: true,
      message: 'Skill updated successfully',
    });
  } catch (error) {
    console.error('Error updating skill:', error);
    return NextResponse.json(
      { error: 'Failed to update skill' },
      { status: 500 }
    );
  }
}
