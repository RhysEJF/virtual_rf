/**
 * Capability Creation API
 *
 * POST /api/capabilities/create - Create a capability (task or file)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createCapabilityTask,
  createSkillFile,
  createToolFile,
  createOutcomeSkillFile,
} from '@/lib/capabilities';

interface CreateCapabilityRequest {
  type: 'skill' | 'tool';
  name: string;
  description?: string;
  specification?: string;
  // For task-based creation
  outcome_id?: string;
  // For direct file creation
  category?: string; // For global skills
  create_file?: boolean; // Create file directly instead of task
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as CreateCapabilityRequest;
    const {
      type,
      name,
      description,
      specification,
      outcome_id,
      category,
      create_file,
    } = body;

    // Validate required fields
    if (!type || !['skill', 'tool'].includes(type)) {
      return NextResponse.json(
        { error: 'type is required and must be "skill" or "tool"' },
        { status: 400 }
      );
    }

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'name is required and must be a string' },
        { status: 400 }
      );
    }

    // Handle direct file creation
    if (create_file) {
      if (type === 'skill') {
        if (outcome_id) {
          // Create outcome-specific skill
          const result = createOutcomeSkillFile(outcome_id, name, description);
          if (!result.success) {
            return NextResponse.json(
              { error: result.error || result.message },
              { status: 400 }
            );
          }
          return NextResponse.json({
            success: true,
            path: result.path,
            message: result.message,
            type: 'outcome_skill',
          });
        } else {
          // Create global skill
          if (!category) {
            return NextResponse.json(
              { error: 'category is required for global skill creation' },
              { status: 400 }
            );
          }
          const result = createSkillFile({ category, name, description });
          if (!result.success) {
            return NextResponse.json(
              { error: result.error || result.message },
              { status: 400 }
            );
          }
          return NextResponse.json({
            success: true,
            path: result.path,
            message: result.message,
            type: 'global_skill',
          });
        }
      } else {
        // Create tool file
        if (!outcome_id) {
          return NextResponse.json(
            { error: 'outcome_id is required for tool creation' },
            { status: 400 }
          );
        }
        const result = createToolFile({ outcomeId: outcome_id, name, description });
        if (!result.success) {
          return NextResponse.json(
            { error: result.error || result.message },
            { status: 400 }
          );
        }
        return NextResponse.json({
          success: true,
          path: result.path,
          message: result.message,
          type: 'tool',
        });
      }
    }

    // Handle task-based creation (default)
    if (!outcome_id) {
      return NextResponse.json(
        { error: 'outcome_id is required for capability task creation' },
        { status: 400 }
      );
    }

    const result = createCapabilityTask(outcome_id, {
      type,
      name,
      description,
      specification,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      message: result.message,
      type: 'capability_task',
    });
  } catch (error) {
    console.error('[API] Capability creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create capability' },
      { status: 500 }
    );
  }
}
