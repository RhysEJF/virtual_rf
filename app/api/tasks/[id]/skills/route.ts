/**
 * Task Skills API
 *
 * GET /api/tasks/[id]/skills
 * Returns skills mapped to this task with their status (ready, needs API key, will be built)
 *
 * PATCH /api/tasks/[id]/skills
 * Update the required_skills for a task
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById, updateTask } from '@/lib/db/tasks';
import { getAllSkillsWithKeyStatus, getSkillByName, searchSkills } from '@/lib/db/skills';

export interface TaskSkillStatus {
  name: string;
  status: 'ready' | 'needs_api_key' | 'will_be_built';
  skillId?: string;
  missingKeys?: string[];
  description?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const task = getTaskById(id);

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Parse required_skills JSON
    let requiredSkillNames: string[] = [];
    if (task.required_skills) {
      try {
        requiredSkillNames = JSON.parse(task.required_skills);
      } catch {
        requiredSkillNames = [];
      }
    }

    // Get all skills with their key status
    const allSkills = getAllSkillsWithKeyStatus();

    // Map each required skill to its status
    const skills: TaskSkillStatus[] = requiredSkillNames.map((skillName) => {
      // Try to find an exact match first
      const skill = allSkills.find(
        s => s.name.toLowerCase() === skillName.toLowerCase()
      );

      if (skill) {
        // Skill exists - check if API keys are configured
        if (skill.keyStatus.allMet) {
          return {
            name: skill.name,
            status: 'ready' as const,
            skillId: skill.id,
            description: skill.description || undefined,
          };
        } else {
          return {
            name: skill.name,
            status: 'needs_api_key' as const,
            skillId: skill.id,
            missingKeys: skill.keyStatus.missing,
            description: skill.description || undefined,
          };
        }
      } else {
        // Skill doesn't exist yet - will be built during capability phase
        return {
          name: skillName,
          status: 'will_be_built' as const,
        };
      }
    });

    return NextResponse.json({
      taskId: id,
      skills,
      availableSkills: allSkills.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        keyStatus: s.keyStatus,
      })),
    });
  } catch (error) {
    console.error('Error getting task skills:', error);
    return NextResponse.json(
      { error: 'Failed to get task skills' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    const { skills } = body;

    if (!Array.isArray(skills)) {
      return NextResponse.json(
        { error: 'Skills must be an array' },
        { status: 400 }
      );
    }

    const task = getTaskById(id);
    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Update the task with new required_skills
    const updated = updateTask(id, {
      required_skills: skills.length > 0 ? JSON.stringify(skills) : null,
    });

    return NextResponse.json({
      success: true,
      task: updated,
    });
  } catch (error) {
    console.error('Error updating task skills:', error);
    return NextResponse.json(
      { error: 'Failed to update task skills' },
      { status: 500 }
    );
  }
}
