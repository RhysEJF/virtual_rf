/**
 * Outcome Skill Detail API Route
 *
 * GET /api/skills/outcome/[id] - Get skill content with optional key status
 * PUT /api/skills/outcome/[id] - Update skill content
 * id format: outcomeId:skill-name
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSkillContent } from '@/lib/agents/skill-builder';
import { getOutcomeById } from '@/lib/db/outcomes';
import { checkRequiredKeys } from '@/lib/utils/env-keys';
import { getWorkspacePath } from '@/lib/workspace/detector';
import fs from 'fs';
import path from 'path';

/**
 * Parse YAML frontmatter from skill content to extract requires field
 */
function parseRequiresFromContent(content: string): string[] {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return [];

  const frontmatter = frontmatterMatch[1];

  // Match requires: [KEY1, KEY2] format
  const requiresMatch = frontmatter.match(/^requires:\s*\[(.*)\]$/m);
  if (requiresMatch) {
    return requiresMatch[1]
      .split(',')
      .map(t => t.trim().replace(/['"]/g, ''))
      .filter(t => t.length > 0);
  }

  return [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeKeyStatus = searchParams.get('includeKeyStatus') === 'true';

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

    const response: {
      id: string;
      outcomeId: string;
      outcomeName: string;
      skillName: string;
      content: string;
      keyStatus?: {
        allMet: boolean;
        missing: string[];
        configured: string[];
        requiredKeys: string[];
      };
    } = {
      id,
      outcomeId,
      outcomeName: outcome.name,
      skillName,
      content,
    };

    // Parse requires from content and check key status
    if (includeKeyStatus) {
      const requiredKeys = parseRequiresFromContent(content);
      if (requiredKeys.length > 0) {
        const status = checkRequiredKeys(requiredKeys);
        response.keyStatus = {
          allMet: status.allSet,
          missing: status.missing,
          configured: status.configured,
          requiredKeys,
        };
      } else {
        response.keyStatus = {
          allMet: true,
          missing: [],
          configured: [],
          requiredKeys: [],
        };
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching outcome skill:', error);
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

    // Build path to skill file
    const workspacePath = getWorkspacePath(outcomeId);
    const skillFileName = skillName.toLowerCase().replace(/\s+/g, '-') + '.md';
    const skillPath = path.join(workspacePath, 'skills', skillFileName);

    // Check if skill exists
    if (!fs.existsSync(skillPath)) {
      return NextResponse.json(
        { error: 'Skill file not found' },
        { status: 404 }
      );
    }

    // Write the updated content
    fs.writeFileSync(skillPath, content, 'utf-8');

    return NextResponse.json({
      success: true,
      message: 'Skill updated successfully',
    });
  } catch (error) {
    console.error('Error updating outcome skill:', error);
    return NextResponse.json(
      { error: 'Failed to update skill' },
      { status: 500 }
    );
  }
}
