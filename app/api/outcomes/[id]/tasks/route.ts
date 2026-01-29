/**
 * Outcome Tasks API Route
 *
 * GET /api/outcomes/[id]/tasks - List tasks for outcome
 * POST /api/outcomes/[id]/tasks - Create new task(s)
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

    const response: { tasks: typeof tasks; stats?: ReturnType<typeof getTaskStats> } = { tasks };

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
      const inputs: CreateTaskInput[] = body.tasks.map((task: Partial<CreateTaskInput>) => ({
        outcome_id: id,
        title: task.title || 'Untitled Task',
        description: task.description,
        prd_context: task.prd_context,
        design_context: task.design_context,
        priority: task.priority,
        from_review: task.from_review,
        review_cycle: task.review_cycle,
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

    const task = createTask({
      outcome_id: id,
      title: body.title,
      description: body.description,
      prd_context: body.prd_context,
      design_context: body.design_context,
      priority: body.priority,
      from_review: body.from_review,
      review_cycle: body.review_cycle,
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
