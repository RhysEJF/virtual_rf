/**
 * Analysis Job Status API
 *
 * GET /api/improvements/jobs/[jobId] - Get status of a specific analysis job
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJobStatus } from '@/lib/analysis/runner';

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { jobId } = await params;

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }

    const status = getJobStatus(jobId);

    if (!status) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      job: status,
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get job status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
