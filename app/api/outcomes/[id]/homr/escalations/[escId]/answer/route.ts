/**
 * HOMЯ Escalation Answer API
 *
 * POST /api/outcomes/:id/homr/escalations/:escId/answer - Answer an escalation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getEscalationById, parseEscalation } from '@/lib/db/homr';
import { resolveEscalation } from '@/lib/homr/escalator';

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

  // Parse request body
  let body: { selectedOption: string; additionalContext?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.selectedOption) {
    return NextResponse.json({ error: 'selectedOption is required' }, { status: 400 });
  }

  // Resolve the escalation
  try {
    const resolution = await resolveEscalation(escalationId, {
      selectedOption: body.selectedOption,
      additionalContext: body.additionalContext,
    });

    return NextResponse.json({
      success: true,
      escalationId: resolution.escalationId,
      selectedOption: resolution.selectedOption,
      resumedTasks: resolution.resumedTasks,
    });
  } catch (error) {
    console.error('[HOMЯ API] Failed to resolve escalation:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to resolve escalation',
    }, { status: 500 });
  }
}
