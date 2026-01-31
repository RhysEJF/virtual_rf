/**
 * HOMЯ Observations API
 *
 * GET /api/outcomes/:id/homr/observations - Get observation history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getRecentObservations, parseObservation } from '@/lib/db/homr';

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

  // Get limit from query params
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  // Get observations
  const observationsRaw = getRecentObservations(outcomeId, limit);
  const observations = observationsRaw.map(obs => parseObservation(obs));

  return NextResponse.json({
    outcomeId,
    observations,
    total: observations.length,
  });
}
