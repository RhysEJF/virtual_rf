/**
 * Active Analysis Jobs API
 *
 * GET /api/improvements/jobs/active - Get all active (running/pending) analysis jobs
 */

import { NextResponse } from 'next/server';
import { getActiveAnalysisJobs } from '@/lib/analysis/runner';

export async function GET(): Promise<NextResponse> {
  try {
    const jobs = getActiveAnalysisJobs();

    return NextResponse.json({
      success: true,
      jobs,
    });
  } catch (error) {
    console.error('Error getting active jobs:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get active jobs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
