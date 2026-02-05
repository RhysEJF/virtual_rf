/**
 * Server Management API Route
 *
 * GET /api/outcomes/[id]/server - Get detected apps and running servers
 * POST /api/outcomes/[id]/server - Start a server for an app
 * DELETE /api/outcomes/[id]/server?appId=... - Stop a server (or all if no appId)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { detectApps } from '@/lib/workspace/detector';
import {
  startAppServer,
  stopServerById,
  stopOutcomeServers,
  getServersByOutcome,
} from '@/lib/workspace/server-manager';

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

    // Detect apps in workspace
    const apps = detectApps(id);

    // Get running servers
    const servers = getServersByOutcome(id);

    return NextResponse.json({
      outcomeId: id,
      apps,
      servers,
      hasRunningServers: servers.some(s => s.status === 'running'),
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

    // Parse request body
    let appId: string | undefined;
    try {
      const body = await request.json();
      appId = body.appId;
    } catch {
      // No body or invalid JSON
    }

    // Detect apps
    const apps = detectApps(id);

    if (apps.length === 0) {
      return NextResponse.json(
        { error: 'No apps found in workspace' },
        { status: 400 }
      );
    }

    // Find the app to start
    let app = apps[0]; // Default to first app
    if (appId) {
      const found = apps.find(a => a.id === appId);
      if (!found) {
        return NextResponse.json(
          { error: `App not found: ${appId}` },
          { status: 400 }
        );
      }
      app = found;
    }

    // Start the server
    const serverInfo = await startAppServer(id, app);

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

    // Check for appId query param
    const url = new URL(request.url);
    const appId = url.searchParams.get('appId');

    let stopped: boolean | number;
    let message: string;

    if (appId) {
      // Stop specific server
      stopped = stopServerById(appId);
      message = stopped ? `Server ${appId} stopped` : 'Server was not running';
    } else {
      // Stop all servers for outcome
      stopped = stopOutcomeServers(id);
      message = stopped > 0 ? `Stopped ${stopped} server(s)` : 'No servers were running';
    }

    return NextResponse.json({
      success: typeof stopped === 'number' ? stopped > 0 : stopped,
      stopped: typeof stopped === 'number' ? stopped : (stopped ? 1 : 0),
      message,
    });
  } catch (error) {
    console.error('Error stopping server:', error);
    return NextResponse.json(
      { error: 'Failed to stop server' },
      { status: 500 }
    );
  }
}
