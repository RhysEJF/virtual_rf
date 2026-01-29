/**
 * Supervisor API Route
 *
 * GET /api/supervisor - Get supervisor status
 * POST /api/supervisor - Start supervisor
 * DELETE /api/supervisor - Stop supervisor
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  startSupervisor,
  stopSupervisor,
  getSupervisorStatus,
  triggerCheck,
} from '@/lib/agents/supervisor';
import { getAlertStats } from '@/lib/db/supervisor-alerts';

export async function GET(): Promise<NextResponse> {
  try {
    const status = getSupervisorStatus();
    const alertStats = getAlertStats();

    return NextResponse.json({
      ...status,
      alerts: alertStats,
    });
  } catch (error) {
    console.error('Error getting supervisor status:', error);
    return NextResponse.json(
      { error: 'Failed to get supervisor status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'check') {
      // Manual trigger of a check
      triggerCheck();
      return NextResponse.json({ success: true, message: 'Check triggered' });
    }

    // Default: start supervisor
    const result = startSupervisor();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error starting supervisor:', error);
    return NextResponse.json(
      { error: 'Failed to start supervisor' },
      { status: 500 }
    );
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    const result = stopSupervisor();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error stopping supervisor:', error);
    return NextResponse.json(
      { error: 'Failed to stop supervisor' },
      { status: 500 }
    );
  }
}
