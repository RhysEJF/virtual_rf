/**
 * Start Worker API Route (Legacy Adapter)
 *
 * Starts a Ralph worker for a project/outcome.
 * Supports both legacy project-based and new outcome-based flows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProjectById } from '@/lib/db/projects';
import { getOutcomeById } from '@/lib/db/outcomes';
import { createTask, getPendingTasks } from '@/lib/db/tasks';
import { startRalphWorker } from '@/lib/ralph/worker';
import type { PRDItem } from '@/lib/agents/briefer';

interface StartResponse {
  success: boolean;
  workerId?: string;
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<StartResponse>> {
  try {
    const { id } = await params;

    // First try to find as an outcome (new model)
    const outcome = getOutcomeById(id);
    if (outcome) {
      // Check if there are pending tasks
      const pendingTasks = getPendingTasks(id);
      if (pendingTasks.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No pending tasks for this outcome' },
          { status: 400 }
        );
      }

      // Start worker for outcome
      const result = await startRalphWorker({ outcomeId: id });

      if (!result.started) {
        return NextResponse.json(
          { success: false, error: result.error || 'Failed to start worker' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        workerId: result.workerId,
      });
    }

    // Fall back to legacy project model
    const project = getProjectById(id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project/Outcome not found' },
        { status: 404 }
      );
    }

    // Check if project is already active
    if (project.status === 'active') {
      return NextResponse.json(
        { success: false, error: 'Project already has an active worker' },
        { status: 400 }
      );
    }

    // Parse PRD from project and create tasks
    let prd: PRDItem[] = [];
    try {
      prd = JSON.parse(project.prd || '[]');
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid PRD data' },
        { status: 400 }
      );
    }

    // Convert PRD items to tasks for the worker to claim
    // Note: Using project.id as outcome_id for legacy compatibility
    // Note: briefer uses numeric priority (1 = highest)
    for (const item of prd) {
      createTask({
        outcome_id: project.id,
        title: item.title,
        description: item.description,
        prd_context: JSON.stringify(item),
        priority: item.priority * 10, // Convert 1-10 scale to 10-100 range
      });
    }

    // Start the Ralph worker (now uses outcomeId)
    const result = await startRalphWorker({ outcomeId: project.id });

    if (!result.started) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to start worker' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      workerId: result.workerId,
    });
  } catch (error) {
    console.error('Start worker error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
