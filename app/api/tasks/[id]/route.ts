/**
 * Individual Task API Route
 *
 * GET /api/tasks/[id] - Get task details (includes blocked_by)
 * PATCH /api/tasks/[id] - Update task (including depends_on)
 * DELETE /api/tasks/[id] - Delete task
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getTaskById,
  updateTask,
  deleteTask,
} from '@/lib/db/tasks';
import {
  validateDependenciesForTask,
  detectCircularDependencies,
  getBlockingTasks,
  parseDependsOn,
} from '@/lib/db/dependencies';

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

    // Enrich task with blocked_by information
    const dependencyIds = parseDependsOn(task.depends_on);
    const blockedBy = getBlockingTasks(id);
    const enrichedTask = {
      ...task,
      dependency_ids: dependencyIds,
      blocked_by: blockedBy.map(bt => bt.id),
      is_blocked: blockedBy.length > 0,
    };

    return NextResponse.json({ task: enrichedTask });
  } catch (error) {
    console.error('Error fetching task:', error);
    return NextResponse.json(
      { error: 'Failed to fetch task' },
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

    // Verify task exists
    const existing = getTaskById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Validate depends_on if provided
    if (body.depends_on !== undefined) {
      const dependsOn: string[] = body.depends_on || [];
      if (dependsOn.length > 0) {
        // Validate that dependencies exist and belong to same outcome
        const validation = validateDependenciesForTask(id, dependsOn);
        if (!validation.valid) {
          return NextResponse.json(
            { error: `Invalid dependencies: ${validation.errors.join(', ')}` },
            { status: 400 }
          );
        }

        // Check for circular dependencies
        const circularIds = detectCircularDependencies(id, dependsOn);
        if (circularIds.length > 0) {
          return NextResponse.json(
            { error: `Circular dependencies detected: ${circularIds.join(', ')}` },
            { status: 400 }
          );
        }
      }
    }

    // Update task with any provided fields
    const task = updateTask(id, {
      title: body.title,
      description: body.description,
      prd_context: body.prd_context,
      design_context: body.design_context,
      priority: body.priority,
      score: body.score,
      max_attempts: body.max_attempts,
      task_intent: body.task_intent,
      task_approach: body.task_approach,
      depends_on: body.depends_on,
    });

    if (!task) {
      return NextResponse.json(
        { error: 'Failed to update task' },
        { status: 500 }
      );
    }

    // Return enriched task with blocked_by
    const dependencyIds = parseDependsOn(task.depends_on);
    const blockedBy = getBlockingTasks(id);
    const enrichedTask = {
      ...task,
      dependency_ids: dependencyIds,
      blocked_by: blockedBy.map(bt => bt.id),
      is_blocked: blockedBy.length > 0,
    };

    return NextResponse.json({ task: enrichedTask });
  } catch (error) {
    console.error('Error updating task:', error);
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const deleted = deleteTask(id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting task:', error);
    return NextResponse.json(
      { error: 'Failed to delete task' },
      { status: 500 }
    );
  }
}
