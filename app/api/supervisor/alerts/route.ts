/**
 * Supervisor Alerts API Route
 *
 * GET /api/supervisor/alerts - Get alerts (with optional filters)
 * PATCH /api/supervisor/alerts - Acknowledge or resolve an alert
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveAlerts,
  getRecentAlerts,
  getAlertsByOutcome,
  acknowledgeAlert,
  resolveAlert,
  getSupervisorAlertById,
} from '@/lib/db/supervisor-alerts';
import type { SupervisorAlertStatus } from '@/lib/db/schema';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as SupervisorAlertStatus | null;
    const outcomeId = searchParams.get('outcome_id');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    let alerts;

    if (outcomeId) {
      alerts = getAlertsByOutcome(outcomeId, status || undefined);
    } else if (status === 'active') {
      alerts = getActiveAlerts();
    } else {
      alerts = getRecentAlerts(limit);
    }

    return NextResponse.json({ alerts });
  } catch (error) {
    console.error('Error fetching supervisor alerts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch alerts' },
      { status: 500 }
    );
  }
}

interface UpdateAlertRequest {
  alert_id: number;
  action: 'acknowledge' | 'resolve';
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as UpdateAlertRequest;

    if (!body.alert_id || !body.action) {
      return NextResponse.json(
        { error: 'alert_id and action are required' },
        { status: 400 }
      );
    }

    // Verify alert exists
    const existing = getSupervisorAlertById(body.alert_id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Alert not found' },
        { status: 404 }
      );
    }

    let alert;
    switch (body.action) {
      case 'acknowledge':
        alert = acknowledgeAlert(body.alert_id);
        break;
      case 'resolve':
        alert = resolveAlert(body.alert_id);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action. Must be: acknowledge or resolve' },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, alert });
  } catch (error) {
    console.error('Error updating supervisor alert:', error);
    return NextResponse.json(
      { error: 'Failed to update alert' },
      { status: 500 }
    );
  }
}
