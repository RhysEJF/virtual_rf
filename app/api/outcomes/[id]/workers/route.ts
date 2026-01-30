/**
 * Outcome Workers API Route
 *
 * GET /api/outcomes/[id]/workers - List workers for outcome
 * POST /api/outcomes/[id]/workers - Start a new worker
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkersByOutcome } from '@/lib/db/workers';
import { getOutcomeById, hasChildren } from '@/lib/db/outcomes';
import { getPendingTasks } from '@/lib/db/tasks';
import { startRalphWorker, stopRalphWorker, stopAllWorkersForOutcome, getRalphWorkerStatus } from '@/lib/ralph/worker';
import { isGitRepo } from '@/lib/worktree/manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    let workers = getWorkersByOutcome(id);

    if (status) {
      workers = workers.filter(w => w.status === status);
    }

    // Add live status for running workers
    const enrichedWorkers = workers.map(worker => {
      const liveStatus = getRalphWorkerStatus(worker.id);
      return {
        ...worker,
        liveStatus,
      };
    });

    return NextResponse.json({ workers: enrichedWorkers });
  } catch (error) {
    console.error('Error fetching workers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workers' },
      { status: 500 }
    );
  }
}

interface StartWorkerRequest {
  parallel?: boolean; // Allow starting even if another worker is running
  useWorktree?: boolean; // Use git worktree for isolation
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Parse request body (optional)
    let body: StartWorkerRequest = {};
    try {
      body = await request.json();
    } catch {
      // No body is fine
    }

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Only leaf outcomes (no children) can have workers
    if (hasChildren(id)) {
      return NextResponse.json(
        { error: 'Cannot start workers on parent outcomes. Workers can only run on leaf outcomes (those without children).' },
        { status: 400 }
      );
    }

    // Check if there are pending tasks
    const pendingTasks = getPendingTasks(id);
    if (pendingTasks.length === 0) {
      return NextResponse.json(
        { error: 'No pending tasks to work on' },
        { status: 400 }
      );
    }

    // Check for already running workers (unless parallel mode)
    const workers = getWorkersByOutcome(id);
    const runningWorkers = workers.filter(w => w.status === 'running');

    if (runningWorkers.length > 0 && !body.parallel) {
      return NextResponse.json(
        {
          error: 'A worker is already running for this outcome. Use parallel=true to start another.',
          workerId: runningWorkers[0].id,
          runningCount: runningWorkers.length,
        },
        { status: 400 }
      );
    }

    // Check if worktrees can be used
    const canUseWorktree = body.useWorktree && isGitRepo();
    if (body.useWorktree && !canUseWorktree) {
      console.warn('[Workers] Worktree requested but not in a git repo, using shared workspace');
    }

    // Start new worker
    const result = await startRalphWorker({
      outcomeId: id,
      useWorktree: canUseWorktree,
    });

    if (!result.started) {
      return NextResponse.json(
        { error: result.error || 'Failed to start worker' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        workerId: result.workerId,
        message: `Worker started with ${pendingTasks.length} pending tasks`,
        parallel: body.parallel || false,
        usingWorktree: canUseWorktree,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error starting worker:', error);
    return NextResponse.json(
      { error: 'Failed to start worker' },
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
    const { searchParams } = new URL(request.url);
    const workerId = searchParams.get('workerId');
    const stopAll = searchParams.get('all') === 'true';

    // Stop all workers for this outcome
    if (stopAll) {
      const stoppedCount = stopAllWorkersForOutcome(id);
      return NextResponse.json({
        success: true,
        message: `Stopped ${stoppedCount} workers`,
        stoppedCount,
      });
    }

    // Stop a specific worker
    if (!workerId) {
      return NextResponse.json(
        { error: 'workerId is required (or use ?all=true to stop all)' },
        { status: 400 }
      );
    }

    const stopped = stopRalphWorker(workerId);
    if (!stopped) {
      return NextResponse.json(
        { error: 'Worker not found or already stopped' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: 'Worker stopped' });
  } catch (error) {
    console.error('Error stopping worker:', error);
    return NextResponse.json(
      { error: 'Failed to stop worker' },
      { status: 500 }
    );
  }
}
