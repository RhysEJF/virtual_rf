/**
 * Outcome Review API Route
 *
 * GET /api/outcomes/[id]/review - Get review status and history
 * POST /api/outcomes/[id]/review - Trigger a new review cycle
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getReviewCyclesByOutcome, getConvergenceStatus, hasConverged } from '@/lib/db/review-cycles';
import { reviewOutcome, getReviewSummary } from '@/lib/agents/reviewer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    const reviewCycles = getReviewCyclesByOutcome(id);
    const convergence = getConvergenceStatus(id);
    const summary = getReviewSummary(id);
    const isConverged = hasConverged(id);

    return NextResponse.json({
      reviewCycles,
      convergence,
      summary,
      isConverged,
    });
  } catch (error) {
    console.error('Error fetching review status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch review status' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Run review
    const result = await reviewOutcome(id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Review failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      reviewCycleId: result.reviewCycleId,
      issuesFound: result.issuesFound,
      tasksCreated: result.tasksCreated,
      issues: result.issues,
      convergence: result.convergence,
      message: result.issuesFound === 0
        ? 'No issues found!'
        : `Found ${result.issuesFound} issues, created ${result.tasksCreated} tasks`,
    });
  } catch (error) {
    console.error('Error running review:', error);
    return NextResponse.json(
      { error: 'Failed to run review' },
      { status: 500 }
    );
  }
}
