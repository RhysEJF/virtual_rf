/**
 * HOMЯ Escalation Confirm/Reject API (Semi-Auto Mode)
 *
 * POST /api/outcomes/:id/homr/escalations/:escId/confirm - Confirm a proposed resolution
 * DELETE /api/outcomes/:id/homr/escalations/:escId/confirm - Reject a proposed resolution
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getEscalationById, confirmEscalationResolution, rejectEscalationResolution } from '@/lib/db/homr';
import { logHomrActivity } from '@/lib/db/homr';
import { resolveEscalation } from '@/lib/homr/escalator';
import { startRalphWorker } from '@/lib/ralph/worker';
import { getWorkersByOutcome } from '@/lib/db/workers';
import { getTasksByOutcome } from '@/lib/db/tasks';

interface Params {
  params: Promise<{ id: string; escId: string }>;
}

/**
 * POST - Confirm the AI-proposed resolution and apply it
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: outcomeId, escId: escalationId } = await params;

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
  }

  const escalation = getEscalationById(escalationId);
  if (!escalation) {
    return NextResponse.json({ error: 'Escalation not found' }, { status: 404 });
  }
  if (escalation.outcome_id !== outcomeId) {
    return NextResponse.json({ error: 'Escalation does not belong to this outcome' }, { status: 400 });
  }
  if (escalation.status !== 'pending_confirmation') {
    return NextResponse.json({ error: `Escalation is not pending confirmation (status: ${escalation.status})` }, { status: 400 });
  }

  try {
    // Parse the proposed resolution
    const proposed = JSON.parse(escalation.proposed_resolution || '{}');
    if (!proposed.selectedOption) {
      return NextResponse.json({ error: 'No proposed resolution found' }, { status: 400 });
    }

    // Confirm the escalation (sets status to 'answered')
    confirmEscalationResolution(escalationId);

    // Apply the resolution through the standard escalation resolution pipeline
    const resolution = await resolveEscalation(escalationId, {
      selectedOption: proposed.selectedOption,
      additionalContext: `[SEMI-AUTO CONFIRMED] ${proposed.reasoning || ''}`,
    });

    logHomrActivity({
      outcome_id: outcomeId,
      type: 'auto_resolved',
      summary: `Semi-auto confirmed: ${proposed.selectedOption} (confidence: ${((escalation.proposed_confidence || 0) * 100).toFixed(0)}%)`,
      details: { escalationId, selectedOption: proposed.selectedOption, confirmed: true },
    });

    // Auto-spawn worker if none running and there are pending tasks
    let workerSpawned = false;
    try {
      const workers = getWorkersByOutcome(outcomeId);
      const runningWorkers = workers.filter(w => w.status === 'running');

      if (runningWorkers.length === 0) {
        const tasks = getTasksByOutcome(outcomeId);
        const pendingTasks = tasks.filter(t => t.status === 'pending');

        if (pendingTasks.length > 0) {
          const workerResult = await startRalphWorker({
            outcomeId,
            maxTurns: 20,
            enableComplexityCheck: true,
            autoDecompose: false,
          });

          if (workerResult.started) {
            workerSpawned = true;
          }
        }
      }
    } catch (workerError) {
      console.error('[Semi-Auto Confirm] Error spawning worker:', workerError);
    }

    return NextResponse.json({
      success: true,
      escalationId: resolution.escalationId,
      selectedOption: resolution.selectedOption,
      resumedTasks: resolution.resumedTasks,
      workerSpawned,
    });
  } catch (error) {
    console.error('[Semi-Auto Confirm] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to confirm resolution',
    }, { status: 500 });
  }
}

/**
 * DELETE - Reject the AI-proposed resolution, revert to pending
 */
export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: outcomeId, escId: escalationId } = await params;

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
  }

  const escalation = getEscalationById(escalationId);
  if (!escalation) {
    return NextResponse.json({ error: 'Escalation not found' }, { status: 404 });
  }
  if (escalation.outcome_id !== outcomeId) {
    return NextResponse.json({ error: 'Escalation does not belong to this outcome' }, { status: 400 });
  }
  if (escalation.status !== 'pending_confirmation') {
    return NextResponse.json({ error: `Escalation is not pending confirmation (status: ${escalation.status})` }, { status: 400 });
  }

  try {
    const updated = rejectEscalationResolution(escalationId);

    logHomrActivity({
      outcome_id: outcomeId,
      type: 'auto_resolve_deferred',
      summary: `Semi-auto rejected: proposal dismissed, escalation reverted to pending`,
      details: { escalationId, rejected: true },
    });

    return NextResponse.json({
      success: true,
      escalation: {
        id: updated.id,
        status: updated.status,
      },
    });
  } catch (error) {
    console.error('[Semi-Auto Reject] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to reject resolution',
    }, { status: 500 });
  }
}
