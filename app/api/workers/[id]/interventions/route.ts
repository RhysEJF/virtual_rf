/**
 * Worker Interventions API Route
 *
 * GET /api/workers/[id]/interventions - Get pending interventions for worker
 * PATCH /api/workers/[id]/interventions - Acknowledge/complete interventions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkerById } from '@/lib/db/workers';
import {
  getPendingInterventionsForWorker,
  acknowledgeIntervention,
  completeIntervention,
  dismissIntervention,
} from '@/lib/db/interventions';
import type { InterventionStatus } from '@/lib/db/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: workerId } = await params;

    // Validate worker exists
    const worker = getWorkerById(workerId);
    if (!worker) {
      return NextResponse.json(
        { error: 'Worker not found' },
        { status: 404 }
      );
    }

    // Get pending interventions for this worker
    const interventions = getPendingInterventionsForWorker(workerId, worker.outcome_id);

    return NextResponse.json({ interventions });
  } catch (error) {
    console.error('Error fetching worker interventions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch interventions' },
      { status: 500 }
    );
  }
}

interface UpdateInterventionRequest {
  intervention_id: string;
  status: 'acknowledged' | 'completed' | 'dismissed';
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: workerId } = await params;
    const body = (await request.json()) as UpdateInterventionRequest;

    // Validate worker exists
    const worker = getWorkerById(workerId);
    if (!worker) {
      return NextResponse.json(
        { error: 'Worker not found' },
        { status: 404 }
      );
    }

    if (!body.intervention_id || !body.status) {
      return NextResponse.json(
        { error: 'intervention_id and status are required' },
        { status: 400 }
      );
    }

    let intervention;
    switch (body.status) {
      case 'acknowledged':
        intervention = acknowledgeIntervention(body.intervention_id);
        break;
      case 'completed':
        intervention = completeIntervention(body.intervention_id);
        break;
      case 'dismissed':
        intervention = dismissIntervention(body.intervention_id);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid status. Must be: acknowledged, completed, or dismissed' },
          { status: 400 }
        );
    }

    if (!intervention) {
      return NextResponse.json(
        { error: 'Intervention not found or already processed' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      intervention,
    });
  } catch (error) {
    console.error('Error updating intervention:', error);
    return NextResponse.json(
      { error: 'Failed to update intervention' },
      { status: 500 }
    );
  }
}
