/**
 * Outputs API Route
 *
 * GET    /api/outcomes/[id]/outputs - List detected outputs for an outcome
 * DELETE /api/outcomes/[id]/outputs - Delete an output file by path
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { detectOutputs, getWorkspacePath, ensureWorkspaceExists } from '@/lib/workspace/detector';
import { getServerStatus } from '@/lib/workspace/server-manager';
import { existsSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';

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

/**
 * DELETE /api/outcomes/[id]/outputs?path=relative/path - Delete an output file
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: 'path parameter is required' }, { status: 400 });
    }

    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    const workspacePath = getWorkspacePath(id);
    const absolutePath = resolve(join(workspacePath, filePath));

    // Prevent path traversal — file must be inside the workspace
    if (!absolutePath.startsWith(resolve(workspacePath))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!existsSync(absolutePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    unlinkSync(absolutePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting output:', error);
    return NextResponse.json({ error: 'Failed to delete output' }, { status: 500 });
  }
}
