/**
 * Activity API Route
 *
 * GET /api/activity - Get recent activity for the feed
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRecentActivity, getActivityByOutcome, getActivitySince } from '@/lib/db/activity';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const outcomeId = searchParams.get('outcome_id');
    const since = searchParams.get('since');

    let activities;

    if (outcomeId) {
      activities = getActivityByOutcome(outcomeId, limit);
    } else if (since) {
      activities = getActivitySince(parseInt(since, 10), limit);
    } else {
      activities = getRecentActivity(limit, offset);
    }

    return NextResponse.json({ activities });
  } catch (error) {
    console.error('Error fetching activity:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activity' },
      { status: 500 }
    );
  }
}
