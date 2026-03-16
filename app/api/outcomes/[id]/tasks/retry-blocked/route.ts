/**
 * Retry Blocked Tasks API Route
 *
 * POST /api/outcomes/[id]/tasks/retry-blocked - Reset all failed tasks
 *   that are blocking pending tasks
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getFailedBlockerTasks, resetTaskForRetry } from '@/lib/db/tasks';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    const failedBlockers = getFailedBlockerTasks(id);

    if (failedBlockers.length === 0) {
      return NextResponse.json({
        retried: [],
        message: 'No failed tasks blocking progress',
      });
    }

    const retried: Array<{ id: string; title: string }> = [];
    for (const blocker of failedBlockers) {
      const updated = resetTaskForRetry(blocker.id);
      if (updated) {
        retried.push({ id: blocker.id, title: blocker.title });
      }
    }

    return NextResponse.json({
      retried,
      message: `Reset ${retried.length} failed blocker task(s) to pending`,
    });
  } catch (error) {
    console.error('Error retrying blocked tasks:', error);
    return NextResponse.json(
      { error: 'Failed to retry blocked tasks' },
      { status: 500 }
    );
  }
}
