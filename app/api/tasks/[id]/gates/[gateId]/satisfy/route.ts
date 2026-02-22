/**
 * Gate Satisfaction API Route
 *
 * POST /api/tasks/[id]/gates/[gateId]/satisfy - Satisfy a specific gate
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getTaskById,
  parseGates,
  satisfyGate,
} from '@/lib/db/tasks';
import { getEscalationById, answerEscalation } from '@/lib/db/homr';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; gateId: string }> }
): Promise<NextResponse> {
  try {
    const { id, gateId } = await params;
    const body = await request.json().catch(() => ({}));

    const task = getTaskById(id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const gates = parseGates(task.gates);
    const gate = gates.find(g => g.id === gateId);
    if (!gate) {
      return NextResponse.json({ error: 'Gate not found' }, { status: 404 });
    }

    if (gate.status === 'satisfied') {
      return NextResponse.json(
        { error: 'Gate is already satisfied' },
        { status: 400 }
      );
    }

    // Satisfy the gate
    const updatedGate = satisfyGate(id, gateId, body.response_data, 'human');

    // Also resolve the linked escalation if it exists
    if (gate.escalation_id) {
      const escalation = getEscalationById(gate.escalation_id);
      if (escalation && escalation.status === 'pending') {
        const optionId = gate.type === 'document_required' ? 'document_provided' : 'approve';
        answerEscalation(gate.escalation_id, optionId, body.response_data || 'Satisfied via gate API');
      }
    }

    return NextResponse.json({ gate: updatedGate });
  } catch (error) {
    console.error('Error satisfying gate:', error);
    return NextResponse.json({ error: 'Failed to satisfy gate' }, { status: 500 });
  }
}
