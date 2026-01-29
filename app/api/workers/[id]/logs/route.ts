/**
 * Worker Logs API Route
 *
 * GET /api/workers/[id]/logs - Get progress entries for worker
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkerById } from '@/lib/db/workers';
import { getRecentProgress, getProgressEntriesByWorker } from '@/lib/db/progress';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: workerId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const since = searchParams.get('since');

    // Validate worker exists
    const worker = getWorkerById(workerId);
    if (!worker) {
      return NextResponse.json(
        { error: 'Worker not found' },
        { status: 404 }
      );
    }

    // Get progress entries
    let entries = getRecentProgress(workerId, limit);

    // Filter by timestamp if provided
    if (since) {
      const sinceTimestamp = parseInt(since, 10);
      entries = entries.filter(e => e.created_at > sinceTimestamp);
    }

    return NextResponse.json({
      entries,
      worker_id: workerId,
      outcome_id: worker.outcome_id,
    });
  } catch (error) {
    console.error('Error fetching worker logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}
