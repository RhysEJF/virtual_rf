/**
 * Create Skill API Route
 *
 * POST /api/skills/create - Create a new skill template
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSkillTemplate, syncSkillsToDatabase } from '@/lib/agents/skill-manager';

interface CreateSkillRequest {
  category: string;
  name: string;
  description?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as CreateSkillRequest;
    const { category, name, description } = body;

    if (!category || !name) {
      return NextResponse.json(
        { error: 'Category and name are required' },
        { status: 400 }
      );
    }

    // Create the skill template file
    const path = createSkillTemplate(category, name, description || '');

    // Sync to database
    syncSkillsToDatabase();

    return NextResponse.json({
      success: true,
      path,
      message: `Skill template created at ${path}. Edit the file to add instructions.`,
    });
  } catch (error) {
    console.error('Error creating skill:', error);
    return NextResponse.json(
      { error: 'Failed to create skill' },
      { status: 500 }
    );
  }
}
