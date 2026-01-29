/**
 * Outcome Interventions API Route
 *
 * POST /api/outcomes/[id]/interventions - Create an intervention
 * GET /api/outcomes/[id]/interventions - List interventions for outcome
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import {
  createIntervention,
  getInterventionsByOutcome,
  type CreateInterventionInput,
} from '@/lib/db/interventions';
import { createTask } from '@/lib/db/tasks';
import type { InterventionActionType, InterventionStatus } from '@/lib/db/schema';

interface CreateInterventionRequest {
  type: InterventionActionType;
  message: string;
  worker_id?: string;
  priority?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await params;
    const body = (await request.json()) as CreateInterventionRequest;

    // Validate outcome exists
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Validate required fields
    if (!body.type || !body.message) {
      return NextResponse.json(
        { error: 'Type and message are required' },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes: InterventionActionType[] = ['add_task', 'redirect', 'pause', 'priority_change'];
    if (!validTypes.includes(body.type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // For add_task type, create the task immediately
    if (body.type === 'add_task') {
      const task = createTask({
        outcome_id: outcomeId,
        title: body.message,
        priority: body.priority ?? 1, // High priority for user-added tasks
      });

      // Still create intervention record for tracking
      const intervention = createIntervention({
        outcome_id: outcomeId,
        worker_id: body.worker_id,
        type: body.type,
        message: body.message,
        priority: body.priority ?? 0,
      });

      return NextResponse.json({
        success: true,
        intervention,
        task,
        message: 'Task created and intervention recorded',
      }, { status: 201 });
    }

    // For other types, just create the intervention
    const input: CreateInterventionInput = {
      outcome_id: outcomeId,
      worker_id: body.worker_id,
      type: body.type,
      message: body.message,
      priority: body.priority ?? 0,
    };

    const intervention = createIntervention(input);

    return NextResponse.json({
      success: true,
      intervention,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating intervention:', error);
    return NextResponse.json(
      { error: 'Failed to create intervention' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as InterventionStatus | null;

    // Validate outcome exists
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    const interventions = getInterventionsByOutcome(
      outcomeId,
      status || undefined
    );

    return NextResponse.json({ interventions });
  } catch (error) {
    console.error('Error fetching interventions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch interventions' },
      { status: 500 }
    );
  }
}
