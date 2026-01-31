/**
 * HOMЯ Escalations API
 *
 * GET /api/outcomes/:id/homr/escalations - List escalations
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getEscalations, getPendingEscalations, parseEscalation } from '@/lib/db/homr';

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
  const pendingOnly = searchParams.get('pending') === 'true';
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  // Get escalations
  const escalationsRaw = pendingOnly
    ? getPendingEscalations(outcomeId)
    : getEscalations(outcomeId, limit);

  const escalations = escalationsRaw.map(esc => parseEscalation(esc));

  return NextResponse.json({
    outcomeId,
    escalations,
    pendingCount: getPendingEscalations(outcomeId).length,
    total: escalations.length,
  });
}
