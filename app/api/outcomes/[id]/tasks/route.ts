/**
 * Outcome Tasks API Route
 *
 * GET /api/outcomes/[id]/tasks - List tasks for outcome (includes blocked_by)
 * POST /api/outcomes/[id]/tasks - Create new task(s) with optional depends_on
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getTasksByOutcome,
  getPendingTasks,
  createTask,
  createTasksBatch,
  getTaskStats,
  type CreateTaskInput,
} from '@/lib/db/tasks';
import { getOutcomeById } from '@/lib/db/outcomes';
import {
  validateDependencies,
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
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const includeStats = searchParams.get('stats') === 'true';

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    let tasks;
    if (status === 'pending') {
      tasks = getPendingTasks(id);
    } else {
      tasks = getTasksByOutcome(id);
      if (status) {
        tasks = tasks.filter(t => t.status === status);
      }
    }

    // Enrich tasks with blocked_by information
    const enrichedTasks = tasks.map(task => {
      const dependencyIds = parseDependsOn(task.depends_on);
      const blockedBy = getBlockingTasks(task.id);
      return {
        ...task,
        dependency_ids: dependencyIds,
        blocked_by: blockedBy.map(bt => bt.id),
        is_blocked: blockedBy.length > 0,
      };
    });

    const response: { tasks: typeof enrichedTasks; stats?: ReturnType<typeof getTaskStats> } = { tasks: enrichedTasks };

    if (includeStats) {
      response.stats = getTaskStats(id);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Handle batch creation
    if (Array.isArray(body.tasks)) {
      // Validate dependencies for each task in batch
      for (const task of body.tasks) {
        if (task.depends_on && Array.isArray(task.depends_on) && task.depends_on.length > 0) {
          const validation = validateDependencies(id, task.depends_on);
          if (!validation.valid) {
            return NextResponse.json(
              { error: `Invalid dependencies: ${validation.errors.join(', ')}` },
              { status: 400 }
            );
          }
        }
      }

      const inputs: CreateTaskInput[] = body.tasks.map((task: Partial<CreateTaskInput>) => ({
        outcome_id: id,
        title: task.title || 'Untitled Task',
        description: task.description,
        prd_context: task.prd_context,
        design_context: task.design_context,
        priority: task.priority,
        from_review: task.from_review,
        review_cycle: task.review_cycle,
        task_intent: task.task_intent,
        task_approach: task.task_approach,
        depends_on: task.depends_on,
      }));

      const tasks = createTasksBatch(inputs);
      return NextResponse.json({ tasks }, { status: 201 });
    }

    // Single task creation
    if (!body.title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    // Validate dependencies if provided
    const dependsOn: string[] = body.depends_on || [];
    if (dependsOn.length > 0) {
      const validation = validateDependencies(id, dependsOn);
      if (!validation.valid) {
        return NextResponse.json(
          { error: `Invalid dependencies: ${validation.errors.join(', ')}` },
          { status: 400 }
        );
      }
    }

    const task = createTask({
      outcome_id: id,
      title: body.title,
      description: body.description,
      prd_context: body.prd_context,
      design_context: body.design_context,
      priority: body.priority,
      from_review: body.from_review,
      review_cycle: body.review_cycle,
      task_intent: body.task_intent,
      task_approach: body.task_approach,
      depends_on: dependsOn,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error('Error creating task:', error);
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    );
  }
}
