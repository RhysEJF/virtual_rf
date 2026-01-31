/**
 * Escalation Insights API
 *
 * GET /api/insights/escalations - Get aggregated escalation data by trigger_type
 *
 * Query params:
 * - from: Unix timestamp to filter escalations from (optional)
 * - to: Unix timestamp to filter escalations to (optional)
 * - outcome_id: Filter by specific outcome (optional)
 * - status: Filter by status ('pending', 'answered', 'dismissed') (optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { HomrEscalation, HomrEscalationStatus } from '@/lib/db/schema';

interface TriggerTypeAggregation {
  trigger_type: string;
  count: number;
  pending_count: number;
  answered_count: number;
  dismissed_count: number;
  avg_resolution_time_ms: number | null;
  recent_escalations: {
    id: string;
    outcome_id: string;
    question_text: string;
    status: HomrEscalationStatus;
    created_at: number;
  }[];
}

interface InsightsResponse {
  total_escalations: number;
  by_trigger_type: TriggerTypeAggregation[];
  by_status: {
    pending: number;
    answered: number;
    dismissed: number;
  };
  avg_resolution_time_ms: number | null;
  time_range: {
    from: number | null;
    to: number | null;
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  // Parse query params
  const fromTimestamp = searchParams.get('from')
    ? parseInt(searchParams.get('from')!, 10)
    : null;
  const toTimestamp = searchParams.get('to')
    ? parseInt(searchParams.get('to')!, 10)
    : null;
  const outcomeId = searchParams.get('outcome_id');
  const status = searchParams.get('status') as HomrEscalationStatus | null;

  const db = getDb();

  // Build WHERE clause
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (fromTimestamp) {
    conditions.push('created_at >= ?');
    params.push(fromTimestamp);
  }
  if (toTimestamp) {
    conditions.push('created_at <= ?');
    params.push(toTimestamp);
  }
  if (outcomeId) {
    conditions.push('outcome_id = ?');
    params.push(outcomeId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get all escalations matching filters
  const escalations = db.prepare(`
    SELECT * FROM homr_escalations
    ${whereClause}
    ORDER BY created_at DESC
  `).all(...params) as HomrEscalation[];

  // Calculate status counts
  const statusCounts = {
    pending: 0,
    answered: 0,
    dismissed: 0,
  };

  for (const esc of escalations) {
    statusCounts[esc.status as keyof typeof statusCounts]++;
  }

  // Aggregate by trigger_type
  const triggerTypeMap = new Map<string, {
    escalations: HomrEscalation[];
    pending: number;
    answered: number;
    dismissed: number;
    resolutionTimes: number[];
  }>();

  for (const esc of escalations) {
    const triggerType = esc.trigger_type;

    if (!triggerTypeMap.has(triggerType)) {
      triggerTypeMap.set(triggerType, {
        escalations: [],
        pending: 0,
        answered: 0,
        dismissed: 0,
        resolutionTimes: [],
      });
    }

    const agg = triggerTypeMap.get(triggerType)!;
    agg.escalations.push(esc);
    agg[esc.status as 'pending' | 'answered' | 'dismissed']++;

    // Calculate resolution time for answered/dismissed escalations
    if (esc.answered_at && esc.created_at) {
      agg.resolutionTimes.push(esc.answered_at - esc.created_at);
    }
  }

  // Build aggregation response
  const byTriggerType: TriggerTypeAggregation[] = [];

  const triggerTypeEntries = Array.from(triggerTypeMap.entries());
  for (const [triggerType, data] of triggerTypeEntries) {
    const avgResolutionTime = data.resolutionTimes.length > 0
      ? Math.round(data.resolutionTimes.reduce((a: number, b: number) => a + b, 0) / data.resolutionTimes.length)
      : null;

    byTriggerType.push({
      trigger_type: triggerType,
      count: data.escalations.length,
      pending_count: data.pending,
      answered_count: data.answered,
      dismissed_count: data.dismissed,
      avg_resolution_time_ms: avgResolutionTime,
      recent_escalations: data.escalations.slice(0, 5).map((esc: HomrEscalation) => ({
        id: esc.id,
        outcome_id: esc.outcome_id,
        question_text: esc.question_text,
        status: esc.status,
        created_at: esc.created_at,
      })),
    });
  }

  // Sort by count descending
  byTriggerType.sort((a, b) => b.count - a.count);

  // Calculate overall average resolution time
  const allResolutionTimes: number[] = [];
  for (const esc of escalations) {
    if (esc.answered_at && esc.created_at) {
      allResolutionTimes.push(esc.answered_at - esc.created_at);
    }
  }
  const overallAvgResolutionTime = allResolutionTimes.length > 0
    ? Math.round(allResolutionTimes.reduce((a: number, b: number) => a + b, 0) / allResolutionTimes.length)
    : null;

  const response: InsightsResponse = {
    total_escalations: escalations.length,
    by_trigger_type: byTriggerType,
    by_status: statusCounts,
    avg_resolution_time_ms: overallAvgResolutionTime,
    time_range: {
      from: fromTimestamp,
      to: toTimestamp,
    },
  };

  return NextResponse.json(response);
}
