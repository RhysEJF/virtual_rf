/**
 * Outputs API Route
 *
 * GET /api/outcomes/[id]/outputs - List detected outputs for an outcome
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { detectOutputs, getWorkspacePath, ensureWorkspaceExists } from '@/lib/workspace/detector';
import { getServerStatus } from '@/lib/workspace/server-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Detect outputs
    const workspaceInfo = detectOutputs(id);

    // Get server status if there's an app
    const serverStatus = getServerStatus(id);

    return NextResponse.json({
      outcomeId: id,
      outcomeName: outcome.name,
      workspace: {
        path: workspaceInfo.path,
        exists: workspaceInfo.exists,
      },
      outputs: workspaceInfo.outputs,
      summary: workspaceInfo.summary,
      server: serverStatus,
    });
  } catch (error) {
    console.error('Error detecting outputs:', error);
    return NextResponse.json(
      { error: 'Failed to detect outputs' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/outcomes/[id]/outputs - Create/ensure workspace exists
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Ensure workspace exists
    const workspacePath = ensureWorkspaceExists(id);

    return NextResponse.json({
      success: true,
      workspacePath,
    });
  } catch (error) {
    console.error('Error creating workspace:', error);
    return NextResponse.json(
      { error: 'Failed to create workspace' },
      { status: 500 }
    );
  }
}
