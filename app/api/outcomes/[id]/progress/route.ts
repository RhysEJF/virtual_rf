/**
 * Progress API Route
 *
 * GET /api/outcomes/[id]/progress
 * Returns progress entries for all workers on this outcome
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getWorkersByOutcome } from '@/lib/db/workers';
import { getProgressEntriesByWorker, getProgressStats } from '@/lib/db/progress';
import type { ProgressEntry } from '@/lib/db/schema';

interface WorkerProgress {
  workerId: string;
  workerName: string;
  workerStatus: string;
  entries: ProgressEntry[];
  stats: {
    total: number;
    compacted: number;
    uncompacted: number;
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Get outcome
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Get all workers for this outcome
    const workers = getWorkersByOutcome(id);

    // Get progress entries for each worker
    const workerProgress: WorkerProgress[] = workers.map((worker) => {
      const entries = getProgressEntriesByWorker(worker.id);
      const stats = getProgressStats(worker.id);

      return {
        workerId: worker.id,
        workerName: worker.name,
        workerStatus: worker.status,
        entries,
        stats,
      };
    });

    // Also aggregate overall stats
    const overallStats = {
      totalEntries: workerProgress.reduce((sum, wp) => sum + wp.stats.total, 0),
      totalCompacted: workerProgress.reduce((sum, wp) => sum + wp.stats.compacted, 0),
      totalUncompacted: workerProgress.reduce((sum, wp) => sum + wp.stats.uncompacted, 0),
      workerCount: workers.length,
    };

    return NextResponse.json({
      outcomeId: id,
      outcomeName: outcome.name,
      workerProgress,
      overallStats,
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    return NextResponse.json(
      { error: 'Failed to fetch progress' },
      { status: 500 }
    );
  }
}
