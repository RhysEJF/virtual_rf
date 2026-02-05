/**
 * Recent Analysis Jobs API
 *
 * GET /api/improvements/jobs/recent - Get recent analysis jobs (including completed/failed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRecentJobs } from '@/lib/db/analysis-jobs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 10;

    const jobs = getRecentJobs(limit);

    // Transform to camelCase for API response
    const transformedJobs = jobs.map((job) => ({
      id: job.id,
      outcomeId: job.outcome_id,
      jobType: job.job_type,
      status: job.status,
      progressMessage: job.progress_message,
      result: job.result ? JSON.parse(job.result) : null,
      error: job.error,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    }));

    return NextResponse.json({
      success: true,
      jobs: transformedJobs,
    });
  } catch (error) {
    console.error('Error getting recent jobs:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get recent jobs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
