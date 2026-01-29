/**
 * Start Worker API Route
 *
 * Starts a Ralph worker for a project.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProjectById } from '@/lib/db/projects';
import { startRalphWorker } from '@/lib/ralph/worker';
import { PRDItem } from '@/lib/agents/briefer';

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

    // Get the project
    const project = getProjectById(id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
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

    // Parse PRD from project
    let prd: PRDItem[] = [];
    try {
      prd = JSON.parse(project.prd || '[]');
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid PRD data' },
        { status: 400 }
      );
    }

    // Start the Ralph worker
    const result = await startRalphWorker({
      projectId: project.id,
      projectName: project.name,
      objective: project.brief || 'Complete the project',
      prd,
    });

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
