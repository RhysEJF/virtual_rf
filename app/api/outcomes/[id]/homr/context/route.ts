/**
 * HOMЯ Context API
 *
 * GET /api/outcomes/:id/homr/context - Get full context store
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getHomrContext } from '@/lib/db/homr';
import type { HomrDiscovery, HomrDecision, HomrConstraint, HomrContextInjection } from '@/lib/db/schema';

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

  // Get context store
  const context = getHomrContext(outcomeId);

  if (!context) {
    return NextResponse.json({
      outcomeId,
      discoveries: [],
      decisions: [],
      constraints: [],
      injections: [],
      stats: {
        tasksObserved: 0,
        discoveriesExtracted: 0,
        escalationsCreated: 0,
        steeringActions: 0,
      },
      createdAt: null,
      updatedAt: null,
    });
  }

  // Parse JSON fields
  const discoveries: HomrDiscovery[] = JSON.parse(context.discoveries);
  const decisions: HomrDecision[] = JSON.parse(context.decisions);
  const constraints: HomrConstraint[] = JSON.parse(context.constraints);
  const injections: HomrContextInjection[] = JSON.parse(context.injections);

  return NextResponse.json({
    outcomeId: context.outcome_id,
    discoveries,
    decisions,
    constraints,
    injections,
    stats: {
      tasksObserved: context.tasks_observed,
      discoveriesExtracted: context.discoveries_extracted,
      escalationsCreated: context.escalations_created,
      steeringActions: context.steering_actions,
    },
    createdAt: context.created_at,
    updatedAt: context.updated_at,
  });
}
