/**
 * HOMЯ Escalation Dismiss API
 *
 * POST /api/outcomes/:id/homr/escalations/:escId/dismiss - Dismiss an escalation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getEscalationById } from '@/lib/db/homr';
import { dismissEscalation } from '@/lib/homr/escalator';

interface Params {
  params: Promise<{ id: string; escId: string }>;
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: outcomeId, escId: escalationId } = await params;

  // Verify outcome exists
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
  }

  // Verify escalation exists and belongs to this outcome
  const escalation = getEscalationById(escalationId);
  if (!escalation) {
    return NextResponse.json({ error: 'Escalation not found' }, { status: 404 });
  }
  if (escalation.outcome_id !== outcomeId) {
    return NextResponse.json({ error: 'Escalation does not belong to this outcome' }, { status: 400 });
  }
  if (escalation.status !== 'pending') {
    return NextResponse.json({ error: `Escalation is already ${escalation.status}` }, { status: 400 });
  }

  // Parse request body for optional reason
  let reason: string | undefined;
  try {
    const body = await req.json();
    reason = body.reason;
  } catch {
    // Body is optional
  }

  // Dismiss the escalation
  try {
    await dismissEscalation(escalationId, reason);

    return NextResponse.json({
      success: true,
      escalationId,
      message: 'Escalation dismissed',
    });
  } catch (error) {
    console.error('[HOMЯ API] Failed to dismiss escalation:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to dismiss escalation',
    }, { status: 500 });
  }
}
