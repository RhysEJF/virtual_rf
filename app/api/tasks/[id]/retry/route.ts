/**
 * Task Retry API Route
 *
 * POST /api/tasks/[id]/retry - Reset a failed task to pending for retry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById, resetTaskForRetry } from '@/lib/db/tasks';

export async function POST(
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

    if (task.status !== 'failed') {
      return NextResponse.json(
        { error: `Task is not failed (current status: ${task.status})` },
        { status: 400 }
      );
    }

    const updated = resetTaskForRetry(id);
    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to reset task' },
        { status: 500 }
      );
    }

    return NextResponse.json({ task: updated, retried: true });
  } catch (error) {
    console.error('Error retrying task:', error);
    return NextResponse.json(
      { error: 'Failed to retry task' },
      { status: 500 }
    );
  }
}
