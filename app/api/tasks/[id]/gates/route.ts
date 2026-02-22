/**
 * Task Gates API Route
 *
 * GET /api/tasks/[id]/gates - List gates on a task
 * POST /api/tasks/[id]/gates - Add a gate to a task
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getTaskById,
  parseGates,
  addGateToTask,
  createEscalationsForPendingGates,
} from '@/lib/db/tasks';
import type { GateType } from '@/lib/db/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const task = getTaskById(id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const gates = parseGates(task.gates);
    return NextResponse.json({ gates });
  } catch (error) {
    console.error('Error fetching gates:', error);
    return NextResponse.json({ error: 'Failed to fetch gates' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();

    const task = getTaskById(id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status !== 'pending') {
      return NextResponse.json(
        { error: 'Gates can only be added to pending tasks' },
        { status: 400 }
      );
    }

    const validTypes: GateType[] = ['document_required', 'human_approval'];
    if (!body.type || !validTypes.includes(body.type)) {
      return NextResponse.json(
        { error: `Invalid gate type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    if (!body.label) {
      return NextResponse.json(
        { error: 'Gate label is required' },
        { status: 400 }
      );
    }

    const gate = addGateToTask(id, {
      type: body.type,
      label: body.label,
      description: body.description,
    });

    if (!gate) {
      return NextResponse.json(
        { error: 'Failed to add gate' },
        { status: 500 }
      );
    }

    // Auto-create escalation for the new gate
    createEscalationsForPendingGates(id, task.outcome_id);

    return NextResponse.json({ gate }, { status: 201 });
  } catch (error) {
    console.error('Error adding gate:', error);
    return NextResponse.json({ error: 'Failed to add gate' }, { status: 500 });
  }
}
