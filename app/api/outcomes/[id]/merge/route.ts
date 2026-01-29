/**
 * Outcome Merge API Route
 *
 * GET /api/outcomes/[id]/merge - Get merge queue status
 * POST /api/outcomes/[id]/merge - Queue a merge for a worker
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getWorkerById } from '@/lib/db/workers';
import {
  queueMerge,
  getMergesByOutcome,
  getMergeStats,
  canMergeCleanly,
} from '@/lib/worktree/merge';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    const merges = getMergesByOutcome(outcomeId);
    const stats = getMergeStats(outcomeId);

    return NextResponse.json({
      merges,
      stats,
    });
  } catch (error) {
    console.error('Error fetching merge queue:', error);
    return NextResponse.json(
      { error: 'Failed to fetch merge queue' },
      { status: 500 }
    );
  }
}

interface MergeRequest {
  worker_id: string;
  check_only?: boolean; // Just check if merge is clean, don't actually merge
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await params;
    const body = (await request.json()) as MergeRequest;

    // Verify outcome exists
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    if (!body.worker_id) {
      return NextResponse.json(
        { error: 'worker_id is required' },
        { status: 400 }
      );
    }

    // Verify worker exists and has a branch
    const worker = getWorkerById(body.worker_id);
    if (!worker) {
      return NextResponse.json(
        { error: 'Worker not found' },
        { status: 404 }
      );
    }

    if (worker.outcome_id !== outcomeId) {
      return NextResponse.json(
        { error: 'Worker does not belong to this outcome' },
        { status: 400 }
      );
    }

    if (!worker.branch_name) {
      return NextResponse.json(
        { error: 'Worker does not have a branch (not using worktree)' },
        { status: 400 }
      );
    }

    // Check only mode - just check if merge would be clean
    if (body.check_only) {
      const { clean, conflicts } = canMergeCleanly(worker.branch_name);
      return NextResponse.json({
        clean,
        conflicts,
        worker_id: worker.id,
        branch: worker.branch_name,
      });
    }

    // Queue and execute the merge
    const entry = await queueMerge(outcomeId, worker.id, worker.branch_name);

    return NextResponse.json({
      success: entry.status === 'completed',
      entry,
      message: entry.status === 'completed'
        ? 'Merge completed successfully'
        : entry.status === 'conflicted'
        ? 'Merge has conflicts that need resolution'
        : 'Merge failed',
    });
  } catch (error) {
    console.error('Error processing merge:', error);
    return NextResponse.json(
      { error: 'Failed to process merge' },
      { status: 500 }
    );
  }
}
