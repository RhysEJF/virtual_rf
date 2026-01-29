/**
 * Server Management API Route
 *
 * GET /api/outcomes/[id]/server - Get server status
 * POST /api/outcomes/[id]/server - Start dev server
 * DELETE /api/outcomes/[id]/server - Stop dev server
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { startServer, stopServer, getServerStatus } from '@/lib/workspace/server-manager';

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

    const status = getServerStatus(id);

    return NextResponse.json({
      outcomeId: id,
      running: status !== null && status.status === 'running',
      server: status,
    });
  } catch (error) {
    console.error('Error getting server status:', error);
    return NextResponse.json(
      { error: 'Failed to get server status' },
      { status: 500 }
    );
  }
}

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

    // Parse request body for optional script name
    let script = 'dev';
    try {
      const body = await request.json();
      if (body.script) {
        script = body.script;
      }
    } catch {
      // No body or invalid JSON, use default
    }

    // Start the server
    const serverInfo = await startServer(id, script);

    return NextResponse.json({
      success: true,
      server: serverInfo,
      message: serverInfo.status === 'running'
        ? `Server running at ${serverInfo.url}`
        : serverInfo.status === 'starting'
        ? 'Server is starting...'
        : `Server status: ${serverInfo.status}`,
    });
  } catch (error) {
    console.error('Error starting server:', error);
    return NextResponse.json(
      { error: 'Failed to start server' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const stopped = stopServer(id);

    return NextResponse.json({
      success: stopped,
      message: stopped ? 'Server stopped' : 'No server was running',
    });
  } catch (error) {
    console.error('Error stopping server:', error);
    return NextResponse.json(
      { error: 'Failed to stop server' },
      { status: 500 }
    );
  }
}
