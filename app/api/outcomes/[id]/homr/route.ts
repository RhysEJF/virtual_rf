/**
 * HOMЯ Status API
 *
 * GET /api/outcomes/:id/homr - Get HOMЯ status for an outcome
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import {
  getHomrStatus,
  getRecentObservations,
  getPendingEscalations,
  getHomrActivity,
  parseObservation,
  parseEscalation,
} from '@/lib/db/homr';

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

  // Get HOMЯ status
  const status = getHomrStatus(outcomeId);

  // Get recent observations (last 5)
  const recentObservationsRaw = getRecentObservations(outcomeId, 5);
  const recentObservations = recentObservationsRaw.map(obs => parseObservation(obs));

  // Get pending escalations
  const pendingEscalationsRaw = getPendingEscalations(outcomeId);
  const pendingEscalations = pendingEscalationsRaw.map(esc => parseEscalation(esc));

  // Get recent activity (last 10)
  const recentActivity = getHomrActivity(outcomeId, 10);

  return NextResponse.json({
    ...status,
    recentObservations,
    pendingEscalations,
    recentActivity: recentActivity.map(act => ({
      id: act.id,
      type: act.type,
      summary: act.summary,
      createdAt: act.created_at,
      details: JSON.parse(act.details),
    })),
  });
}
