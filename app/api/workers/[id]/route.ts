/**
 * Single Worker API Route
 *
 * GET /api/workers/[id] - Get worker details
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkerById } from '@/lib/db/workers';
import { getTasksByOutcome } from '@/lib/db/tasks';
import { getRalphWorkerStatus } from '@/lib/ralph/worker';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const worker = getWorkerById(id);
    if (!worker) {
      return NextResponse.json(
        { error: 'Worker not found' },
        { status: 404 }
      );
    }

    // Get live status if running
    const liveStatus = getRalphWorkerStatus(id);

    // Get tasks for this outcome
    const allTasks = getTasksByOutcome(worker.outcome_id);
    const currentTask = allTasks.find(t => t.id === worker.current_task_id);
    const completedTasks = allTasks.filter(t => t.status === 'completed' && t.claimed_by === id);

    return NextResponse.json({
      worker: {
        ...worker,
        liveStatus,
      },
      currentTask,
      completedTasks,
      totalTasks: allTasks.length,
    });
  } catch (error) {
    console.error('Error fetching worker:', error);
    return NextResponse.json(
      { error: 'Failed to fetch worker' },
      { status: 500 }
    );
  }
}
