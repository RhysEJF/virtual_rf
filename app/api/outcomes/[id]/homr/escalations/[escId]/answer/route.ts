/**
 * HOMЯ Escalation Answer API
 *
 * POST /api/outcomes/:id/homr/escalations/:escId/answer - Answer an escalation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getEscalationById, parseEscalation } from '@/lib/db/homr';
import { resolveEscalation, markTasksForDecomposition } from '@/lib/homr/escalator';
import { isBreakIntoSubtasksOption } from '@/lib/homr/escalator';

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

  // If the selected option is "break_into_subtasks", immediately mark the affected tasks
  // as decomposition_status='in_progress' BEFORE calling resolveEscalation.
  // This protects the tasks from being claimed by workers while decomposition is pending.
  if (isBreakIntoSubtasksOption(body.selectedOption)) {
    // Parse affected tasks from the escalation
    let affectedTasks: string[] = [];
    try {
      affectedTasks = escalation.affected_tasks
        ? JSON.parse(escalation.affected_tasks)
        : [];
    } catch {
      affectedTasks = [];
    }

    // Mark tasks for decomposition immediately
    if (affectedTasks.length > 0) {
      const markedCount = markTasksForDecomposition(affectedTasks);
      console.log(`[HOMЯ API] Marked ${markedCount} task(s) for decomposition before resolution`);
    }
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
