/**
 * HOMЯ Activity Log API
 *
 * GET /api/outcomes/:id/homr/activity - Get activity log
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getHomrActivity } from '@/lib/db/homr';
import type { HomrActivityType } from '@/lib/db/schema';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: outcomeId } = await params;

  // Verify outcome exists
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
  }

  // Get query params
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const typeFilter = searchParams.get('type') as HomrActivityType | null;

  // Get activity log
  const activityRaw = getHomrActivity(outcomeId, limit, typeFilter || undefined);

  const activity = activityRaw.map(act => ({
    id: act.id,
    outcomeId: act.outcome_id,
    type: act.type,
    summary: act.summary,
    details: JSON.parse(act.details),
    createdAt: act.created_at,
  }));

  return NextResponse.json({
    outcomeId,
    activity,
    total: activity.length,
  });
}
