/**
 * Workers List API Route
 *
 * GET /api/workers - List all workers with optional outcome filter
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllWorkers, getWorkersByOutcome } from '@/lib/db/workers';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const outcomeId = searchParams.get('outcome');

    let workers;
    if (outcomeId) {
      workers = getWorkersByOutcome(outcomeId);
    } else {
      workers = getAllWorkers();
    }

    return NextResponse.json({ workers });
  } catch (error) {
    console.error('Error fetching workers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workers' },
      { status: 500 }
    );
  }
}
